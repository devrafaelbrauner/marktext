<template>
  <div
    ref="listEl"
    class="pdf-reader-thumbnails"
  >
    <button
      v-for="(size, index) in pageSizes"
      :key="index"
      type="button"
      class="pdf-reader-thumbnail"
      :class="{ 'is-current': index + 1 === currentPage }"
      :data-page-number="index + 1"
      :aria-current="index + 1 === currentPage ? 'page' : undefined"
      :aria-label="t('page.label', { page: index + 1 })"
      @click="emit('navigate', index + 1)"
    >
      <span
        class="pdf-reader-thumbnail-canvas"
        :style="{ width: `${THUMBNAIL_WIDTH}px`, height: `${thumbnailHeight(size)}px` }"
      />
      <span class="pdf-reader-thumbnail-label">{{ index + 1 }}</span>
    </button>
  </div>
</template>

<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist'
import { canvasPixelSize, type PageSize } from '../common/zoom'

const THUMBNAIL_WIDTH = 120

const props = defineProps<{
  doc: PDFDocumentProxy
  pageSizes: PageSize[]
  currentPage: number
  t: (key: string, params?: Record<string, string | number>) => string
}>()

const emit = defineEmits<{ navigate: [page: number] }>()

const listEl = ref<HTMLElement | null>(null)
const rendered = new Set<number>()
const tasks = new Map<number, RenderTask>()
let observer: IntersectionObserver | null = null
let unmounted = false

const thumbnailHeight = (size: PageSize): number =>
  Math.max(1, Math.round((THUMBNAIL_WIDTH * size.height) / Math.max(1, size.width)))

const renderThumbnail = async (index: number, holder: HTMLElement): Promise<void> => {
  if (rendered.has(index) || tasks.has(index)) return
  try {
    const page = await props.doc.getPage(index + 1)
    if (unmounted) return
    const base = page.getViewport({ scale: 1 })
    const viewport = page.getViewport({ scale: THUMBNAIL_WIDTH / base.width })
    const pixels = canvasPixelSize(viewport.width, viewport.height, window.devicePixelRatio, 1 << 20)
    const canvas = document.createElement('canvas')
    canvas.width = pixels.width
    canvas.height = pixels.height
    const task = page.render({
      canvas,
      viewport,
      transform: [pixels.scaleX, 0, 0, pixels.scaleY, 0, 0]
    })
    tasks.set(index, task)
    await task.promise
    tasks.delete(index)
    if (unmounted) return
    holder.replaceChildren(canvas)
    rendered.add(index)
  } catch (err) {
    tasks.delete(index)
    if ((err as Error)?.name !== 'RenderingCancelledException') {
      console.warn(`[pdf-reader] thumbnail ${index + 1} failed:`, err)
    }
  }
}

const observeAll = (): void => {
  observer?.disconnect()
  if (!listEl.value) return
  observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue
        const button = entry.target as HTMLElement
        const holder = button.querySelector<HTMLElement>('.pdf-reader-thumbnail-canvas')
        if (holder) renderThumbnail(Number(button.dataset.pageNumber) - 1, holder)
      }
    },
    { root: listEl.value, rootMargin: '200px 0px' }
  )
  for (const button of listEl.value.querySelectorAll('.pdf-reader-thumbnail')) observer.observe(button)
}

const revealCurrent = (): void => {
  const list = listEl.value
  const button = list?.querySelector<HTMLElement>(`[data-page-number="${props.currentPage}"]`)
  if (!list || !button) return
  // The list is the buttons' offsetParent (position: relative).
  const top = button.offsetTop
  if (top < list.scrollTop || top + button.offsetHeight > list.scrollTop + list.clientHeight) {
    list.scrollTop = top - (list.clientHeight - button.offsetHeight) / 2
  }
}

watch(() => props.currentPage, revealCurrent)
watch(
  () => props.pageSizes.length,
  async () => {
    await nextTick()
    observeAll()
  }
)

onMounted(() => {
  observeAll()
  revealCurrent()
})

onBeforeUnmount(() => {
  unmounted = true
  observer?.disconnect()
  for (const task of tasks.values()) task.cancel()
  tasks.clear()
})
</script>
