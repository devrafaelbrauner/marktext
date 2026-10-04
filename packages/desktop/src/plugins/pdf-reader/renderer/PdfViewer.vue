<template>
  <div
    class="pdf-reader"
    :class="{ 'is-dark': darkPages }"
    role="region"
    :aria-label="t('view.label', { name: fileName })"
    :data-status="status"
    :data-current-page="currentPage"
    :data-zoom="zoom"
    @keydown="onKeydown"
  >
    <div
      class="pdf-reader-toolbar"
      role="toolbar"
      :aria-label="t('toolbar.label')"
    >
      <button
        type="button"
        class="pdf-reader-button"
        :class="{ 'is-active': sidebarOpen }"
        :aria-pressed="sidebarOpen"
        :aria-label="t('toolbar.sidebar')"
        :title="t('toolbar.sidebar')"
        :disabled="!doc"
        @click="sidebarOpen = !sidebarOpen"
      >
        <pdf-icon name="sidebar" />
      </button>
      <span class="pdf-reader-separator" />
      <button
        type="button"
        class="pdf-reader-button"
        :aria-label="t('toolbar.previousPage')"
        :title="t('toolbar.previousPage')"
        :disabled="!doc || currentPage <= 1"
        @click="goToPage(currentPage - 1)"
      >
        <pdf-icon name="previousPage" />
      </button>
      <input
        v-model="pageInput"
        class="pdf-reader-page-input"
        type="text"
        inputmode="numeric"
        :aria-label="t('toolbar.pageNumber')"
        :disabled="!doc"
        @keydown.enter.prevent="commitPageInput"
        @blur="pageInput = String(currentPage)"
      >
      <span class="pdf-reader-page-count">{{ t('toolbar.pageCount', { count: pageCount }) }}</span>
      <button
        type="button"
        class="pdf-reader-button"
        :aria-label="t('toolbar.nextPage')"
        :title="t('toolbar.nextPage')"
        :disabled="!doc || currentPage >= pageCount"
        @click="goToPage(currentPage + 1)"
      >
        <pdf-icon name="nextPage" />
      </button>
      <span class="pdf-reader-separator" />
      <button
        type="button"
        class="pdf-reader-button"
        :aria-label="t('toolbar.zoomOut')"
        :title="t('toolbar.zoomOut')"
        :disabled="!doc || zoom <= MIN_ZOOM"
        @click="zoomByStep(-1)"
      >
        <pdf-icon name="zoomOut" />
      </button>
      <select
        class="pdf-reader-zoom-select"
        :aria-label="t('toolbar.zoomLevel')"
        :value="zoomSelectValue"
        :disabled="!doc"
        @change="onZoomSelect"
      >
        <option value="page-width">
          {{ t('toolbar.fitWidth') }}
        </option>
        <option value="page-fit">
          {{ t('toolbar.fitPage') }}
        </option>
        <option
          v-if="zoomSelectValue === 'custom'"
          value="custom"
        >
          {{ Math.round(zoom * 100) }}%
        </option>
        <option
          v-for="preset in ZOOM_PRESETS"
          :key="preset"
          :value="String(preset)"
        >
          {{ Math.round(preset * 100) }}%
        </option>
      </select>
      <button
        type="button"
        class="pdf-reader-button"
        :aria-label="t('toolbar.zoomIn')"
        :title="t('toolbar.zoomIn')"
        :disabled="!doc || zoom >= MAX_ZOOM"
        @click="zoomByStep(1)"
      >
        <pdf-icon name="zoomIn" />
      </button>
      <button
        type="button"
        class="pdf-reader-button"
        :class="{ 'is-active': zoomMode === 'page-width' }"
        :aria-pressed="zoomMode === 'page-width'"
        :aria-label="t('toolbar.fitWidth')"
        :title="t('toolbar.fitWidth')"
        :disabled="!doc"
        @click="applyFit('page-width')"
      >
        <pdf-icon name="fitWidth" />
      </button>
      <button
        type="button"
        class="pdf-reader-button"
        :class="{ 'is-active': zoomMode === 'page-fit' }"
        :aria-pressed="zoomMode === 'page-fit'"
        :aria-label="t('toolbar.fitPage')"
        :title="t('toolbar.fitPage')"
        :disabled="!doc"
        @click="applyFit('page-fit')"
      >
        <pdf-icon name="fitPage" />
      </button>
      <span class="pdf-reader-spacer" />
      <button
        type="button"
        class="pdf-reader-button"
        :class="{ 'is-active': darkPages }"
        :aria-pressed="darkPages"
        :aria-label="t('toolbar.darkPages')"
        :title="t('toolbar.darkPages')"
        @click="darkPagesOverride = !darkPages"
      >
        <pdf-icon name="darkPages" />
      </button>
      <button
        type="button"
        class="pdf-reader-button"
        :class="{ 'is-active': findOpen }"
        :aria-pressed="findOpen"
        :aria-label="t('toolbar.find')"
        :title="t('toolbar.find')"
        :disabled="!doc"
        @click="findOpen ? closeFind() : openFind()"
      >
        <pdf-icon name="find" />
      </button>
      <button
        type="button"
        class="pdf-reader-button"
        :aria-label="t('toolbar.copyLink')"
        :title="t('toolbar.copyLink')"
        :disabled="!doc"
        @click="copyPageLink(ctx, { pathname, page: currentPage })"
      >
        <pdf-icon name="copyLink" />
      </button>
    </div>
    <div
      v-if="findOpen"
      class="pdf-reader-findbar"
      role="search"
      :aria-label="t('find.label')"
    >
      <input
        ref="findInputEl"
        v-model="findQuery"
        class="pdf-reader-find-input"
        type="search"
        :placeholder="t('find.placeholder')"
        :aria-label="t('find.placeholder')"
        @keydown="onFindKeydown"
      >
      <span
        class="pdf-reader-find-status"
        role="status"
        aria-live="polite"
      >{{ findStatus }}</span>
      <button
        type="button"
        class="pdf-reader-button"
        :aria-label="t('find.previous')"
        :title="t('find.previous')"
        :disabled="findTotal === 0"
        @click="stepFind(-1)"
      >
        <pdf-icon name="previousPage" />
      </button>
      <button
        type="button"
        class="pdf-reader-button"
        :aria-label="t('find.next')"
        :title="t('find.next')"
        :disabled="findTotal === 0"
        @click="stepFind(1)"
      >
        <pdf-icon name="nextPage" />
      </button>
      <button
        type="button"
        class="pdf-reader-button"
        :aria-label="t('find.close')"
        :title="t('find.close')"
        @click="closeFind"
      >
        <pdf-icon name="close" />
      </button>
    </div>
    <div class="pdf-reader-body">
      <aside
        v-if="sidebarOpen && doc"
        class="pdf-reader-sidebar"
        :aria-label="t('sidebar.label')"
      >
        <div
          class="pdf-reader-sidebar-tabs"
          role="tablist"
        >
          <button
            type="button"
            role="tab"
            class="pdf-reader-sidebar-tab"
            :class="{ 'is-active': sidebarTab === 'thumbnails' }"
            :aria-selected="sidebarTab === 'thumbnails'"
            @click="sidebarTab = 'thumbnails'"
          >
            {{ t('sidebar.thumbnails') }}
          </button>
          <button
            type="button"
            role="tab"
            class="pdf-reader-sidebar-tab"
            :class="{ 'is-active': sidebarTab === 'outline' }"
            :aria-selected="sidebarTab === 'outline'"
            @click="sidebarTab = 'outline'"
          >
            {{ t('sidebar.outline') }}
          </button>
        </div>
        <pdf-thumbnails
          v-if="sidebarTab === 'thumbnails'"
          role="tabpanel"
          :doc="doc"
          :page-sizes="pageSizes"
          :current-page="currentPage"
          :t="t"
          @navigate="goToPage"
        />
        <pdf-outline
          v-else
          role="tabpanel"
          :doc="doc"
          :t="t"
          @navigate="openOutlineNode"
        />
      </aside>
      <div
        ref="scrollerEl"
        class="pdf-reader-scroller"
        tabindex="0"
        @scroll="onScroll"
      >
        <div
          v-if="status === 'loading'"
          class="pdf-reader-message"
          role="status"
        >
          {{ t('loading') }}
        </div>
        <div
          v-else-if="status === 'error'"
          class="pdf-reader-message"
          role="alert"
        >
          <p class="pdf-reader-message-title">
            {{ t('error.title') }}
          </p>
          <p>{{ errorText }}</p>
          <button
            type="button"
            class="pdf-reader-text-button"
            @click="openExternally"
          >
            {{ t('error.openExternally') }}
          </button>
        </div>
        <div
          v-else
          class="pdf-reader-pages"
        >
          <div
            v-for="(size, index) in pageSizes"
            :key="index"
            class="pdf-reader-page"
            role="group"
            :aria-label="t('page.label', { page: index + 1 })"
            :data-page-number="index + 1"
            :style="pageStyle(size, index)"
          />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, markRaw, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { TextLayer } from 'pdfjs-dist'
