import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { launchElectron } from './helpers'

// The tags plugin is enabled by default. Every test works on a copy of the
// fixture vault plus an empty `Scratch.md` to type into.
const fixtureVault = path.resolve(__dirname, '../fixtures/vault')

const createVault = (): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'marktext-tags-'))
  fs.cpSync(fixtureVault, dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'Scratch.md'), '', 'utf-8')
  return dir
}

// Opening a directory can attach to a window other than the first one, and a
// window may also show the app's project folder: pick the one listing the
// vault's `Scratch.md`.
const launchFolder = async(folder: string): Promise<{ app: ElectronApplication; page: Page }> => {
  const launched = await launchElectron([folder], { preferences: { language: 'pt' } })
  let page = launched.page
  await expect
    .poll(
      async() => {
        for (const candidate of launched.app.windows()) {
          if (await candidate.locator('.side-bar-file', { hasText: 'Scratch.md' }).count()) {
            page = candidate
            return true
          }
        }
        return false
      },
      { timeout: 15000 }
    )
    .toBe(true)
  return { app: launched.app, page }
}

const openTagsPanel = async(page: Page): Promise<void> => {
  await page.locator('.side-bar .left-column li[title="Tags"]').click()
  await expect(page.locator('.tags-panel')).toBeVisible({ timeout: 5000 })
  // Rows appear once the vault index finished its first scan.
  await expect(page.locator('.tags-row').first()).toBeVisible({ timeout: 15000 })
}

const row = (page: Page, tag: string) => page.locator(`.tags-row[data-tag="${tag}"]`)

test.describe('Tags plugin', () => {
  let app: ElectronApplication | undefined
  let vault: string

  test.beforeEach(() => {
    vault = createVault()
  })

  test.afterEach(async() => {
    if (app) await app.close()
    app = undefined
    fs.rmSync(vault, { recursive: true, force: true })
  })

  test('`#reuni` at a paragraph start stays a paragraph and completes to a known tag', async() => {
    const launched = await launchFolder(vault)
    app = launched.app
    const page = launched.page
    // The Tags panel replaces the file tree in the sidebar: open the note first.
    await page.locator('.side-bar-file', { hasText: 'Scratch.md' }).click()
    // The panel loads the known tags the completion offers.
    await openTagsPanel(page)
    await expect(row(page, 'reunião')).toBeVisible()

    await page.locator('.editor-component').click()
    await page.keyboard.type('#reuni', { delay: 30 })

    const editor = page.locator('.editor-component')
    await expect(editor.locator('h1')).toHaveCount(0)
    const item = page.locator('.mu-completion-picker-wrapper .mu-completion-picker li.item').first()
    await expect(item.locator('.label')).toHaveText('#reunião', { timeout: 5000 })
    await page.keyboard.press('Enter')

    await expect(editor.locator('h1')).toHaveCount(0)
    const tag = editor.locator('p span.mu-inline-hashtag')
    await expect(tag).toHaveText('#reunião')
    await expect(tag).toHaveAttribute('data-tag', 'reunião')

    // Ctrl/Cmd-click reveals the panel filtered to that tag, with its notes.
    await tag.click({ modifiers: [process.platform === 'darwin' ? 'Meta' : 'Control'] })
    await expect(page.locator('.tags-filter input')).toHaveValue('reunião')
    await expect(page.locator('.tags-notes-title')).toHaveText('Notas com #reunião')
    await expect(page.locator('.tags-note-name')).toContainText(['Tags Edge Cases'])
  })

  test('the panel shows nested tags with note counts', async() => {
    const launched = await launchFolder(vault)
    app = launched.app
    const page = launched.page
    await openTagsPanel(page)

    await expect(row(page, 'daily').locator('.tags-count')).toHaveText('3')
    await expect(row(page, 'project').locator('.tags-count')).toHaveText('2')
    await expect(row(page, 'project').locator('.tags-count')).toHaveAttribute('aria-label', '2 notas')
    // A parent counts the notes having it or any nested tag.
    await expect(row(page, 'archive').locator('.tags-count')).toHaveText('2')
    await expect(row(page, 'archive/2025')).toHaveCount(0)

    await page.getByRole('button', { name: 'Expandir tudo' }).click()
    await expect(row(page, 'archive/2025').locator('.tags-count')).toHaveText('1')
    await expect(row(page, 'a/b/c')).toHaveAttribute('aria-level', '3')

    await page.locator('.tags-filter input').fill('alpha')
    await expect(page.locator('.tags-row')).toHaveCount(2)
    await expect(row(page, 'project/alpha').locator('.tags-count')).toHaveText('1')
  })

  test('renaming a tag previews and rewrites another note on disk', async() => {
    const launched = await launchFolder(vault)
    app = launched.app
    const page = launched.page
    await page.locator('.side-bar-file', { hasText: 'Scratch.md' }).click()
    await openTagsPanel(page)

    await row(page, 'idea').click()
    await page.getByRole('button', { name: 'Renomear tag…' }).click()
    const dialog = page.getByRole('dialog', { name: 'Renomear tag' })
    await expect(dialog).toBeVisible()
    const inputs = dialog.locator('input')
    await expect(inputs.nth(0)).toHaveValue('idea')
    await inputs.nth(1).fill('pensamento')
    await dialog.getByRole('button', { name: 'Pré-visualizar' }).click()

    await expect(dialog.locator('.tags-rename-status')).toHaveText(
      '#idea → #pensamento: 4 ocorrência(s) em 1 nota(s).',
      { timeout: 10000 }
    )
    await expect(dialog.locator('.tags-rename-files li')).toHaveText([/^Ideas\s*4×$/])
    await dialog.getByRole('button', { name: 'Renomear', exact: true }).click()
    await expect(dialog).toBeHidden({ timeout: 10000 })

    const ideas = path.join(vault, 'Ideas.md')
    await expect
      .poll(() => fs.readFileSync(ideas, 'utf-8'), { timeout: 10000 })
      .toContain('tags: pensamento, pensamento/product\n')
    const content = fs.readFileSync(ideas, 'utf-8')
    expect(content).toContain('names #pensamento/research and #pensamento in another case. ^idea-1')
    expect(content).toContain('- First idea about [[Projects/Alpha]]')

    // The index picks the change up and the panel follows.
    await expect(row(page, 'pensamento').locator('.tags-count')).toHaveText('1', { timeout: 10000 })
    await expect(row(page, 'idea')).toHaveCount(0)
  })
})
