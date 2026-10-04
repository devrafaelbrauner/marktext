/**
 * Installed community plugins under `<userData>/plugins/<id>/` plus the
 * permissions the user granted, in `community-grants.json`. Built-in ids
 * cannot be installed. A corrupt folder is skipped so one bad plugin cannot
 * stop the app.
 */

import fs from 'fs'
import path from 'path'
import type { CommunityManifest, CommunityPluginRecord } from '@shared/plugins/community'
import { validateCommunityManifest } from '@shared/plugins/communitySchema'
import { installFromFolder, installFromZip, InstallError, uninstallPluginDir } from './installer'

interface GrantsFile {
  granted: Record<string, string[]>
}

export interface CommunityRegistryOptions {
  userDataPath: string
  builtinIds: readonly string[]
  appVersion: string
  log?(message: string): void
}

export class CommunityRegistry {
  readonly pluginsRoot: string
  private readonly grantsPath: string
  private grants: GrantsFile = { granted: {} }
  private cache: CommunityPluginRecord[] | null = null

  constructor(private readonly options: CommunityRegistryOptions) {
    this.pluginsRoot = path.join(options.userDataPath, 'plugins')
    this.grantsPath = path.join(options.userDataPath, 'community-grants.json')
    this.grants = this.readGrants()
  }

  records(): readonly CommunityPluginRecord[] {
    if (!this.cache) this.cache = this.scan()
    return this.cache
  }

  get(id: string): CommunityPluginRecord | undefined {
    return this.records().find((record) => record.id === id)
  }

  installFolder(sourceDir: string): CommunityPluginRecord {
    const manifest = installFromFolder(sourceDir, this.installOptions())
    return this.afterInstall(manifest)
  }

  installZip(zipPath: string): CommunityPluginRecord {
    const manifest = installFromZip(zipPath, this.installOptions())
    return this.afterInstall(manifest)
  }

  /** Removes the folder and the grant. The caller disables the plugin first. */
  uninstall(id: string): void {
    if (!this.get(id)) throw new InstallError(`Plugin "${id}" is not installed`)
    uninstallPluginDir(this.pluginsRoot, id)
    delete this.grants.granted[id]
    this.writeGrants()
    this.cache = null
  }

  /** Records consent for every permission the current manifest declares. */
  grant(id: string): void {
    const record = this.get(id)
    if (!record) throw new InstallError(`Plugin "${id}" is not installed`)
    this.grants.granted[id] = [...record.permissions]
    this.writeGrants()
    this.cache = null
  }

  private afterInstall(manifest: CommunityManifest): CommunityPluginRecord {
    delete this.grants.granted[manifest.id]
    this.writeGrants()
    this.cache = null
    const record = this.get(manifest.id)
    if (!record) throw new InstallError('Installed plugin could not be read back')
    return record
  }

  private installOptions() {
    return {
      pluginsRoot: this.pluginsRoot,
      appVersion: this.options.appVersion,
      builtinIds: this.options.builtinIds
    }
  }

  private scan(): CommunityPluginRecord[] {
    if (!fs.existsSync(this.pluginsRoot)) return []
    const records: CommunityPluginRecord[] = []
    for (const entry of fs.readdirSync(this.pluginsRoot, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith('.') || entry.isSymbolicLink()) continue
      const dir = path.join(this.pluginsRoot, entry.name)
      const manifestPath = path.join(dir, 'manifest.json')
      if (!fs.existsSync(manifestPath)) continue
      let parsed: unknown
      try {
        parsed = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
      } catch (err) {
        this.options.log?.(`Skipping community plugin ${entry.name}: ${err instanceof Error ? err.message : String(err)}`)
        continue
      }
      const checked = validateCommunityManifest(parsed, {
        appVersion: this.options.appVersion,
        builtinIds: this.options.builtinIds
      })
      if (!checked.ok) {
        this.options.log?.(`Skipping community plugin ${entry.name}: ${checked.issues.join('; ')}`)
        continue
      }
      if (checked.manifest.id !== entry.name) {
        this.options.log?.(`Skipping ${entry.name}: manifest id is ${checked.manifest.id}`)
        continue
      }
      const granted = this.grants.granted[checked.manifest.id] ?? []
      records.push({
        ...checked.manifest,
        grantedPermissions: granted.filter((permission) => checked.manifest.permissions.includes(permission))
      })
    }
    records.sort((a, b) => a.id.localeCompare(b.id))
    return records
  }

  private readGrants(): GrantsFile {
    try {
      const parsed: unknown = JSON.parse(fs.readFileSync(this.grantsPath, 'utf8'))
      if (!parsed || typeof parsed !== 'object' || !('granted' in parsed)) return { granted: {} }
      const granted = parsed.granted
      if (!granted || typeof granted !== 'object' || Array.isArray(granted)) return { granted: {} }
      const clean: Record<string, string[]> = {}
      for (const [id, value] of Object.entries(granted)) {
        if (!Array.isArray(value)) continue
        clean[id] = value.filter((item): item is string => typeof item === 'string')
      }
      return { granted: clean }
    } catch {
      return { granted: {} }
    }
  }

  private writeGrants(): void {
    fs.mkdirSync(this.options.userDataPath, { recursive: true })
    fs.writeFileSync(this.grantsPath, JSON.stringify(this.grants), 'utf8')
  }
}
