/**
 * Builds the HTTP response for one `mt-plugin:` request. The Electron
 * protocol handler is a thin wrapper around this so traversal and CSP can
 * be tested without a BrowserWindow.
 */

import fs from 'fs'
import path from 'path'
import { pluginResponseCsp } from '@shared/plugins/community'
import { resolvePluginFile, safeRelativePath } from './paths'

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8'
}

export interface ServeResult {
  status: number
  headers: Record<string, string>
  body: Buffer
}

export interface ServeOptions {
  url: string
  pluginsRoot: string
  /** Enabled, not in safe mode, and installed. */
  isServable(id: string): boolean
  /** Host bootstrap for this plugin, or null when the plugin has no main. */
  bootstrapScript(id: string): string | null
}

const text = (status: number, id: string, body: string, contentType = 'text/plain; charset=utf-8'): ServeResult => ({
  status,
  headers: responseHeaders(id || 'invalid', contentType),
  body: Buffer.from(body)
})

const responseHeaders = (id: string, contentType: string): Record<string, string> => ({
  'Content-Type': contentType,
  'Content-Security-Policy': pluginResponseCsp(id),
  'X-Content-Type-Options': 'nosniff',
  'Cache-Control': 'no-store'
})

const bootstrapHtml = (id: string): string => `<!doctype html>
<html>
<head><meta charset="utf-8"></head>
<body>
<script type="module" src="mt-plugin://${id}/__mt/bootstrap.js"></script>
</body>
</html>
`

/**
 * Host bootstrap. It imports the plugin `main` (which must call
 * `definePlugin`) and only then consumes the init message, so a slow import
 * cannot miss the MessagePort. `hello` lets the host post that message
 * without waiting for the iframe `load` event (which waits on this module).
 */
export const renderBootstrapScript = (id: string, main: string): string => {
  const mainLiteral = JSON.stringify(main)
  const idLiteral = JSON.stringify(id)
  return `const MAIN = ${mainLiteral}
const ID = ${idLiteral}
const waitInit = () => new Promise((resolve) => {
  const onMessage = (event) => {
    if (event.source !== window.parent) return
    const data = event.data
    if (!data || data.type !== 'mt-plugin:init' || data.protocol !== 1) return
    const port = event.ports && event.ports[0]
    if (!port) return
    window.removeEventListener('message', onMessage)
    resolve({ data, port })
  }
  window.addEventListener('message', onMessage)
})
const initPromise = waitInit()
window.parent.postMessage({ type: 'mt-plugin:hello', role: 'background', id: ID }, '*')
try {
  const root = new URL('/', import.meta.url)
  await import(new URL(MAIN, root).href)
} catch (err) {
  const message = err instanceof Error ? err.message : String(err)
  window.parent.postMessage({ type: 'mt-plugin:crash', id: ID, message }, '*')
  throw err
}
const pending = globalThis.__MT_PLUGIN_DEFINITION__
if (!pending || pending.kind !== 'background' || typeof pending.start !== 'function') {
  window.parent.postMessage({ type: 'mt-plugin:crash', id: ID, message: 'Plugin main did not call definePlugin' }, '*')
  throw new Error('definePlugin was not called')
}
try {
  const init = await initPromise
  await pending.start(init.data, init.port)
} catch (err) {
  const message = err instanceof Error ? err.message : String(err)
  window.parent.postMessage({ type: 'mt-plugin:crash', id: ID, message }, '*')
}
`
}

export const servePluginUrl = ({ url, pluginsRoot, isServable, bootstrapScript }: ServeOptions): ServeResult => {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return text(400, 'invalid', 'bad url')
  }
  if (parsed.protocol !== 'mt-plugin:') return text(400, 'invalid', 'bad scheme')
  const id = parsed.hostname.toLowerCase()
  if (!/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/.test(id)) return text(404, id || 'invalid', 'not found')
  if (!isServable(id)) return text(403, id, 'disabled')

  const relative = safeRelativePath(parsed.pathname || '/')
  if (!relative) return text(400, id, 'bad path')

  if (relative === '__mt/bootstrap.html' || relative === '__mt/bootstrap.js') {
    const script = bootstrapScript(id)
    if (!script) return text(404, id, 'not found')
    if (relative.endsWith('.html')) return text(200, id, bootstrapHtml(id), 'text/html; charset=utf-8')
    return text(200, id, script, 'text/javascript; charset=utf-8')
  }
  if (relative === '__mt' || relative.startsWith('__mt/')) return text(404, id, 'not found')

  const root = path.join(pluginsRoot, id)
  const filePath = resolvePluginFile(root, relative)
  if (!filePath) return text(404, id, 'not found')
  let stat: fs.Stats
  try {
    stat = fs.statSync(filePath)
  } catch {
    return text(404, id, 'not found')
  }
  if (stat.size > 8 * 1024 * 1024) return text(413, id, 'too large')
  const ext = path.extname(filePath).toLowerCase()
  const contentType = CONTENT_TYPES[ext] ?? 'application/octet-stream'
  return {
    status: 200,
    headers: responseHeaders(id, contentType),
    body: fs.readFileSync(filePath)
  }
}
