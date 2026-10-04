<template>
  <div class="tab-view-host">
    <div
      v-if="renderError"
      class="tab-view-message"
    >
      <p>{{ t('editor.tabView.viewFailed') }}</p>
      <p class="tab-view-detail">
        {{ renderError }}
      </p>
    </div>
    <component
      :is="assetView.view.component"
      v-else-if="assetView"
      :ctx="assetView.ctx"
      :pathname="tab.pathname"
      :subpath="tab.subpath"
      :read-file="readFile"
    />
    <component
      :is="markdownView.view.component"
      v-else-if="markdownView"
      :ctx="markdownView.ctx"
      :tab-id="tab.id"
      :pathname="tab.pathname || null"
      :markdown="tab.markdown"
      :update="update"
    />
    <div
      v-else-if="tab.kind === 'asset' && viewsReady"
      class="tab-view-message"
    >
      <p>{{ t('editor.tabView.noViewer') }}</p>
      <el-button
        size="small"
        @click="openExternally"
      >
        {{ t('editor.tabView.openExternally') }}
      </el-button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onErrorCaptured, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { wordCount as getWordCount } from '@muyajs/core'
import { useEditorStore } from '@/store/editor'
import {
  getAssetViewForPath,
  getTabView,
  isTabViewsReady,
  whenTabViewsReady,
  type AssetTabView,
  type MarkdownTabView,
  type RegisteredTabView
} from '@/plugins/registries/tabViews'
import type { IFileState } from '@shared/types/files'

// Shows the current tab through its registered tab view. Mounted per tab (keyed
// by the tab id), only while the tab is an asset tab or has a markdown view.
const props = defineProps<{
  tab: IFileState
}>()

const { t } = useI18n()
const editorStore = useEditorStore()

const viewsReady = ref(isTabViewsReady())
whenTabViewsReady().then(() => {
  viewsReady.value = true
})

const renderError = ref('')

const assetView = computed<RegisteredTabView<AssetTabView> | null>(() => {
  if (props.tab.kind !== 'asset') return null
  const byId = getTabView(props.tab.viewId)
  if (byId?.view.kind === 'asset') return byId as RegisteredTabView<AssetTabView>
  // The view the tab was opened with may be gone (plugin disabled); another view
  // registered for the extension can still show the file.
  return getAssetViewForPath(props.tab.pathname)
})

const markdownView = computed<RegisteredTabView<MarkdownTabView> | null>(() => {
  if (props.tab.kind !== 'markdown') return null
  const entry = getTabView(props.tab.viewId)
  return entry?.view.kind === 'markdown' ? (entry as RegisteredTabView<MarkdownTabView>) : null
})

// A markdown tab whose view is not registered once the plugins are in (plugin
// removed or disabled) goes back to the editor.
watch(
  [markdownView, viewsReady],
  ([view, ready]) => {
    if (ready && !view && props.tab.kind === 'markdown') {
      editorStore.SET_TAB_VIEW(props.tab.id, null)
    }
  },
  { immediate: true }
)

const readFile = (maxBytes?: number): Promise<Uint8Array> => {
  const entry = assetView.value
  if (!entry) return Promise.reject(new Error('The tab view is no longer registered.'))
  return entry.ctx.vault.readBinary(props.tab.pathname, maxBytes)
}

const update = (markdown: string): void => {
  editorStore.LISTEN_FOR_CONTENT_CHANGE({
    id: props.tab.id,
    markdown,
    wordCount: getWordCount(markdown)
  })
}

const openExternally = (): void => {
  window.electron.shell.openPath(props.tab.pathname)
}

// A failing plugin view must not take the window down with it.
onErrorCaptured((err) => {
  renderError.value = err instanceof Error ? err.message : String(err)
  console.error('Tab view failed:', err)
  return false
})
</script>

<style scoped>
.tab-view-host {
  height: 100%;
  overflow: auto;
  color: var(--editorColor);
}

.tab-view-message {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  height: 100%;
  padding: 0 24px;
  text-align: center;
  color: var(--editorColor50);
}

.tab-view-detail {
  font-size: 12px;
  max-width: 600px;
  word-break: break-word;
}
</style>
