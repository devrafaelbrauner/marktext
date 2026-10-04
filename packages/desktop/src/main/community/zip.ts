/**
 * Minimal ZIP reader for the community installer. Supports stored and
 * deflated entries. Zip-slip, absolute names, backslashes and symlink
 * entries are rejected before any byte is written outside the destination.
 */

import fs from 'fs'
import path from 'path'
import zlib from 'zlib'
import { MAX_ARCHIVE_BYTES, MAX_FILE_BYTES, MAX_FILE_COUNT, MAX_UNCOMPRESSED_BYTES } from '@shared/plugins/community'

const EOCD = 0x06054b50
const CENTRAL = 0x02014b50
const LOCAL = 0x04034b50
const UNIX_SYMLINK = 0o120000

export class ZipError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ZipError'
  }
}

interface CentralEntry {
  name: string
  method: number
  compressedSize: number
  uncompressedSize: number
  localOffset: number
  crc: number
  unixMode: number
  isDirectory: boolean
}

const crcTable = new Uint32Array(256)
for (let n = 0; n < 256; n++) {
  let c = n
  for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1)
  crcTable[n] = c >>> 0
}

const crc32 = (data: Buffer): number => {
  let crc = 0xffffffff
  for (const byte of data) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

/**
 * Relative destination of a zip entry name, or null when the name would
 * leave the extraction directory.
 */
export const safeZipEntryName = (name: string): string | null => {
  if (!name || name.includes('\0')) return null
  const normalized = name.replace(/\\/g, '/')
  if (normalized.startsWith('/') || /^[a-zA-Z]:/.test(normalized)) return null
  const segments = normalized.split('/').filter((segment) => segment.length > 0 && segment !== '.')
  if (segments.length === 0 || segments.some((segment) => segment === '..')) return null
  return segments.join('/')
}

const findEocd = (buffer: Buffer): number => {
  const min = Math.max(0, buffer.length - 0x10015)
  for (let offset = buffer.length - 22; offset >= min; offset--) {
    if (buffer.readUInt32LE(offset) === EOCD) return offset
  }
  return -1
}

const readCentralDirectory = (buffer: Buffer): CentralEntry[] => {
  const eocd = findEocd(buffer)
  if (eocd < 0) throw new ZipError('ZIP end of central directory not found')
  const count = buffer.readUInt16LE(eocd + 10)
  const size = buffer.readUInt32LE(eocd + 12)
  const offset = buffer.readUInt32LE(eocd + 16)
  if (count === 0xffff || size === 0xffffffff || offset === 0xffffffff) {
    throw new ZipError('ZIP64 archives are not supported')
  }
  if (offset + size > buffer.length) throw new ZipError('ZIP central directory is truncated')
  const entries: CentralEntry[] = []
  let cursor = offset
  for (let i = 0; i < count; i++) {
    if (cursor + 46 > buffer.length || buffer.readUInt32LE(cursor) !== CENTRAL) {
      throw new ZipError('ZIP central directory is truncated')
    }
    const method = buffer.readUInt16LE(cursor + 10)
    const crc = buffer.readUInt32LE(cursor + 16)
    const compressedSize = buffer.readUInt32LE(cursor + 20)
    const uncompressedSize = buffer.readUInt32LE(cursor + 24)
    const nameLength = buffer.readUInt16LE(cursor + 28)
    const extraLength = buffer.readUInt16LE(cursor + 30)
    const commentLength = buffer.readUInt16LE(cursor + 32)
    const external = buffer.readUInt32LE(cursor + 38)
    const localOffset = buffer.readUInt32LE(cursor + 42)
    const name = buffer.toString('utf8', cursor + 46, cursor + 46 + nameLength)
    const unixMode = (external >>> 16) & 0xffff
    entries.push({
      name,
      method,
      compressedSize,
      uncompressedSize,
      localOffset,
      crc,
      unixMode,
      isDirectory: name.endsWith('/') || (unixMode & 0o170000) === 0o040000
    })
    cursor += 46 + nameLength + extraLength + commentLength
  }
  return entries
}

const readEntry = (buffer: Buffer, entry: CentralEntry): Buffer => {
  if (entry.localOffset + 30 > buffer.length || buffer.readUInt32LE(entry.localOffset) !== LOCAL) {
    throw new ZipError(`ZIP local header missing for ${entry.name}`)
  }
  const nameLength = buffer.readUInt16LE(entry.localOffset + 26)
  const extraLength = buffer.readUInt16LE(entry.localOffset + 28)
  const dataStart = entry.localOffset + 30 + nameLength + extraLength
  const dataEnd = dataStart + entry.compressedSize
  if (dataEnd > buffer.length) throw new ZipError(`ZIP entry is truncated: ${entry.name}`)
  const compressed = buffer.subarray(dataStart, dataEnd)
  if (entry.method === 0) return Buffer.from(compressed)
  if (entry.method === 8) {
    try {
      return zlib.inflateRawSync(compressed)
    } catch {
      throw new ZipError(`ZIP entry could not be inflated: ${entry.name}`)
    }
  }
  throw new ZipError(`ZIP compression method ${entry.method} is not supported`)
}

export interface ExtractedZip {
  /** Files relative to the extraction root. Directory entries are omitted. */
  files: Map<string, Buffer>
}

/**
 * Reads `buffer` and returns its files. Throws `ZipError` on slip, symlink,
 * size-cap and format failures. Nothing is written to disk.
 */
export const readZip = (buffer: Buffer): ExtractedZip => {
  if (buffer.length > MAX_ARCHIVE_BYTES) throw new ZipError('ZIP archive exceeds the size limit')
  const entries = readCentralDirectory(buffer)
  if (entries.length > MAX_FILE_COUNT) throw new ZipError('ZIP archive has too many entries')
  const files = new Map<string, Buffer>()
  let total = 0
  for (const entry of entries) {
    if ((entry.unixMode & 0o170000) === UNIX_SYMLINK) {
      throw new ZipError(`ZIP symlink entries are not allowed: ${entry.name}`)
    }
    const relative = safeZipEntryName(entry.name)
    if (!relative) throw new ZipError(`ZIP entry escapes the plugin directory: ${entry.name}`)
    if (entry.isDirectory) continue
    if (entry.uncompressedSize > MAX_FILE_BYTES || entry.compressedSize > MAX_FILE_BYTES) {
      throw new ZipError(`ZIP entry exceeds the file size limit: ${entry.name}`)
    }
    total += entry.uncompressedSize
    if (total > MAX_UNCOMPRESSED_BYTES) throw new ZipError('ZIP archive exceeds the uncompressed size limit')
    const data = readEntry(buffer, entry)
    if (data.length > MAX_FILE_BYTES) throw new ZipError(`ZIP entry exceeds the file size limit: ${entry.name}`)
    if (crc32(data) !== entry.crc) throw new ZipError(`ZIP entry checksum failed: ${entry.name}`)
    files.set(relative, data)
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
