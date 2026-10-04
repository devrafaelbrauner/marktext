import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { launchElectron, sendIpcToRenderer, type LaunchOptions } from './helpers'

// The daily-notes plugin is enabled by default; settings come from plugins.json.
const fixtureVault = path.resolve(__dirname, '../fixtures/vault')

const localDateKey = (date = new Date()): string =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`

const createVault = (): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'marktext-daily-notes-'))
  // Home.md sits at the root so the file tree shows a `.side-bar-file` without expanding folders.
  for (const entry of ['Daily', 'Templates', 'Home.md']) {
    fs.cpSync(path.join(fixtureVault, entry), path.join(dir, entry), { recursive: true })
  }
  return dir
}

// Opening a directory can attach to a window other than the first one.
const launchFolder = async(folder: string, options: LaunchOptions): Promise<{ app: ElectronApplication; page: Page }> => {
  const launched = await launchElectron([folder], options)
  let page = launched.page
  await expect
    .poll(
      async() => {
        for (const candidate of launched.app.windows()) {
          if (await candidate.locator('.side-bar-file').count()) {
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

const runCommand = async(app: ElectronApplication, page: Page, title: string): Promise<void> => {
  await sendIpcToRenderer(app, 'mt::show-command-palette')
  const input = page.locator('.search-wrapper input.search, input.search').first()
  await expect(input).toBeVisible({ timeout: 5000 })
  // The palette filters on keyup, so the query must be typed (fill() fires no key events).
  await input.pressSequentially(title, { delay: 10 })
  await expect(page.locator('.command-palette li.active .title, li.active .title').first()).toHaveText(title, {
    timeout: 5000
  })
  await input.press('Enter')
}

test.describe('Daily notes plugin', () => {
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

  test('"Abrir nota de hoje" creates today\'s note from the template', async() => {
    const launched = await launchFolder(vault, {
      preferences: { language: 'pt' },
      plugins: { settings: { 'daily-notes': { folder: 'Journal', template: 'Templates/Daily Template' } } }
    })
    app = launched.app
    const page = launched.page
    const today = localDateKey()
    const notePath = path.join(vault, 'Journal', `${today}.md`)
    expect(fs.existsSync(notePath)).toBe(false)

    await runCommand(app, page, 'Abrir nota de hoje')

    await expect.poll(() => fs.existsSync(notePath), { timeout: 10000 }).toBe(true)
    expect(fs.readFileSync(notePath, 'utf-8')).toBe(`# ${today}\n\nmood::\n\n- [ ] First task\n`)
    await expect(page.locator('.editor-component h1').first()).toContainText(today, { timeout: 10000 })
  })

  test('the calendar marks an existing fixture day and opens it', async() => {
    const launched = await launchFolder(vault, {
      preferences: { language: 'en' },
      plugins: { settings: { 'daily-notes': { folder: 'Daily' } } }
    })
    app = launched.app
    const page = launched.page

    await runCommand(app, page, 'Open calendar')
    const calendar = page.locator('.daily-notes-calendar')
    await expect(calendar).toBeVisible({ timeout: 5000 })

    // Walk from the current month to October 2026, where the fixture notes are.
    const now = new Date()
    const months = (2026 - now.getFullYear()) * 12 + (9 - now.getMonth())
    const step = calendar.getByRole('button', { name: months > 0 ? 'Next month' : 'Previous month' })
    for (let i = 0; i < Math.abs(months); i++) await step.click()
    await expect(calendar.locator('.dn-month')).toHaveText('October 2026')

    const fixtureDay = calendar.locator('[data-date="2026-10-02"]')
    await expect(fixtureDay.locator('.dn-dot')).toHaveCount(1, { timeout: 15000 })
    await expect(fixtureDay).toHaveAttribute('aria-label', /^Friday, October 2, 2026, daily note, \d+ words$/)

    const emptyDay = localDateKey() === '2026-10-20' ? '2026-10-21' : '2026-10-20'
    await expect(calendar.locator(`[data-date="${emptyDay}"] .dn-dot`)).toHaveCount(0)

    await fixtureDay.click()
    await expect(page.locator('.editor-component h1').first()).toContainText('2026-10-02', { timeout: 10000 })
    expect(fs.existsSync(path.join(vault, 'Daily', `${emptyDay}.md`))).toBe(false)
  })
})