import type { PageViewport, PDFDocumentProxy, PDFPageProxy, RenderTask } from 'pdfjs-dist'
import type { TextContent } from 'pdfjs-dist/types/src/display/api'
import type { RendererPluginContext } from '@/plugins/types'
import { classifyLoadError } from '../common/errors'
import {
  buildPageText,
  countMatches,
  findMatches,
  firstMatchFrom,
  foldText,
  matchOrdinal,
  stepMatch,
  toItemRanges,
  type FoldedText,
  type MatchCursor,
  type PageText,
  type TextRange
} from '../common/find'
import { clampPage, parsePageSubpath } from '../common/subpath'
import {
  canvasPixelSize,
  clampZoom,
  fitPageZoom,
  fitWidthZoom,
  MAX_ZOOM,
  MIN_ZOOM,
  pageCssSize,
  PDF_TO_CSS_UNITS,
  stepZoom,
  wheelZoom,
  type PageSize,
  type ZoomMode
} from '../common/zoom'
import { copyPageLink } from './copyLink'
import { PdfIcon } from './icons'
import PdfOutline, { type OutlineNode } from './PdfOutline.vue'
import { openPdf, type OpenedPdf } from './pdfjs'
import PdfThumbnails from './PdfThumbnails.vue'
import { darkPagesOverride, sidebarOpen, sidebarTab, viewStates } from './session'

const props = defineProps<{
  ctx: RendererPluginContext
  pathname: string
  /** Part after `#` of the link that opened the file (e.g. 'page=3'), or null. */
  subpath: string | null
  readFile: (maxBytes?: number) => Promise<Uint8Array>
}>()

const ZOOM_PRESETS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4]
// Padding around the pages and the gap between them, in CSS px (see the styles).
const PAGES_PADDING = 16
const PAGE_GAP = 12
// 4096² pixels per page canvas keeps a deep zoom on a HiDPI screen within GPU memory limits.
const MAX_CANVAS_PIXELS = 4096 * 4096
// Fraction of the viewport height whose page counts as the current page.
const CURRENT_PAGE_LINE = 0.3
const RENDER_SETTLE_MS = 120
const FIND_DEBOUNCE_MS = 200

const isMac = window.electron.process.platform === 'darwin'
const { t } = props.ctx

interface PageTextData {
  content: TextContent
  text: PageText
  folded: FoldedText | null
}

interface PageView {
  /** `scale:devicePixelRatio` the canvas shows, or is being rendered for. */
  renderedKey: string | null
  pendingKey: string | null
  renderTask: RenderTask | null
  canvas: HTMLCanvasElement | null
  textLayer: TextLayer | null
  textLayerEl: HTMLDivElement | null
  /** Resolves once the text layer is laid out; null while there is none. */
  textReady: Promise<void> | null
  text: PageText | null
  /** Text items whose content was split into highlight spans. */
  highlightedItems: number[]
}

type Status = 'loading' | 'ready' | 'error'

const status = ref<Status>('loading')
const errorText = ref('')
const doc = shallowRef<PDFDocumentProxy | null>(null)
const pageSizes = ref<PageSize[]>([])
const currentPage = ref(1)
const pageInput = ref('1')
const zoom = ref(1)
const zoomMode = ref<ZoomMode>('page-width')
const bodyDark = ref(document.body.classList.contains('dark'))
const darkPages = computed(() => darkPagesOverride.value ?? bodyDark.value)
const scrollerEl = ref<HTMLElement | null>(null)
const findInputEl = ref<HTMLInputElement | null>(null)

const findOpen = ref(false)
const findQuery = ref('')
const findTotal = ref(0)
const findOrdinal = ref(0)
const findSearching = ref(false)

