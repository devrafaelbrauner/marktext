<template>
  <div
    v-if="items.length"
    class="plugin-status-bar title-no-drag"
  >
    <div
      v-for="item of items"
      :key="item.id"
      class="plugin-status-item"
    >
      <component
        :is="item.component"
        :ctx="item.ctx"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { listStatusBarItems } from '@/plugins/registries/statusBar'

const items = listStatusBarItems()
</script>

<style scoped>
.plugin-status-bar {
  -webkit-app-region: no-drag;
  display: flex;
  align-items: center;
  height: 100%;
  font-size: 14px;
  color: var(--editorColor30);
}

.plugin-status-item {
  display: flex;
  align-items: center;
  padding: 0 5px;
}
</style>
