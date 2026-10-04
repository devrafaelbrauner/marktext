<template>
  <div
    class="mt-icon-picker-overlay"
    @mousedown.self="emit('close')"
  >
    <div
      ref="dialog"
      class="mt-icon-picker"
      role="dialog"
      aria-modal="true"
      :aria-label="t('picker.title')"
      @keydown="handleDialogKeydown"
    >
      <div class="input-wrapper">
        <input
          ref="input"
          v-model="query"
          type="text"
          class="search"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded="true"
          :aria-controls="gridId"
          :aria-activedescendant="activeId"
          :aria-label="t('picker.search')"
          :placeholder="t('picker.search')"
          spellcheck="false"
          @keydown="handleInputKeydown"
        >
      </div>
      <div
        :id="gridId"
        ref="grid"
        class="grid"
        role="listbox"
        tabindex="0"
        :aria-label="t('picker.results', { count: results.length })"
        :aria-activedescendant="activeId"
        :style="{ height: `${GRID_HEIGHT}px` }"
        @scroll="scrollTop = ($event.target as HTMLElement).scrollTop"
        @keydown="handleGridKeydown"
      >
        <div
          class="grid-content"
          :style="{ height: `${rowCount * CELL_SIZE}px` }"
        >
          <div
            v-for="cell of visibleCells"
            :id="optionId(cell.index)"
            :key="cell.name"
            class="cell"
            role="option"
            :aria-selected="cell.index === selected"
            :aria-label="cell.name"
            :title="cell.name"
            :class="{ active: cell.index === selected }"
            :style="cell.style"
            @click="pick(cell.index)"
            @mousemove="selected = cell.index"
          >
            <span
              class="glyph"
              :style="cell.glyphStyle"
            />
          </div>
        </div>
        <p
          v-if="results.length === 0"
          class="empty"
        >
          {{ t('picker.empty') }}
        </p>
      </div>
      <div class="footer">
        <code
          v-if="selectedName"
          class="shortcode"
        >{{ formatShortcode(prefix, selectedName) }}</code>
        <span class="hint">{{ t('picker.hint') }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import type { IconPack } from '../common/pack'
import { searchIcons } from '../common/search'
import { formatShortcode } from '../common/shortcode'

const props = defineProps<{
  pack: IconPack
  t: (key: string, params?: Record<string, string | number>) => string
  /** Mask image `data:` URI of an icon (cached by the caller). */
  maskUri: (name: string) => string | null
}>()

const emit = defineEmits<{
  pick: [name: string]
  close: []
}>()

// Fixed geometry keeps the virtual grid arithmetic trivial: only the rows
// inside the scroll viewport (plus one row above and below) are rendered.
const COLUMNS = 10
const CELL_SIZE = 44
const VISIBLE_ROWS = 7
const GRID_HEIGHT = CELL_SIZE * VISIBLE_ROWS
const OVERSCAN_ROWS = 1

const gridId = `mt-icon-picker-grid-${Math.random().toString(36).slice(2)}`
const prefix = props.pack.prefix
const input = ref<HTMLInputElement | null>(null)
const grid = ref<HTMLElement | null>(null)
const query = ref('')
const selected = ref(0)
const scrollTop = ref(0)

const results = computed(() => searchIcons(props.pack, query.value))
const rowCount = computed(() => Math.ceil(results.value.length / COLUMNS))
const selectedName = computed<string | undefined>(() => results.value[selected.value])
const activeId = computed(() => (selectedName.value ? optionId(selected.value) : undefined))

const visibleCells = computed(() => {
  const firstRow = Math.max(0, Math.floor(scrollTop.value / CELL_SIZE) - OVERSCAN_ROWS)
  const lastRow = Math.min(rowCount.value, Math.ceil((scrollTop.value + GRID_HEIGHT) / CELL_SIZE) + OVERSCAN_ROWS)
  const end = Math.min(results.value.length, lastRow * COLUMNS)
  const cells: Array<{
    index: number
    name: string
    style: Record<string, string>
    glyphStyle: Record<string, string>
  }> = []
  for (let index = firstRow * COLUMNS; index < end; index++) {
    const name = results.value[index]
    const uri = props.maskUri(name)
    cells.push({
      index,
      name,
      style: {
        top: `${Math.floor(index / COLUMNS) * CELL_SIZE}px`,
        left: `${(index % COLUMNS) * CELL_SIZE}px`
      },
      glyphStyle: uri ? { maskImage: `url("${uri}")` } : {}
    })
  }
  return cells
})

function optionId (index: number): string {
  return `${gridId}-option-${index}`
}

watch(results, () => {
  selected.value = 0
  scrollTop.value = 0
  if (grid.value) grid.value.scrollTop = 0
})

// Keeps the selected row inside the viewport, which also keeps its option
// rendered so `aria-activedescendant` always points at an existing element.
watch(selected, (index) => {
  const element = grid.value
  if (!element) return
  const rowTop = Math.floor(index / COLUMNS) * CELL_SIZE
  if (rowTop < element.scrollTop) element.scrollTop = rowTop
  else if (rowTop + CELL_SIZE > element.scrollTop + GRID_HEIGHT) element.scrollTop = rowTop + CELL_SIZE - GRID_HEIGHT
  scrollTop.value = element.scrollTop
})

function move (delta: number): void {
  const count = results.value.length
  if (count === 0) return
  selected.value = Math.min(count - 1, Math.max(0, selected.value + delta))
}

function pick (index: number): void {
  const name = results.value[index]
  if (name) emit('pick', name)
}

// Keys shared by the search box and the grid; returns true when handled.
function handleNavigationKey (event: KeyboardEvent, inGrid: boolean): boolean {
  switch (event.key) {
    case 'ArrowDown':
      move(COLUMNS)
      return true
    case 'ArrowUp':
      move(-COLUMNS)
      return true
    case 'PageDown':
      move(COLUMNS * VISIBLE_ROWS)
      return true
    case 'PageUp':
      move(-COLUMNS * VISIBLE_ROWS)
      return true
    case 'Enter':
      pick(selected.value)
      return true
  }
  if (!inGrid) return false
  switch (event.key) {
    case 'ArrowRight':
      move(1)
      return true
    case 'ArrowLeft':
      move(-1)
      return true
    case 'Home':
      selected.value = 0
      return true
    case 'End':
      move(results.value.length)
      return true
  }
  return false
}

function handleInputKeydown (event: KeyboardEvent): void {
  if (event.isComposing) return
  if (handleNavigationKey(event, false)) event.preventDefault()
}

function handleGridKeydown (event: KeyboardEvent): void {
  if (handleNavigationKey(event, true)) {
    event.preventDefault()
    return
  }
  // Typing while the grid has focus goes on refining the search.
  if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
    input.value?.focus()
  }
}

