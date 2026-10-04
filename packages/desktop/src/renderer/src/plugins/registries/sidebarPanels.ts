import { markRaw, shallowReactive, type Component } from 'vue'
import DOMPurify from 'dompurify'
import type { Disposable, RendererPluginContext, SidebarPanelContribution } from '../types'

/** Panels the sidebar implements itself; plugin panels cannot reuse these ids. */
export const BUILTIN_SIDEBAR_PANEL_IDS: readonly string[] = ['files', 'search', 'toc']

export interface RegisteredSidebarPanel {
  id: string
  pluginId: string
  ctx: RendererPluginContext
  /** i18n key in the plugin namespace; translate with `ctx.t`. */
  title: string
  /** Sanitized SVG markup, safe for `v-html`. */
  icon: string
  component: Component
  order: number
}

const panels = shallowReactive<RegisteredSidebarPanel[]>([])

/**
 * Reduces plugin-supplied icon markup to a single inert `<svg>`: no scripts,
 * event handlers, links, external references, styles or foreign content.
 * Returns '' when nothing usable is left.
 */
export const sanitizeSvgIcon = (markup: string): string => {
  const fragment = DOMPurify.sanitize(markup, {
    USE_PROFILES: { svg: true },
    FORBID_TAGS: ['style', 'foreignObject', 'a', 'use', 'image', 'script'],
    FORBID_ATTR: ['style', 'href', 'xlink:href'],
    RETURN_DOM_FRAGMENT: true
  })
  const svg = fragment.firstElementChild
  if (!svg || svg.tagName.toLowerCase() !== 'svg' || fragment.childElementCount !== 1) return ''
  return svg.outerHTML
}

/** Plugin panels sorted by `order` (then registration order); reactive. */
export const listSidebarPanels = (): readonly RegisteredSidebarPanel[] => panels

export const getSidebarPanel = (id: string): RegisteredSidebarPanel | undefined =>
  panels.find((panel) => panel.id === id)

/** Adds a panel to the sidebar icon strip; throws on an empty, built-in or duplicate id. */
export const registerSidebarPanel = (
  ctx: RendererPluginContext,
  panel: SidebarPanelContribution
): Disposable => {
  if (!panel.id || BUILTIN_SIDEBAR_PANEL_IDS.includes(panel.id) || getSidebarPanel(panel.id)) {
    throw new Error(`Sidebar panel id "${panel.id}" is empty or already registered`)
  }
  const entry: RegisteredSidebarPanel = {
    id: panel.id,
    pluginId: ctx.id,
    ctx,
    title: panel.title,
    icon: sanitizeSvgIcon(panel.icon),
    component: markRaw(panel.component),
    order: panel.order ?? 0
  }
  const index = panels.findIndex((p) => p.order > entry.order)
  panels.splice(index === -1 ? panels.length : index, 0, entry)
  return {
    dispose: () => {
      const at = panels.indexOf(entry)
      if (at !== -1) panels.splice(at, 1)
    }
  }
}
