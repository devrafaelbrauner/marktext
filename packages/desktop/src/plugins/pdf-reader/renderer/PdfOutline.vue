<template>
  <div class="pdf-reader-outline">
    <p
      v-if="loaded && rows.length === 0"
      class="pdf-reader-panel-empty"
    >
      {{ t('sidebar.noOutline') }}
    </p>
    <ul
      v-else
      role="tree"
      :aria-label="t('sidebar.outline')"
    >
      <li
        v-for="row in rows"
        :key="row.key"
        role="treeitem"
        :aria-level="row.depth + 1"
        :aria-expanded="row.node.items.length ? expanded.has(row.key) : undefined"
        class="pdf-reader-outline-row"
        :style="{ paddingInlineStart: `${row.depth * 14 + 4}px` }"
      >
        <button
          v-if="row.node.items.length"
          type="button"
          class="pdf-reader-outline-toggle"
          :class="{ 'is-expanded': expanded.has(row.key) }"
          :aria-label="expanded.has(row.key) ? t('sidebar.collapse') : t('sidebar.expand')"
          @click="toggle(row.key)"
        >
          <pdf-icon name="expand" />
        </button>
        <span
          v-else
          class="pdf-reader-outline-spacer"
        />
        <button
          type="button"
          class="pdf-reader-outline-title"
          :class="{ 'is-bold': row.node.bold, 'is-italic': row.node.italic }"
          :title="row.node.title"
          @click="emit('navigate', row.node)"
        >
          {{ row.node.title }}
        </button>
      </li>
    </ul>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, shallowRef } from 'vue'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { PdfIcon } from './icons'

export type OutlineNode = Awaited<ReturnType<PDFDocumentProxy['getOutline']>>[number]

const props = defineProps<{
  doc: PDFDocumentProxy
  t: (key: string, params?: Record<string, string | number>) => string
}>()

const emit = defineEmits<{ navigate: [node: OutlineNode] }>()

const outline = shallowRef<OutlineNode[]>([])
const loaded = ref(false)
// Keys are index paths ("0.2.1"), stable for the lifetime of the document.
const expanded = ref(new Set<string>())

const rows = computed(() => {
  const result: Array<{ key: string; depth: number; node: OutlineNode }> = []
  const visit = (nodes: OutlineNode[], depth: number, prefix: string): void => {
    nodes.forEach((node, index) => {
      const key = prefix ? `${prefix}.${index}` : String(index)
      result.push({ key, depth, node })
      if (node.items.length && expanded.value.has(key)) visit(node.items, depth + 1, key)
    })
  }
  visit(outline.value, 0, '')
  return result
})

const toggle = (key: string): void => {
  const next = new Set(expanded.value)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  expanded.value = next
}

onMounted(async () => {
  try {
    const nodes = (await props.doc.getOutline()) ?? []
    // A positive `count` means the PDF wants the item open initially.
    const open = new Set<string>()
    const collect = (list: OutlineNode[], prefix: string): void => {
      list.forEach((node, index) => {
        const key = prefix ? `${prefix}.${index}` : String(index)
        if ((node.count ?? 0) > 0) open.add(key)
        collect(node.items, key)
      })
    }
    collect(nodes, '')
    expanded.value = open
    outline.value = nodes
  } catch (err) {
    console.warn('[pdf-reader] reading the outline failed:', err)
  } finally {
    loaded.value = true
  }
})
</script>
