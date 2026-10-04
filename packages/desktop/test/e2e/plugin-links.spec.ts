import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { launchElectron } from './helpers'

// Links plugin against a copy of the fixture vault: rendering, Ctrl/Cmd-click
// navigation, `[[` completion, the backlinks panel and link updates after a
// sidebar rename.

const FIXTURE_VAULT = path.resolve(__dirname, '../fixtures/vault')
const MOD = process.platform === 'darwin' ? 'Meta' : 'Control'

type StoreMap = Map<string, Record<string, unknown>>

const withStore = <T>(page: Page, id: string, fn: string, arg?: unknown): Promise<T> =>
  page.evaluate(
    ({ storeId, body, value }) => {
      const root = document.querySelector('#app') as
        | (Element & { __vue_app__?: { config?: { globalProperties?: Record<string, unknown> } } })
        | null
      const pinia = root?.__vue_app__?.config?.globalProperties?.$pinia as { _s?: StoreMap } | undefined
      const store = pinia?._s?.get(storeId)
      // eslint-disable-next-line no-new-func -- the body is a literal from this spec
      return new Function('store', 'value', body)(store, value)
    },
    { storeId: id, body: fn, value: arg }
  )

const currentMarkdown = (page: Page): Promise<string> =>
  withStore<string>(page, 'editor', 'return store.currentFile ? store.currentFile.markdown : ""')

const activeTabTitle = (page: Page): Promise<string> =>
  page.evaluate(() => document.querySelector('.tabs-container > li.active')?.textContent?.trim() ?? '')

test.describe('Links plugin', () => {
  let app: ElectronApplication
  let page: Page
  let vault: string

  test.beforeAll(async() => {
    vault = fs.mkdtempSync(path.join(os.tmpdir(), 'marktext-links-'))
    fs.cpSync(FIXTURE_VAULT, vault, { recursive: true })
    const launched = await launchElectron([vault], { preferences: { language: 'en' } })
    app = launched.app
    page = launched.page
    await expect
      .poll(
        async() => {
          for (const candidate of app.windows()) {
            if (await candidate.locator('.side-bar-file').count()) {
              page = candidate
              return true
            }
          }
          return false
        },
        { timeout: 20000 }
      )
      .toBe(true)
    await page.locator(`.side-bar-file[title="${path.join(vault, 'Home.md')}"]`).click()
    await expect(page.locator('span.mu-inline-wikilink').first()).toBeVisible({ timeout: 15000 })
  })

  test.afterAll(async() => {
    if (app) await app.close()
    if (vault) fs.rmSync(vault, { recursive: true, force: true })
  })

  test('renders the alias of a wikilink and hides the target', async() => {
    const link = page.locator('span.mu-inline-wikilink[data-target="Projects/Alpha"]:not([data-embed])')
    await expect(link).toHaveAttribute('data-alias', 'Project Alpha')
    await expect(link.locator('.mu-inline-rule')).toHaveText('Project Alpha')
    await expect(link).toHaveText('[[Projects/Alpha|Project Alpha]]')
    await expect(page.locator('.mu-links-unresolved', { hasText: 'Missing Note' })).toBeVisible()
  })

  test('typing [[Proj completes a note link', async() => {
    const paragraph = page.locator('[contenteditable="true"] p', { hasText: 'Welcome to the test vault.' }).first()
    await paragraph.click()
    await page.keyboard.press('End')
    await page.keyboard.type(' [[Proj')
    const items = page.locator('.mu-completion-picker li.item')
    await expect(items.first()).toBeVisible({ timeout: 10000 })
    await expect(page.locator('.mu-completion-picker li.item .label', { hasText: 'Alpha' })).toBeVisible()
    // Path matches rank by name length: Beta, Alpha, Kanban Board.
    await expect(items.nth(0)).toContainText('Beta')
    await expect(items.nth(2)).toContainText('Kanban Board')
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('Enter')
    await expect(page.locator('span.mu-inline-wikilink[data-target="Kanban Board"]')).toBeVisible()
    await expect.poll(() => currentMarkdown(page), { timeout: 10000 }).toContain('Welcome to the test vault. #moc [[Kanban Board]]')
  })

  test('Ctrl/Cmd-click opens the linked note', async() => {
    await page.locator('span.mu-inline-wikilink[data-target="Beta"] .mu-inline-rule').last().click({ modifiers: [MOD] })
    await expect.poll(() => activeTabTitle(page), { timeout: 10000 }).toContain('Beta')
  })

  test('backlinks panel lists the notes linking to the active note', async() => {
    await page.locator('.left-column li[title="Backlinks"]').click()
    const linked = page.locator('[data-testid="links-linked"]')
    await expect(linked).toBeVisible({ timeout: 15000 })
    await expect(linked.locator('.links-backlinks-source', { hasText: 'Home' })).toBeVisible()
    await expect(linked.locator('.links-backlinks-source', { hasText: 'Alpha' })).toBeVisible()
    await expect(linked).toContainText('[[Beta]] depends on it.')
  })

  test('renaming a note in the sidebar rewrites links in other notes', async() => {
    await page.locator('.tabs-container > li', { hasText: 'Home' }).click()
    await expect.poll(() => activeTabTitle(page)).toContain('Home')
    const beta = path.join(vault, 'Projects', 'Beta.md')
    await withStore(page, 'project', 'store.renameCache = value; store.RENAME_IN_SIDEBAR("Gamma.md")', beta)
    const dialog = page.locator('.links-plugin-dialog')
    await expect(dialog).toBeVisible({ timeout: 15000 })
    await expect(dialog).toContainText('Projects/Alpha.md')
    await dialog.locator('.el-button--primary').click()

    const alpha = path.join(vault, 'Projects', 'Alpha.md')
    await expect.poll(() => fs.readFileSync(alpha, 'utf-8'), { timeout: 10000 }).toContain('- [ ] Review [[Gamma]] integration')
    // Home is open in a tab: the rewrite lands there as an unsaved edit.
    await expect.poll(() => currentMarkdown(page), { timeout: 10000 }).toContain('- [[Gamma]] depends on it.')
    expect(fs.readFileSync(path.join(vault, 'Home.md'), 'utf-8')).toContain('- [[Beta]] depends on it.')
  })
})
