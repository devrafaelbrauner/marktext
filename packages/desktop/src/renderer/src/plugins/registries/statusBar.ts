import { markRaw, shallowReactive, type Component } from 'vue'
import type { Disposable, RendererPluginContext, StatusBarItemContribution } from '../types'

export interface RegisteredStatusBarItem {
  id: string
  pluginId: string
  ctx: RendererPluginContext
  component: Component
  order: number
}

const items = shallowReactive<RegisteredStatusBarItem[]>([])

/** Status bar items sorted by `order` (then registration order); reactive. */
export const listStatusBarItems = (): readonly RegisteredStatusBarItem[] => items

/** Adds an item next to the word count; throws on an empty or duplicate id. */
export const registerStatusBarItem = (
  ctx: RendererPluginContext,
  item: StatusBarItemContribution
): Disposable => {
  if (!item.id || items.some((i) => i.id === item.id)) {
    throw new Error(`Status bar item id "${item.id}" is empty or already registered`)
  }
  const entry: RegisteredStatusBarItem = {
    id: item.id,
    pluginId: ctx.id,
    ctx,
    component: markRaw(item.component),
    order: item.order ?? 0
  }
  const index = items.findIndex((i) => i.order > entry.order)
  items.splice(index === -1 ? items.length : index, 0, entry)
  return {
    dispose: () => {
      const at = items.indexOf(entry)
      if (at !== -1) items.splice(at, 1)
    }
  }
}
