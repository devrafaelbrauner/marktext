/**
 * Zoom is expressed as a factor of the page's physical size: 1 shows a page
 * at 100% (one PDF point = 1/72 inch rendered at 96 CSS px per inch), the
 * same convention as Firefox's PDF viewer.
 */

/** CSS pixels per PDF point. */
export const PDF_TO_CSS_UNITS = 96 / 72

export const MIN_ZOOM = 0.25
export const MAX_ZOOM = 5

/** Stops of the zoom in/out buttons and shortcuts. */
export const ZOOM_STEPS: readonly number[] = Object.freeze([
  0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5
])

/** 'custom' keeps the zoom factor; the fit modes recompute it whenever the viewer is resized. */
export type ZoomMode = 'custom' | 'page-width' | 'page-fit'

export const clampZoom = (zoom: number): number => {
  if (!Number.isFinite(zoom)) return 1
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom))
}

// Tolerance so a zoom that is a rounding error away from a stop counts as on it.
const STEP_EPSILON = 1e-3

/** Next zoom stop above (`direction` 1) or below (-1) `zoom`; stays at the limit. */
export const stepZoom = (zoom: number, direction: 1 | -1): number => {
  if (direction > 0) {
    return ZOOM_STEPS.find((step) => step > zoom + STEP_EPSILON) ?? MAX_ZOOM
  }
  for (let i = ZOOM_STEPS.length - 1; i >= 0; i--) {
    if (ZOOM_STEPS[i] < zoom - STEP_EPSILON) return ZOOM_STEPS[i]
  }
  return MIN_ZOOM
}

/**
 * Zoom after a Ctrl+wheel event. Exponential in `deltaY` so trackpads (many
 * small deltas) and mouse wheels (few large ones) zoom at the same speed per
 * pixel; scrolling up zooms in.
 */
export const wheelZoom = (zoom: number, deltaY: number): number =>
  clampZoom(zoom * Math.exp(-deltaY * 0.002))

export interface PageSize {
  /** Width in PDF points (rotation applied). */
  width: number
  /** Height in PDF points (rotation applied). */
  height: number
}

/**
 * Zoom at which a page of `page` size fills `availableWidth` CSS px.
 * `availableWidth` must already exclude margins and the scrollbar.
 */
export const fitWidthZoom = (page: PageSize, availableWidth: number): number =>
  page.width > 0 && availableWidth > 0 ? clampZoom(availableWidth / (page.width * PDF_TO_CSS_UNITS)) : 1

/** Zoom at which the whole page fits into `availableWidth` × `availableHeight` CSS px. */
export const fitPageZoom = (page: PageSize, availableWidth: number, availableHeight: number): number => {
  if (page.width <= 0 || page.height <= 0 || availableWidth <= 0 || availableHeight <= 0) return 1
  return clampZoom(
    Math.min(availableWidth / (page.width * PDF_TO_CSS_UNITS), availableHeight / (page.height * PDF_TO_CSS_UNITS))
  )
}

/** Size of a page on screen at `zoom`, in CSS px, rounded down like pdf.js does for its layers. */
export const pageCssSize = (page: PageSize, zoom: number): { width: number; height: number } => ({
  width: Math.floor(page.width * PDF_TO_CSS_UNITS * zoom),
  height: Math.floor(page.height * PDF_TO_CSS_UNITS * zoom)
})

/**
 * Canvas backing-store size for a page drawn at `cssWidth` × `cssHeight` on a
 * screen with `devicePixelRatio`, capped at `maxPixels` so a deep zoom on a
 * HiDPI screen cannot exhaust canvas memory (the canvas is then upscaled by
 * CSS, trading sharpness for memory). Returns the scale factors to pass to
 * pdf.js as the render transform.
 */
export const canvasPixelSize = (
  cssWidth: number,
  cssHeight: number,
  devicePixelRatio: number,
  maxPixels: number
): { width: number; height: number; scaleX: number; scaleY: number } => {
  let ratio = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1
  const area = cssWidth * cssHeight * ratio * ratio
  if (area > maxPixels && area > 0) ratio *= Math.sqrt(maxPixels / area)
  const width = Math.max(1, Math.floor(cssWidth * ratio))
  const height = Math.max(1, Math.floor(cssHeight * ratio))
  return {
    width,
    height,
    scaleX: cssWidth > 0 ? width / cssWidth : 1,
    scaleY: cssHeight > 0 ? height / cssHeight : 1
  }
}
