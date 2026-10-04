<template>
  <div class="tags-panel">
    <div class="tags-title">
      {{ ctx.t('panel.title') }}
    </div>

    <div class="tags-filter">
      <input
        v-model="view.filter"
        type="text"
        :placeholder="ctx.t('panel.filterPlaceholder')"
        :aria-label="ctx.t('panel.filterPlaceholder')"
        @keydown.down.prevent="focusRow(0)"
        @keydown.esc="view.filter = ''"
      >
      <button
        v-if="view.filter"
        type="button"
        class="tags-icon-button"
        :title="ctx.t('panel.clearFilter')"
        :aria-label="ctx.t('panel.clearFilter')"
        @click="view.filter = ''"
      >
        <PanelIcon name="clear" />
      </button>
    </div>

    <div class="tags-toolbar">
      <button
        type="button"
        class="tags-icon-button"
        :disabled="!hasParents || !!view.filter"
        :title="ctx.t('panel.expandAll')"
        :aria-label="ctx.t('panel.expandAll')"
        @click="expandAll"
      >
        <PanelIcon name="expandAll" />
      </button>
      <button
        type="button"
        class="tags-icon-button"
        :disabled="!hasParents || !!view.filter"
        :title="ctx.t('panel.collapseAll')"
        :aria-label="ctx.t('panel.collapseAll')"
        @click="collapseAll"
      >
        <PanelIcon name="collapseAll" />
      </button>
      <button
        type="button"
        class="tags-icon-button"
        :disabled="view.status !== 'ready'"
        :title="ctx.t('panel.rename')"
        :aria-label="ctx.t('panel.rename')"
        @click="store.requestRename()"
      >
        <PanelIcon name="rename" />
      </button>
    </div>

    <p
      v-if="message"
      class="tags-message"
      role="status"
    >
      {{ message }}
    </p>
    <ul
      v-else
      ref="treeRef"
      class="tags-tree"
      role="tree"
      :aria-label="ctx.t('panel.title')"
      @keydown="onTreeKeydown"
    >
      <li
        v-for="(row, index) of rows"
        :key="row.node.tag"
        role="treeitem"
        class="tags-row"
        :class="{ selected: isSelected(row.node.tag) }"
        :style="{ paddingLeft: `${8 + (row.level - 1) * 14}px` }"
        :tabindex="index === focusIndex ? 0 : -1"
        :aria-level="row.level"
        :aria-expanded="row.node.children.length > 0 ? row.expanded : undefined"
        :aria-selected="isSelected(row.node.tag)"
        :data-tag="row.node.tag"
        @click="select(index)"
        @focus="focusIndex = index"
      >
        <span
          class="tags-chevron"
          :class="{ open: row.expanded, hidden: row.node.children.length === 0 || !!view.filter }"
          aria-hidden="true"
          @click.stop="toggle(index)"
        >
          <PanelIcon name="chevron" />
        </span>
        <span class="tags-name">#{{ row.node.name }}</span>
        <span
          class="tags-count"
          :aria-label="row.node.count === 1 ? ctx.t('panel.noteCountOne') : ctx.t('panel.noteCount', { count: row.node.count })"
        >{{ row.node.count }}</span>
      </li>
    </ul>

    <section
      v-if="view.selectedTag"
      class="tags-notes"
      :aria-label="ctx.t('panel.notesTagged', { tag: view.selectedTag })"
    >
      <div class="tags-notes-header">
        <span class="tags-notes-title">{{ ctx.t('panel.notesTagged', { tag: view.selectedTag }) }}</span>
        <button
          type="button"
          class="tags-icon-button"
          :title="ctx.t('panel.closeNotes')"
          :aria-label="ctx.t('panel.closeNotes')"
          @click="view.selectedTag = null"
        >
          <PanelIcon name="clear" />
        </button>
      </div>
      <p
        v-if="notesLoaded && notes.length === 0"
        class="tags-message"
      >
        {{ ctx.t('panel.noNotes') }}
      </p>
      <ul
        v-else
        class="tags-note-list"
      >
        <li
          v-for="note of notes"
          :key="note.path"
        >
          <button
            type="button"
            class="tags-note"
            :title="note.path"
            @click="ctx.workspace.openFile(note.path)"
          >
            <span class="tags-note-name">{{ note.name }}</span>
            <span
              v-if="note.folder"
              class="tags-note-folder"
            >{{ note.folder }}</span>
          </button>
        </li>
      </ul>
    </section>

    <RenameDialog
      :ctx="ctx"
      :store="store"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import type { RendererPluginContext } from '@/plugins/types'