const fileName = computed(() => props.pathname.split(/[\\/]/).pop() ?? props.pathname)
const pageCount = computed(() => pageSizes.value.length)
const zoomSelectValue = computed(() => {
  if (zoomMode.value !== 'custom') return zoomMode.value
  return ZOOM_PRESETS.includes(zoom.value) ? String(zoom.value) : 'custom'
})
const findStatus = computed(() => {
  if (!findQuery.value.trim()) return ''
  if (findTotal.value === 0) return findSearching.value ? t('find.searching') : t('find.none')
  return t('find.count', { current: findOrdinal.value, total: findTotal.value })
})

let opened: OpenedPdf | null = null
let unmounted = false
let appliedSubpath: string | null = props.subpath
// pdf.js page sizes include the page's UserUnit; the text layer needs it in its scale variable.
const userUnits: number[] = []
const pagePromises = new Map<number, Promise<PDFPageProxy>>()
const textPromises = new Map<number, Promise<PageTextData>>()
const views = new Map<number, PageView>()
const visiblePages = new Set<number>()
let pageObserver: IntersectionObserver | null = null
let resizeObserver: ResizeObserver | null = null
let bodyObserver: MutationObserver | null = null
let dprQuery: MediaQueryList | null = null
let renderTimer: ReturnType<typeof setTimeout> | null = null
let scrollFrame = 0
let resizeFrame = 0
// Set when the viewer moves the scroll position itself, so that scroll event
// does not overwrite the page it navigated to.
let ignoreNextScroll = false

let matches: Array<TextRange[] | undefined> = []
let cursor: MatchCursor | null = null
let searchToken = 0
let searchedQuery = ''
let findTimer: ReturnType<typeof setTimeout> | null = null
// Scroll to the selected match once its page's text layer exists.
let revealPending = false
let stopEditActions: (() => void) | null = null
let stopParagraphActions: (() => void) | null = null

const pageStyle = (size: PageSize, index: number): Record<string, string> => {
  const css = pageCssSize(size, zoom.value)
  return {
    width: `${css.width}px`,
    height: `${css.height}px`,
    '--total-scale-factor': String(zoom.value * PDF_TO_CSS_UNITS * (userUnits[index] ?? 1))
  }
}

const pageElement = (index: number): HTMLElement | null =>
  scrollerEl.value?.querySelector<HTMLElement>(`.pdf-reader-page[data-page-number="${index + 1}"]`) ?? null

const getPage = (index: number): Promise<PDFPageProxy> => {
  let promise = pagePromises.get(index)
  if (!promise) {
    if (!doc.value) return Promise.reject(new Error('No document'))
    promise = doc.value.getPage(index + 1)
    pagePromises.set(index, promise)
    promise.catch(() => pagePromises.delete(index))
  }
  return promise
}

const getPageText = (index: number): Promise<PageTextData> => {
  let promise = textPromises.get(index)
  if (!promise) {
    promise = getPage(index).then(async (page) => {
      const content = await page.getTextContent()
      const items = content.items.flatMap((item) => ('str' in item ? [item] : []))
      return { content, text: buildPageText(items), folded: null }
    })
    textPromises.set(index, promise)
    promise.catch(() => textPromises.delete(index))
  }
  return promise
}

const getView = (index: number): PageView => {
  let view = views.get(index)
  if (!view) {
    view = {
      renderedKey: null,
      pendingKey: null,
      renderTask: null,
      canvas: null,
      textLayer: null,
      textLayerEl: null,
      textReady: null,
      text: null,
      highlightedItems: []
    }
    views.set(index, view)
  }
  return view
}

// ---------------------------------------------------------------------------
// Scroll position
// ---------------------------------------------------------------------------

const setScrollTop = (value: number): void => {
  const scroller = scrollerEl.value
  if (!scroller) return
  const target = Math.max(0, Math.min(value, scroller.scrollHeight - scroller.clientHeight))
  if (Math.abs(scroller.scrollTop - target) < 1) return
  ignoreNextScroll = true
  if (scrollFrame) cancelAnimationFrame(scrollFrame)
  scrollFrame = 0
  scroller.scrollTop = target
}

interface ScrollAnchor {
  index: number
  /** Scroll offset from the page top as a fraction of the page height (negative in the gap above). */
  fraction: number
  /** Horizontal centre of the viewport as a fraction of the content width. */
  centerX: number
}

const captureAnchor = (): ScrollAnchor | null => {
  const scroller = scrollerEl.value
  const index = currentPage.value - 1
  const el = pageElement(index)
  if (!scroller || !el || el.offsetHeight === 0) return null
  return {
    index,
    fraction: (scroller.scrollTop - el.offsetTop) / el.offsetHeight,
    centerX: scroller.scrollWidth > 0 ? (scroller.scrollLeft + scroller.clientWidth / 2) / scroller.scrollWidth : 0.5
  }
}

const restoreAnchor = (anchor: ScrollAnchor | null): void => {
  const scroller = scrollerEl.value
  const el = anchor ? pageElement(anchor.index) : null
  if (!scroller || !anchor || !el) return
  setScrollTop(el.offsetTop + anchor.fraction * el.offsetHeight)
  scroller.scrollLeft = anchor.centerX * scroller.scrollWidth - scroller.clientWidth / 2
}

const saveViewState = (): void => {
  const anchor = captureAnchor()
  viewStates.set(props.pathname, {
    page: currentPage.value,
    pageOffset: anchor?.fraction ?? 0,
    zoomMode: zoomMode.value,
    zoom: zoom.value,
    appliedSubpath
  })
}

/** Scrolls page `index` to the top: exactly to `fraction` of its height, or with the usual gap above it. */
const scrollToPage = (index: number, fraction: number | null): void => {
  const el = pageElement(index)
  if (!el) return
  currentPage.value = index + 1
  setScrollTop(fraction === null ? el.offsetTop - PAGE_GAP / 2 : el.offsetTop + fraction * el.offsetHeight)
  saveViewState()
}

const goToPage = (page: number): void => {
  if (!pageCount.value) return
  scrollToPage(clampPage(page, pageCount.value) - 1, null)
}

const syncCurrentPage = (): void => {
  const scroller = scrollerEl.value
  const pages = scroller?.querySelectorAll<HTMLElement>('.pdf-reader-page')
  if (!scroller || !pages?.length) return
  const line = scroller.scrollTop + scroller.clientHeight * CURRENT_PAGE_LINE
  let low = 0
  let high = pages.length - 1
  while (low < high) {
    const mid = (low + high + 1) >> 1
    if (pages[mid].offsetTop <= line) low = mid
    else high = mid - 1
  }
  currentPage.value = low + 1
  saveViewState()
}

