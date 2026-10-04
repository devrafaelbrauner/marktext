import fs from 'fs'
import path from 'path'

// Packaged windows load from this origin instead of `file://`. With
// webSecurity on, each `file://` path is its own origin, so a module worker,
// a font, or an XHR of `pdfjs/` next to index.html would be blocked. A
// standard scheme makes those relative URLs same-origin, the way the dev
// server already is.
export const MT_APP_HOST = 'bundle'
export const MT_APP_RENDERER_URL = `mt-app://${MT_APP_HOST}/index.html`

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.map': 'application/json',
  '.wasm': 'application/wasm',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.bcmap': 'application/octet-stream',
  '.icc': 'application/octet-stream',
  '.icm': 'application/octet-stream'
}

export function contentTypeForAppFile(filePath: string): string {
  return CONTENT_TYPES[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream'
}

/**
 * Resolve a request under the renderer output directory. Returns null when the
 * URL is not our scheme, names another host, or leaves the directory (including
 * via a symlink).
 */
export function resolveAppFile(rendererDir: string, requestUrl: string): string | null {
  if (!rendererDir || typeof requestUrl !== 'string') return null
  if (/(?:^|\/)\.\.(?:\/|$)|%2e%2e/i.test(requestUrl.split(/[?#]/, 1)[0])) return null
  let url: URL
  try {
    url = new URL(requestUrl)
  } catch {
    return null
  }
  if (url.protocol !== 'mt-app:' || url.hostname !== MT_APP_HOST) return null
  if (url.username || url.password) return null

  const decoded = decodeURIComponent(url.pathname)
  if (decoded.includes('\0') || decoded.split(/[/\\]/).includes('..')) return null
  const relative = path.normalize(decoded).replace(/^([/\\])+/, '')
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return null

  const full = path.resolve(rendererDir, relative)
  const fromRoot = path.relative(path.resolve(rendererDir), full)
  if (!fromRoot || fromRoot.startsWith('..') || path.isAbsolute(fromRoot)) return null

  // asar paths do not always realpath; a lexical jail is enough there because
  // the archive has no symlinks. Outside an asar, follow the link and refuse
  // one that lands elsewhere.
  if (full.includes(`${path.sep}app.asar${path.sep}`) || full.endsWith(`${path.sep}app.asar`)) {
    return full
  }
  try {
    if (!fs.existsSync(full)) return full
    const real = fs.realpathSync(full)
    const realRoot = fs.realpathSync(rendererDir)
    const escaped = path.relative(realRoot, real)
    if (escaped.startsWith('..') || path.isAbsolute(escaped)) return null
    return real
  } catch {
    return null
  }
}

export async function handleMtAppRequest(rendererDir: string, requestUrl: string): Promise<Response> {
  const filePath = resolveAppFile(rendererDir, requestUrl)
  if (!filePath) {
    return new Response('Forbidden', { status: 403, headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
  }
  try {
    const bytes = await fs.promises.readFile(filePath)
    const body = new Uint8Array(bytes.byteLength)
    body.set(bytes)
    return new Response(body, {
      status: 200,
      headers: {
        'Content-Type': contentTypeForAppFile(filePath),
        'X-Content-Type-Options': 'nosniff'
      }
    })
  } catch {
    return new Response('Not found', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
  }
}
