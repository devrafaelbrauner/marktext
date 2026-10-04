/**
 * Community plugin contract (protocol 1). Built-in plugins do not use this:
 * they stay trusted in-process. A community plugin runs in a sandboxed iframe
 * and can only reach the host through the MessagePort methods listed here.
 *
 * Host and SDK must agree on these names. The host is the authority; the SDK
 * (`packages/plugin-sdk`) speaks the same protocol.
 */

import type { PluginManifest, PluginSettingSchema, PluginSettingValue } from './types'

/** MessagePort protocol the host and the plugin bootstrap speak. */
export const COMMUNITY_PROTOCOL = 1

/** A plugin that does not signal activation within this many ms is disabled. */
export const ACTIVATION_TIMEOUT_MS = 10_000

export const MAX_ARCHIVE_BYTES = 32 * 1024 * 1024
export const MAX_UNCOMPRESSED_BYTES = 64 * 1024 * 1024
export const MAX_FILE_BYTES = 8 * 1024 * 1024
export const MAX_FILE_COUNT = 2_000

/** Kebab-case ids that are also valid `mt-plugin://` hostnames. */
export const PLUGIN_ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/

export const FIXED_PERMISSIONS = [
  'editor:read',
  'editor:write',
  'editor:decorate',
  'vault:read',
  'vault:write',
  'metadata:read',
  'ui:sidebar',
  'ui:statusbar',
  'clipboard:write'
] as const

export type FixedPermission = (typeof FIXED_PERMISSIONS)[number]

/** `network:<host>` is granted per hostname, never as a wildcard. */
export type CommunityPermission = FixedPermission | `network:${string}`

export const DECORATION_CLASSES = ['spelling', 'grammar', 'style', 'info'] as const
export type DecorationClass = (typeof DECORATION_CLASSES)[number]

export interface CommunityPanel {
  id: string
  title: string
  /** Single-colour SVG using `currentColor`; the host sanitizes it. */
  icon: string
  /** HTML file inside the plugin folder, relative, no `..`. */
  entry: string
}

export type CommunityDescription = string | { en: string; pt?: string }

export interface CommunityManifest {
  id: string
  name: string
  version: string
  minAppVersion: string
  author: string
  description: CommunityDescription
  /** ES module path inside the plugin folder. */
  main: string
  permissions: string[]
  panels?: CommunityPanel[]
  settings?: PluginSettingSchema[]
}

/** What the host publishes for one installed community plugin. No filesystem paths. */
export interface CommunityPluginRecord extends CommunityManifest {
  /** Permissions the user consented to. Empty until the plugin is enabled. */
  grantedPermissions: string[]
}

/**
 * RPC methods a community plugin may call, and the permission each one needs.
 * `always` means commands, notifications and settings — no manifest permission.
 * `network` means a `network:<host>` grant for the URL's hostname.
 */
export const METHOD_PERMISSIONS = {
  'commands.register': 'always',
  dispose: 'always',
  notify: 'always',
  'settings.get': 'always',
  'settings.set': 'always',
  'settings.subscribe': 'always',
  'ui.openSettings': 'always',
  'editor.getMarkdown': 'editor:read',
  'editor.getActiveTab': 'editor:read',
  'editor.getCheckableBlocks': 'editor:read',
  'editor.subscribeContent': 'editor:read',
  'editor.subscribeActiveTab': 'editor:read',
  'editor.subscribeSetContent': 'editor:read',
  'editor.registerCodeBlockRenderer': 'editor:read',
  'editor.insertText': 'editor:write',
  'editor.replaceRange': 'editor:write',
  'editor.setDecorations': 'editor:decorate',
  'editor.clearDecorations': 'editor:decorate',
  'editor.subscribeDecorationClick': 'editor:decorate',
  'vault.readText': 'vault:read',
  'vault.readBinary': 'vault:read',
  'vault.exists': 'vault:read',
  'vault.list': 'vault:read',
  'vault.writeText': 'vault:write',
  'vault.createText': 'vault:write',
  'metadata.isReady': 'metadata:read',
  'metadata.getFile': 'metadata:read',
  'metadata.listFiles': 'metadata:read',
  'metadata.resolveLink': 'metadata:read',
  'metadata.getBacklinks': 'metadata:read',
  'metadata.getTags': 'metadata:read',
  'metadata.getFilesWithTag': 'metadata:read',
  'metadata.subscribe': 'metadata:read',
  'net.fetch': 'network',
  'ui.registerSidebarPanel': 'ui:sidebar',
  'ui.revealSidebarPanel': 'ui:sidebar',
  'ui.registerStatusBarItem': 'ui:statusbar',
  'ui.updateStatusBarItem': 'ui:statusbar',
  'clipboard.writeText': 'clipboard:write'
} as const

