import { describe, expect, it } from 'vitest'
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
  wheelZoom
} from '@plugins/pdf-reader/common/zoom'

// A4 portrait in PDF points.
const A4 = { width: 595, height: 842 }

describe('zoom steps', () => {
  it('moves to the next stop, also from between two stops', () => {
    expect(stepZoom(1, 1)).toBe(1.1)
    expect(stepZoom(1, -1)).toBe(0.9)
    expect(stepZoom(1.17, 1)).toBe(1.25)
    expect(stepZoom(1.17, -1)).toBe(1.1)
  })

  it('treats a zoom a rounding error away from a stop as that stop', () => {
    expect(stepZoom(1.0000001, 1)).toBe(1.1)
    expect(stepZoom(0.9999999, -1)).toBe(0.9)
  })

  it('stays at the limits', () => {
    expect(stepZoom(MAX_ZOOM, 1)).toBe(MAX_ZOOM)
    expect(stepZoom(MIN_ZOOM, -1)).toBe(MIN_ZOOM)
  })

  it('clamps arbitrary values', () => {
    expect(clampZoom(100)).toBe(MAX_ZOOM)
    expect(clampZoom(0)).toBe(MIN_ZOOM)
    expect(clampZoom(Number.NaN)).toBe(1)
  })
})

describe('wheel zoom', () => {
  it('zooms in when scrolling up and out when scrolling down, symmetrically', () => {
    const zoomedIn = wheelZoom(1, -100)
    expect(zoomedIn).toBeGreaterThan(1)
    expect(wheelZoom(zoomedIn, 100)).toBeCloseTo(1, 10)
    expect(wheelZoom(1, 100)).toBeLessThan(1)
  })

  it('reaches the same zoom from many small deltas as from one large delta', () => {
    let trackpad = 1
    for (let i = 0; i < 10; i++) trackpad = wheelZoom(trackpad, -10)
    expect(trackpad).toBeCloseTo(wheelZoom(1, -100), 10)
  })

  it('never leaves the zoom range', () => {
    expect(wheelZoom(4.9, -10000)).toBe(MAX_ZOOM)
    expect(wheelZoom(0.3, 10000)).toBe(MIN_ZOOM)
  })
})

describe('fit zoom', () => {
  it('fills the available width with the page', () => {
    const zoom = fitWidthZoom(A4, 800)
    expect(A4.width * PDF_TO_CSS_UNITS * zoom).toBeCloseTo(800, 6)
    expect(pageCssSize(A4, zoom).width).toBe(800)
  })

  it('fits the whole page, limited by the tighter dimension', () => {
    // Wide viewport: height limits.
    const byHeight = fitPageZoom(A4, 2000, 600)
    expect(A4.height * PDF_TO_CSS_UNITS * byHeight).toBeCloseTo(600, 6)
    // Narrow viewport: width limits.
    const byWidth = fitPageZoom(A4, 300, 2000)
    expect(A4.width * PDF_TO_CSS_UNITS * byWidth).toBeCloseTo(300, 6)
  })

  it('handles landscape pages', () => {
    const landscape = { width: 842, height: 595 }
    const zoom = fitPageZoom(landscape, 1000, 1000)
    expect(landscape.width * PDF_TO_CSS_UNITS * zoom).toBeCloseTo(1000, 6)
  })

  it('falls back to 100% before the viewer has a size', () => {
    expect(fitWidthZoom(A4, 0)).toBe(1)
    expect(fitPageZoom(A4, 0, 500)).toBe(1)
    expect(fitWidthZoom({ width: 0, height: 0 }, 800)).toBe(1)
  })

  it('clamps fits of tiny or huge pages to the zoom range', () => {
    expect(fitWidthZoom({ width: 10, height: 10 }, 2000)).toBe(MAX_ZOOM)
    expect(fitWidthZoom({ width: 100000, height: 10 }, 200)).toBe(MIN_ZOOM)
  })
})

describe('page and canvas sizes', () => {
  it('shows a page at 100% in physical size (96 CSS px per inch)', () => {
    // US Letter: 8.5in x 11in.
    expect(pageCssSize({ width: 612, height: 792 }, 1)).toEqual({ width: 816, height: 1056 })
  })

  it('backs the canvas with device pixels for crisp HiDPI rendering', () => {
    const size = canvasPixelSize(816, 1056, 2, 1 << 30)
    expect(size).toEqual({ width: 1632, height: 2112, scaleX: 2, scaleY: 2 })
  })

  it('caps the canvas area, keeping the aspect ratio', () => {
    const size = canvasPixelSize(4000, 4000, 2, 4096 * 4096)
    expect(size.width * size.height).toBeLessThanOrEqual(4096 * 4096)
    expect(size.width).toBe(size.height)
    expect(size.scaleX).toBeCloseTo(size.width / 4000, 10)
  })

  it('treats an invalid device pixel ratio as 1', () => {
    expect(canvasPixelSize(100, 50, 0, 1 << 30)).toEqual({ width: 100, height: 50, scaleX: 1, scaleY: 1 })
  })
})
