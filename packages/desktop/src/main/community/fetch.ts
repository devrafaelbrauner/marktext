// `net.fetch` of a community plugin: argument checks, the per-host network
// permission and the sanitized request, over an injected `safeFetch`. Free
// of Electron imports so the Android build enforces the same rules.

import { parseNetworkHost, type CommunityPluginRecord } from '@shared/plugins/community'
import { PluginError } from '../plugins/errors'
import type { MainPluginContext, SafeFetchInit } from '../plugins/types'
import { SafeFetchError } from '../security/safeFetchPolicy'

export interface CommunityFetchResult {
  status: number
  ok: boolean
  headers: Record<string, string>
  body: string
}

export interface CommunityFetchRequest {
  id: unknown
  url: unknown
  init: unknown
  /** Installed record of `id`, if any. */
  record: CommunityPluginRecord | undefined
  /** Enabled and not in safe mode. */
  active: boolean
  fetch: MainPluginContext['net']['fetch']
}

/**
 * `SafeFetchInit` from the untrusted `init` a community plugin passed to
 * `net.fetch`: GET or POST only, string headers without `Cookie` or `Host`,
 * a string body and a timeout. Anything else is dropped.
 */
export const sanitizeFetchInit = (init: unknown): SafeFetchInit => {
  if (!init || typeof init !== 'object') return {}
  const record = init as Record<string, unknown>
  const method = record.method === 'POST' ? 'POST' : record.method === 'GET' ? 'GET' : undefined
  const headers: Record<string, string> = {}
  if (record.headers && typeof record.headers === 'object' && !Array.isArray(record.headers)) {
    for (const [key, value] of Object.entries(record.headers)) {
      if (typeof value !== 'string') continue
      if (/^cookie$/i.test(key) || /^host$/i.test(key)) continue
      headers[key] = value
    }
  }
  const body = typeof record.body === 'string' ? record.body : undefined
  const timeoutMs = typeof record.timeoutMs === 'number' ? record.timeoutMs : undefined
  return { method, headers, body, timeoutMs }
}

/** Rejects with `PluginError` ('BAD_ARGS', 'DISABLED', 'PERMISSION_DENIED' or 'FAILED'). */
export const communityFetch = async({ id, url, init, record, active, fetch }: CommunityFetchRequest): Promise<CommunityFetchResult> => {
  if (typeof id !== 'string' || typeof url !== 'string') throw new PluginError('BAD_ARGS', 'Malformed fetch')
  if (!record || !active) throw new PluginError('DISABLED', `Plugin "${id}" is disabled`)
  let hostname: string
  try {
    hostname = new URL(url).hostname.toLowerCase()
  } catch {
    throw new PluginError('BAD_ARGS', 'Invalid URL')
  }
  const allowed = record.grantedPermissions.some((permission) => parseNetworkHost(permission) === hostname)
  if (!allowed) throw new PluginError('PERMISSION_DENIED', `No network permission for ${hostname}`)
  try {
    const response = await fetch(url, sanitizeFetchInit(init))
    return {
      status: response.status,
      ok: response.ok,
      headers: response.headers,
      body: response.text()
    }
  } catch (err) {
    if (err instanceof SafeFetchError) throw new PluginError(err.code === 'BAD_URL' ? 'BAD_ARGS' : 'FAILED', err.message)
    throw new PluginError('FAILED', err instanceof Error ? err.message : String(err))
  }
}
