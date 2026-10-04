import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import * as fs from 'node:fs'
import * as http from 'node:http'
import type { AddressInfo } from 'node:net'
import * as os from 'node:os'
import * as path from 'node:path'
import { launchElectron, sendIpcToRenderer, waitForEditor, waitForMenuReady } from './helpers'

const ONE_BY_ONE_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

const created: string[] = []

const tempDir = (): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'marktext-e2e-mtfile-'))
  created.push(dir)
  return dir
}

test.afterAll(() => {
  for (const dir of created) fs.rmSync(dir, { recursive: true, force: true })
})

const waitForImage = async(page: Page): Promise<string> => {
  await expect
    .poll(async() => page.locator('.editor-component .mu-inline-image.mu-image-success').count(), {
      timeout: 10000
    })
    .toBeGreaterThanOrEqual(1)
  const src = await page.locator('.editor-component .mu-image-container img').first().getAttribute('src')
  expect(src).toBeTruthy()
  return src as string
}

test.describe('Local images with webSecurity on', () => {
  test('renders an absolute local image through mt-file', async() => {
    const dir = tempDir()
    const imagePath = path.join(dir, 'absolute.png')
    fs.writeFileSync(imagePath, Buffer.from(ONE_BY_ONE_PNG_BASE64, 'base64'))
    const docPath = path.join(dir, 'note.md')
    const markdownPath = imagePath.replace(/\\/g, '/')
    fs.writeFileSync(docPath, `![abs](${markdownPath})\n`, 'utf-8')

    const { app, page } = await launchElectron([docPath], { preferences: { language: 'en' } })
    try {
      await waitForEditor(page)
      const src = await waitForImage(page)
      const url = new URL(src)
      expect(url.protocol).toBe('mt-file:')
      expect(url.hostname).toBe('local')
      expect(url.pathname).toBe(markdownPath)
    } finally {
      await app.close()
    }
  })

  test('a //127.0.0.1 image does not contact a local server', async() => {
    // `//127.0.0.1:port/x.png` looks like a protocol-relative URL but is also
    // a UNC path. The engine must not turn it into a network fetch (which
    // would leak NTLM credentials on Windows); it renders nothing instead.
    const requests: string[] = []
    const server = http.createServer((req, res) => {
      requests.push(req.url ?? '')
      res.writeHead(200, { 'Content-Type': 'image/png' })
      res.end(Buffer.from(ONE_BY_ONE_PNG_BASE64, 'base64'))
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const { port } = server.address() as AddressInfo
    const dir = tempDir()
    const docPath = path.join(dir, 'note.md')
    fs.writeFileSync(docPath, `![probe](//127.0.0.1:${port}/x.png)\n`, 'utf-8')

    const { app, page } = await launchElectron([docPath], { preferences: { language: 'en' } })
    try {
      await waitForEditor(page)
      await page.waitForTimeout(1500)
      expect(await page.locator('.editor-component .mu-image-container img').count()).toBe(0)
      expect(requests).toEqual([])
    } finally {
      await app.close()
      await new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()))
    }
  })
})

test.describe('HTML export still links local images', () => {
  let app: ElectronApplication
  let page: Page
  let docDir: string

  test.beforeAll(async() => {
    docDir = tempDir()
    fs.mkdirSync(path.join(docDir, 'assets'))
    fs.writeFileSync(
      path.join(docDir, 'assets', 'cat.png'),
      Buffer.from(ONE_BY_ONE_PNG_BASE64, 'base64')
    )
    const docPath = path.join(docDir, 'note.md')
    fs.writeFileSync(docPath, '![a cat](assets/cat.png)\n', 'utf-8')
    const launched = await launchElectron([docPath], { preferences: { language: 'en' } })
    app = launched.app
    page = launched.page
    await waitForEditor(page)
    await waitForMenuReady(app)
    await waitForImage(page)
  })

  test.afterAll(async() => {
    if (app) await app.close()
  })

  test('writes file:// or a data URI, not an mt-file URL', async() => {
    const out = path.join(docDir, 'export.html')
    await app.evaluate(async({ dialog }, savePath) => {
      dialog.showSaveDialog = async() => ({ canceled: false, filePath: savePath })
    }, out)
    await sendIpcToRenderer(app, 'mt::show-export-dialog', 'styledHtml')
    const confirm = page.locator('.print-settings-dialog .button-primary')
    await confirm.waitFor({ state: 'visible', timeout: 10000 })
    await confirm.click()

    await expect.poll(() => fs.existsSync(out), { timeout: 20000 }).toBe(true)
    const html = fs.readFileSync(out, 'utf-8')
    expect(html).not.toContain('mt-file:')
    expect(html.includes('file://') || html.includes('data:image/')).toBe(true)
    expect(html).toContain('cat.png')
  })
})
