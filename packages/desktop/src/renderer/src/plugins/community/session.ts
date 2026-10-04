/**
 * One enabled community plugin in one window. Every port (background and
 * panels) shares the same permission check and the same plugin context.
 * A crash or a missed activation deadline closes the session; the manager
 * disables the plugin.
 */

import type { Component } from 'vue'
import { ACTIVATION_TIMEOUT_MS, COMMUNITY_PROTOCOL, dispatchRpc, isHostEvent, isRpcResult } from '@shared/plugins/community'
import type { CommunityPluginRecord, InitMessage } from '@shared/plugins/community'
import type { PluginSettingValue } from '@shared/plugins/types'
import type { Disposable } from '../types'
import type { PluginContextHandle } from '../host/context'
import { ActivationWatch } from './activation'
import { createMethodCaller, type MethodBridge } from './methods'
import { communityStatus, panelComponent, statusComponent } from './frames'

export interface SessionOptions {
  record: CommunityPluginRecord
  handle: PluginContextHandle
  language: string
  settings: Record<string, PluginSettingValue>
  onFault(reason: 'crash' | 'timeout', message: string): void
  onActivated(): void
  onPanelFrame(iframe: HTMLIFrameElement): void
}

interface PendingCall {
  resolve(value: unknown): void
  reject(error: Error): void
  timer: number
}

export class CommunitySession {
  private readonly ports = new Set<MessagePort>()
  private background: MessagePort | null = null
  private readonly handles = new Map<string, Disposable>()
  private readonly pending = new Map<string, PendingCall>()
  private readonly watch: ActivationWatch
  private readonly call: (method: string, args: unknown[]) => Promise<unknown>
  private seq = 0
  private handleSeq = 0
  private closed = false

  constructor(private readonly options: SessionOptions) {
    this.watch = new ActivationWatch(ACTIVATION_TIMEOUT_MS, () => {
      this.fault('timeout', 'activation timed out')
    })
    this.watch.arm()
    const bridge: MethodBridge = {
      pluginId: options.record.id,
      record: options.record,
      ctx: options.handle.ctx,
      track: (disposable) => this.track(disposable),
      disposeHandle: (handle) => this.disposeHandle(handle),
      emit: (event, payload) => this.emit(event, payload),
      requestPlugin: (method, args, timeoutMs, signal) => this.requestPlugin(method, args, timeoutMs, signal),
      setStatus: (id, text, tooltip) => {
        communityStatus[`${options.record.id}:${id}`] = { text, tooltip }
      },
      panelComponent: (entry) => this.panelFrame(entry),
      statusComponent: (id) => statusComponent(`${options.record.id}:${id}`)
    }
    this.call = createMethodCaller(bridge)
    this.track(options.handle.ctx.settings.onDidChange((key, value) => {
      this.emit('settings:change', { key, value })
    }))
  }

  initMessage(): InitMessage {
    const { record, language, settings } = this.options
    return {
      type: 'mt-plugin:init',
      protocol: COMMUNITY_PROTOCOL,
      manifest: {
        id: record.id,
        name: record.name,
        version: record.version,
        minAppVersion: record.minAppVersion,
        author: record.author,
        description: record.description,
        main: record.main,
        permissions: record.permissions,
        panels: record.panels,
        settings: record.settings
      },
      language,
      settings
    }
  }

  addPort(port: MessagePort, role: 'background' | 'panel'): void {
    if (this.closed) {
      port.close()
      return
    }
    port.start()
    port.addEventListener('message', (event) => {
      this.onPortMessage(port, event.data).catch(() => {})
    })
    port.addEventListener('messageerror', () => this.fault('crash', 'message error'))
    port.addEventListener('close', () => {
      this.ports.delete(port)
      if (this.background === port) this.background = null
      if (!this.closed && role === 'background') this.fault('crash', 'background port closed')
    })
    this.ports.add(port)
    if (role === 'background') this.background = port
  }

  emit(event: string, payload: unknown): void {
    if (this.closed) return
    for (const port of this.ports) port.postMessage({ event, payload })
  }

