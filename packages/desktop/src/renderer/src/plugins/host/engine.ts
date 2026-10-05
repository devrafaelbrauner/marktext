import {
  registerCodeBlockRenderer as engineRegisterCodeBlockRenderer,
  registerCompletionProvider as engineRegisterCompletionProvider,
  registerInlineSyntax as engineRegisterInlineSyntax,
  type Muya
} from '@muyajs/core'
import type {
  BlockPath,
  CheckableBlock,
  CodeBlockRenderer,
  CompletionProvider,
  ContentChangeEvent,
  DecorationClickEvent,
  DecorationRange,
  Disposable,
  EditorSelection,
  EngineOptionRequests,
  InlineSyntaxRule,
  MermaidEngineOptions,
  RangeEdit
} from '../types'

/** Process-global engine registries (module functions of @muyajs/core); injectable for tests. */
export interface EngineRegistries {
  registerInlineSyntax(rule: InlineSyntaxRule): () => void
  registerCodeBlockRenderer(renderer: CodeBlockRenderer): () => void
  registerCompletionProvider(provider: CompletionProvider): () => void
}

export const MUYA_ENGINE_REGISTRIES: EngineRegistries = {
  registerInlineSyntax: engineRegisterInlineSyntax,
  registerCodeBlockRenderer: engineRegisterCodeBlockRenderer,
  registerCompletionProvider: engineRegisterCompletionProvider
}

/** The `Muya` methods the host calls; a structural subset so specs can pass a stand-in. */
export type EngineInstance = Pick<
  Muya,
  | 'on'
  | 'off'
  | 'setOptions'
  | 'setDecorations'
  | 'clearDecorations'
  | 'replaceRange'
  | 'getCheckableBlocks'
  | 'insertText'
  | 'insertMarkdownBlocks'
  | 'getTextSelection'
  | 'refreshInlineRendering'
>

interface DecorationClickPayload extends DecorationClickEvent {
  layerId: string
}

interface FormatClickPayload {
  event: MouseEvent
  formatType: string
  data: unknown
}

type Listener<T> = (event: T) => void

class ListenerSet<T> {
  private readonly listeners = new Set<Listener<T>>()

  add(listener: Listener<T>): Disposable {
    this.listeners.add(listener)
    return { dispose: () => this.listeners.delete(listener) }
  }

  get size(): number {
    return this.listeners.size
  }

  emit(event: T): void {
    for (const listener of [...this.listeners]) {
      try {
        listener(event)
      } catch (err) {
        console.error('[plugins] listener failed:', err)
      }
    }
  }
}

export interface EngineHostOptions {
  /** Id of the active tab, read when the engine reports a content change or reload. */
  getActiveTabId(): string | null
  isMac: boolean
  registries?: EngineRegistries
}

/**
 * Bridge between plugins and the editor engine of this window. The engine may
 * be created and destroyed (editor remount) while plugins stay active, so
 * plugins talk to this object and it forwards to whichever engine is attached:
 * engine events are re-dispatched to plugin listeners, engine option requests
 * are OR-ed and re-applied on attach, and inline syntax changes trigger one
 * coalesced inline re-render.
 */
export class EngineHost {
  private muya: EngineInstance | null = null
  private readonly registries: EngineRegistries
  private readonly contentChanged = new ListenerSet<ContentChangeEvent>()
  private readonly contentSet = new ListenerSet<{ tabId: string }>()
  private readonly decorationClicks = new Map<string, ListenerSet<DecorationClickEvent>>()

  private readonly inlineTokenClicks = new Map<string, ListenerSet<{ data: Record<string, string>; event: MouseEvent }>>()
  private readonly optionRequests = new Set<EngineOptionRequests>()
  /** Nesting depth of host-initiated edits; content changes inside are reported as 'api'. */
  private apiDepth = 0
  /** True during the task in which the app requested an undo/redo. */
  private historyPending = false
  private refreshScheduled = false
  /** User's spellcheck preference as last reported by the editor; null until it reports one. */
  private spellcheckPreference: boolean | null = null

  private readonly onContentSetEvent = (): void => {
    const tabId = this.options.getActiveTabId()
    if (tabId) this.contentSet.emit({ tabId })
  }

