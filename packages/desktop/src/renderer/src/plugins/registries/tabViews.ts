import { markRaw, shallowReactive } from 'vue'
import type { Disposable, RendererPluginContext, TabViewContribution } from '../types'

export type AssetTabView = Extract<TabViewContribution, { kind: 'asset' }>
export type MarkdownTabView = Extract<TabViewContribution, { kind: 'markdown' }>

/** A contribution together with the context of the plugin that registered it. */
export interface RegisteredTabView<V extends TabViewContribution = TabViewContribution> {
  readonly view: V
  readonly ctx: RendererPluginContext
}

// Reactive so tab view hosts re-render when a plugin registers or unregisters
// a view (e.g. a restored PDF tab whose plugin activates after the tabs).
const entries = shallowReactive<RegisteredTabView[]>([])

let isReady = false
let resolveReady: () => void = () => {}
const ready = new Promise<void>((resolve) => {
  resolveReady = resolve
})

const extensionOf = (pathname: string): string => {
  const name = pathname.split(/[/\\]/).pop() ?? ''
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
}

/**
 * Backs `WorkspaceApi.registerTabView`. Throws when the id is already taken or
 * an asset view lists no extension. When several asset views claim the same
 * extension, the earliest registered one opens the file.
 */
export const registerTabView = (
  ctx: RendererPluginContext,
  view: TabViewContribution
): Disposable => {
  if (!view.id) {
    throw new Error(`Plugin "${ctx.id}" registered a tab view without id.`)
  }
  if (entries.some((entry) => entry.view.id === view.id)) {
    throw new Error(`Tab view "${view.id}" is already registered.`)
  }
  if (view.kind === 'asset' && view.extensions.length === 0) {
    throw new Error(`Asset tab view "${view.id}" lists no extension.`)
  }

  const entry: RegisteredTabView = markRaw({
    view: view.kind === 'asset'
      ? { ...view, extensions: view.extensions.map((ext) => ext.replace(/^\./, '').toLowerCase()) }
      : view,
    ctx
  })
  entries.push(entry)

  return {
    dispose: () => {
      const index = entries.indexOf(entry)
      if (index !== -1) entries.splice(index, 1)
    }
  }
}

export const getTabView = (id: string | null): RegisteredTabView | null =>
  (id && entries.find((entry) => entry.view.id === id)) || null

export const getAssetViewForPath = (pathname: string): RegisteredTabView<AssetTabView> | null => {
  const ext = extensionOf(pathname)
  if (!ext) return null
  const entry = entries.find(
    (candidate) => candidate.view.kind === 'asset' && candidate.view.extensions.includes(ext)
  )
  return (entry as RegisteredTabView<AssetTabView> | undefined) ?? null
}

export const listMarkdownViews = (): Array<RegisteredTabView<MarkdownTabView>> =>
  entries.filter(
    (entry): entry is RegisteredTabView<MarkdownTabView> => entry.view.kind === 'markdown'
  )

/**
 * First markdown view whose `matches` accepts the document. A throwing
 * `matches` counts as no match so one faulty plugin cannot block file opening.
 */
export const findMatchingMarkdownView = (
  markdown: string
): RegisteredTabView<MarkdownTabView> | null => {
  for (const entry of listMarkdownViews()) {
    const { matches } = entry.view
    if (!matches) continue
    try {
      if (matches(markdown)) return entry
    } catch (err) {
      console.error(`Tab view "${entry.view.id}" failed to match a document:`, err)
    }
  }
  return null
}

/** Called by the plugin host once the initial plugin activation pass is over. */
export const markTabViewsReady = (): void => {
  isReady = true
  resolveReady()
}

export const isTabViewsReady = (): boolean => isReady

/** Resolves once the initial registrations are in, so routing decisions see them. */
export const whenTabViewsReady = (): Promise<void> => ready