const onScroll = (): void => {
  if (ignoreNextScroll) {
    ignoreNextScroll = false
    return
  }
  if (scrollFrame) return
  scrollFrame = requestAnimationFrame(() => {
    scrollFrame = 0
    syncCurrentPage()
  })
}

const commitPageInput = (): void => {
  const page = Number.parseInt(pageInput.value, 10)
  if (Number.isFinite(page)) goToPage(page)
  pageInput.value = String(currentPage.value)
}

watch(currentPage, (page) => {
  pageInput.value = String(page)
})

// ---------------------------------------------------------------------------
// Zoom
// ---------------------------------------------------------------------------

const fitZoom = (mode: Exclude<ZoomMode, 'custom'>): number => {
  const scroller = scrollerEl.value
  const size = pageSizes.value[currentPage.value - 1] ?? pageSizes.value[0]
  if (!scroller || !size) return zoom.value
  const width = scroller.clientWidth - 2 * PAGES_PADDING
  if (mode === 'page-width') return fitWidthZoom(size, width)
  return fitPageZoom(size, width, scroller.clientHeight - PAGE_GAP)
}

/**
 * Changes the zoom keeping the reading position: the point under `pointer`
 * (viewport coordinates of the scroller) for Ctrl+wheel, the current page
 * position otherwise.
 */
const applyZoom = async (next: number, mode: ZoomMode, pointer?: { x: number; y: number }): Promise<void> => {
  const scroller = scrollerEl.value
  const value = clampZoom(next)
  if (!scroller || (value === zoom.value && mode === zoomMode.value)) return
  const ratio = value / zoom.value
  const anchor = pointer ? null : captureAnchor()
  const pointerTop = pointer ? (scroller.scrollTop + pointer.y) * ratio - pointer.y : 0
  const pointerLeft = pointer ? (scroller.scrollLeft + pointer.x) * ratio - pointer.x : 0
  zoom.value = value
  zoomMode.value = mode
  await nextTick()
  if (pointer) {
    setScrollTop(pointerTop)
    scroller.scrollLeft = pointerLeft
  } else {
    restoreAnchor(anchor)
  }
  scheduleRender(RENDER_SETTLE_MS)
  saveViewState()
}

const applyFit = (mode: Exclude<ZoomMode, 'custom'>): void => {
  applyZoom(fitZoom(mode), mode)
}

const zoomByStep = (direction: 1 | -1): void => {
  applyZoom(stepZoom(zoom.value, direction), 'custom')
}

const onZoomSelect = (event: Event): void => {
  const value = (event.target as HTMLSelectElement).value
  if (value === 'page-width' || value === 'page-fit') applyFit(value)
  else if (value !== 'custom') applyZoom(Number(value), 'custom')
}

const onWheel = (event: WheelEvent): void => {
  if (!event.ctrlKey && !event.metaKey) return
  event.preventDefault()
  const scroller = scrollerEl.value
  if (!scroller || !doc.value) return
  const rect = scroller.getBoundingClientRect()
  // Line-based deltas (some mice) are converted to approximate pixels.
  const deltaY = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? event.deltaY * 16 : event.deltaY
  applyZoom(wheelZoom(zoom.value, deltaY), 'custom', { x: event.clientX - rect.left, y: event.clientY - rect.top })
}

const onResize = (): void => {
  if (resizeFrame) return
  resizeFrame = requestAnimationFrame(() => {
    resizeFrame = 0
    if (zoomMode.value !== 'custom' && status.value === 'ready') applyZoom(fitZoom(zoomMode.value), zoomMode.value)
  })
}

// ---------------------------------------------------------------------------
// Page rendering
// ---------------------------------------------------------------------------

const scheduleRender = (delay = 0): void => {
  if (renderTimer) clearTimeout(renderTimer)
  renderTimer = setTimeout(() => {
    renderTimer = null
    for (const index of visiblePages) renderPage(index)
  }, delay)
}

const updatePageSize = async (index: number, page: PDFPageProxy): Promise<void> => {
  const viewport = page.getViewport({ scale: 1 })
  const current = pageSizes.value[index]
  if (current && current.width === viewport.width && current.height === viewport.height && userUnits[index] === page.userUnit) {
    return
  }
  const anchor = captureAnchor()
  userUnits[index] = page.userUnit
  pageSizes.value[index] = { width: viewport.width, height: viewport.height }
  await nextTick()
  restoreAnchor(anchor)
}

const releasePage = (index: number): void => {
  const view = views.get(index)
  if (!view) return
  view.renderTask?.cancel()
  view.textLayer?.cancel()
  view.textLayerEl?.remove()
  if (view.canvas) {
    // Frees the backing store now instead of at garbage collection.
    view.canvas.width = 0
    view.canvas.height = 0
    view.canvas.remove()
  }
  views.delete(index)
}

const renderTextLayer = async (index: number, view: PageView, viewport: PageViewport, el: HTMLElement): Promise<void> => {
  if (view.textLayer && view.textReady) {
    const layer = view.textLayer
    await view.textReady
    if (views.get(index) === view) layer.update({ viewport })
    return
  }
  const data = await getPageText(index)
  if (unmounted || views.get(index) !== view || view.textLayer) return
  const container = document.createElement('div')
  container.className = 'textLayer'
  const layer = new TextLayer({ textContentSource: data.content, container, viewport })
  view.textLayer = layer
  view.textLayerEl = container
  view.text = data.text
  el.append(container)
  view.textReady = layer.render().then(
    () => undefined,
    (err: unknown) => {
      if ((err as Error)?.name !== 'AbortException') console.warn(`[pdf-reader] text layer ${index + 1} failed:`, err)
    }
  )
  await view.textReady
  if (views.get(index) === view) applyHighlights(index)
}