import { buildTagTree, collectParentKeys, flattenTagTree } from '../common/tree'
import { describeNotePath } from './notePath'
import type { TagsStore } from './store'
import PanelIcon from './PanelIcon.vue'
import RenameDialog from './RenameDialog.vue'

const props = defineProps<{ ctx: RendererPluginContext; store: TagsStore }>()

const view = props.store.view
const tree = computed(() => buildTagTree(props.store.tags.value))
const parentKeys = computed(() => collectParentKeys(tree.value))
const hasParents = computed(() => parentKeys.value.length > 0)
const expanded = ref<Set<string>>(new Set())
const rows = computed(() => flattenTagTree(tree.value, expanded.value, view.filter))
const focusIndex = ref(0)
const treeRef = ref<HTMLUListElement | null>(null)

const collapseAll = (): void => {
  expanded.value = new Set()
}

const message = computed((): string => {
  switch (view.status) {
    case 'noFolder':
      return props.ctx.t('panel.noFolder')
    case 'indexing':
      return props.ctx.t('panel.indexing')
    case 'error':
      return props.ctx.t('panel.loadFailed', { message: view.error })
    default:
      if (tree.value.length === 0) return props.ctx.t('panel.empty')
      if (rows.value.length === 0) return props.ctx.t('panel.noMatch', { query: view.filter })
      return ''
  }
})

const isSelected = (tag: string): boolean => view.selectedTag?.toLowerCase() === tag.toLowerCase()

const expandAll = (): void => {
  expanded.value = new Set(parentKeys.value)
}

const toggle = (index: number): void => {
  const row = rows.value[index]
  if (!row || row.node.children.length === 0 || view.filter) return
  const key = row.node.tag.toLowerCase()
  const next = new Set(expanded.value)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  expanded.value = next
}

const select = (index: number): void => {
  const row = rows.value[index]
  if (!row) return
  focusIndex.value = index
  view.selectedTag = row.node.tag
}

const focusRow = (index: number): void => {
  if (rows.value.length === 0) return
  focusIndex.value = Math.max(0, Math.min(index, rows.value.length - 1))
  nextTick(() => {
    const items = treeRef.value?.querySelectorAll<HTMLElement>('[role="treeitem"]')
    items?.[focusIndex.value]?.focus()
  })
}

const parentIndex = (index: number): number => {
  const level = rows.value[index].level
  for (let i = index - 1; i >= 0; i--) {
    if (rows.value[i].level < level) return i
  }
  return index
}

// Treeview keyboard pattern (WAI-ARIA APG): arrows move and expand/collapse, Enter/Space select.
const onTreeKeydown = (event: KeyboardEvent): void => {
  const index = focusIndex.value
  const row = rows.value[index]
  if (!row) return
  const hasChildren = row.node.children.length > 0
  switch (event.key) {
    case 'ArrowDown':
      focusRow(index + 1)
      break
    case 'ArrowUp':
      focusRow(index - 1)
      break
    case 'Home':
      focusRow(0)
      break
    case 'End':
      focusRow(rows.value.length - 1)
      break
    case 'ArrowRight':
      if (hasChildren && !row.expanded) toggle(index)
      else if (hasChildren) focusRow(index + 1)
      break
    case 'ArrowLeft':
      if (hasChildren && row.expanded && !view.filter) toggle(index)
      else focusRow(parentIndex(index))
      break
    case 'Enter':
    case ' ':
      select(index)
      break
    default:
      return
  }
  event.preventDefault()
}

// Keep the roving tab stop on an existing row when the list shrinks.
watch(rows, (list) => {
  if (focusIndex.value >= list.length) focusIndex.value = Math.max(0, list.length - 1)
})

// Show a revealed tag inside its collapsed parents once the filter is cleared.
watch(
  () => view.selectedTag,
  (tag) => {
    if (!tag) return
    const parts = tag.toLowerCase().split('/')
    if (parts.length < 2) return
    const next = new Set(expanded.value)
    for (let depth = 1; depth < parts.length; depth++) next.add(parts.slice(0, depth).join('/'))
    expanded.value = next
  },
  { immediate: true }
)

interface NoteItem {
  path: string
  name: string
  folder: string
}

const notes = ref<NoteItem[]>([])
const notesLoaded = ref(false)
let notesRequest = 0