// Escape closes; Tab cycles between the search box and the grid (the only
// focusable elements) so focus stays inside the modal. No key reaches the
// app's document-level shortcut handlers while the modal is open.
function handleDialogKeydown (event: KeyboardEvent): void {
  event.stopPropagation()
  if (event.key === 'Escape') {
    event.preventDefault()
    emit('close')
  } else if (event.key === 'Tab') {
    event.preventDefault()
    if (document.activeElement === input.value) grid.value?.focus()
    else input.value?.focus()
  }
}

onMounted(async () => {
  await nextTick()
  input.value?.focus()
})
</script>

<style scoped>
.mt-icon-picker-overlay {
  position: fixed;
  inset: 0;
  z-index: 10000;
  display: flex;
  justify-content: center;
  align-items: flex-start;
  background: var(--el-overlay-color-lighter, rgba(0, 0, 0, 0.5));
}
.mt-icon-picker {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 10vh;
  padding: 8px;
  box-sizing: content-box;
  /* 10 cells of 44px plus room for the scrollbar */
  width: 452px;
  color: var(--editorColor);
  background: var(--floatBgColor);
  border: 1px solid var(--floatBorderColor);
  border-radius: 4px;
  box-shadow: var(--floatShadow);
}
.input-wrapper {
  border: 1px solid var(--inputBgColor);
  background: var(--inputBgColor);
  border-radius: 3px;
}
input.search {
  box-sizing: border-box;
  width: 100%;
  height: 30px;
  padding: 0 10px;
  font-size: 14px;
  color: var(--editorColor);
  background: transparent;
  outline: none;
  border: none;
}
.grid {
  position: relative;
  overflow-x: hidden;
  overflow-y: auto;
  outline: none;
  border-radius: 3px;
}
.grid:focus-visible {
  box-shadow: inset 0 0 0 1px var(--themeColor);
}
.grid-content {
  position: relative;
}
.cell {
  position: absolute;
  display: flex;
  justify-content: center;
  align-items: center;
  width: 44px;
  height: 44px;
  box-sizing: border-box;
  border-radius: 4px;
  cursor: pointer;
}
.cell.active {
  background: var(--floatHoverColor);
  box-shadow: inset 0 0 0 1px var(--themeColor);
}
.glyph {
  width: 22px;
  height: 22px;
  background-color: currentColor;
  mask-repeat: no-repeat;
  mask-position: center;
  mask-size: 100% 100%;
}
.empty {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  margin: 16px 0;
  text-align: center;
  font-size: 13px;
  color: var(--editorColor50, var(--editorColor));
}
.footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  min-height: 20px;
  font-size: 12px;
  color: var(--editorColor50, var(--editorColor));
}
.footer .shortcode {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--editorColor);
}
.footer .hint {
  margin-left: auto;
  white-space: nowrap;
}
</style>
