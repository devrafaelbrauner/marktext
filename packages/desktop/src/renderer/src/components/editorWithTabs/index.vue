<template>
  <div
    class="editor-with-tabs"
    :style="{ 'max-width': `calc(100vw - ${effectiveSideBarWidth}px)` }"
  >
    <tabs v-show="showTabBar" />
    <div class="container">
      <editor
        :markdown="markdown"
        :cursor="cursor"
        :text-direction="textDirection"
        :platform="platform"
      />
      <source-code
        v-if="sourceCode && !showsTabView"
        :markdown="markdown"
        :muya-index-cursor="muyaIndexCursor"
        :text-direction="textDirection"
      />
      <tab-view-host
        v-if="showsTabView && currentFile"
        :key="currentFile.id"
        :tab="currentFile"
      />
    </div>
    <tab-notifications />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useLayoutStore } from '@/store/layout'
import { useEditorStore } from '@/store/editor'
import { storeToRefs } from 'pinia'
import Tabs from './tabs.vue'
import Editor from './editor.vue'
import SourceCode from './sourceCode.vue'
import TabViewHost from './TabViewHost.vue'
import TabNotifications from './notifications.vue'

defineProps<{
  markdown: string
  // `cursor` originates as `IFileState.cursor` which is `unknown`
  // (see src/shared/types/files.ts); align here instead of forcing every
  // caller to widen.
  cursor: unknown
  muyaIndexCursor?: unknown
  sourceCode: boolean
  showTabBar: boolean
  textDirection: string
  platform: string
}>()

const { effectiveSideBarWidth } = storeToRefs(useLayoutStore())
const { currentFile } = storeToRefs(useEditorStore())

// Asset tabs and markdown tabs switched to a plugin view replace both the
// WYSIWYG editor (hidden by editor.vue, like in source mode) and source mode.
const showsTabView = computed<boolean>(
  () => !!currentFile.value && (currentFile.value.kind === 'asset' || currentFile.value.viewId !== null)
)
</script>

<style scoped>
.editor-with-tabs {
  position: relative;
  height: 100%;
  flex: 1;
  display: flex;
  flex-direction: column;

  overflow: hidden;
  background: var(--editorBgColor);
  & > .container {
    flex: 1;
    overflow: hidden;
  }
}
</style>
