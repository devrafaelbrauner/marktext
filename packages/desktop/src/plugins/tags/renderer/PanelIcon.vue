<template>
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    focusable="false"
  >
    <path
      v-for="d of ICON_PATHS[name]"
      :key="d"
      :d="d"
    />
  </svg>
</template>

<script setup lang="ts">
export type PanelIconName = 'chevron' | 'expandAll' | 'collapseAll' | 'rename' | 'clear'

defineProps<{ name: PanelIconName }>()

// Path data of the Lucide icons chevron-right, chevrons-up-down,
// chevrons-down-up, pencil and x (lucide-static, ISC license).
const ICON_PATHS: Record<PanelIconName, string[]> = {
  chevron: ['m9 18 6-6-6-6'],
  expandAll: ['m7 15 5 5 5-5', 'm7 9 5-5 5 5'],
  collapseAll: ['m7 20 5-5 5 5', 'm7 4 5 5 5-5'],
  rename: [
    'M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z',
    'm15 5 4 4'
  ],
  clear: ['M18 6 6 18', 'm6 6 12 12']
}
</script>