export type CommunityMethod = keyof typeof METHOD_PERMISSIONS

export type RpcErrorCode =
  | 'PERMISSION_DENIED'
  | 'UNKNOWN_METHOD'
  | 'BAD_ARGS'
  | 'FAILED'
  | 'DISABLED'
  | 'TIMEOUT'
  | 'OUTSIDE_VAULT'
  | 'CONFLICT'
  | 'EXISTS'
  | 'NOT_FOUND'
  | 'TOO_LARGE'

export interface RpcError {
  code: RpcErrorCode | string
  message: string
}

export type RpcResult =
  | { id: number | string; ok: true; value?: unknown }
  | { id: number | string; ok: false; error: RpcError }

export interface RpcRequest {
  id: number | string
  method: string
  args: unknown[]
}

export interface HostEvent {
  event: string
  payload?: unknown
}

export interface InitMessage {
  type: 'mt-plugin:init'
  protocol: 1
  manifest: CommunityManifest
  language: string
  settings: Record<string, PluginSettingValue>
}

export type AuthorizeResult = { ok: true } | { ok: false; code: RpcErrorCode; message: string }

const NETWORK_HOST = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/

/** Hostname of a `network:<host>` permission, or null when the permission is not that shape. */
export const parseNetworkHost = (permission: string): string | null => {
  if (!permission.startsWith('network:')) return null
  const host = permission.slice('network:'.length).toLowerCase().replace(/\.$/, '')
  if (!host || host.includes('*') || host.includes('/') || host.includes(':') || host.includes(' ')) return null
  return NETWORK_HOST.test(host) ? host : null
}

export const isFixedPermission = (permission: string): permission is FixedPermission =>
  (FIXED_PERMISSIONS as readonly string[]).includes(permission)

/** True when `permission` may appear in a manifest. */
export const isCommunityPermission = (permission: string): boolean =>
  isFixedPermission(permission) || parseNetworkHost(permission) !== null

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object'

const fetchUrl = (args: unknown[]): string | null => {
  const first = args[0]
  if (typeof first === 'string') return first
  if (!isRecord(first) || !('url' in first)) return null
  return typeof first.url === 'string' ? first.url : null
}

/**
 * Whether `method` may run with `granted`. Unknown methods are
 * `UNKNOWN_METHOD`, not a permission denial, so a plugin can tell a typo
 * from a missing grant. `net.fetch` is allowed only when a granted
 * `network:<host>` equals the URL hostname.
 */
export const authorize = (method: string, granted: readonly string[], args: unknown[] = []): AuthorizeResult => {
  if (!Object.prototype.hasOwnProperty.call(METHOD_PERMISSIONS, method)) {
    return { ok: false, code: 'UNKNOWN_METHOD', message: `Unknown method "${method}"` }
  }
  const required = METHOD_PERMISSIONS[method as CommunityMethod]
  if (required === 'always') return { ok: true }
  if (required === 'network') {
    const raw = fetchUrl(args)
    if (!raw) return { ok: false, code: 'BAD_ARGS', message: 'net.fetch requires a URL' }
    let host: string
    try {
      host = new URL(raw).hostname.toLowerCase()
    } catch {
      return { ok: false, code: 'BAD_ARGS', message: 'net.fetch URL is invalid' }
    }
    const allowed = granted.some((permission) => parseNetworkHost(permission) === host)
    if (!allowed) {
      return { ok: false, code: 'PERMISSION_DENIED', message: `No network permission for ${host}` }
    }
    return { ok: true }
  }
  if (!granted.includes(required)) {
    return { ok: false, code: 'PERMISSION_DENIED', message: `Permission "${required}" is required for ${method}` }
  }
  return { ok: true }
}

export const isRpcRequest = (value: unknown): value is RpcRequest => {
  if (!isRecord(value)) return false
  const idOk = typeof value.id === 'number' || typeof value.id === 'string'
  return idOk && typeof value.method === 'string' && Array.isArray(value.args) && !('ok' in value) && !('event' in value)
}

