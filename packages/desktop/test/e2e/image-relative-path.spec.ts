import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { launchElectron, waitForEditor, waitForMenuReady } from './helpers'

// A relative-path image (`![](assets/cat.png)`) in a saved document must resolve
// to a DIRNAME-anchored `mt-file:` URL so Chromium can load it with webSecurity
// on. This spec drives the built app and asserts the rendered `<img>` src is
// `mt-file://local/<docDir>/assets/cat.png`, not a non-anchored path.

// A 1x1 transparent PNG so `loadImage` resolves (the engine swaps the wrapper
// to `.mu-image-success` only when the file actually loads off disk).
const ONE_BY_ONE_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

const createdDirs: string[] = []

const writeDocWithRelativeImage = (folderName = ''): { docPath: string; docDir: string } => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'marktext-e2e-relimg-'))
  createdDirs.push(tempDir)
  const docDir = path.join(tempDir, folderName)
  const assetsDir = path.join(docDir, 'assets')
  fs.mkdirSync(assetsDir, { recursive: true })
  fs.writeFileSync(path.join(assetsDir, 'cat.png'), Buffer.from(ONE_BY_ONE_PNG_BASE64, 'base64'))
  const docPath = path.join(docDir, 'note.md')
  fs.writeFileSync(docPath, '![a cat](assets/cat.png)\n', 'utf-8')
  return { docPath, docDir }
}

test.afterAll(() => {
  for (const dir of createdDirs) {
    try {
      fs.rmSync(dir, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
  }
})

test.describe('Relative-path image resolves to a DIRNAME-anchored mt-file URL', () => {
  let app: ElectronApplication | null = null
  let page: Page
  let docDir: string

  test.beforeAll(async() => {
    const written = writeDocWithRelativeImage()
    docDir = written.docDir
    const launched = await launchElectron([written.docPath])
    app = launched.app
    page = launched.page
    await waitForEditor(page)
    await waitForMenuReady(app)
  })

  test.afterAll(async() => {
    if (app) await app.close()
  })

  test('window.DIRNAME tracks the opened document directory', async() => {
    // The renderer populates window.DIRNAME from the open file's dirname; the
    // engine reads it to anchor relative image paths (image.ts getImageSrc).
    await expect
      .poll(async() => page.evaluate(() => window.DIRNAME), { timeout: 10000 })
      .toBeTruthy()
    const dirname = await page.evaluate(() => window.DIRNAME)
    // file:// URLs always use forward slashes, and so does the engine's
    // resolveRelativePath; compare against the normalised doc dir.
    expect(dirname.replace(/\\/g, '/')).toBe(docDir.replace(/\\/g, '/'))
  })

  test('renders an <img> whose src is mt-file://local/<docDir>/assets/cat.png', async() => {
    const imgLocator = page.locator('.editor-component .mu-image-container img')
    await imgLocator.first().waitFor({ state: 'attached', timeout: 10000 })

    await expect
      .poll(async() => page.locator('.editor-component .mu-inline-image.mu-image-success').count(), {
        timeout: 10000
      })
      .toBeGreaterThanOrEqual(1)

    const src = await imgLocator.first().getAttribute('src')
    expect(src).not.toBeNull()
    const url = new URL(src as string)
    expect(url.protocol).toBe('mt-file:')
    expect(url.hostname).toBe('local')
    expect(url.pathname).toBe(`${docDir.replace(/\\/g, '/')}/assets/cat.png`)
  })

  test('the anchored mt-file URL points at a file that exists on disk', async() => {
    const src = await page
      .locator('.editor-component .mu-image-container img')
      .first()
      .getAttribute('src')
    const url = new URL(src as string)
    expect(fs.existsSync(url.pathname)).toBe(true)
    expect(url.pathname).toBe(path.join(docDir, 'assets', 'cat.png').replace(/\\/g, '/'))
  })
})

test.describe('Relative-path image in a directory named with URL delimiters (#5212)', () => {
  let app: ElectronApplication | null = null
  let page: Page
  let docDir: string

  test.beforeAll(async() => {
    // `?` cannot appear in a Windows file name.
    const folderName = process.platform === 'win32' ? 'C# 100%25' : 'C# 100%25 what?'
    const written = writeDocWithRelativeImage(folderName)
    docDir = written.docDir
    const launched = await launchElectron([written.docPath])
    app = launched.app
    page = launched.page
    await waitForEditor(page)
    await waitForMenuReady(app)
  })

  test.afterAll(async() => {
    if (app) await app.close()
  })

  test('loads the image from the file next to the document', async() => {
    await expect
      .poll(async() => page.locator('.editor-component .mu-inline-image.mu-image-success').count(), {
        timeout: 10000
      })
      .toBeGreaterThanOrEqual(1)

    const src = await page
      .locator('.editor-component .mu-image-container img')
      .first()
      .getAttribute('src')
    expect(src).not.toBeNull()
    const url = new URL(src as string)
    expect(url.protocol).toBe('mt-file:')
    expect(url.hostname).toBe('local')
    expect(url.hash).toBe('')
    // `URL.pathname` keeps percent-escapes: decode once to get the file path.
    // The engine appends `?mucache=` to local loads; only `mt-file:` may do so.
    expect(decodeURIComponent(url.pathname)).toBe(
      path.join(docDir, 'assets', 'cat.png').replace(/\\/g, '/')
    )
  })
})
