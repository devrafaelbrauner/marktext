/**
 * Builds the HTTP response for one `mt-plugin:` request. The Electron
 * protocol handler is a thin wrapper around this so traversal and CSP can
 * be tested without a BrowserWindow.
 */

import fs from 'fs'
import path from 'path'
import { pluginResponseCsp } from '@shared/plugins/community'
import { renderBootstrapHtml } from '@shared/plugins/communityBootstrap'
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
    if (relative.endsWith('.html')) return text(200, id, renderBootstrapHtml(`mt-plugin://${id}`), 'text/html; charset=utf-8')
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
