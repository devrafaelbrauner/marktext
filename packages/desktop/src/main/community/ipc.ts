/**
 * Install, uninstall, consent and network for community plugins. Every
 * handler rejects a sender that is not the top frame of an app window, so a
 * sandboxed plugin iframe cannot call these even if it obtained a preload.
 */

import { BrowserWindow, dialog, ipcMain } from 'electron'
import type { IpcMainInvokeEvent } from 'electron'
import type { PluginIpcResult } from '@shared/types/ipc'
import { parseNetworkHost } from '@shared/plugins/community'
import { validateSender } from '../security/validateSender'
import { safeFetch, SafeFetchError } from '../security/safeFetch'
import { PluginError } from '../plugins/errors'
import { toIpcResult } from '../plugins/errors'
import type { MainPluginHost } from '../plugins/host'
import type { SafeFetchInit } from '../plugins/types'
import { InstallError } from './installer'
import type { CommunityRegistry } from './registry'

export interface CommunityIpcOptions {
  host: MainPluginHost
  registry: CommunityRegistry
}

const forbidden = (): PluginIpcResult<never> => ({
  ok: false,
  error: { code: 'FAILED', message: 'Request from an untrusted sender' }
})

const asError = (err: unknown): Error => {
  if (err instanceof InstallError || err instanceof PluginError || err instanceof SafeFetchError) return err
  return err instanceof Error ? err : new Error(String(err))
}

const windowOf = (event: IpcMainInvokeEvent): BrowserWindow | null =>
  BrowserWindow.fromWebContents(event.sender)

export const registerCommunityIpc = ({ host, registry }: CommunityIpcOptions): void => {
  ipcMain.handle('mt::community::install', (event, kind: unknown) => {
    if (!validateSender(event)) return forbidden()
    return toIpcResult(async() => {
      const win = windowOf(event)
      if (!win) throw new PluginError('FAILED', 'No window')
      if (kind !== 'folder' && kind !== 'zip') throw new PluginError('FAILED', 'Install kind must be folder or zip')
      const picked = await dialog.showOpenDialog(win, kind === 'folder'
        ? { properties: ['openDirectory'] }
        : { properties: ['openFile'], filters: [{ name: 'Zip', extensions: ['zip'] }] })
      if (picked.canceled || !picked.filePaths[0]) throw new PluginError('FAILED', 'CANCELED')
      try {
        const record = kind === 'folder'
          ? registry.installFolder(picked.filePaths[0])
          : registry.installZip(picked.filePaths[0])
        // A previous install may have left `enabled: true` in plugins.json.
        // Installing always starts disabled until the user consents again.
        await host.setEnabled(record.id, false)
        return { id: record.id, name: record.name }
      } catch (err) {
        throw new PluginError('FAILED', asError(err).message)
      }
    })
  })

  ipcMain.handle('mt::community::uninstall', (event, id: unknown) => {
    if (!validateSender(event)) return forbidden()
    return toIpcResult(async() => {
      if (typeof id !== 'string' || !registry.get(id)) throw new PluginError('NOT_FOUND', 'Plugin is not installed')
      if (host.getState().enabled[id]) await host.setEnabled(id, false)
      try {
        registry.uninstall(id)
      } catch (err) {
        throw new PluginError('FAILED', asError(err).message)
      }
      host.publish()
      return null
    })
  })

  ipcMain.handle('mt::community::set-enabled', (event, id: unknown, enabled: unknown) => {
    if (!validateSender(event)) return forbidden()
    return toIpcResult(async() => {
      if (typeof id !== 'string' || !registry.get(id)) throw new PluginError('NOT_FOUND', 'Plugin is not installed')
      if (typeof enabled !== 'boolean') throw new PluginError('FAILED', 'enabled must be a boolean')
      if (enabled) registry.grant(id)
      await host.setEnabled(id, enabled)
      return null
    })
  })

  ipcMain.handle('mt::community::fetch', (event, id: unknown, url: unknown, init: unknown) => {
    if (!validateSender(event)) return forbidden()
    return toIpcResult(async() => {
      if (typeof id !== 'string' || typeof url !== 'string') throw new PluginError('BAD_ARGS', 'Malformed fetch')
      const record = registry.get(id)
      if (!record || !host.getState().enabled[id] || host.safeMode) {
        throw new PluginError('DISABLED', `Plugin "${id}" is disabled`)
      }
      let hostname: string
      try {
        hostname = new URL(url).hostname.toLowerCase()
      } catch {
        throw new PluginError('BAD_ARGS', 'Invalid URL')
      }
      const allowed = record.grantedPermissions.some((permission) => parseNetworkHost(permission) === hostname)
      if (!allowed) throw new PluginError('PERMISSION_DENIED', `No network permission for ${hostname}`)
      const fetchInit = sanitizeFetchInit(init)
      try {
        const response = await safeFetch(url, fetchInit)
        return {
          status: response.status,
          ok: response.ok,
          headers: response.headers,
          body: response.text()
        }
      } catch (err) {
        if (err instanceof SafeFetchError) throw new PluginError(err.code === 'BAD_URL' ? 'BAD_ARGS' : 'FAILED', err.message)
        throw new PluginError('FAILED', asError(err).message)
      }
    })
  })
}

const sanitizeFetchInit = (init: unknown): SafeFetchInit => {
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
