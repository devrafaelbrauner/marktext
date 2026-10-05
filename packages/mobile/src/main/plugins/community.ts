// Installed community plugins on Android, mirroring desktop
// `main/community/{registry,installer}.ts` over the FileBackend: plugins live
// in `<userData>/plugins/<id>/`, granted permissions in
// `<userData>/community-grants.json`. Installs are staged, validated with the
// shared manifest schema, then renamed into place; a failed install leaves
// the previous copy untouched.
//
// The native PluginRequestHandler serves `https://<id>.plugin.local/` from
// `<userData>/plugins/<id>/` only while `<userData>/plugin-host/<id>/` holds
// the host documents written by `syncServable` (enabled plugins only).

import { posix } from 'pathe'
import {
  androidPluginOrigin,
  MAX_FILE_BYTES,
  MAX_FILE_COUNT,
  MAX_UNCOMPRESSED_BYTES,
  pluginResponseCsp,
  PLUGIN_ID_PATTERN,
  type CommunityManifest,
  type CommunityPluginRecord
} from '@shared/plugins/community'
import { renderBootstrapHtml, renderBootstrapScript } from '@shared/plugins/communityBootstrap'
import { validateCommunityManifest } from '@shared/plugins/communitySchema'
import { safeZipEntryName, ZipError } from '@shared/plugins/zipFormat'
import type { PluginHostState } from '@shared/plugins/types'
import type { FileBackend } from '../fs/backend'
import { readZip } from './zip'

/** Same cap as the desktop installer. */
const MAX_ZIP_BYTES = 32 * 1024 * 1024

export class InstallError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InstallError'
  }
}

export interface CommunityRegistryOptions {
  backend: FileBackend
  userDataPath: string
  builtinIds: readonly string[]
  appVersion: string
  log(message: string): void
}

const join = posix.join

export class MobileCommunityRegistry {
  readonly pluginsRoot: string
  readonly hostRoot: string
  private readonly grantsPath: string
  private grants: Record<string, string[]> = {}
  private cache: CommunityPluginRecord[] = []
  /** Tail of the mutation chain: installs, grants and host-document syncs never interleave. */
  private queue: Promise<unknown> = Promise.resolve()

  constructor(private readonly options: CommunityRegistryOptions) {
    this.pluginsRoot = join(options.userDataPath, 'plugins')
    this.hostRoot = join(options.userDataPath, 'plugin-host')
    this.grantsPath = join(options.userDataPath, 'community-grants.json')
  }

  /** Reads grants and scans the plugins folder; call before `records()`. */
  async load(): Promise<void> {
    this.grants = await this.readGrants()
    await this.rescan()
  }

  /** Installed plugins as of the last load or change (the desktop host reads this synchronously). */
  records(): readonly CommunityPluginRecord[] {
    return this.cache
  }

  get(id: string): CommunityPluginRecord | undefined {
    return this.cache.find((record) => record.id === id)
  }

  /** Copies the folder at `sourceDir` (any backend path, e.g. a SAF tree) into `plugins/<id>`. */
  installFolder(sourceDir: string): Promise<CommunityPluginRecord> {
    return this.serial(() => this.installFolderNow(sourceDir))
  }

  /** Extracts the ZIP at `zipPath` into `plugins/<id>` with the same checks as a folder install. */
  installZip(zipPath: string): Promise<CommunityPluginRecord> {
    return this.serial(() => this.installZipNow(zipPath))
  }

  /** Removes the folder, its host documents and the grant. The caller disables the plugin first. */
  uninstall(id: string): Promise<void> {
    return this.serial(() => this.uninstallNow(id))
  }

  /** Records consent for every permission the current manifest declares. */
  grant(id: string): Promise<void> {
    return this.serial(() => this.grantNow(id))
  }

  /**
   * Writes the host documents (bootstrap, CSP) of every plugin the state
   * enables and removes those of the others, so the native handler serves
   * exactly the enabled plugins (desktop `isServable`).
   */
  syncServable(state: PluginHostState): Promise<void> {
    return this.serial(() => this.syncServableNow(state))
  }

