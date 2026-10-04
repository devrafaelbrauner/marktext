import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { getDocument, PDFWorker } from 'pdfjs-dist'
import type { PDFDocumentProxy } from 'pdfjs-dist'

// Served by the `pdfjsAssets` plugin in electron.vite.config.ts.
const assetDir = (dir: string): string => new URL(`pdfjs/${dir}/`, document.baseURI).href

export interface OpenedPdf {
  doc: PDFDocumentProxy
  /** Releases the document and terminates its worker. */
  destroy(): Promise<void>
}

/**
 * Parses `data` (which is transferred to the worker and detached) in a module
 * worker of its own. The worker is created here from a same-origin script URL
 * rather than by pdf.js: for a `file://` page pdf.js would wrap the script in
 * a `blob:` URL, which the renderer CSP forbids, and silently fall back to
 * parsing on the main thread.
 */
export const openPdf = async(data: Uint8Array): Promise<OpenedPdf> => {
  const webWorker = new Worker(workerUrl, { type: 'module', name: 'pdf-reader' })
  const worker = PDFWorker.create({ port: webWorker })
  const task = getDocument({
    data,
    worker,
    cMapUrl: assetDir('cmaps'),
    cMapPacked: true,
    standardFontDataUrl: assetDir('standard_fonts'),
    wasmUrl: assetDir('wasm'),
    iccUrl: assetDir('iccs'),
    enableXfa: false
  })
  const destroy = async(): Promise<void> => {
    try {
      await task.destroy()
    } finally {
      worker.destroy()
      webWorker.terminate()
    }
  }
  // With an explicit port pdf.js never notices a worker that failed to load.
  const workerFailed = new Promise<never>((_resolve, reject) => {
    webWorker.addEventListener('error', (event) => {
      reject(new Error(event.message || 'The PDF worker failed to start.'))
    })
  })
  try {
    const doc = await Promise.race([task.promise, workerFailed])
    return { doc, destroy }
  } catch (err) {
    await destroy().catch(() => undefined)
    throw err
  }
}
