/**
 * Main-process plugin API. A built-in plugin may ship a main part exporting a
 * `MainPluginModule` for work the sandboxed renderer cannot do: network calls,
 * reading secrets, CPU-heavy jobs. Its renderer part reaches it through
 * `ctx.ipc.invoke(method, …)` (see src/renderer/src/plugins/types.ts).
 */

import type { Disposable, PluginManifest, PluginSettingValue } from '@shared/plugins/types'

export type { Disposable } from '@shared/plugins/types'

export interface PluginCallInfo {
  /** Id of the BrowserWindow that made the call, or null when it is not an app window. */
  windowId: number | null
  webContentsId: number
}

export interface SafeFetchInit {
  method?: 'GET' | 'POST'
  headers?: Record<string, string>
  body?: string | URLSearchParams | Uint8Array
  /** Abort after this many ms. Default 15000. */
  timeoutMs?: number
  /** Reject with 'TOO_LARGE' once the response body exceeds this many bytes. Default 5 MiB. */
  maxResponseBytes?: number
}

export interface SafeFetchResponse {
  status: number
  ok: boolean
  /** Lower-cased header names. */
  headers: Record<string, string>
  body: Uint8Array
  text(): string
  /** Throws when the body is not valid JSON. */
  json<T = unknown>(): T
}

export interface MainPluginContext {
  readonly id: string
  readonly manifest: PluginManifest
  /** electron-log scoped to the plugin. */
  readonly log: {
    info(...args: unknown[]): void
    warn(...args: unknown[]): void
    error(...args: unknown[]): void
  }
  /**
   * Registers `method` for the plugin's renderer part. The handler's return
   * value (or rejection) is delivered to `ctx.ipc.invoke`; arguments arrive as
   * sent and must be validated by the handler.
   */
  handle(method: string, handler: (call: PluginCallInfo, ...args: unknown[]) => unknown): Disposable
  /** Sends `event` to the plugin's renderer part in every window, or only in `windowId`. */
  emit(event: string, payload: unknown, windowId?: number): void
  readonly settings: {
    /** Stored value, or the schema default. */
    get<T extends PluginSettingValue>(key: string): T
    onDidChange(listener: (key: string, value: PluginSettingValue) => void): Disposable
  }
  /** Values of the plugin's `secret` settings; they never leave the main process. */
  readonly secrets: {
    get(key: string): Promise<string | null>
    isSet(key: string): boolean
  }
  readonly net: {
    /**
     * HTTP(S) request via Electron `net.fetch` with redirects rejected,
     * credentials omitted, a timeout and a response size cap. Plain `http:` is
     * only allowed to loopback hosts (self-hosted services).
     */
    fetch(url: string, init?: SafeFetchInit): Promise<SafeFetchResponse>
  }
  /** Ties a disposable to the plugin's lifetime; `handle` results are already tracked. */
  track<T extends Disposable>(disposable: T): T
}

export interface MainPluginModule {
  activate(ctx: MainPluginContext): void | Promise<void>
  deactivate?(): void | Promise<void>
}
