/**
 * Privileged `mt-plugin:` scheme. Registered before `app.ready`; the handler
 * is attached once the app is ready. Responses never leave the plugin
 * directory and always carry that plugin's CSP.
 *
 * `registerSchemesAsPrivileged` can be called only once and replaces the
 * whole list. `mt-file` and `mt-app` belong to the hardening work: they are
 * included here so a merge that keeps this call still privileges them.
 * bypassCSP stays off.
 */

import { app, protocol } from 'electron'
import { renderBootstrapScript, servePluginUrl } from './serve'
import type { CommunityRegistry } from './registry'

let attached = false

const STANDARD_PRIVILEGES = {
  standard: true,
  secure: true,
  supportFetchAPI: true,
  corsEnabled: true,
  stream: true
} as const

/** Must run before the `ready` event. */
export const registerCommunityScheme = (): void => {
  protocol.registerSchemesAsPrivileged([
    { scheme: 'mt-plugin', privileges: { ...STANDARD_PRIVILEGES } },
    { scheme: 'mt-file', privileges: { ...STANDARD_PRIVILEGES } },
    { scheme: 'mt-app', privileges: { ...STANDARD_PRIVILEGES } }
  ])
}

export interface CommunityProtocolOptions {
  registry: CommunityRegistry
  isServable(id: string): boolean
}

export const startCommunityProtocol = ({ registry, isServable }: CommunityProtocolOptions): void => {
  const attach = (): void => {
    if (attached) return
    attached = true
    protocol.handle('mt-plugin', (request) => {
      const result = servePluginUrl({
        url: request.url,
        pluginsRoot: registry.pluginsRoot,
        isServable,
        bootstrapScript: (id) => {
          const record = registry.get(id)
          return record ? renderBootstrapScript(id, record.main) : null
        }
      })
      return new Response(new Uint8Array(result.body), { status: result.status, headers: result.headers })
    })
  }
  if (app.isReady()) attach()
  else app.whenReady().then(attach).catch(() => {})
}