watch(
  [() => view.selectedTag, props.store.revision],
  async ([tag]) => {
    const request = ++notesRequest
    notesLoaded.value = false
    if (!tag) {
      notes.value = []
      return
    }
    try {
      const paths = await props.ctx.metadata.getFilesWithTag(tag, { includeNested: true })
      if (request !== notesRequest) return
      const root = props.ctx.workspace.getRootPath()
      notes.value = paths.map((path) => ({ path, ...describeNotePath(path, root) }))
    } catch {
      if (request !== notesRequest) return
      notes.value = []
    }
    notesLoaded.value = true
  },
  { immediate: true }
)
</script>

<style scoped>
.tags-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  color: var(--sideBarColor);
}

.tags-title {
  flex-shrink: 0;
  margin: 37px 0 10px 0;
  padding-left: 25px;
  color: var(--sideBarTitleColor);
  font-size: 16px;
  font-weight: 600;
}

.tags-filter {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  box-sizing: border-box;
  height: 28px;
  margin: 0 8px 6px 8px;
  padding: 0 4px 0 6px;
  border: 1px solid var(--floatBorderColor);
  border-radius: 4px;
  background: var(--inputBgColor);
}

.tags-filter > input {
  flex: 1;
  width: 50%;
  height: 100%;
  padding: 0;
  border: none;
  outline: none;
  background: transparent;
  color: var(--sideBarColor);
  font-size: 13px;
}

.tags-toolbar {
  display: flex;
  flex-shrink: 0;
  justify-content: flex-end;
  gap: 2px;
  margin: 0 8px 6px 8px;
}

.tags-icon-button {
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  padding: 0;
  border: none;
  border-radius: 3px;
  background: transparent;
  color: var(--sideBarIconColor);
  cursor: pointer;
}

.tags-icon-button:hover:not(:disabled),
.tags-icon-button:focus-visible {
  background: var(--sideBarItemHoverBgColor);
  color: var(--highlightThemeColor);
}

.tags-icon-button:disabled {
  cursor: default;
  opacity: 0.4;
}

.tags-icon-button :deep(svg) {
  width: 14px;
  height: 14px;
}

.tags-message {
  margin: 8px 15px;
  font-size: 12px;
  overflow-wrap: break-word;
}

.tags-tree {
  flex: 1;
  min-height: 0;
  margin: 0;
  padding: 0;
  overflow-x: hidden;
  overflow-y: auto;
  list-style: none;
}

.tags-row {
  display: flex;
  align-items: center;
  height: 26px;
  padding-right: 10px;
  font-size: 14px;
  cursor: pointer;
  outline: none;
}

.tags-row:hover,
.tags-row:focus-visible {
  background: var(--sideBarItemHoverBgColor);
}

.tags-row.selected {
  background: var(--sideBarItemHoverBgColor);
  color: var(--themeColor);
}

.tags-chevron {
  display: inline-flex;
  flex-shrink: 0;
  width: 16px;
  height: 16px;
  margin-right: 2px;
  color: var(--sideBarIconColor);
  transition: transform 0.15s;
}

.tags-chevron.open {
  transform: rotate(90deg);
}

.tags-chevron.hidden {
  visibility: hidden;
}

.tags-chevron :deep(svg) {
  width: 14px;
  height: 14px;
  margin: 1px;
}

.tags-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tags-count {
  flex-shrink: 0;
  min-width: 16px;
  height: 16px;
  margin-left: 6px;
  padding: 0 5px;
  border-radius: 3px;
  background: var(--itemBgColor);
  color: var(--sideBarTextColor);
  font-size: 10px;
  line-height: 16px;
  text-align: center;
}

.tags-notes {
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  max-height: 45%;
  border-top: 1px solid var(--itemBgColor);
}

.tags-notes-header {
  display: flex;
  align-items: center;
  padding: 8px 8px 4px 15px;
}

.tags-notes-title {
  flex: 1;
  overflow: hidden;
  color: var(--sideBarTitleColor);
  font-size: 13px;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tags-note-list {
  min-height: 0;
  margin: 0;
  padding: 0 0 8px 0;
  overflow-y: auto;
  list-style: none;
}

.tags-note {
  display: flex;
  flex-direction: column;
  width: 100%;
  padding: 4px 10px 4px 15px;
  border: none;
  background: transparent;
  color: var(--sideBarColor);
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.tags-note:hover,
.tags-note:focus-visible {
  background: var(--sideBarItemHoverBgColor);
  outline: none;
}

.tags-note-name {
  overflow: hidden;
  color: var(--sideBarTextColor);
  font-size: 13px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tags-note-folder {
  overflow: hidden;
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