const renderPage = async (index: number): Promise<void> => {
  if (!doc.value || unmounted) return
  const view = getView(index)
  const scale = zoom.value * PDF_TO_CSS_UNITS
  const key = `${scale}:${window.devicePixelRatio}`
  if (view.renderedKey === key || view.pendingKey === key) return
  view.renderTask?.cancel()
  view.pendingKey = key
  let page: PDFPageProxy
  try {
    page = await getPage(index)
  } catch (err) {
    console.warn(`[pdf-reader] page ${index + 1} failed to load:`, err)
    return
  }
  if (unmounted || views.get(index) !== view || view.pendingKey !== key) return
  await updatePageSize(index, page)
  const viewport = page.getViewport({ scale })
  const pixels = canvasPixelSize(viewport.width, viewport.height, window.devicePixelRatio, MAX_CANVAS_PIXELS)
  const canvas = document.createElement('canvas')
  canvas.className = 'pdf-reader-canvas'
  canvas.setAttribute('aria-hidden', 'true')
  canvas.width = pixels.width
  canvas.height = pixels.height
  const task = page.render({ canvas, viewport, transform: [pixels.scaleX, 0, 0, pixels.scaleY, 0, 0] })
  view.renderTask = task
  try {
    await task.promise
  } catch (err) {
    if ((err as Error)?.name !== 'RenderingCancelledException') {
      console.warn(`[pdf-reader] page ${index + 1} failed to render:`, err)
      if (view.pendingKey === key) view.pendingKey = null
    }
    return
  }
  if (unmounted || views.get(index) !== view || view.pendingKey !== key) return
  view.renderTask = null
  view.pendingKey = null
  view.renderedKey = key
  const el = pageElement(index)
  if (!el) return
  if (view.canvas) {
    view.canvas.width = 0
    view.canvas.height = 0
    view.canvas.replaceWith(canvas)
  } else {
    el.prepend(canvas)
  }
  view.canvas = canvas
  await renderTextLayer(index, view, viewport, el)
}

const observePages = (): void => {
  pageObserver?.disconnect()
  const scroller = scrollerEl.value
  if (!scroller) return
  // Pages within one viewport height of the visible area are kept rendered.
  pageObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const index = Number((entry.target as HTMLElement).dataset.pageNumber) - 1
        if (entry.isIntersecting) {
          visiblePages.add(index)
        } else {
          visiblePages.delete(index)
          releasePage(index)
        }
      }
      scheduleRender()
    },
    { root: scroller, rootMargin: '100% 0px' }
  )
  for (const el of scroller.querySelectorAll('.pdf-reader-page')) pageObserver.observe(el)
}

