<template>
  <div
    v-show="showSideBar"
    ref="sideBar"
    class="side-bar"
    :class="{ drawer: isDrawer }"
    :style="sideBarStyle"
  >
    <div
      v-if="isDrawer"
      class="drawer-backdrop"
      @click="closeDrawer"
    />
    <div class="left-column">
      <ul>
        <li
          v-for="(c, index) of sideBarIcons"
          :key="index"
          :class="{ active: c.id === rightColumn }"
          @click="handleLeftIconClick(c.id)"
        >
          <component :is="c.icon" />
        </li>
        <li
          v-for="panel of pluginPanels"
          :key="panel.id"
          :class="{ active: panel.id === rightColumn }"
          :title="panel.ctx.t(panel.title)"
          @click="handleLeftIconClick(panel.id)"
        >
          <!-- eslint-disable-next-line vue/no-v-html -- sanitized by sanitizeSvgIcon at registration -->
          <span
            class="plugin-panel-icon"
            v-html="panel.icon"
          />
        </li>
      </ul>
      <ul class="bottom">
        <li
          v-for="(c, index) of sideBarBottomIcons"
          :key="index"
          @click="handleLeftBottomClick(c.id)"
        >
          <component :is="c.icon" />
        </li>
      </ul>
    </div>
    <div
      v-show="rightColumn"
      class="right-column"
    >
      <tree
        v-if="rightColumn === 'files'"
        :project-tree="projectTree"
        :opened-files="openedFiles"
        :tabs="tabs"
      />
      <side-bar-search v-else-if="rightColumn === 'search'" />
      <toc v-else-if="rightColumn === 'toc'" />
      <component
        :is="activePluginPanel.component"
        v-else-if="activePluginPanel"
        :key="activePluginPanel.id"
        :ctx="activePluginPanel.ctx"
      />
    </div>
    <div
      v-show="rightColumn"
      ref="dragBar"
      class="drag-bar"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, nextTick, watch } from 'vue'
import { useLayoutStore } from '@/store/layout'
import { useProjectStore } from '@/store/project'
import { useEditorStore } from '@/store/editor'

import { sideBarIcons, sideBarBottomIcons } from './help'
import Tree from './tree.vue'
import SideBarSearch from './search.vue'
import Toc from './toc.vue'
import { storeToRefs } from 'pinia'
import type { TabDescriptor } from './types'
import { getSidebarPanel, listSidebarPanels } from '@/plugins/registries/sidebarPanels'

const layoutStore = useLayoutStore()
const projectStore = useProjectStore()
const editorStore = useEditorStore()

const sideBar = ref<HTMLDivElement | null>(null)
const dragBar = ref<HTMLDivElement | null>(null)

const openedFiles = ref<TabDescriptor[]>([])
const sideBarViewWidth = ref(280)

const { rightColumn, showSideBar, sideBarWidth } = storeToRefs(layoutStore)

const { projectTree } = storeToRefs(projectStore)
const { tabs } = storeToRefs(editorStore)

const pluginPanels = listSidebarPanels()
const activePluginPanel = computed(() => getSidebarPanel(rightColumn.value))

const finalSideBarWidth = computed<number>(() => {
  if (!showSideBar.value) return 0
  if (rightColumn.value === '') return 45
  return sideBarViewWidth.value < 220 ? 220 : sideBarViewWidth.value
})

// Below 600px the expanded sidebar overlays the editor as a drawer instead of
// shrinking it; the 45px icon strip stays in flow as the drawer's handle.
const NARROW_QUERY = '(max-width: 599px)'
const narrowMedia = window.matchMedia(NARROW_QUERY)
const isNarrow = ref(narrowMedia.matches)
const onNarrowChange = (event: MediaQueryListEvent): void => {
  isNarrow.value = event.matches
}
narrowMedia.addEventListener('change', onNarrowChange)
onBeforeUnmount(() => narrowMedia.removeEventListener('change', onNarrowChange))

const isDrawer = computed(() => isNarrow.value && rightColumn.value !== '')

const sideBarStyle = computed(() => {
  if (isDrawer.value) return { width: 'min(85vw, 320px)' }
  return [!rightColumn.value ? { 'min-width': '45px' } : {}, { width: `${finalSideBarWidth.value}px` }]
})

// Collapsing via SET_LAYOUT only: the persisted desktop width stays untouched.
const closeDrawer = (): void => {
  layoutStore.SET_LAYOUT({ rightColumn: '' })
}

watch(
  () => editorStore.currentFile?.id,
  (id, oldId) => {
    if (isDrawer.value && id !== oldId) closeDrawer()
  }
)

// An editor selection left active keeps the system Cut/Copy bar floating over
// the drawer; opening the drawer moves the user away from the text anyway.
watch(isDrawer, (open) => {
  if (!open) return
  window.getSelection()?.removeAllRanges()
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
})

onMounted(() => {
  // Boot opens the files column (desktop default); on a phone start on the editor.
  if (isDrawer.value && editorStore.currentFile) closeDrawer()
})

