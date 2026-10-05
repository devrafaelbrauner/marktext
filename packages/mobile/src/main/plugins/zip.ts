// ZIP extraction for community plugin installs in the WebView: the shared
// parser (zip-slip, symlink, size caps, CRC) with the browser's raw-deflate
// `DecompressionStream` in place of Node's zlib.

import { MAX_FILE_BYTES } from '@shared/plugins/community'
import { listZipFiles, verifyZipFile, ZIP_STORED, ZipError } from '@shared/plugins/zipFormat'

/** Inflates one entry, stopping as soon as it exceeds the per-file cap (a lying size header). */
const inflateRaw = async(compressed: Uint8Array, name: string): Promise<Uint8Array> => {
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    const inflater = new DecompressionStream('deflate-raw')
    const writer = inflater.writable.getWriter()
    // Not awaited: the writes settle only as the reader below drains the output.
    writer.write(compressed.slice()).catch(() => {})
    writer.close().catch(() => {})
    const reader = inflater.readable.getReader()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > MAX_FILE_BYTES) {
        await reader.cancel().catch(() => {})
        throw new ZipError(`ZIP entry exceeds the file size limit: ${name}`)
      }
      chunks.push(value)
    }
  } catch (err) {
    if (err instanceof ZipError) throw err
    throw new ZipError(`ZIP entry could not be inflated: ${name}`)
  }
  const data = new Uint8Array(total)
  let at = 0
  for (const chunk of chunks) {
    data.set(chunk, at)
    at += chunk.byteLength
  }
  return data
}

/** Files of `bytes` keyed by their safe relative path. Throws `ZipError`. */
export const readZip = async(bytes: Uint8Array): Promise<Map<string, Uint8Array>> => {
  const files = new Map<string, Uint8Array>()
  for (const entry of listZipFiles(bytes)) {
    const data = entry.method === ZIP_STORED ? entry.compressed.slice() : await inflateRaw(entry.compressed, entry.name)
    files.set(entry.relative, verifyZipFile(entry, data))
  }
  return files
}
