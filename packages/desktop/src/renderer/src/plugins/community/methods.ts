/**
 * Maps community RPC methods onto the same context built-in plugins use.
 * `authorize` already rejected a missing permission; these handlers reject
 * malformed arguments and keep command ids inside the plugin's namespace.
 */

import { markRaw, type Component } from 'vue'
import type { CommunityPluginRecord } from '@shared/plugins/community'
import { normalizeDecorationClass } from '@shared/plugins/community'
import type { Disposable, PluginSettingValue } from '@shared/plugins/types'
import { PluginError } from '../host/errors'
import type { BlockPath, RendererPluginContext } from '../types'
import { sanitizeCommunityHtml } from './sanitize'

const MAX_TEXT = 100_000
const MAX_NOTIFY = 2_000
const MAX_STATUS = 200

export interface MethodBridge {
  pluginId: string
  record: CommunityPluginRecord
  ctx: RendererPluginContext
  track(disposable: Disposable): string
  disposeHandle(handle: string): void
  emit(event: string, payload: unknown): void
  requestPlugin(method: string, args: unknown, timeoutMs?: number, signal?: AbortSignal): Promise<unknown>
  setStatus(id: string, text: string, tooltip: string): void
  panelComponent(entry: string): Component
  statusComponent(id: string): Component
}

const objectArg = (args: unknown[]): object | null => {
  const first = args[0]
  if (!first || typeof first !== 'object' || Array.isArray(first)) return null
  return first
}

const readField = (value: object | null, key: string): unknown => {
  if (!value || !(key in value)) return undefined
  return value[key as keyof typeof value]
}

const stringField = (value: object | null, key: string): string | null => {
  const field = readField(value, key)
  return typeof field === 'string' ? field : null
}

const numberField = (value: object | null, key: string): number | null => {
  const field = readField(value, key)
  return typeof field === 'number' && Number.isFinite(field) ? field : null
}

const boolField = (value: object | null, key: string): boolean | null => {
  const field = readField(value, key)
  return typeof field === 'boolean' ? field : null
}

function bad(message: string): never {
  throw new PluginError('BAD_ARGS', message)
}

const requireString = (value: object | null, key: string, max = MAX_TEXT): string => {
  const text = stringField(value, key)
  if (text === null) bad(`${key} must be a string`)
  if (text.length > max) bad(`${key} is too long`)
  return text
}

const plain = (value: unknown): unknown => {
  try {
    return structuredClone(value)
  } catch {
    return null
  }
}

const blockPath = (value: unknown): BlockPath | null => {
  if (!Array.isArray(value)) return null
  const path: BlockPath = []
  for (const part of value) {
    if (typeof part !== 'string' && typeof part !== 'number') return null
    path.push(part)
  }
  return path
}

const settingValue = (value: unknown): PluginSettingValue => {
  if (typeof value === 'boolean' || typeof value === 'string' || typeof value === 'number') return value
  if (Array.isArray(value) && value.every((item) => typeof item === 'string')) return value
  bad('value has an unsupported type')
}

const tabInfo = (tab: ReturnType<RendererPluginContext['editor']['getActiveTab']>) => {
  if (!tab) return null
  return {
    id: tab.id,
    pathname: tab.pathname,
    filename: tab.filename,
    isSaved: tab.isSaved,
    kind: tab.kind,
    viewId: tab.viewId
  }
}

const stripStatus = (text: string): string =>
  text.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim().slice(0, MAX_STATUS)

const headerRecord = (payload: object | null): Record<string, string> => {
  const headers = readField(payload, 'headers')
  if (!headers || typeof headers !== 'object' || Array.isArray(headers)) return {}
  const clean: Record<string, string> = {}
  for (const [key, value] of Object.entries(headers)) {
    if (typeof value === 'string' && !/^cookie$/i.test(key) && !/^host$/i.test(key)) clean[key] = value
  }
  return clean
}

const bytesToBase64 = (bytes: Uint8Array): string => {
  let binary = ''
  const chunk = 0x8000
  for (let offset = 0; offset < bytes.length; offset += chunk) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunk))
  }
  return btoa(binary)
}