  private serial<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task, task)
    this.queue = run.catch(() => {})
    return run
  }

  private async installFolderNow(sourceDir: string): Promise<CommunityPluginRecord> {
    const { backend } = this.options
    if (!(await backend.stat(sourceDir))?.isDirectory) throw new InstallError('Plugin folder was not found')
    const sourceFiles = await this.assertSafeTree(sourceDir)
    const manifest = await this.readManifestFile(sourceDir)
    await this.assertDeclaredFiles(sourceDir, manifest)
    const staging = await this.newStaging(manifest.id)
    try {
      for (const relative of sourceFiles) {
        await backend.writeFile(join(staging, relative), await backend.readFile(join(sourceDir, relative)))
      }
      await this.assertSafeTree(staging)
      await this.assertDeclaredFiles(staging, manifest)
      await this.commitStaging(manifest.id, staging)
    } catch (err) {
      await backend.remove(staging).catch(() => {})
      throw err
    }
    return this.afterInstall(manifest)
  }

  private async installZipNow(zipPath: string): Promise<CommunityPluginRecord> {
    const { backend } = this.options
    const stat = await backend.stat(zipPath)
    if (!stat?.isFile) throw new InstallError('ZIP file was not found')
    if (stat.size > MAX_ZIP_BYTES) throw new InstallError('ZIP archive exceeds the size limit')
    let files: Map<string, Uint8Array>
    try {
      files = await readZip(await backend.readFile(zipPath))
    } catch (err) {
      if (err instanceof ZipError) throw new InstallError(err.message)
      throw err
    }
    files = stripRoot(files, manifestRoot(files))
    const staging = await this.newStaging(`zip-${Date.now().toString(36)}`)
    try {
      for (const [name, data] of files) {
        const relative = safeZipEntryName(name)
        const target = relative ? join(staging, relative) : ''
        if (!relative || !target.startsWith(`${staging}/`)) {
          throw new InstallError(`ZIP entry escapes the plugin directory: ${name}`)
        }
        await backend.writeFile(target, data)
      }
      await this.assertSafeTree(staging)
      const manifest = await this.readManifestFile(staging)
      await this.assertDeclaredFiles(staging, manifest)
      await this.commitStaging(manifest.id, staging)
      return await this.afterInstall(manifest)
    } catch (err) {
      await backend.remove(staging).catch(() => {})
      throw err
    }
  }

  private async uninstallNow(id: string): Promise<void> {
    if (!this.get(id) || !PLUGIN_ID_PATTERN.test(id)) throw new InstallError(`Plugin "${id}" is not installed`)
    await this.removeIfPresent(join(this.hostRoot, id))
    await this.removeIfPresent(join(this.pluginsRoot, id))
    delete this.grants[id]
    await this.writeGrants()
    await this.rescan()
  }

  private async grantNow(id: string): Promise<void> {
    const record = this.get(id)
    if (!record) throw new InstallError(`Plugin "${id}" is not installed`)
    this.grants[id] = [...record.permissions]
    await this.writeGrants()
    await this.rescan()
  }

  private async syncServableNow(state: PluginHostState): Promise<void> {
    const { backend } = this.options
    for (const record of this.cache) {
      const dir = join(this.hostRoot, record.id)
      if (!state.safeMode && state.enabled[record.id]) {
        const origin = androidPluginOrigin(record.id)
        await backend.writeFile(join(dir, 'bootstrap.js'), renderBootstrapScript(record.id, record.main))
        await backend.writeFile(join(dir, 'bootstrap.html'), renderBootstrapHtml(origin))
        await backend.writeFile(join(dir, 'csp.txt'), pluginResponseCsp(record.id, origin))
      } else {
        await this.removeIfPresent(dir)
      }
    }
  }

  private async afterInstall(manifest: CommunityManifest): Promise<CommunityPluginRecord> {
    delete this.grants[manifest.id]
    await this.writeGrants()
    await this.rescan()
    const record = this.get(manifest.id)
    if (!record) throw new InstallError('Installed plugin could not be read back')
    return record
  }

  private manifestOptions() {
    return { appVersion: this.options.appVersion, builtinIds: this.options.builtinIds }
  }

  /** Relative paths of every file below `root`, enforcing the count and size caps. */
  private async assertSafeTree(root: string): Promise<string[]> {
    const { backend } = this.options
    const files: string[] = []
    let bytes = 0
    const walk = async(relativeDir: string): Promise<void> => {
      for (const entry of await backend.readdir(join(root, relativeDir))) {
        const relative = relativeDir ? `${relativeDir}/${entry.name}` : entry.name
        if (entry.isDirectory) {
          await walk(relative)
          continue
        }
        if (!entry.isFile) throw new InstallError(`Unsupported file: ${entry.name}`)
        const size = (await backend.stat(join(root, relative)))?.size ?? 0
        files.push(relative)
        bytes += size
        if (files.length > MAX_FILE_COUNT) throw new InstallError('Plugin has too many files')
        if (size > MAX_FILE_BYTES) throw new InstallError(`File exceeds the size limit: ${entry.name}`)
        if (bytes > MAX_UNCOMPRESSED_BYTES) throw new InstallError('Plugin exceeds the size limit')
      }
    }
    await walk('')
    return files
  }

  private async readManifestFile(dir: string): Promise<CommunityManifest> {
    const { backend } = this.options
    const manifestPath = join(dir, 'manifest.json')
    if (!(await backend.stat(manifestPath))?.isFile) throw new InstallError('manifest.json is missing')
    let parsed: unknown
    try {
      parsed = JSON.parse(await backend.readText(manifestPath))
    } catch {
      throw new InstallError('manifest.json is not valid JSON')
    }
    const checked = validateCommunityManifest(parsed, this.manifestOptions())
    if (!checked.ok) throw new InstallError(checked.issues.join('; '))
    return checked.manifest
  }

  private async assertDeclaredFiles(dir: string, manifest: CommunityManifest): Promise<void> {
    const required = [manifest.main, ...(manifest.panels ?? []).map((panel) => panel.entry)]
    for (const relative of required) {
      const full = join(dir, relative)
      if (!full.startsWith(`${dir}/`)) throw new InstallError(`Path escapes the plugin: ${relative}`)
      if (!(await this.options.backend.stat(full))?.isFile) {
        throw new InstallError(`Declared file is missing: ${relative}`)
      }
    }
  }

  private async newStaging(id: string): Promise<string> {
    const staging = join(
      this.pluginsRoot,
      `.staging-${id}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
    )
    await this.options.backend.mkdirp(staging)
    return staging
  }

  private async commitStaging(id: string, staging: string): Promise<void> {
    const destination = join(this.pluginsRoot, id)
    await this.removeIfPresent(destination)
    await this.options.backend.rename(staging, destination)
  }

  private async removeIfPresent(path: string): Promise<void> {
    if (await this.options.backend.stat(path)) await this.options.backend.remove(path)
  }

  private async rescan(): Promise<void> {
    const { backend, log } = this.options
    const records: CommunityPluginRecord[] = []
    const entries = (await backend.stat(this.pluginsRoot))?.isDirectory ? await backend.readdir(this.pluginsRoot) : []
    for (const entry of entries) {
      if (!entry.isDirectory || entry.name.startsWith('.')) continue
      const manifestPath = join(this.pluginsRoot, entry.name, 'manifest.json')
      if (!(await backend.stat(manifestPath))?.isFile) continue
      let parsed: unknown
      try {
        parsed = JSON.parse(await backend.readText(manifestPath))
      } catch (err) {
        log(`Skipping community plugin ${entry.name}: ${err instanceof Error ? err.message : String(err)}`)
        continue
      }
      const checked = validateCommunityManifest(parsed, this.manifestOptions())
      if (!checked.ok) {
        log(`Skipping community plugin ${entry.name}: ${checked.issues.join('; ')}`)
        continue
      }
      if (checked.manifest.id !== entry.name) {
        log(`Skipping ${entry.name}: manifest id is ${checked.manifest.id}`)
        continue
      }
      const granted = this.grants[checked.manifest.id] ?? []
      records.push({
        ...checked.manifest,
        grantedPermissions: granted.filter((permission) => checked.manifest.permissions.includes(permission))
      })
    }
    records.sort((a, b) => a.id.localeCompare(b.id))
    this.cache = records
  }

  private async readGrants(): Promise<Record<string, string[]>> {
    try {
      const parsed: unknown = JSON.parse(await this.options.backend.readText(this.grantsPath))
      if (!parsed || typeof parsed !== 'object' || !('granted' in parsed)) return {}
      const granted = parsed.granted
      if (!granted || typeof granted !== 'object' || Array.isArray(granted)) return {}
      const clean: Record<string, string[]> = {}
      for (const [id, value] of Object.entries(granted)) {
        if (!Array.isArray(value)) continue
        clean[id] = value.filter((item): item is string => typeof item === 'string')
      }
      return clean
    } catch {
      return {}
    }
  }

  private async writeGrants(): Promise<void> {
    await this.options.backend.writeFile(this.grantsPath, JSON.stringify({ granted: this.grants }))
  }
}

/** Folder inside the ZIP that holds manifest.json: the root, or its single top-level folder. */
const manifestRoot = (files: Map<string, Uint8Array>): string => {
  if (files.has('manifest.json')) return ''
  const tops = new Set<string>()
  for (const name of files.keys()) tops.add(name.split('/')[0])
  const top = [...tops][0]
  if (tops.size === 1 && top && files.has(`${top}/manifest.json`)) return top
  throw new InstallError('manifest.json is missing')
}

const stripRoot = (files: Map<string, Uint8Array>, root: string): Map<string, Uint8Array> => {
  if (!root) return files
  const stripped = new Map<string, Uint8Array>()
  const prefix = `${root}/`
  for (const [name, data] of files) {
    if (name === root) continue
    if (!name.startsWith(prefix)) throw new InstallError('ZIP has files outside its plugin folder')
    stripped.set(name.slice(prefix.length), data)
  }
  return stripped
}
