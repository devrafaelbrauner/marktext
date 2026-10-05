/**
 * ZIP parsing for the community installer without the inflater: the central
 * directory, zip-slip and symlink checks, size caps and CRC. Desktop inflates
 * with zlib, Android with `DecompressionStream`; both run these checks.
 */

import { MAX_ARCHIVE_BYTES, MAX_FILE_BYTES, MAX_FILE_COUNT, MAX_UNCOMPRESSED_BYTES } from './community'

const EOCD = 0x06054b50
const CENTRAL = 0x02014b50
const LOCAL = 0x04034b50
const UNIX_SYMLINK = 0o120000

export const ZIP_STORED = 0
export const ZIP_DEFLATED = 8

export class ZipError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ZipError'
  }
}

/** A file entry that passed every check that does not need its uncompressed bytes. */
export interface ZipFileEntry {
  /** Original entry name, for messages. */
  name: string
  /** Safe relative destination. */
  relative: string
  method: number
  /** Compressed bytes (a view into the archive). */
  compressed: Uint8Array
  crc: number
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

export const crc32 = (data: Uint8Array): number => {
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

const findEocd = (view: DataView): number => {
  const min = Math.max(0, view.byteLength - 0x10015)
  for (let offset = view.byteLength - 22; offset >= min; offset--) {
    if (view.getUint32(offset, true) === EOCD) return offset
  }
  return -1
}

const utf8 = new TextDecoder()

const readCentralDirectory = (bytes: Uint8Array, view: DataView): CentralEntry[] => {
  const eocd = findEocd(view)
  if (eocd < 0) throw new ZipError('ZIP end of central directory not found')
  const count = view.getUint16(eocd + 10, true)
  const size = view.getUint32(eocd + 12, true)
  const offset = view.getUint32(eocd + 16, true)
  if (count === 0xffff || size === 0xffffffff || offset === 0xffffffff) {
    throw new ZipError('ZIP64 archives are not supported')
  }
  if (offset + size > bytes.length) throw new ZipError('ZIP central directory is truncated')
  const entries: CentralEntry[] = []
  let cursor = offset
  for (let i = 0; i < count; i++) {
    if (cursor + 46 > bytes.length || view.getUint32(cursor, true) !== CENTRAL) {
      throw new ZipError('ZIP central directory is truncated')
    }
    const method = view.getUint16(cursor + 10, true)
    const crc = view.getUint32(cursor + 16, true)
    const compressedSize = view.getUint32(cursor + 20, true)
    const uncompressedSize = view.getUint32(cursor + 24, true)
    const nameLength = view.getUint16(cursor + 28, true)
    const extraLength = view.getUint16(cursor + 30, true)
    const commentLength = view.getUint16(cursor + 32, true)
    const external = view.getUint32(cursor + 38, true)
    const localOffset = view.getUint32(cursor + 42, true)
    const name = utf8.decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength))
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

const compressedData = (bytes: Uint8Array, view: DataView, entry: CentralEntry): Uint8Array => {
  if (entry.localOffset + 30 > bytes.length || view.getUint32(entry.localOffset, true) !== LOCAL) {
    throw new ZipError(`ZIP local header missing for ${entry.name}`)
  }
  const nameLength = view.getUint16(entry.localOffset + 26, true)
  const extraLength = view.getUint16(entry.localOffset + 28, true)
  const dataStart = entry.localOffset + 30 + nameLength + extraLength
  const dataEnd = dataStart + entry.compressedSize
  if (dataEnd > bytes.length) throw new ZipError(`ZIP entry is truncated: ${entry.name}`)
  if (entry.method !== ZIP_STORED && entry.method !== ZIP_DEFLATED) {
    throw new ZipError(`ZIP compression method ${entry.method} is not supported`)
  }
  return bytes.subarray(dataStart, dataEnd)
}

/**
 * File entries of `bytes`. Throws `ZipError` on slip, symlink, size-cap and
 * format failures. Directory entries are omitted; nothing is inflated.
 */
export const listZipFiles = (bytes: Uint8Array): ZipFileEntry[] => {
  if (bytes.length > MAX_ARCHIVE_BYTES) throw new ZipError('ZIP archive exceeds the size limit')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const entries = readCentralDirectory(bytes, view)
  if (entries.length > MAX_FILE_COUNT) throw new ZipError('ZIP archive has too many entries')
  const files: ZipFileEntry[] = []
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
    files.push({ name: entry.name, relative, method: entry.method, compressed: compressedData(bytes, view, entry), crc: entry.crc })
  }
  return files
}

/** Checks the uncompressed `data` of `entry` against the file cap and its CRC; returns `data`. */
export const verifyZipFile = (entry: ZipFileEntry, data: Uint8Array): Uint8Array => {
  if (data.length > MAX_FILE_BYTES) throw new ZipError(`ZIP entry exceeds the file size limit: ${entry.name}`)
  if (crc32(data) !== entry.crc) throw new ZipError(`ZIP entry checksum failed: ${entry.name}`)
  return data
}