const watchDevicePixelRatio = (): void => {
  dprQuery?.removeEventListener('change', onDevicePixelRatioChange)
  dprQuery = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`)
  dprQuery.addEventListener('change', onDevicePixelRatioChange)
}

// Moving the window to another screen or zooming the app changes the ratio;
// the render keys include it, so visible pages are redrawn sharp.
function onDevicePixelRatioChange (): void {
  watchDevicePixelRatio()
  scheduleRender()
}

// ---------------------------------------------------------------------------
// Find
// ---------------------------------------------------------------------------

const scrollToElement = (el: HTMLElement): void => {
  const scroller = scrollerEl.value
  if (!scroller) return
  const box = el.getBoundingClientRect()
  const frame = scroller.getBoundingClientRect()
  setScrollTop(scroller.scrollTop + box.top - frame.top - scroller.clientHeight * CURRENT_PAGE_LINE)
  if (box.left < frame.left || box.right > frame.right) {
    scroller.scrollLeft += box.left - frame.left - scroller.clientWidth / 2
  }
}

/** Rebuilds the highlight spans of page `index`'s text layer from the current matches. */
const applyHighlights = (index: number): void => {
  const view = views.get(index)
  const layer = view?.textLayer
  if (!view || !layer || !view.text) return
  const divs = layer.textDivs
  const strings = layer.textContentItemsStr
  for (const item of view.highlightedItems) divs[item].textContent = strings[item]
  view.highlightedItems = []
  const ranges = findOpen.value ? matches[index] : undefined
  if (!ranges?.length) return
  const parts = new Map<number, Array<{ start: number; end: number; selected: boolean }>>()
  ranges.forEach((range, matchIndex) => {
    const selected = cursor?.page === index && cursor.index === matchIndex
    for (const part of toItemRanges(view.text as PageText, range)) {
      const list = parts.get(part.item) ?? []
      list.push({ start: part.start, end: part.end, selected })
      parts.set(part.item, list)
    }
  })
  let selectedEl: HTMLElement | null = null
  for (const [item, list] of parts) {
    const div = divs[item]
    const source = strings[item]
    if (!div || source === undefined) continue
    const fragment = document.createDocumentFragment()
    let position = 0
    for (const part of list) {
      if (part.start > position) fragment.append(source.slice(position, part.start))
      const span = document.createElement('span')
      span.className = part.selected ? 'pdf-reader-highlight is-selected' : 'pdf-reader-highlight'
      span.textContent = source.slice(part.start, part.end)
      fragment.append(span)
      if (part.selected) selectedEl ??= span
      position = part.end
    }
    if (position < source.length) fragment.append(source.slice(position))
    div.replaceChildren(fragment)
    view.highlightedItems.push(item)
  }
  if (revealPending && selectedEl) {
    revealPending = false
    scrollToElement(selectedEl)
    currentPage.value = index + 1
    saveViewState()
  }
}

const updateOrdinal = (): void => {
  findTotal.value = countMatches(matches)
  findOrdinal.value = cursor ? matchOrdinal(matches, cursor) : 0
}

/** Shows the selected match: scrolls to it now if its page has a text layer, else once it gets one. */
const revealCursor = (): void => {
  if (!cursor) return
  revealPending = true
  const index = cursor.page
  applyHighlights(index)
  if (revealPending) goToPage(index + 1)
}

const runSearch = async (query: string): Promise<void> => {
  const token = ++searchToken
  searchedQuery = query
  const count = pageCount.value
  matches = new Array<TextRange[] | undefined>(count).fill(undefined)
  cursor = null
  revealPending = false
  updateOrdinal()
  for (const index of views.keys()) applyHighlights(index)
  if (!query.trim() || count === 0) {
    findSearching.value = false
    return
  }
  findSearching.value = true
  // The current page is searched first so the first hit is the nearest one.
  const start = currentPage.value - 1
  for (let step = 0; step < count; step++) {
    const index = (start + step) % count
    let ranges: TextRange[] = []
    try {
      const data = await getPageText(index)
      data.folded ??= foldText(data.text.text)
      ranges = findMatches(data.folded, query)
    } catch (err) {
      console.warn(`[pdf-reader] reading the text of page ${index + 1} failed:`, err)
    }
    if (token !== searchToken || unmounted) return
    matches[index] = ranges
    if (ranges.length && !cursor) {
      cursor = { page: index, index: 0 }
      revealCursor()
    } else if (ranges.length) {
      applyHighlights(index)
    }
    updateOrdinal()
  }
  findSearching.value = false
}

const stepFind = (direction: 1 | -1): void => {
  if (!findQuery.value.trim()) return
  if (findQuery.value !== searchedQuery) {
    if (findTimer) clearTimeout(findTimer)
    findTimer = null
    runSearch(findQuery.value)
    return
  }
  const next = cursor ? stepMatch(matches, cursor, direction) : firstMatchFrom(matches, currentPage.value - 1)
  if (!next) return
  const previous = cursor
  cursor = next
  if (previous && previous.page !== next.page) applyHighlights(previous.page)
  updateOrdinal()
  revealCursor()
}

watch(findQuery, (query) => {
  if (findTimer) clearTimeout(findTimer)
  findTimer = setTimeout(() => {
    findTimer = null
    if (query !== searchedQuery) runSearch(query)
  }, FIND_DEBOUNCE_MS)
})

const openFind = async (): Promise<void> => {
  if (!doc.value) return
  const selection = window.getSelection()?.toString().trim() ?? ''
  if (selection && selection.length <= 200 && !selection.includes('\n')) findQuery.value = selection
  findOpen.value = true
  await nextTick()
  findInputEl.value?.focus()
  findInputEl.value?.select()
  if (findQuery.value.trim() && findQuery.value !== searchedQuery) runSearch(findQuery.value)
}

const closeFind = (): void => {
  findOpen.value = false
  searchToken++
  searchedQuery = ''
  matches = []
  cursor = null
  revealPending = false
  findSearching.value = false
  updateOrdinal()
  for (const index of views.keys()) applyHighlights(index)
  scrollerEl.value?.focus({ preventScroll: true })
}

const onFindKeydown = (event: KeyboardEvent): void => {
  if (event.key === 'Enter') {
    event.preventDefault()
    stepFind(event.shiftKey ? -1 : 1)
  } else if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    closeFind()
  }
}

// ---------------------------------------------------------------------------
// Outline
// ---------------------------------------------------------------------------

const openOutlineNode = async (node: OutlineNode): Promise<void> => {
  const pdf = doc.value
  if (!pdf) return
  if (!node.dest) {
    if (node.url) window.electron.shell.openExternal(node.url).catch((err) => console.warn('[pdf-reader] opening the link failed:', err))
    return
  }
  try {
    const dest = typeof node.dest === 'string' ? await pdf.getDestination(node.dest) : node.dest
    if (!Array.isArray(dest) || dest.length === 0) return
    const [target, mode, ...args] = dest as [unknown, { name?: string } | undefined, ...unknown[]]
    const index =
      typeof target === 'number'
        ? target
        : target && typeof target === 'object'
          ? await pdf.getPageIndex(target as Parameters<PDFDocumentProxy['getPageIndex']>[0])
          : null
    if (index === null || unmounted) return
    // XYZ and FitH/FitBH destinations name a y coordinate (PDF space) to put at the top.
    const top = mode?.name === 'XYZ' ? args[1] : mode?.name === 'FitH' || mode?.name === 'FitBH' ? args[0] : null
    if (typeof top !== 'number') {
      goToPage(index + 1)
      return
    }
    const page = await getPage(index)
    const viewport = page.getViewport({ scale: 1 })
    const [, y] = viewport.convertToViewportPoint(0, top)
    scrollToPage(index, Math.max(0, Math.min(1, y / viewport.height)))
  } catch (err) {
    console.warn('[pdf-reader] following the outline entry failed:', err)
  }
}

// ---------------------------------------------------------------------------
// Keyboard
// ---------------------------------------------------------------------------

const isTextInput = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName))

const onKeydown = (event: KeyboardEvent): void => {
  if (!doc.value) return
  const mod = isMac ? event.metaKey : event.ctrlKey
  const key = event.key
  let handled = true
  if (mod && !event.altKey) {
    if (key.toLowerCase() === 'f' && !event.shiftKey) openFind()
    else if (key === '=' || key === '+') zoomByStep(1)
    else if (key === '-' || key === '_') zoomByStep(-1)
    else if (key === '0') applyFit('page-width')
    else if (key.toLowerCase() === 'g' && findOpen.value) stepFind(event.shiftKey ? -1 : 1)
    else handled = false
  } else if (key === 'F3' && findOpen.value) {
    stepFind(event.shiftKey ? -1 : 1)
  } else if (key === 'Escape' && findOpen.value) {
    closeFind()
  } else if (isTextInput(event.target) || event.altKey || event.ctrlKey || event.metaKey) {
    handled = false
  } else {
    const scroller = scrollerEl.value
    const scrollsSideways = !!scroller && scroller.scrollWidth > scroller.clientWidth
    if (key === 'n' || (key === 'ArrowRight' && !scrollsSideways)) goToPage(currentPage.value + 1)
    else if (key === 'p' || (key === 'ArrowLeft' && !scrollsSideways)) goToPage(currentPage.value - 1)
    else if (key === 'Home') goToPage(1)
    else if (key === 'End') goToPage(pageCount.value)
    else handled = false
  }
  if (handled) {
    // Also keeps the app's own shortcuts (window zoom, editor find) from running.
    event.preventDefault()
    event.stopPropagation()
  }
}

// Shortcuts typed while nothing has focus (e.g. right after clicking the tab) still reach the viewer.
const onWindowKeydown = (event: KeyboardEvent): void => {
  if (!event.defaultPrevented && (document.activeElement === document.body || !document.activeElement)) {
    onKeydown(event)
  }
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

const openExternally = (): void => {
  window.electron.shell.openPath(props.pathname).catch((err) => console.warn('[pdf-reader] opening the file failed:', err))
}

const load = async (): Promise<void> => {
  try {
    const data = await props.readFile()
    if (unmounted) return
    const pdf = await openPdf(data)
    if (unmounted) {
      await pdf.destroy()
      return
    }
    opened = pdf
    const first = await pdf.doc.getPage(1)
    if (unmounted) return
    pagePromises.set(0, Promise.resolve(first))
    const viewport = first.getViewport({ scale: 1 })
    const count = pdf.doc.numPages
    for (let i = 0; i < count; i++) userUnits[i] = first.userUnit
    pageSizes.value = Array.from({ length: count }, () => ({ width: viewport.width, height: viewport.height }))
    doc.value = markRaw(pdf.doc)

    const saved = viewStates.get(props.pathname)
    const requested = parsePageSubpath(props.subpath)
    const followLink = requested !== null && props.subpath !== saved?.appliedSubpath
    zoomMode.value = saved?.zoomMode ?? 'page-width'
    zoom.value = saved?.zoom ?? 1
    status.value = 'ready'
    await nextTick()
    if (unmounted) return
    if (zoomMode.value !== 'custom') zoom.value = fitZoom(zoomMode.value)
    await nextTick()
    if (followLink) goToPage(requested)
    else if (saved) scrollToPage(clampPage(saved.page, count) - 1, saved.pageOffset)
    else saveViewState()
    observePages()
    scrollerEl.value?.focus({ preventScroll: true })
  } catch (err) {
    if (unmounted) return
    console.warn('[pdf-reader] opening the PDF failed:', err)
    const kind = classifyLoadError(err)
    errorText.value = t(`error.${kind}`, { message: err instanceof Error ? err.message : String(err) })
    status.value = 'error'
  }
}

watch(
  () => props.subpath,
  (subpath) => {
    appliedSubpath = subpath
    const page = parsePageSubpath(subpath)
    if (page !== null && status.value === 'ready') goToPage(page)
    else if (status.value === 'ready') saveViewState()
  }
)

onMounted(() => {
  const scroller = scrollerEl.value
  scroller?.addEventListener('wheel', onWheel, { passive: false })
  if (scroller) {
    resizeObserver = new ResizeObserver(onResize)
    resizeObserver.observe(scroller)
  }
  bodyObserver = new MutationObserver(() => {
    bodyDark.value = document.body.classList.contains('dark')
  })
  bodyObserver.observe(document.body, { attributes: true, attributeFilter: ['class'] })
  window.addEventListener('keydown', onWindowKeydown)
  // The app's Find shortcuts (Cmd/Ctrl+F, Cmd+G, F3, configurable) are taken by
  // the main process before the page sees the key and arrive as edit actions.
  // The viewer is only mounted while its tab is the active one.
  stopEditActions = window.electron.ipcRenderer.on('mt::editor-edit-action', (_event, action) => {
    if (action === 'find') openFind()
    else if (action === 'findNext') stepFind(1)
    else if (action === 'findPrev') stepFind(-1)
  })
  // Cmd/Ctrl+= / - / 0 are the app's heading shortcuts on some platforms and
  // likewise never reach the page; in a PDF tab they have no target, so they
  // drive the PDF zoom instead.
  stopParagraphActions = window.electron.ipcRenderer.on('mt::editor-paragraph-action', (_event, { type }) => {
    if (!doc.value) return
    if (type === 'upgrade heading') zoomByStep(1)
    else if (type === 'degrade heading') zoomByStep(-1)
    else if (type === 'paragraph') applyFit('page-width')
  })
  watchDevicePixelRatio()
  load()
})

onBeforeUnmount(() => {
  if (status.value === 'ready') saveViewState()
  unmounted = true
  searchToken++
  scrollerEl.value?.removeEventListener('wheel', onWheel)
  window.removeEventListener('keydown', onWindowKeydown)
  stopEditActions?.()
  stopParagraphActions?.()
  dprQuery?.removeEventListener('change', onDevicePixelRatioChange)
  pageObserver?.disconnect()
  resizeObserver?.disconnect()
  bodyObserver?.disconnect()
  if (renderTimer) clearTimeout(renderTimer)
  if (findTimer) clearTimeout(findTimer)
  if (scrollFrame) cancelAnimationFrame(scrollFrame)
  if (resizeFrame) cancelAnimationFrame(resizeFrame)
  for (const index of [...views.keys()]) releasePage(index)
  const pdf = opened
  opened = null
  pdf?.destroy().catch((err) => console.warn('[pdf-reader] closing the PDF failed:', err))
})
</script>

<style>
.pdf-reader {
  --pdf-reader-toolbar-height: 36px;
  --pdf-reader-page-bg: #fff;

  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
  color: var(--editorColor);
  background: var(--editorBgColor);
}

.pdf-reader.is-dark {
  --pdf-reader-page-bg: #000;
}

.pdf-reader-icon {
  display: inline-flex;
  width: 16px;
  height: 16px;

  & svg {
    width: 100%;
    height: 100%;
  }
}

.pdf-reader-toolbar,
.pdf-reader-findbar {
  display: flex;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
  padding: 0 8px;
  border-bottom: 1px solid var(--floatBorderColor);
  background: var(--editorBgColor);
}

.pdf-reader-toolbar {
  height: var(--pdf-reader-toolbar-height);
  overflow-x: auto;
  scrollbar-width: none;
}

.pdf-reader-findbar {
  height: 34px;
  gap: 4px;
}

.pdf-reader-separator {
  width: 1px;
  height: 18px;
  margin: 0 6px;
  background: var(--floatBorderColor);
}

.pdf-reader-spacer {
  flex: 1;
}

.pdf-reader-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 28px;
  height: 26px;
  padding: 0;
  border: none;
  border-radius: 4px;
  color: var(--iconColor);
  background: transparent;
  cursor: pointer;

  &:hover:not(:disabled) {
    color: var(--themeColor);
    background: var(--sideBarItemHoverBgColor);
  }

  &.is-active {
    color: var(--themeColor);
    background: var(--themeColor20);
  }

  &:disabled {
    opacity: 0.4;
    cursor: default;
  }

  &:focus-visible {
    outline: 2px solid var(--themeColor);
    outline-offset: -2px;
  }
}

.pdf-reader-page-input,
.pdf-reader-zoom-select,
.pdf-reader-find-input {
  height: 24px;
  border: 1px solid var(--floatBorderColor);
  border-radius: 4px;
  color: var(--editorColor);
  background: var(--inputBgColor);
  font-size: 13px;

  &:focus {
    outline: none;
    border-color: var(--themeColor);
  }
}

.pdf-reader-page-input {
  width: 44px;
  padding: 0 4px;
  text-align: center;
}

.pdf-reader-page-count {
  padding: 0 6px;
  font-size: 13px;
  color: var(--editorColor60);
  white-space: nowrap;
}

.pdf-reader-zoom-select {
  padding: 0 4px;
  margin: 0 2px;
}

.pdf-reader-find-input {
  width: 240px;
  padding: 0 8px;
}

.pdf-reader-find-status {
  min-width: 80px;
  font-size: 12px;
  color: var(--editorColor60);
  white-space: nowrap;
}

.pdf-reader-body {
  display: flex;
  flex: 1;
  min-height: 0;
}

.pdf-reader-sidebar {
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  width: 200px;
  border-right: 1px solid var(--floatBorderColor);
  color: var(--sideBarColor);
  background: var(--sideBarBgColor);
}

.pdf-reader-sidebar-tabs {
  display: flex;
  flex-shrink: 0;
  border-bottom: 1px solid var(--floatBorderColor);
}

.pdf-reader-sidebar-tab {
  flex: 1;
  height: 30px;
  border: none;
  border-bottom: 2px solid transparent;
  color: var(--sideBarColor);
  background: transparent;
  font-size: 12px;
  cursor: pointer;

  &.is-active {
    color: var(--sideBarTitleColor);
    border-bottom-color: var(--themeColor);
  }

  &:focus-visible {
    outline: 2px solid var(--themeColor);
    outline-offset: -2px;
  }
}

.pdf-reader-thumbnails,
.pdf-reader-outline {
  position: relative;
  flex: 1;
  overflow-y: auto;
}

.pdf-reader-thumbnails {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 12px 0;
}

.pdf-reader-thumbnail {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 6px;
  border: none;
  border-radius: 4px;
  color: var(--sideBarTextColor);
  background: transparent;
  cursor: pointer;

  &:hover {
    background: var(--sideBarItemHoverBgColor);
  }

  &.is-current {
    background: var(--themeColor20);

    & .pdf-reader-thumbnail-canvas {
      outline: 2px solid var(--themeColor);
    }
  }

  &:focus-visible {
    outline: 2px solid var(--themeColor);
  }
}

.pdf-reader-thumbnail-canvas {
  display: block;
  background: var(--pdf-reader-page-bg);
  box-shadow: 0 1px 3px rgb(0 0 0 / 0.25);

  & canvas {
    display: block;
    width: 100%;
    height: 100%;
  }
}

.pdf-reader-thumbnail-label {
  font-size: 12px;
}

.pdf-reader-outline {
  padding: 6px 0;

  & ul {
    margin: 0;
    padding: 0;
    list-style: none;
  }
}

.pdf-reader-panel-empty {
  padding: 12px;
  font-size: 13px;
  color: var(--sideBarTextColor);
}

.pdf-reader-outline-row {
  display: flex;
  align-items: center;
  padding-inline-end: 6px;
}

.pdf-reader-outline-toggle,
.pdf-reader-outline-spacer {
  flex-shrink: 0;
  width: 18px;
  height: 22px;
}

.pdf-reader-outline-toggle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: none;
  color: var(--sideBarIconColor);
  background: transparent;
  cursor: pointer;

  & .pdf-reader-icon {
    width: 14px;
    height: 14px;
    transition: transform 0.15s;
  }

  &.is-expanded .pdf-reader-icon {
    transform: rotate(90deg);
  }
}

.pdf-reader-outline-title {
  flex: 1;
  min-width: 0;
  padding: 3px 4px;
  border: none;
  border-radius: 3px;
  overflow: hidden;
  color: var(--sideBarColor);
  background: transparent;
  font-size: 13px;
  text-align: start;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: pointer;

  &:hover {
    background: var(--sideBarItemHoverBgColor);
  }

  &.is-bold {
    font-weight: 600;
  }

  &.is-italic {
    font-style: italic;
  }
}

.pdf-reader-outline-toggle:focus-visible,
.pdf-reader-outline-title:focus-visible {
  outline: 2px solid var(--themeColor);
  outline-offset: -2px;
}

.pdf-reader-scroller {
  position: relative;
  flex: 1;
  min-width: 0;
  overflow: auto;
  scrollbar-gutter: stable;
  background: var(--editorColor04);

  &:focus-visible {
    outline: none;
  }
}

.pdf-reader-message {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  height: 100%;
  padding: 0 24px;
  text-align: center;
  color: var(--editorColor60);

  & p {
    margin: 0;
    max-width: 520px;
  }
}

.pdf-reader-message-title {
  font-size: 16px;
  color: var(--editorColor);
}

.pdf-reader-text-button {
  margin-top: 8px;
  padding: 6px 14px;
  border: 1px solid var(--buttonBorder);
  border-radius: 4px;
  color: var(--buttonFontColor);
  background: var(--buttonBgColor);
  cursor: pointer;

  &:hover {
    background: var(--buttonBgColorHover);
  }
}

.pdf-reader-pages {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  width: max-content;
  min-width: 100%;
  padding: 16px;
  box-sizing: border-box;
}

.pdf-reader-page {
  --scale-round-x: 1px;
  --scale-round-y: 1px;

  position: relative;
  flex-shrink: 0;
  background: var(--pdf-reader-page-bg);
  box-shadow: 0 1px 4px rgb(0 0 0 / 0.25);
}

.pdf-reader-canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}

.pdf-reader.is-dark :is(.pdf-reader-canvas, .pdf-reader-thumbnail-canvas canvas) {
  filter: invert(1) hue-rotate(180deg);
}

/* pdf.js text layer: transparent text positioned over the canvas for selection and find. */
.pdf-reader-page .textLayer {
  position: absolute;
  inset: 0;
  overflow: clip;
  opacity: 1;
  line-height: 1;
  text-align: initial;
  letter-spacing: normal;
  word-spacing: normal;
  text-size-adjust: none;
  forced-color-adjust: none;
  transform-origin: 0 0;
  caret-color: CanvasText;
  z-index: 0;

  --min-font-size: 1;
  --text-scale-factor: calc(var(--total-scale-factor) * var(--min-font-size));
  --min-font-size-inv: calc(1 / var(--min-font-size));

  & :is(span, br) {
    position: absolute;
    color: transparent;
    white-space: pre;
    cursor: text;
    transform-origin: 0% 0%;
    user-select: text;
  }

  & > :not(.markedContent) {
    z-index: 1;

    --font-height: 0;
    font-size: calc(var(--text-scale-factor) * var(--font-height));

    --scale-x: 1;
    --rotate: 0deg;
    transform: rotate(var(--rotate)) scaleX(var(--scale-x)) scale(var(--min-font-size-inv));
  }

  & .markedContent {
    display: contents;
  }

  & ::selection {
    background: color-mix(in srgb, AccentColor, transparent 60%);
    color: transparent;
  }

  & br::selection {
    background: transparent;
  }

  & .pdf-reader-highlight {
    position: initial;
    margin: -1px;
    padding: 1px;
    border-radius: 3px;
    background-color: rgb(255 200 0 / 0.4);

    &.is-selected {
      background-color: rgb(255 120 0 / 0.55);
    }
  }
}
</style>
