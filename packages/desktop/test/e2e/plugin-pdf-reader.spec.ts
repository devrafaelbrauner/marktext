import { expect, test } from '@playwright/test'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import type { ElectronApplication, Page } from 'playwright'
import { expectNoRendererErrors, launchElectron, waitForEditor, waitForMenuReady } from './helpers'

// The built-in PDF reader (src/plugins/pdf-reader) runs pdf.js in a module
// worker under the renderer CSP of the built app (file://, out/).

const FIXTURE_VAULT = path.resolve(__dirname, '../fixtures/vault')
const MOD = process.platform === 'darwin' ? 'meta' : 'control'

/**
 * Presses a shortcut through Electron's input pipeline, so the main process's
 * window shortcuts (which take e.g. Cmd/Ctrl+F before the page sees it) run
 * exactly as for a real key press; Playwright's keyboard bypasses them.
 */
const pressShortcut = (app: ElectronApplication, windowTitlePart: string, keyCode: string): Promise<void> =>
  app.evaluate(
    ({ BrowserWindow }, args) => {
      const win = BrowserWindow.getAllWindows().find((w) => w.getTitle().includes(args.windowTitlePart))
      if (!win) throw new Error(`No window titled *${args.windowTitlePart}*`)
      const modifiers = [args.modifier] as Array<'meta' | 'control'>
      win.webContents.sendInputEvent({ type: 'keyDown', keyCode: args.keyCode, modifiers })
      win.webContents.sendInputEvent({ type: 'keyUp', keyCode: args.keyCode, modifiers })
    },
    { windowTitlePart, keyCode, modifier: MOD }
  )

const modifierClickLink = (page: Page, raw: string): Promise<boolean> =>
  page.evaluate((linkRaw) => {
    const link = [...document.querySelectorAll<HTMLElement>('span.mu-link')].find((el) => el.dataset.raw === linkRaw)
    link?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, metaKey: true, ctrlKey: true }))
    return !!link
  }, raw)

const copyVault = (): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'marktext-e2etest-pdf-'))
  fs.cpSync(FIXTURE_VAULT, dir, { recursive: true })
  return dir
}

/**
 * Opens `vaultDir` as the window's folder with `notePath` in a tab. Plugin
 * file access is scoped to the opened folder, and the harness also passes the
 * package directory, which opens in a window of its own.
 */
const launchVault = async(
  vaultDir: string,
  notePath: string,
  language: string
): Promise<{ app: ElectronApplication; page: Page }> => {
  const { app } = await launchElectron([vaultDir, notePath], { suppressErrorDialog: true, preferences: { language } })
  const noteName = path.basename(notePath)
  let page: Page | null = null
  await expect
    .poll(
      async() => {
        for (const candidate of app.windows()) {
          if ((await candidate.title()).startsWith(noteName)) page = candidate
        }
        return page !== null
      },
      { timeout: 15000 }
    )
    .toBe(true)
  const found = page as unknown as Page
  await waitForEditor(found)
  await waitForMenuReady(app)
  return { app, page: found }
}

/** Records CSP violations and pdf.js warnings (e.g. a fallback to the main-thread "fake worker"). */
const watchProblems = async(page: Page): Promise<string[]> => {
  const problems: string[] = []
  page.on('console', (message) => {
    const text = message.text()
    if (/Content Security Policy|fake worker|Unable to load|pdf-reader/i.test(text)) problems.push(text)
  })
  await page.evaluate(() => {
    document.addEventListener('securitypolicyviolation', (event) => {
      console.error(`Content Security Policy violation: ${event.violatedDirective} ${event.blockedURI}`)
    })
  })
  return problems
}

const darkPixelCount = (page: Page, pageNumber: number): Promise<number> =>
  page.evaluate((n) => {
    const canvas = document.querySelector<HTMLCanvasElement>(`.pdf-reader-page[data-page-number="${n}"] canvas`)
    const context = canvas?.getContext('2d')
    if (!canvas || !context) return -1
    const { data } = context.getImageData(0, 0, canvas.width, canvas.height)
    let dark = 0
    for (let i = 0; i < data.length; i += 4) if (data[i] < 128 && data[i + 1] < 128 && data[i + 2] < 128) dark++
    return dark
  }, pageNumber)

