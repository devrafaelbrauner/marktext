import path from 'path'
import { protocol } from 'electron'
import { handleMtAppRequest } from './mtApp'
import { handleMtFileRequest } from './mtFile'

let installed = false

/**
 * Must run before `app.ready`. A scheme that is not privileged cannot be used
 * as an `<img>` source or as the page origin once webSecurity is on.
 */
export function registerPrivilegedSchemes(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: 'mt-file',
      privileges: SCHEME_PRIVILEGES
    },
    {
      scheme: 'mt-app',
      privileges: SCHEME_PRIVILEGES
    },
    // Community plugins register `protocol.handle('mt-plugin')`. The list can
    // be passed only once, so the entry lives here with the other schemes.
    {
      scheme: 'mt-plugin',
      privileges: SCHEME_PRIVILEGES
    }
  ])
}

const SCHEME_PRIVILEGES = {
  standard: true,
  secure: true,
  supportFetchAPI: true,
  corsEnabled: true,
  stream: true
} as const

export function installProtocolHandlers(rendererDir = path.join(__dirname, '../renderer')): void {
  if (installed) return
  installed = true
  protocol.handle('mt-file', (request) => handleMtFileRequest(request.url))
  protocol.handle('mt-app', (request) => handleMtAppRequest(rendererDir, request.url))
}