  private readonly onDecorationClickEvent = (payload: DecorationClickPayload): void => {
    const { layerId, range, rect, event } = payload
    this.decorationClicks.get(layerId)?.emit({ range, rect, event })
  }

  private readonly onFormatClickEvent = ({ event, formatType, data }: FormatClickPayload): void => {
    const listeners = this.inlineTokenClicks.get(formatType)
    if (!listeners) return
    const ctrlOrMeta = this.options.isMac ? event.metaKey : event.ctrlKey
    // A finger has no modifier keys, so on touch screens a tap follows the
    // token (wikilink, tag) the way Ctrl/Cmd-click does with a mouse.
    const fingerTap = typeof PointerEvent !== 'undefined' && event instanceof PointerEvent && event.pointerType === 'touch'
    if (!ctrlOrMeta && !fingerTap) return
    listeners.emit({ data: { ...(data as Record<string, string>) }, event })
  }

  constructor(private readonly options: EngineHostOptions) {
    this.registries = options.registries ?? MUYA_ENGINE_REGISTRIES
  }

  getMuya(): Muya | null {
    return this.muya as Muya | null
  }

  /** Connects a freshly initialized engine; replaces any previous one. */
  attach(muya: EngineInstance): void {
    this.detach()
    this.muya = muya
    muya.on('content-set', this.onContentSetEvent)
    muya.on('decoration-click', this.onDecorationClickEvent)
    muya.on('format-click', this.onFormatClickEvent)
    this.applyEngineOptions()
  }

  detach(): void {
    const { muya } = this
    if (!muya) return
    muya.off('content-set', this.onContentSetEvent)
    muya.off('decoration-click', this.onDecorationClickEvent)
    muya.off('format-click', this.onFormatClickEvent)
    this.muya = null
  }

  /**
   * Reports a committed edit of `tabId` (called after the editor store
   * accepted it, in every editing mode). Delivery waits one microtask so an
   * undo/redo request that caused the edit is known by then.
   */
  notifyContentChange(tabId: string): void {
    if (tabId !== this.options.getActiveTabId()) return
    const fromApi = this.apiDepth > 0
    queueMicrotask(() => {
      const source = fromApi || this.historyPending ? 'api' : 'user'
      this.contentChanged.emit({ tabId, source })
    })
  }

  /**
   * Marks content changes reported in the current task as programmatic
   * (undo/redo requested through the app). The mark expires with the task, so
   * an undo with nothing to undo cannot mislabel the next keystroke.
   */
  notifyHistoryRequest(): void {
    this.historyPending = true
    setTimeout(() => {
      this.historyPending = false
    }, 0)
  }

  onDidChangeContent(listener: Listener<ContentChangeEvent>): Disposable {
    return this.contentChanged.add(listener)
  }

  onDidSetContent(listener: Listener<{ tabId: string }>): Disposable {
    return this.contentSet.add(listener)
  }

  setDecorations(layerId: string, ranges: DecorationRange[]): void {
    this.muya?.setDecorations(layerId, ranges)
  }

  clearDecorations(layerId: string): void {
    this.muya?.clearDecorations(layerId)
  }

  onDidClickDecoration(layerId: string, listener: Listener<DecorationClickEvent>): Disposable {
    return this.addKeyed(this.decorationClicks, layerId, listener)
  }

  replaceRange(edit: RangeEdit): boolean {
    const { muya } = this
    if (!muya) return false
    return this.asApi(() => muya.replaceRange(edit))
  }

  getCheckableBlocks(paths?: BlockPath[]): CheckableBlock[] {
    return this.muya?.getCheckableBlocks(paths) ?? []
  }

  insertText(text: string): void {
    const { muya } = this
    if (muya) this.asApi(() => muya.insertText(text))
  }

  insertMarkdownBlocks(markdown: string, after?: BlockPath): boolean {
    const { muya } = this
    if (!muya) return false
    return this.asApi(() => muya.insertMarkdownBlocks(markdown, after))
  }

  getSelection(): EditorSelection | null {
    return this.muya?.getTextSelection() ?? null
  }

