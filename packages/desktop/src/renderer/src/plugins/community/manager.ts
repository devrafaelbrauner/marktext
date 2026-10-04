/**
 * Runs enabled community plugins in this window. Built-ins stay on the
 * existing PluginManager; this only creates sandboxed iframes and tears
 * them down on disable, uninstall, crash, timeout or `--safe`.
 */

import { watch } from 'vue'
import type { CommunityPluginRecord } from '@shared/plugins/community'
import { toPluginManifest } from '@shared/plugins/community'
import type { PluginSettingValue } from '@shared/plugins/types'
import { t } from '@/i18n'
import { resolveSetting } from '../host/pluginState'
import type { PluginHostServices } from '../host/context'
import { createPluginContext } from '../host/context'
import type { PluginStateClient } from '../host/pluginState'
import { CommunitySession } from './session'
import { createSandboxedFrame, ensureBackgroundHost } from './frames'

interface FrameInfo {
  session: CommunitySession
  role: 'background' | 'panel'
  greeted: boolean
}

export const startCommunityRuntime = (
  services: PluginHostServices,
  stateClient: PluginStateClient
): { stop(): void } => {
  const sessions = new Map<string, CommunitySession>()
  const frames = new Map<HTMLIFrameElement, FrameInfo>()
  const faulted = new Set<string>()
  let stopped = false
  const debug = { started: true, syncs: 0, starts: 0, error: '' }
  ;(window as unknown as { __mtCommunity?: typeof debug }).__mtCommunity = debug

  const resolvedSettings = (record: CommunityPluginRecord): Record<string, PluginSettingValue> => {
    const manifest = toPluginManifest(record)
    const settings: Record<string, PluginSettingValue> = {}
    for (const schema of record.settings ?? []) {
      if (schema.type === 'secret') continue
      const value = resolveSetting(stateClient.state.value, manifest, schema.key)
      if (value !== undefined) settings[schema.key] = value
    }
    return settings
  }

  const dropFrames = (session: CommunitySession): void => {
    for (const [iframe, info] of frames) {
      if (info.session !== session) continue
      iframe.remove()
      frames.delete(iframe)
    }
  }

  const teardown = (id: string): void => {
    const session = sessions.get(id)
    if (!session) return
    sessions.delete(id)
    session.close()
    dropFrames(session)
  }

  const disable = (id: string, name: string): void => {
    if (faulted.has(id)) return
    faulted.add(id)
    teardown(id)
    services.notify({
      title: name,
      message: t('pluginHost.communityDisabled', { name }),
      type: 'error',
      timeout: 8000
    })
    window.plugins.setEnabled(id, false).catch(() => {})
  }

  const startOne = (record: CommunityPluginRecord): void => {
    if (sessions.has(record.id) || faulted.has(record.id) || stopped) return
    const handle = createPluginContext({
      manifest: toPluginManifest(record),
      locales: { en: {} }
    }, services)
    const session = new CommunitySession({
      record,
      handle,
      language: services.language.value,
      settings: resolvedSettings(record),
      onFault: (_reason, _message) => disable(record.id, record.name),
      onActivated: () => {},
      onPanelFrame: (iframe) => {
        frames.set(iframe, { session, role: 'panel', greeted: false })
      }
    })
    sessions.set(record.id, session)
    const iframe = createSandboxedFrame(
      `mt-plugin://${record.id}/__mt/bootstrap.html`,
      'community-plugin-frame'
    )
    frames.set(iframe, { session, role: 'background', greeted: false })
    ensureBackgroundHost().appendChild(iframe)
  }

  const sync = (): void => {
    const state = stateClient.state.value
    if (!state || stopped) return
    const community = state.community ?? []
    const wanted = new Set<string>()
    if (!state.safeMode) {
      for (const record of community) {
        if (state.enabled[record.id]) wanted.add(record.id)
        else faulted.delete(record.id)
      }
    }
    for (const id of [...sessions.keys()]) {
      if (!wanted.has(id)) teardown(id)
    }
    if (state.safeMode) return
    for (const record of community) {
      if (wanted.has(record.id)) startOne(record)
    }
  }

  const onMessage = (event: MessageEvent): void => {
    let iframe: HTMLIFrameElement | null = null
    let info: FrameInfo | undefined
    for (const [frame, frameInfo] of frames) {
      if (event.source === frame.contentWindow) {
        iframe = frame
        info = frameInfo
        break
      }
    }
    if (!iframe || !info) return
    const data = event.data
    if (!data || typeof data !== 'object' || !('type' in data)) return
    if (data.type === 'mt-plugin:hello' && !info.greeted) {
      info.greeted = true
      const channel = new MessageChannel()
      info.session.addPort(channel.port1, info.role)
      iframe.contentWindow?.postMessage(info.session.initMessage(), '*', [channel.port2])
    }
    if (data.type === 'mt-plugin:crash') {
      const message = 'message' in data ? String(data.message) : 'plugin crashed'
      info.session.fail(message)
    }
  }

  window.addEventListener('message', onMessage)
  const stopState = stateClient.onDidChange(() => sync())
  const stopLanguage = watch(() => services.language.value, (language) => {
    for (const session of sessions.values()) session.emit('host:language', { language })
  })
  stateClient.load().then(sync).catch((err) => {
    services.log('error', '[community] failed to load plugin state:', err)
  })

  return {
    stop() {
      stopped = true
      window.removeEventListener('message', onMessage)
      stopState.dispose()
      stopLanguage()
      for (const id of [...sessions.keys()]) teardown(id)
    }
  }
}