  fail(message: string): void {
    this.fault('crash', message)
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    this.watch.cancel()
    for (const pending of this.pending.values()) {
      window.clearTimeout(pending.timer)
      pending.reject(new Error('plugin closed'))
    }
    this.pending.clear()
    for (const port of this.ports) {
      try {
        port.close()
      } catch {
        // The frame may already be gone.
      }
    }
    this.ports.clear()
    this.background = null
    for (const disposable of [...this.handles.values()].reverse()) {
      try {
        disposable.dispose()
      } catch {
        // A registration that throws on dispose must not keep the others.
      }
    }
    this.handles.clear()
    this.options.handle.dispose()
  }

  private panelFrame(entry: string): Component {
    return panelComponent(this.options.record.id, entry, (iframe) => {
      this.options.onPanelFrame(iframe)
    })
  }

  private track(disposable: Disposable): string {
    const handle = `d${++this.handleSeq}`
    this.handles.set(handle, disposable)
    return handle
  }

  private disposeHandle(handle: string): void {
    const disposable = this.handles.get(handle)
    if (!disposable) throw Object.assign(new Error(`Unknown handle "${handle}"`), { code: 'BAD_ARGS' })
    this.handles.delete(handle)
    disposable.dispose()
  }

  private requestPlugin(method: string, args: unknown, timeoutMs = 5_000, signal?: AbortSignal): Promise<unknown> {
    const port = this.background ?? this.ports.values().next().value
    if (!port) return Promise.reject(new Error('plugin is not connected'))
    const id = `h${++this.seq}`
    let resolveCall: (value: unknown) => void = () => {}
    let rejectCall: (error: Error) => void = () => {}
    const promise = new Promise<unknown>((resolve, reject) => {
      resolveCall = resolve
      rejectCall = reject
    })
    const timer = window.setTimeout(() => {
      this.pending.delete(id)
      rejectCall(Object.assign(new Error('plugin request timed out'), { code: 'TIMEOUT' }))
    }, timeoutMs)
    this.pending.set(id, { resolve: resolveCall, reject: rejectCall, timer })
    signal?.addEventListener('abort', () => {
      const pending = this.pending.get(id)
      if (!pending) return
      window.clearTimeout(pending.timer)
      this.pending.delete(id)
      rejectCall(new Error('aborted'))
    }, { once: true })
    port.postMessage({ id, method, args: [args] })
    return promise
  }

  private async onPortMessage(port: MessagePort, data: unknown): Promise<void> {
    if (this.closed) return
    if (isRpcResult(data) && typeof data.id === 'string') {
      const pending = this.pending.get(data.id)
      if (!pending) return
      window.clearTimeout(pending.timer)
      this.pending.delete(data.id)
      if (data.ok) pending.resolve(data.value)
      else pending.reject(Object.assign(new Error(data.error.message), { code: data.error.code }))
      return
    }
    if (isHostEvent(data)) {
      if (data.event === 'activated' && this.watch.activate()) {
        this.registerManifestPanels()
        this.options.onActivated()
      }
      if (data.event === 'crash') {
        const message = data.payload && typeof data.payload === 'object' && 'message' in data.payload
          ? String(data.payload.message)
          : 'plugin crashed'
        this.fault('crash', message)
      }
      return
    }
    const result = await dispatchRpc(data, {
      granted: this.options.record.grantedPermissions,
      call: this.call
    })
    if (result) port.postMessage(result)
  }

  private registerManifestPanels(): void {
    if (!this.options.record.grantedPermissions.includes('ui:sidebar')) return
    for (const panel of this.options.record.panels ?? []) {
      try {
        this.track(this.options.handle.ctx.ui.registerSidebarPanel({
          id: panel.id,
          title: panel.title,
          icon: panel.icon,
          component: this.panelFrame(panel.entry)
        }))
      } catch {
        // A duplicate or reserved id must not take down the plugin.
      }
    }
  }

  private fault(reason: 'crash' | 'timeout', message: string): void {
    if (this.closed) return
    this.close()
    this.options.onFault(reason, message)
  }
}
