import fs from 'fs'
import path from 'path'
import { parseMtFileUrl } from 'common/mtFileUrl'

// Only these extensions are served. A symlink whose target is not itself an
// image (photo.png → /etc/passwd) is refused after realpath, so the extension
// check is on the file that would actually be read.
const IMAGE_CONTENT_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  webp: 'image/webp',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  avif: 'image/avif',
  apng: 'image/apng'
}

const SVG_CSP = "default-src 'none'; script-src 'none'; object-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:"

export interface MtFileIo {
  realpath(filePath: string): Promise<string>
  stat(filePath: string): Promise<{ isFile(): boolean }>
  readFile(filePath: string): Promise<Uint8Array>
}

const nodeIo: MtFileIo = {
  realpath: (filePath) => fs.promises.realpath(filePath),
  stat: (filePath) => fs.promises.stat(filePath),
  readFile: async(filePath) => fs.promises.readFile(filePath)
}

const text = (status: number, reason: string): Response =>
  new Response(reason, {
    status,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'X-Content-Type-Options': 'nosniff' }
  })

/**
 * Serve one local image for an `mt-file:` request. Never opens a network
 * connection: a rejected URL is answered from this function alone.
 */
export async function handleMtFileRequest(requestUrl: string, io: MtFileIo = nodeIo): Promise<Response> {
  const parsed = parseMtFileUrl(requestUrl)
  if (!parsed.ok) return text(parsed.status, parsed.reason)

  const requestedExt = path.extname(parsed.filePath).slice(1).toLowerCase()
  if (!IMAGE_CONTENT_TYPES[requestedExt]) return text(403, 'type')

  let real: string
  try {
    real = await io.realpath(parsed.filePath)
  } catch (err) {
    const code = err && typeof err === 'object' && 'code' in err ? err.code : undefined
    if (code === 'ENOENT') return text(404, 'missing')
    return text(403, 'unreadable')
  }

  const realExt = path.extname(real).slice(1).toLowerCase()
  const contentType = IMAGE_CONTENT_TYPES[realExt]
  if (!contentType) return text(403, 'type')

  let stat: { isFile(): boolean }
  try {
    stat = await io.stat(real)
  } catch {
    return text(404, 'missing')
  }
  if (!stat.isFile()) return text(403, 'type')

  let bytes: Uint8Array
  try {
    bytes = await io.readFile(real)
  } catch (err) {
    const code = err && typeof err === 'object' && 'code' in err ? err.code : undefined
    if (code === 'ENOENT') return text(404, 'missing')
    return text(403, 'unreadable')
  }

  const body = new Uint8Array(bytes.byteLength)
  body.set(bytes)
  const headers: Record<string, string> = {
    'Content-Type': contentType,
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'no-store'
  }
  if (realExt === 'svg') headers['Content-Security-Policy'] = SVG_CSP
  return new Response(body, { status: 200, headers })
}