export const createMethodCaller = (bridge: MethodBridge): ((method: string, args: unknown[]) => Promise<unknown>) => {
  const handlers: Record<string, (args: unknown[]) => Promise<unknown>> = {
    'commands.register': async(args) => {
      const payload = objectArg(args)
      const id = requireString(payload, 'id', 80)
      const title = requireString(payload, 'title', 200)
      if (id !== bridge.pluginId && !id.startsWith(`${bridge.pluginId}.`)) {
        bad(`Command id must start with "${bridge.pluginId}."`)
      }
      const keybinding = stringField(payload, 'keybinding')
      if (keybinding && keybinding.length > 64) bad('keybinding is too long')
      const handle = bridge.track(bridge.ctx.commands.register({
        id,
        title,
        ...(keybinding ? { keybinding } : {}),
        run: () => {
          bridge.requestPlugin('command.run', { id }).catch(() => {})
        }
      }))
      return { handle }
    },
    dispose: async(args) => {
      bridge.disposeHandle(requireString(objectArg(args), 'handle', 80))
      return null
    },
    notify: async(args) => {
      const payload = objectArg(args)
      const message = requireString(payload, 'message', MAX_NOTIFY)
      const title = stringField(payload, 'title')
      const type = stringField(payload, 'type')
      const timeout = numberField(payload, 'timeout')
      const allowed = type === 'primary' || type === 'info' || type === 'warning' || type === 'error'
      bridge.ctx.ui.notify({
        message,
        ...(title ? { title: title.slice(0, 200) } : {}),
        ...(allowed ? { type } : {}),
        ...(timeout !== null && timeout >= 0 && timeout <= 60_000 ? { timeout } : {})
      })
      return null
    },
    'settings.get': async(args) => bridge.ctx.settings.get(requireString(objectArg(args), 'key', 80)),
    'settings.set': async(args) => {
      const payload = objectArg(args)
      const key = requireString(payload, 'key', 80)
      await bridge.ctx.settings.set(key, settingValue(readField(payload, 'value')))
      return null
    },
    'settings.subscribe': async() => ({
      handle: bridge.track(bridge.ctx.settings.onDidChange((key, value) => {
        bridge.emit('settings:change', { key, value })
      }))
    }),
    'ui.openSettings': async() => {
      bridge.ctx.ui.openSettings()
      return null
    },
    'editor.getMarkdown': async() => bridge.ctx.editor.getMarkdown(),
    'editor.getActiveTab': async() => tabInfo(bridge.ctx.editor.getActiveTab()),
    'editor.getCheckableBlocks': async(args) => {
      const paths = readField(objectArg(args), 'paths')
      if (paths === undefined) return plain(bridge.ctx.editor.getCheckableBlocks())
      if (!Array.isArray(paths)) bad('paths must be an array')
      const parsed: BlockPath[] = []
      for (const item of paths) {
        const path = blockPath(item)
        if (!path) bad('paths must be block paths')
        parsed.push(path)
      }
      return plain(bridge.ctx.editor.getCheckableBlocks(parsed))
    },
    'editor.subscribeContent': async() => ({
      handle: bridge.track(bridge.ctx.editor.onDidChangeContent((event) => {
        bridge.emit('editor:content-change', { tabId: event.tabId, source: event.source })
      }))
    }),
    'editor.subscribeActiveTab': async() => ({
      handle: bridge.track(bridge.ctx.editor.onDidChangeActiveTab((tab) => {
        bridge.emit('editor:active-tab', tabInfo(tab))
      }))
    }),
    'editor.subscribeSetContent': async() => ({
      handle: bridge.track(bridge.ctx.editor.onDidSetContent((event) => {
        bridge.emit('editor:set-content', { tabId: event.tabId })
      }))
    }),
    'editor.registerCodeBlockRenderer': async(args) => {
      const payload = objectArg(args)
      const rawLang = readField(payload, 'lang')
      if (!Array.isArray(rawLang) || rawLang.length === 0) bad('lang must be a non-empty array')
      const lang: string[] = []
      for (const item of rawLang) {
        if (typeof item !== 'string' || !/^[a-z0-9][a-z0-9-]{0,30}$/.test(item)) bad('lang contains an invalid language')
        lang.push(item)
      }
      const debounceMs = numberField(payload, 'debounceMs')
      let token = ''
      const registration = bridge.ctx.editor.registerCodeBlockRenderer({
        lang,
        ...(debounceMs !== null ? { debounceMs } : {}),
        render: async(container, renderCtx) => {
          let html = ''
          try {
            const value = await bridge.requestPlugin('codeblock.render', {
              token,
              source: renderCtx.source,
              lang: renderCtx.lang
            }, 5_000, renderCtx.signal)
            html = typeof value === 'string' ? value : ''
          } catch {
            html = ''
          }
          if (renderCtx.signal.aborted) return
          container.innerHTML = sanitizeCommunityHtml(html)
        },
        exportHtml: async(source, fenceLang) => {
          try {
            const value = await bridge.requestPlugin('codeblock.exportHtml', { token, source, lang: fenceLang }, 5_000)
            return sanitizeCommunityHtml(typeof value === 'string' ? value : '')
          } catch {
            return ''
          }
        }
      })
      token = bridge.track(registration)
      return { handle: token }
    },
    'editor.insertText': async(args) => {
      bridge.ctx.editor.insertText(requireString(objectArg(args), 'text'))
      return null
    },
    'editor.replaceRange': async(args) => {
      const payload = objectArg(args)
      const path = blockPath(readField(payload, 'path'))
      const start = numberField(payload, 'start')
      const end = numberField(payload, 'end')
      const replacement = stringField(payload, 'replacement')
      if (!path || start === null || end === null || replacement === null) bad('replaceRange is malformed')
      const expected = stringField(payload, 'expected')
      if (expected === null) bad('replaceRange requires expected')
      return bridge.ctx.editor.replaceRange({ path, start, end, replacement, expected })
    },
    'editor.setDecorations': async(args) => {
      const payload = objectArg(args)
      const layerId = requireString(payload, 'layerId', 80)
      const rawRanges = readField(payload, 'ranges')
      if (!Array.isArray(rawRanges)) bad('ranges must be an array')
      const ranges = rawRanges.map((range) => {
        if (!range || typeof range !== 'object') bad('decoration range is malformed')
        const path = blockPath(readField(range, 'path'))
        const start = numberField(range, 'start')
        const end = numberField(range, 'end')
        const className = stringField(range, 'className')
        if (!path || start === null || end === null || className === null) bad('decoration range is malformed')
        const normalized = normalizeDecorationClass(className)
        if (!normalized) bad('decoration class must be spelling, grammar, style or info')
        const data = readField(range, 'data')
        const cleanData = data && typeof data === 'object' && !Array.isArray(data)
          ? Object.fromEntries(Object.entries(data).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
          : undefined
        return { path, start, end, className: normalized, ...(cleanData ? { data: cleanData } : {}) }
      })
      bridge.ctx.editor.setDecorations(layerId, ranges)
      return null
    },
    'editor.clearDecorations': async(args) => {
      bridge.ctx.editor.clearDecorations(requireString(objectArg(args), 'layerId', 80))
      return null
    },
    'editor.subscribeDecorationClick': async(args) => {
      const layerId = requireString(objectArg(args), 'layerId', 80)
      return {
        handle: bridge.track(bridge.ctx.editor.onDidClickDecoration(layerId, (event) => {
          bridge.emit('editor:decoration-click', {
            layerId,
            path: event.range.path,
            start: event.range.start,
            end: event.range.end,
            className: event.range.className,
            data: event.range.data ?? null
          })
        }))
      }
    },
    'vault.readText': async(args) => plain(await bridge.ctx.vault.readText(requireString(objectArg(args), 'path'))),
    'vault.readBinary': async(args) => {
      const payload = objectArg(args)
      const maxBytes = numberField(payload, 'maxBytes')
      const bytes = await bridge.ctx.vault.readBinary(requireString(payload, 'path'), maxBytes ?? undefined)
      return { base64: bytesToBase64(bytes) }
    },
    'vault.exists': async(args) => bridge.ctx.vault.exists(requireString(objectArg(args), 'path')),
    'vault.list': async(args) => {
      const raw = readField(objectArg(args), 'extensions')
      if (raw === undefined) return plain(await bridge.ctx.vault.list())
      if (!Array.isArray(raw)) bad('extensions must be an array of strings')
      const extensions: string[] = []
      for (const item of raw) {
        if (typeof item !== 'string') bad('extensions must be an array of strings')
        extensions.push(item)
      }
      return plain(await bridge.ctx.vault.list({ extensions }))
    },
    'vault.writeText': async(args) => {
      const payload = objectArg(args)
      const expected = numberField(payload, 'expectedMtimeMs')
      return plain(await bridge.ctx.vault.writeText(
        requireString(payload, 'path'),
        requireString(payload, 'content'),
        expected === null ? undefined : { expectedMtimeMs: expected }
      ))
    },
    'vault.createText': async(args) => {
      const payload = objectArg(args)
      await bridge.ctx.vault.createText(requireString(payload, 'path'), requireString(payload, 'content'))
      return null
    },
    'metadata.isReady': async() => bridge.ctx.metadata.isReady(),
    'metadata.getFile': async(args) => plain(await bridge.ctx.metadata.getFile(requireString(objectArg(args), 'path'))),
    'metadata.listFiles': async() => plain(await bridge.ctx.metadata.listFiles()),
    'metadata.resolveLink': async(args) => {
      const payload = objectArg(args)
      return bridge.ctx.metadata.resolveLink(requireString(payload, 'target'), requireString(payload, 'sourcePath'))
    },
    'metadata.getBacklinks': async(args) => plain(await bridge.ctx.metadata.getBacklinks(requireString(objectArg(args), 'path'))),
    'metadata.getTags': async() => plain(await bridge.ctx.metadata.getTags()),
    'metadata.getFilesWithTag': async(args) => {
      const payload = objectArg(args)
      const includeNested = boolField(payload, 'includeNested')
      return plain(await bridge.ctx.metadata.getFilesWithTag(
        requireString(payload, 'tag'),
        includeNested === null ? undefined : { includeNested }
      ))
    },
    'metadata.subscribe': async() => {
      const ready = bridge.ctx.metadata.onDidBecomeReady(() => bridge.emit('metadata:ready', {}))
      const changed = bridge.ctx.metadata.onDidChange((event) => bridge.emit('metadata:change', plain(event)))
      return {
        handle: bridge.track({
          dispose: () => {
            ready.dispose()
            changed.dispose()
          }
        })
      }
    },
    'net.fetch': async(args) => {
      const payload = objectArg(args)
      const result = await window.community.fetch(bridge.pluginId, requireString(payload, 'url', 2_000), {
        method: stringField(payload, 'method') === 'POST' ? 'POST' : 'GET',
        headers: headerRecord(payload),
        body: stringField(payload, 'body') ?? undefined,
        timeoutMs: numberField(payload, 'timeoutMs') ?? undefined
      })
      if (!result.ok) throw new PluginError(result.error.code, result.error.message)
      return result.value
    },
    'ui.registerSidebarPanel': async(args) => {
      const payload = objectArg(args)
      const id = requireString(payload, 'id', 64)
      const entry = requireString(payload, 'entry', 200)
      if (entry.includes('..') || entry.startsWith('/') || !entry.endsWith('.html')) {
        bad('panel entry must be a relative HTML file')
      }
      const handle = bridge.track(bridge.ctx.ui.registerSidebarPanel({
        id,
        title: requireString(payload, 'title', 80),
        icon: requireString(payload, 'icon', 8_000),
        order: numberField(payload, 'order') ?? 0,
        component: markRaw(bridge.panelComponent(entry))
      }))
      return { handle }
    },
    'ui.revealSidebarPanel': async(args) => {
      bridge.ctx.ui.revealSidebarPanel(requireString(objectArg(args), 'id', 64))
      return null
    },
    'ui.registerStatusBarItem': async(args) => {
      const payload = objectArg(args)
      const id = requireString(payload, 'id', 64)
      bridge.setStatus(id, stripStatus(requireString(payload, 'text', MAX_STATUS)), stripStatus(stringField(payload, 'tooltip') ?? ''))
      const handle = bridge.track(bridge.ctx.ui.registerStatusBarItem({
        id,
        order: numberField(payload, 'order') ?? 0,
        component: markRaw(bridge.statusComponent(id))
      }))
      return { handle }
    },
    'ui.updateStatusBarItem': async(args) => {
      const payload = objectArg(args)
      const id = requireString(payload, 'id', 64)
      const text = stringField(payload, 'text')
      const tooltip = stringField(payload, 'tooltip')
      bridge.setStatus(id, text === null ? '' : stripStatus(text), tooltip === null ? '' : stripStatus(tooltip))
      return null
    },
    'clipboard.writeText': async(args) => {
      window.electron.clipboard.writeText(requireString(objectArg(args), 'text'))
      return null
    }
  }

  return async(method, args) => {
    const handler = handlers[method]
    if (!handler) throw new PluginError('UNKNOWN_METHOD', `Unknown method "${method}"`)
    return handler(args)
  }
}