export const isRpcResult = (value: unknown): value is RpcResult => {
  if (!isRecord(value)) return false
  const idOk = typeof value.id === 'number' || typeof value.id === 'string'
  return idOk && typeof value.ok === 'boolean' && !('method' in value)
}

export const isHostEvent = (value: unknown): value is HostEvent => {
  if (!isRecord(value)) return false
  return typeof value.event === 'string' && !('method' in value) && !('ok' in value)
}

const errorCodeOf = (err: unknown): string => {
  if (!isRecord(err) || !('code' in err)) return 'FAILED'
  return typeof err.code === 'string' ? err.code : 'FAILED'
}

/**
 * Runs one plugin RPC. Returns null when `message` is not a request (events
 * and results are the caller's). Handler failures become `FAILED` unless the
 * thrown value already carries a `code` string.
 */
export const dispatchRpc = async(
  message: unknown,
  options: {
    granted: readonly string[]
    call(method: string, args: unknown[]): Promise<unknown>
  }
): Promise<RpcResult | null> => {
  if (!isRecord(message) || typeof message.method !== 'string' || 'ok' in message || 'event' in message) return null
  if (typeof message.id !== 'number' && typeof message.id !== 'string') return null
  const id = message.id
  if (!Array.isArray(message.args)) {
    return { id, ok: false, error: { code: 'BAD_ARGS', message: 'args must be an array' } }
  }
  const decision = authorize(message.method, options.granted, message.args)
  if (!decision.ok) return { id, ok: false, error: { code: decision.code, message: decision.message } }
  try {
    const value = await options.call(message.method, message.args)
    return { id, ok: true, value }
  } catch (err) {
    const text = err instanceof Error ? err.message : String(err)
    return { id, ok: false, error: { code: errorCodeOf(err), message: text } }
  }
}

/** Document CSP for every response of `mt-plugin://<id>/`. Scripts run only
 * from the plugin's own origin; inline scripts are needed because the host
 * bootstrap and small fixture plugins ship inline code. No object, frame or
 * network access is allowed. */
export const pluginResponseCsp = (id: string): string =>
  `default-src 'none'; script-src 'unsafe-inline' mt-plugin://${id}; style-src 'unsafe-inline' mt-plugin://${id}; img-src data: mt-plugin://${id}; connect-src 'none'; object-src 'none'; frame-src 'none'`

export const localizeDescription = (description: CommunityDescription, language: string): string => {
  if (typeof description === 'string') return description
  if (language.toLowerCase().startsWith('pt') && description.pt) return description.pt
  return description.en
}

export const parseAppVersion = (raw: string): [number, number, number] | null => {
  const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(raw.trim())
  if (!match) return null
  return [Number(match[1]), Number(match[2]), Number(match[3])]
}

export const satisfiesMinAppVersion = (appVersion: string, minAppVersion: string): boolean => {
  const app = parseAppVersion(appVersion)
  const min = parseAppVersion(minAppVersion)
  if (!app || !min) return false
  for (let i = 0; i < 3; i++) {
    if (app[i] > min[i]) return true
    if (app[i] < min[i]) return false
  }
  return true
}

/** Built-in-shaped manifest so the existing settings store can validate community settings. */
export const toPluginManifest = (record: CommunityPluginRecord | CommunityManifest): PluginManifest => ({
  id: record.id,
  version: record.version,
  name: record.name,
  description: typeof record.description === 'string' ? record.description : record.description.en,
  defaultEnabled: false,
  settings: record.settings,
  affectsParsing: false
})

/**
 * Maps a decoration class the plugin is allowed to name (`info`) onto the
 * engine class (`mu-decoration-info`). Returns null when any token is not
 * one of the fixed classes.
 */
export const normalizeDecorationClass = (className: string): string | null => {
  const tokens = className.split(/\s+/).filter(Boolean)
  if (tokens.length === 0) return null
  const mapped: string[] = []
  for (const token of tokens) {
    const bare = token.startsWith('mu-decoration-') ? token.slice('mu-decoration-'.length) : token
    if (!(DECORATION_CLASSES as readonly string[]).includes(bare)) return null
    mapped.push(`mu-decoration-${bare}`)
  }
  return mapped.join(' ')
}
