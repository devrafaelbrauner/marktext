/**
 * Minimal ZIP reader for the community installer. Supports stored and
 * deflated entries. Zip-slip, absolute names, backslashes and symlink
 * entries are rejected (`@shared/plugins/zipFormat`) before any byte is
 * written outside the destination.
 */

import fs from 'fs'
import path from 'path'
import zlib from 'zlib'
import { listZipFiles, safeZipEntryName, verifyZipFile, ZIP_STORED, ZipError } from '@shared/plugins/zipFormat'

export interface ExtractedZip {
  /** Files relative to the extraction root. Directory entries are omitted. */
  files: Map<string, Buffer>
}

/**
 * Reads `buffer` and returns its files. Throws `ZipError` on slip, symlink,
 * size-cap and format failures. Nothing is written to disk.
 */
export const readZip = (buffer: Buffer): ExtractedZip => {
  const files = new Map<string, Buffer>()
  for (const entry of listZipFiles(buffer)) {
    let data: Buffer
    if (entry.method === ZIP_STORED) {
      data = Buffer.from(entry.compressed)
    } else {
      try {
        data = zlib.inflateRawSync(entry.compressed)
      } catch {
        throw new ZipError(`ZIP entry could not be inflated: ${entry.name}`)
      }
    }
    verifyZipFile(entry, data)
    files.set(entry.relative, data)
  }
  return { files }
}

/**
 * Writes `files` under `destination`. Each name is checked again so a caller
 * cannot pass a slipped path that skipped `readZip`.
 */
export const writeZipFiles = (destination: string, files: Map<string, Buffer>): void => {
  fs.mkdirSync(destination, { recursive: true })
  const root = fs.realpathSync(destination)
  for (const [name, data] of files) {
    const relative = safeZipEntryName(name)
    if (!relative) throw new ZipError(`ZIP entry escapes the plugin directory: ${name}`)
    const target = path.resolve(root, relative)
    const fromRoot = path.relative(root, target)
    if (fromRoot.startsWith('..') || path.isAbsolute(fromRoot)) {
      throw new ZipError(`ZIP entry escapes the plugin directory: ${name}`)
    }
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, data)
  }
}