test.describe('PDF reader plugin', () => {
  let app: ElectronApplication | undefined
  let vaultDir: string | undefined

  test.afterEach(async() => {
    if (app) await app.close()
    app = undefined
    if (vaultDir) fs.rmSync(vaultDir, { recursive: true, force: true })
    vaultDir = undefined
  })

  test('renders pages with a text layer, follows #page links, finds, zooms and copies page links', async() => {
    test.setTimeout(90000)
    vaultDir = copyVault()
    const notePath = path.join(vaultDir, 'PDF Links.md')
    fs.writeFileSync(notePath, '[Second page](Attachments/sample.pdf#page=2)\n')
    const launched = await launchVault(vaultDir, notePath, 'en')
    app = launched.app
    const { page } = launched
    const problems = await watchProblems(page)
    await page.waitForSelector('span.mu-link', { state: 'attached' })

    // A `#page=2` link opens the PDF in a tab at page 2.
    expect(await modifierClickLink(page, '[Second page](Attachments/sample.pdf#page=2)')).toBe(true)
    const viewer = page.locator('.pdf-reader')
    await expect(viewer).toHaveAttribute('data-status', 'ready', { timeout: 20000 })
    await expect(viewer).toHaveAttribute('data-current-page', '2')
    await expect(page.locator('.pdf-reader-page-input')).toHaveValue('2')
    await expect(page.locator('.pdf-reader-page-count')).toHaveText('of 2')
    const pageTwoOffset = await page.evaluate(() => {
      const scroller = document.querySelector('.pdf-reader-scroller') as HTMLElement
      const pageTwo = document.querySelector('.pdf-reader-page[data-page-number="2"]') as HTMLElement
      return pageTwo.getBoundingClientRect().top - scroller.getBoundingClientRect().top
    })
    expect(Math.abs(pageTwoOffset)).toBeLessThan(20)

    // The canvas shows the page (dark glyphs on white) and the text layer carries its text.
    await expect.poll(() => darkPixelCount(page, 2), { timeout: 15000 }).toBeGreaterThan(50)
    const canvasScale = await page.evaluate(() => {
      const canvas = document.querySelector('.pdf-reader-page[data-page-number="2"] canvas') as HTMLCanvasElement
      return canvas.width / canvas.getBoundingClientRect().width
    })
    expect(canvasScale).toBeCloseTo(await page.evaluate(() => window.devicePixelRatio), 1)
    await expect(page.locator('.pdf-reader-page[data-page-number="2"] .textLayer')).toContainText('Page 2')
    await expect(page.locator('.pdf-reader-page[data-page-number="1"] .textLayer')).toContainText('Page 1', {
      timeout: 15000
    })

    // pdf.js data files are reachable next to index.html in the built app.
    const fontStatus = await page.evaluate(
      () =>
        new Promise<number>((resolve) => {
          const request = new XMLHttpRequest()
          request.open('GET', new URL('pdfjs/standard_fonts/LiberationSans-Regular.ttf', document.baseURI).href)
          request.responseType = 'arraybuffer'
          request.onload = () => resolve((request.response as ArrayBuffer).byteLength)
          request.onerror = () => resolve(-1)
          request.send()
        })
    )
    expect(fontStatus).toBeGreaterThan(1000)

    // Find: Ctrl/Cmd+F inside the viewer, highlights and a match count.
    await page.locator('.pdf-reader-scroller').focus()
    await pressShortcut(app, path.basename(vaultDir), 'F')
    const findInput = page.locator('.pdf-reader-find-input')
    await expect(findInput).toBeFocused()
    await findInput.fill('page')
    await expect(page.locator('.pdf-reader-find-status')).toHaveText('2 of 2', { timeout: 10000 })
    await expect(page.locator('.pdf-reader-page[data-page-number="2"] .pdf-reader-highlight.is-selected')).toHaveText(
      'Page'
    )
    await expect(page.locator('.pdf-reader-highlight')).toHaveCount(2)
    await findInput.press('Enter')
    await expect(page.locator('.pdf-reader-find-status')).toHaveText('1 of 2')
    await expect(page.locator('.pdf-reader-page[data-page-number="1"] .pdf-reader-highlight.is-selected')).toHaveText(
      'Page'
    )
    await expect(viewer).toHaveAttribute('data-current-page', '1')
    await findInput.press('Escape')
    await expect(findInput).toHaveCount(0)
    await expect(page.locator('.pdf-reader-highlight')).toHaveCount(0)

    // Zoom: the shortcut changes the scale and the pages are redrawn at the new size.
    const zoomBefore = Number(await viewer.getAttribute('data-zoom'))
    const widthBefore = await page.locator('.pdf-reader-page[data-page-number="1"]').evaluate((el) => el.clientWidth)
    await page.locator('.pdf-reader-scroller').focus()
    await pressShortcut(app, path.basename(vaultDir), '=')
    await expect.poll(async() => Number(await viewer.getAttribute('data-zoom'))).toBeGreaterThan(zoomBefore)
    const widthAfter = await page.locator('.pdf-reader-page[data-page-number="1"]').evaluate((el) => el.clientWidth)
    expect(widthAfter).toBeGreaterThan(widthBefore)
    await expect
      .poll(() =>
        page.evaluate(() => {
          const canvas = document.querySelector('.pdf-reader-page[data-page-number="1"] canvas') as HTMLCanvasElement
          return Math.round(canvas.width / window.devicePixelRatio)
        })
      )
      .toBeGreaterThanOrEqual(widthAfter - 1)
    await page.locator('.pdf-reader-zoom-select').selectOption('1')
    await expect(viewer).toHaveAttribute('data-zoom', '1')

    // Copy link to this page (toolbar button; same action as the palette command).
    await page.locator('.pdf-reader-page-input').fill('2')
    await page.locator('.pdf-reader-page-input').press('Enter')
    await expect(viewer).toHaveAttribute('data-current-page', '2')
    await page.getByRole('button', { name: 'Copy link to this page' }).click()
    const electronApp = launched.app
    await expect.poll(() => electronApp.evaluate(({ clipboard }) => clipboard.readText())).toBe('[[sample.pdf#page=2]]')

    // The position survives switching to another tab and back.
    await page.locator('.tabs-container li', { hasText: 'PDF Links.md' }).click()
    await expect(viewer).toHaveCount(0)
    await page.locator('.tabs-container li', { hasText: 'sample.pdf' }).click()
    await expect(viewer).toHaveAttribute('data-status', 'ready', { timeout: 20000 })
    await expect(viewer).toHaveAttribute('data-current-page', '2')
    await expect(viewer).toHaveAttribute('data-zoom', '1')

    // Sidebar: thumbnails render and navigate; the fixture has no outline.
    await page.getByRole('button', { name: 'Show or hide the sidebar' }).click()
    const thumbnails = page.locator('.pdf-reader-thumbnail')
    await expect(thumbnails).toHaveCount(2)
    await expect(thumbnails.nth(1)).toHaveAttribute('aria-current', 'page')
    await expect(thumbnails.nth(0).locator('canvas')).toHaveCount(1)
    await thumbnails.nth(0).click()
    await expect(viewer).toHaveAttribute('data-current-page', '1')
    await page.getByRole('tab', { name: 'Outline' }).click()
    await expect(page.locator('.pdf-reader-outline')).toContainText('This PDF has no outline.')

    // Dark pages: off with the light theme, inverts the rendered pages when toggled.
    const darkPages = page.getByRole('button', { name: 'Dark pages' })
    await expect(darkPages).toHaveAttribute('aria-pressed', 'false')
    await darkPages.click()
    await expect(page.locator('.pdf-reader-canvas').first()).toHaveCSS('filter', 'invert(1) hue-rotate(180deg)')

    expect(problems).toEqual([])
    await expectNoRendererErrors(app)
  })

  test('shows a localized error for a damaged PDF', async() => {
    vaultDir = copyVault()
    fs.writeFileSync(path.join(vaultDir, 'broken.pdf'), 'This is not a PDF file.\n')
    const notePath = path.join(vaultDir, 'Broken.md')
    fs.writeFileSync(notePath, '[broken](broken.pdf)\n')
    const launched = await launchVault(vaultDir, notePath, 'pt')
    app = launched.app
    const { page } = launched
    await page.waitForSelector('span.mu-link', { state: 'attached' })

    expect(await modifierClickLink(page, '[broken](broken.pdf)')).toBe(true)
    const viewer = page.locator('.pdf-reader')
    await expect(viewer).toHaveAttribute('data-status', 'error', { timeout: 20000 })
    await expect(page.locator('.pdf-reader-message')).toContainText('Não foi possível abrir este PDF')
    await expect(page.locator('.pdf-reader-message')).toContainText('O arquivo está corrompido ou não é um PDF válido.')
    await expect(page.getByRole('button', { name: 'Página anterior' })).toBeDisabled()
    await expectNoRendererErrors(app)
  })
})
