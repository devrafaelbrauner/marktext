import { reactive, shallowRef, type ShallowRef } from 'vue'
import type { RendererPluginContext } from '@/plugins/types'
import type { TagCount } from '@shared/plugins/types'

export type TagsStatus = 'noFolder' | 'indexing' | 'ready' | 'error'

export interface TagsViewState {
  status: TagsStatus
  /** Message of the last failed load (status 'error'). */
  error: string
  filter: string
  /** Tag whose notes the panel lists, or null. */
  selectedTag: string | null
  /** Whether the rename dialog is open; it starts with `renameFrom`. */
  renameOpen: boolean
  renameFrom: string
}

export interface TagsStore {
  /** Tag counts of the opened folder, as the index reports them (parents included). */
  readonly tags: ShallowRef<TagCount[]>
  /** Bumped whenever the index reports a change; the panel reloads its note list on it. */
  readonly revision: ShallowRef<number>
  readonly view: TagsViewState
  refresh(): Promise<void>
  /** Shows `tag` in the panel: filtered to it and its notes listed. */
  revealTag(tag: string): void
  /** Opens the rename dialog (for the selected tag when `tag` is omitted). */
  requestRename(tag?: string): void
}

export const TAGS_PANEL_ID = 'tags'

/**
 * Tag list shared by the panel and the completion provider. It follows the
 * vault index (ready, changes, folder switches) through `ctx`, so every
 * listener goes away when the plugin is disabled.
 */
export const createTagsStore = (ctx: RendererPluginContext): TagsStore => {
  const tags = shallowRef<TagCount[]>([])
  const revision = shallowRef(0)
  const view = reactive<TagsViewState>({
    status: 'noFolder',
    error: '',
    filter: '',
    selectedTag: null,
    renameOpen: false,
    renameFrom: ''
  })
  let generation = 0

  const refresh = async(): Promise<void> => {
    const current = ++generation
    if (!ctx.workspace.getRootPath()) {
      tags.value = []
      view.status = 'noFolder'
      return
    }
    if (!ctx.metadata.isReady()) {
      view.status = 'indexing'
      return
    }
    try {
      const next = await ctx.metadata.getTags()
      if (current !== generation) return
      tags.value = next
      view.status = 'ready'
      view.error = ''
    } catch (error) {
      if (current !== generation) return
      view.status = 'error'
      view.error = error instanceof Error ? error.message : String(error)
    }
  }

  const changed = (): void => {
    revision.value++
    refresh()
  }

  ctx.metadata.onDidBecomeReady(changed)
  ctx.metadata.onDidChange(changed)
  ctx.workspace.onDidChangeRootPath(() => {
    view.selectedTag = null
    view.filter = ''
    changed()
  })
  refresh()

  return {
    tags,
    revision,
    view,
    refresh,
    revealTag: (tag) => {
      view.filter = tag
      view.selectedTag = tag
      ctx.ui.revealSidebarPanel(TAGS_PANEL_ID)
    },
    requestRename: (tag) => {
      view.renameFrom = tag ?? view.selectedTag ?? ''
      view.renameOpen = true
      ctx.ui.revealSidebarPanel(TAGS_PANEL_ID)
    }
  }
}
