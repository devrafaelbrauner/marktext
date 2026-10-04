import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { launchElectron } from './helpers'

// The dataview plugin is enabled by default. Every test works on a copy of the
// fixture vault and opens `Queries/Open Tasks.md`, whose first block is a
// TASK query over #project and whose second block is a TABLE over "Projects".
const fixtureVault = path.resolve(__dirname, '../fixtures/vault')

const createVault = (): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'marktext-dataview-'))
  fs.cpSync(fixtureVault, dir, { recursive: true })
  return dir
}

// Opening a directory can attach to a window other than the first one.
const launchFolder = async(folder: string, language: 'en' | 'pt'): Promise<{ app: ElectronApplication; page: Page }> => {
  const launched = await launchElectron([folder], { preferences: { language } })
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

const openQueryNote = async(page: Page): Promise<void> => {
  await page.locator('.side-bar-folder > .folder-name', { hasText: 'Queries' }).click()
  await page.locator('.side-bar-file', { hasText: 'Open Tasks.md' }).click()
  await expect(page.locator('.editor-component .mu-code-block-preview .dataview')).toHaveCount(2, { timeout: 15000 })
}

test.describe('Dataview plugin', () => {
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

  test('the TABLE block lists the Projects folder with a localized file column', async() => {
    const launched = await launchFolder(vault, 'pt')
    app = launched.app
    const page = launched.page
    await openQueryNote(page)

    const table = page.locator('.mu-code-block-preview table.dataview-table')
    await expect(table.locator('thead th')).toHaveText(['Arquivo', 'status', 'priority'], { timeout: 15000 })
    await expect(table.locator('tbody tr')).toHaveCount(3)
    const rows = await table.locator('tbody tr').evaluateAll((trs) =>
      trs.map((tr) => Array.from(tr.querySelectorAll('td')).map((td) => td.textContent))
    )
    expect(rows).toEqual([
      ['Alpha', 'active', '1'],
      ['Beta', 'planned', '-'],
      ['Kanban Board', '-', '-']
    ])

    // The file column links to the note: it opens in the active tab.
    await table.locator('a.dataview-link', { hasText: 'Beta' }).click()
    await expect(page.locator('.editor-tabs li.active')).toHaveText('Beta.md', { timeout: 10000 })
    await expect(page.locator('.editor-tabs li.active')).toHaveAttribute('title', /[/\\]Projects[/\\]Beta\.md$/)
  })

  test('toggling a TASK checkbox writes the note and refreshes the results', async() => {
    const launched = await launchFolder(vault, 'en')
    app = launched.app
    const page = launched.page
    await openQueryNote(page)

    const tasks = page.locator('.mu-code-block-preview .dataview-tasks')
    await expect(tasks.locator('.dataview-task-file')).toHaveText(['Alpha', 'Beta'], { timeout: 15000 })
    await expect(tasks.locator('.dataview-task-text')).toHaveText([
      'Write the specification [due:: 2026-10-05] #project/alpha',
      'Review Beta integration [due:: 2026-10-08]',
      'Draft the plan [due:: 2026-10-15]'
    ])

    const checkbox = tasks.getByRole('checkbox', { name: 'Task: Draft the plan [due:: 2026-10-15]' })
    await checkbox.check()

    const betaFile = path.join(vault, 'Projects', 'Beta.md')
    await expect.poll(() => fs.readFileSync(betaFile, 'utf-8'), { timeout: 10000 }).toContain('- [x] Draft the plan [due:: 2026-10-15]')
    expect(fs.readFileSync(betaFile, 'utf-8')).not.toContain('- [ ] Draft the plan')

    // WHERE !completed drops the task once the index saw the change.
    await expect(tasks.locator('.dataview-task-file')).toHaveText(['Alpha'], { timeout: 15000 })
    await expect(tasks.locator('.dataview-task-text')).toHaveCount(2)
  })
})
