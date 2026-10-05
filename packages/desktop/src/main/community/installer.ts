/**
 * Installs a community plugin from a folder or a ZIP into
 * `<userData>/plugins/<id>/`. The copy is staged, validated, then renamed
 * into place. A failed install leaves the previous copy untouched.
 */

import fs from 'fs'
import path from 'path'
import { MAX_FILE_BYTES, MAX_FILE_COUNT, MAX_UNCOMPRESSED_BYTES } from '@shared/plugins/community'
import { validateCommunityManifest, type ManifestCheckOptions } from '@shared/plugins/communitySchema'
import type { CommunityManifest } from '@shared/plugins/community'
import { ZipError } from '@shared/plugins/zipFormat'
import { readZip, writeZipFiles } from './zip'

export class InstallError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InstallError'
  }
}

const assertSafeTree = (root: string): void => {
  let files = 0
  let bytes = 0
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === '.' || entry.name === '..') continue
      const full = path.join(dir, entry.name)
      if (entry.isSymbolicLink()) throw new InstallError(`Symlink not allowed: ${entry.name}`)
      if (entry.isDirectory()) {
        walk(full)
        continue
      }
      if (!entry.isFile()) throw new InstallError(`Unsupported file: ${entry.name}`)
      const size = fs.statSync(full).size
      files += 1
      bytes += size
      if (files > MAX_FILE_COUNT) throw new InstallError('Plugin has too many files')
      if (size > MAX_FILE_BYTES) throw new InstallError(`File exceeds the size limit: ${entry.name}`)
      if (bytes > MAX_UNCOMPRESSED_BYTES) throw new InstallError('Plugin exceeds the size limit')
    }
  }
  walk(root)
}

const readManifestFile = (dir: string, options: ManifestCheckOptions): CommunityManifest => {
  const manifestPath = path.join(dir, 'manifest.json')
  if (!fs.existsSync(manifestPath) || !fs.statSync(manifestPath).isFile()) {
    throw new InstallError('manifest.json is missing')
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  } catch {
    throw new InstallError('manifest.json is not valid JSON')
  }
  const checked = validateCommunityManifest(parsed, options)
  if (!checked.ok) throw new InstallError(checked.issues.join('; '))
  return checked.manifest
}

const assertDeclaredFiles = (dir: string, manifest: CommunityManifest): void => {
  const required = [manifest.main, ...(manifest.panels ?? []).map((panel) => panel.entry)]
  for (const relative of required) {
    const full = path.join(dir, relative)
    if (!full.startsWith(dir + path.sep) && full !== dir) throw new InstallError(`Path escapes the plugin: ${relative}`)
    if (!fs.existsSync(full) || !fs.statSync(full).isFile()) {
      throw new InstallError(`Declared file is missing: ${relative}`)
    }
  }
}

const stagingName = (id: string): string => `.staging-${id}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

const commitStaging = (pluginsRoot: string, id: string, staging: string): string => {
  const destination = path.join(pluginsRoot, id)
  fs.rmSync(destination, { recursive: true, force: true })
  fs.renameSync(staging, destination)
  return destination
}

export interface InstallOptions extends ManifestCheckOptions {
  pluginsRoot: string
}

/**
 * Copies `sourceDir` into `pluginsRoot/<id>` after validation. Returns the
 * accepted manifest. The plugin is not enabled; the caller records that.
 */
export const installFromFolder = (sourceDir: string, options: InstallOptions): CommunityManifest => {
  const resolved = path.resolve(sourceDir)
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
    throw new InstallError('Plugin folder was not found')
  }
  assertSafeTree(resolved)
  const manifest = readManifestFile(resolved, options)
  assertDeclaredFiles(resolved, manifest)
  fs.mkdirSync(options.pluginsRoot, { recursive: true })
  const staging = path.join(options.pluginsRoot, stagingName(manifest.id))
  fs.cpSync(resolved, staging, { recursive: true, dereference: false })
  try {
    assertSafeTree(staging)
    assertDeclaredFiles(staging, manifest)
    commitStaging(options.pluginsRoot, manifest.id, staging)
  } catch (err) {
    fs.rmSync(staging, { recursive: true, force: true })
    throw err
  }
  return manifest
}

const manifestRoot = (files: Map<string, Buffer>): string => {
  if (files.has('manifest.json')) return ''
  const tops = new Set<string>()
  for (const name of files.keys()) tops.add(name.split('/')[0])
  const top = [...tops][0]
  if (tops.size === 1 && top && files.has(`${top}/manifest.json`)) return top
  throw new InstallError('manifest.json is missing')
}

const stripRoot = (files: Map<string, Buffer>, root: string): Map<string, Buffer> => {
  if (!root) return files
  const stripped = new Map<string, Buffer>()
  const prefix = `${root}/`
  for (const [name, data] of files) {
    if (name === root) continue
    if (!name.startsWith(prefix)) throw new InstallError('ZIP has files outside its plugin folder')
    stripped.set(name.slice(prefix.length), data)
  }
  return stripped
}

/** Extracts `zipPath` into `pluginsRoot/<id>` with the same checks as a folder install. */
export const installFromZip = (zipPath: string, options: InstallOptions): CommunityManifest => {
  const resolved = path.resolve(zipPath)
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
    throw new InstallError('ZIP file was not found')
  }
  const size = fs.statSync(resolved).size
  if (size > 32 * 1024 * 1024) throw new InstallError('ZIP archive exceeds the size limit')
  let extracted: Map<string, Buffer>
  try {
    extracted = stripRoot(readZip(fs.readFileSync(resolved)).files, '')
  } catch (err) {
    if (err instanceof ZipError) throw new InstallError(err.message)
    throw err
  }
  let root = ''
  try {
    root = manifestRoot(extracted)
  } catch (err) {
    if (err instanceof InstallError) throw err
    throw new InstallError('manifest.json is missing')
  }
  const files = stripRoot(extracted, root)
  fs.mkdirSync(options.pluginsRoot, { recursive: true })
  const stagingId = `zip-${Date.now().toString(36)}`
  const staging = path.join(options.pluginsRoot, stagingName(stagingId))
  try {
    writeZipFiles(staging, files)
    assertSafeTree(staging)
    const manifest = readManifestFile(staging, options)
    assertDeclaredFiles(staging, manifest)
    commitStaging(options.pluginsRoot, manifest.id, staging)
    return manifest
  } catch (err) {
    fs.rmSync(staging, { recursive: true, force: true })
    if (err instanceof ZipError) throw new InstallError(err.message)
    throw err
  }
}

/** Deletes `<pluginsRoot>/<id>`. Refuses ids that are not a single path segment. */
export const uninstallPluginDir = (pluginsRoot: string, id: string): void => {
  if (!/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/.test(id)) {
    throw new InstallError('Invalid plugin id')
  }
  const destination = path.join(pluginsRoot, id)
  const relative = path.relative(pluginsRoot, destination)
  if (relative !== id) throw new InstallError('Invalid plugin id')
  fs.rmSync(destination, { recursive: true, force: true })
}