  /** Runs `edit` so the content changes it causes are reported with source 'api'. */
  asApi<T>(edit: () => T): T {
    this.apiDepth++
    try {
      return edit()
    } finally {
      this.apiDepth--
    }
  }

  registerInlineSyntax(rule: InlineSyntaxRule): Disposable {
    const unregister = this.registries.registerInlineSyntax(rule)
    this.refreshInlineRendering()
    return {
      dispose: () => {
        unregister()
        this.refreshInlineRendering()
      }
    }
  }

  onDidClickInlineToken(
    name: string,
    listener: Listener<{ data: Record<string, string>; event: MouseEvent }>
  ): Disposable {
    return this.addKeyed(this.inlineTokenClicks, name, listener)
  }

  registerCodeBlockRenderer(renderer: CodeBlockRenderer): Disposable {
    return { dispose: this.registries.registerCodeBlockRenderer(renderer) }
  }

  registerCompletionProvider(provider: CompletionProvider): Disposable {
    return { dispose: this.registries.registerCompletionProvider(provider) }
  }

  requestEngineOptions(options: EngineOptionRequests): Disposable {
    const request = { ...options }
    this.optionRequests.add(request)
    this.applyEngineOptions()
    return {
      dispose: () => {
        if (this.optionRequests.delete(request)) this.applyEngineOptions()
      }
    }
  }

  /**
   * Effective engine options: each switch is on when any active request asks
   * for it; `mermaid` comes from the latest active request that sets it.
   */
  getEngineOptions(): Required<Omit<EngineOptionRequests, 'mermaid'>> & Pick<EngineOptionRequests, 'mermaid'> {
    let atxHeadingRequiresSpace = false
    let disableNativeSpellcheck = false
    let mermaid: MermaidEngineOptions | undefined
    for (const request of this.optionRequests) {
      atxHeadingRequiresSpace ||= !!request.atxHeadingRequiresSpace
      disableNativeSpellcheck ||= !!request.disableNativeSpellcheck
      if (request.mermaid) mermaid = request.mermaid
    }
    return mermaid
      ? { atxHeadingRequiresSpace, disableNativeSpellcheck, mermaid }
      : { atxHeadingRequiresSpace, disableNativeSpellcheck }
  }

  /**
   * Records the user's spellcheck preference. The engine gets it unless an
   * active plugin requests `disableNativeSpellcheck`, in which case it stays
   * off until the last request is released.
   */
  setSpellcheckPreference(enabled: boolean): void {
    this.spellcheckPreference = enabled
    this.applyEngineOptions()
  }

  /** Spellcheck state the engine should have for the user's preference `enabled`. */
  getEffectiveSpellcheck(enabled: boolean): boolean {
    return enabled && !this.getEngineOptions().disableNativeSpellcheck
  }

  /**
   * Re-renders the inline content of the active document (after inline
   * syntax rules changed). Calls in the same task collapse into one render.
   */
  refreshInlineRendering(): void {
    if (this.refreshScheduled) return
    this.refreshScheduled = true
    queueMicrotask(() => {
      this.refreshScheduled = false
      this.muya?.refreshInlineRendering()
    })
  }

  private applyEngineOptions(): void {
    const { muya } = this
    if (!muya) return
    const { atxHeadingRequiresSpace, mermaid } = this.getEngineOptions()
    const options = {
      atxHeadingRequiresSpace,
      mermaidThemeOverride: mermaid?.theme ?? null,
      mermaidLook: mermaid?.look ?? 'classic'
    }
    if (this.spellcheckPreference === null) {
      muya.setOptions(options)
      return
    }
    muya.setOptions({
      ...options,
      spellcheckEnabled: this.getEffectiveSpellcheck(this.spellcheckPreference)
    })
  }

  private addKeyed<T>(map: Map<string, ListenerSet<T>>, key: string, listener: Listener<T>): Disposable {
    let listeners = map.get(key)
    if (!listeners) {
      listeners = new ListenerSet<T>()
      map.set(key, listeners)
    }
    const registration = listeners.add(listener)
    return {
      dispose: () => {
        registration.dispose()
        if (listeners.size === 0 && map.get(key) === listeners) map.delete(key)
      }
    }
  }
}