onMounted(() => {
  nextTick(() => {
    const dragBarEl = dragBar.value
    if (!dragBarEl) return
    let startX = 0
    let currentSideBarWidth = +sideBarWidth.value
    let startWidth = currentSideBarWidth

    sideBarViewWidth.value = currentSideBarWidth

    const mouseUpHandler = (): void => {
      document.removeEventListener('mousemove', mouseMoveHandler, false)
      document.removeEventListener('mouseup', mouseUpHandler, false)
      layoutStore.CHANGE_SIDE_BAR_WIDTH(currentSideBarWidth < 220 ? 220 : currentSideBarWidth)
    }

    const mouseMoveHandler = (event: MouseEvent): void => {
      const offset = event.clientX - startX
      currentSideBarWidth = startWidth + offset
      sideBarViewWidth.value = currentSideBarWidth
    }

    const mouseDownHandler = (event: MouseEvent): void => {
      startX = event.clientX
      startWidth = +sideBarWidth.value
      document.addEventListener('mousemove', mouseMoveHandler, false)
      document.addEventListener('mouseup', mouseUpHandler, false)
    }

    dragBarEl.addEventListener('mousedown', mouseDownHandler, false)
  })
})

const handleLeftIconClick = (name: string): void => {
  if (rightColumn.value === name) {
    // Capture the expanded width BEFORE collapsing: once rightColumn is '',
    // finalSideBarWidth evaluates to the 45px icon strip and would overwrite
    // the user's real width with the clamped 220px minimum (#2421).
    const widthToPersist = finalSideBarWidth.value
    layoutStore.SET_LAYOUT({ rightColumn: '' })
    layoutStore.CHANGE_SIDE_BAR_WIDTH(widthToPersist)
  } else {
    const needDispatch = rightColumn.value === ''
    layoutStore.SET_LAYOUT({ rightColumn: name })
    sideBarViewWidth.value = +sideBarWidth.value
    if (needDispatch) {
      layoutStore.CHANGE_SIDE_BAR_WIDTH(finalSideBarWidth.value)
    }
  }
}

const handleLeftBottomClick = (name: string): void => {
  if (name === 'settings') {
    projectStore.OPEN_SETTING_WINDOW()
  }
}
</script>

<style scoped>
.side-bar {
  display: flex;
  flex-shrink: 0;
  flex-grow: 0;
  width: 280px;
  height: 100vh;
  min-width: 220px;
  position: relative;
  color: var(--sideBarColor);
  user-select: none;
  background: var(--sideBarBgColor);
  border-right: 1px solid var(--itemBgColor);
}

.side-bar .left-column svg {
  color: var(--iconColor);
}

.left-column {
  height: 100%;
  width: 45px;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  padding-top: 28px;
  box-sizing: border-box;
}

.left-column > ul {
  opacity: 1;
}

.left-column ul {
  list-style: none;
  display: flex;
  flex-direction: column;
  margin: 0;
  padding: 0;
}

.left-column ul > li {
  width: 45px;
  height: 45px;
  margin: 0;
  padding: 0;
  display: flex;
  justify-content: space-around;
  align-items: center;
  cursor: pointer;
}

.left-column ul > li > svg {
  width: 18px;
  height: 18px;
  color: var(--sideBarIconColor);
  opacity: 1;
  transition: transform 0.25s ease-in-out;
}

.left-column ul > li.active > svg {
  color: var(--themeColor);
}

.left-column ul > li > .plugin-panel-icon {
  display: flex;
  color: var(--sideBarIconColor);
}

.left-column ul > li.active > .plugin-panel-icon {
  color: var(--themeColor);
}

.plugin-panel-icon :deep(svg) {
  width: 18px;
  height: 18px;
}

.side-bar:hover .left-column ul li svg {
  opacity: 1;
}

.right-column {
  flex: 1;
  width: calc(100% - 50px);
  overflow: hidden;
}

.drag-bar {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  height: 100%;
  width: 3px;
  cursor: col-resize;
}

.drag-bar:hover {
  border-right: 2px solid var(--iconColor);
}

.side-bar.drawer {
  position: fixed;
  top: 0;
  left: 0;
  bottom: 0;
  height: auto;
  min-width: 0;
  z-index: 2000;
  padding-top: env(safe-area-inset-top, 0px);
  padding-bottom: env(safe-area-inset-bottom, 0px);
  box-sizing: border-box;
  box-shadow: 0 0 24px rgba(0, 0, 0, 0.3);
}

.side-bar.drawer .drag-bar {
  display: none;
}

/* The backdrop paints above the drawer's own background (negative z-index
   inside its stacking context), so the columns carry an opaque background. */
.side-bar.drawer .left-column,
.side-bar.drawer .right-column {
  position: relative;
  background: linear-gradient(var(--sideBarBgColor), var(--sideBarBgColor)), var(--editorBgColor);
}

.drawer-backdrop {
  position: fixed;
  inset: 0;
  z-index: -1;
  background: rgba(0, 0, 0, 0.35);
}
</style>
