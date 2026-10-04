import { ref } from 'vue'
import type { ZoomMode } from '../common/zoom'

export const VIEW_ID = 'pdf-reader.viewer'

/**
 * Where the reader was in one file. Kept for the app session only: the viewer
 * is unmounted whenever its tab is in the background, and comes back here.
 */
export interface PdfViewState {
  /** 1-based page at the top of the viewport. */
  page: number
  /** How far that page is scrolled past the top of the viewport, as a fraction of its height. */
  pageOffset: number
  zoomMode: ZoomMode
  zoom: number
  /**
   * Last link subpath (`page=3`) the viewer applied. The tab keeps its subpath
   * after a tab switch, and re-applying it would undo the reader's scrolling.
   */
  appliedSubpath: string | null
}

/** Per absolute path. */
export const viewStates = new Map<string, PdfViewState>()

/** Shared by every PDF tab of the window for the session. */
export const sidebarOpen = ref(false)
export const sidebarTab = ref<'outline' | 'thumbnails'>('thumbnails')
/** User choice for inverted pages; null follows the app theme. */
export const darkPagesOverride = ref<boolean | null>(null)
