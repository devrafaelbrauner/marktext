import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { getMarkdownContent, launchElectron, launchWithMarkdown, sendIpcToRenderer, waitForMenuReady } from './helpers'

const FIXTURE_BOARD = path.resolve(__dirname, '../fixtures/vault/Projects/Kanban Board.md')

const openBoard = async(language: 'en' | 'pt'): Promise<{ app: ElectronApplication; page: Page; file: string }> => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'marktext-e2e-kanban-'))
  const file = path.join(dir, 'Kanban Board.md')
  fs.copyFileSync(FIXTURE_BOARD, file)
  // The folder scopes plugin file access (the new board is created next to the board).
  const { app } = await launchElectron([dir, file], { preferences: { language } })
  await waitForMenuReady(app)
  // The app folder Playwright passes as entry point is a path argument too and
  // may open in a window of its own: keep only the window showing the board.
  let page: Page | null = null
  await expect
    .poll(
      async() => {
        for (const candidate of app.windows()) {
          if ((await candidate.locator('.kanban-view .kanban-lane').count().catch(() => 0)) > 0) page = candidate
        }
        return page !== null
      },
      { timeout: 15000 }
    )
    .toBe(true)
  await app.evaluate(async({ BrowserWindow }) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!(await win.webContents.executeJavaScript("!!document.querySelector('.kanban-view')"))) win.destroy()
    }
  })
  if (!page) throw new Error('No window shows the board')
  return { app, page, file }
}

const laneTitles = (page: Page): Promise<string[]> =>
  page.locator('.kanban-lane .kanban-lane-title').allTextContents().then((titles) => titles.map((title) => title.trim()))

const cardTexts = (page: Page, lane: string): Promise<string[]> =>
  page
    .locator('.kanban-lane', { has: page.locator('.kanban-lane-title', { hasText: lane }) })
    .locator('.kanban-card .kanban-card-body')
    .allTextContents()
    .then((texts) => texts.map((text) => text.trim()))

const save = async(app: ElectronApplication, page: Page, file: string, before: string): Promise<string> => {
  await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
  await expect.poll(() => fs.readFileSync(file, 'utf8'), { timeout: 10000 }).not.toBe(before)
  await page.waitForTimeout(100)
  return fs.readFileSync(file, 'utf8')
}

const MOVED_BOARD = `---
kanban-plugin: board
---

## Todo

- [ ] Prepare demo [[Alpha]]
- [ ] Write release notes #release

## Doing

## Done

**Complete**

- [x] Set up the repository
- [x] Fix the importer

***

## Archive

- [x] Old card

%% kanban:settings

\`\`\`
{"kanban-plugin":"board","list-collapse":[false,false,false]}
\`\`\`

%%
`

test.describe('Kanban plugin', () => {
  test('opens the fixture board, drags a card to another lane and saves it', async() => {
    const { app, page, file } = await openBoard('en')
    try {
      const original = fs.readFileSync(file, 'utf8')
      expect(await laneTitles(page)).toEqual(['Todo', 'Doing', 'Done'])
      expect(await cardTexts(page, 'Todo')).toEqual(['Prepare demo Alpha', 'Write release notes #release'])
      expect(await cardTexts(page, 'Done')).toEqual(['Set up the repository'])
      await expect(page.locator('.kanban-lane', { hasText: 'Todo' }).locator('a.kanban-wikilink')).toHaveText('Alpha')
      await expect(page.locator('.kanban-lane', { hasText: 'Todo' }).locator('.kanban-tag')).toHaveText('#release')
      await expect(page.locator('.kanban-archive-toggle')).toContainText('Archive (1)')

      const card = page.locator('.kanban-card', { hasText: 'Fix the importer' })
      const target = page.locator('.kanban-lane', { has: page.locator('.kanban-lane-title', { hasText: 'Done' }) })
        .locator('.kanban-lane-cards')
      const from = (await card.boundingBox())!
      const to = (await target.boundingBox())!
      await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
      await page.mouse.down()
      await page.mouse.move(from.x + from.width / 2 + 20, from.y + from.height / 2 + 10, { steps: 5 })
      await page.mouse.move(to.x + to.width / 2, to.y + to.height - 4, { steps: 15 })
      await page.mouse.up()

      await expect.poll(() => cardTexts(page, 'Done')).toEqual(['Set up the repository', 'Fix the importer'])
      expect(await cardTexts(page, 'Doing')).toEqual([])
      await expect(page.locator('.kanban-card', { hasText: 'Fix the importer' }).locator('.kanban-card-check')).toBeChecked()

      expect(await save(app, page, file, original)).toBe(MOVED_BOARD)

      // The document view toggle shows the same markdown in the editor.
      await sendIpcToRenderer(app, 'mt::execute-command-by-id', 'view.toggle-document-view')
      await page.waitForSelector('.editor-component .mu-paragraph', { timeout: 10000 })
      await expect(page.locator('.kanban-view')).toHaveCount(0)
      const markdown = await getMarkdownContent(page, app)
      expect(markdown).toContain('- [x] Set up the repository\n- [x] Fix the importer')
      expect(markdown).not.toContain('- [ ] Fix the importer')
    } finally {
      await app.close()
    }
  })

  test('moves a card with the keyboard menu (pt)', async() => {
    const { app, page, file } = await openBoard('pt')
    try {
      const original = fs.readFileSync(file, 'utf8')
      const card = page.locator('.kanban-card', { hasText: 'Write release notes' })
      await card.focus()
      await card.locator('.kanban-menu-trigger').focus()
      await page.keyboard.press('Enter')
      const menu = page.locator('.kanban-menu')
      await expect(menu.locator('[role="menuitem"]', { hasText: 'Mover para…' })).toBeVisible()
      await menu.locator('[role="menuitem"]', { hasText: 'Mover para…' }).focus()
      await page.keyboard.press('Enter')
      await expect(menu.locator('[role="menuitem"]', { hasText: 'Doing' })).toBeFocused()
      await page.keyboard.press('Enter')
      await expect(menu).toHaveCount(0)

      await expect.poll(() => cardTexts(page, 'Doing')).toEqual(['Fix the importer', 'Write release notes #release'])
      const saved = await save(app, page, file, original)
      expect(saved).toBe(original.replace('- [ ] Write release notes #release\n', '').replace(
        '- [ ] Fix the importer\n',
        '- [ ] Fix the importer\n- [ ] Write release notes #release\n'
      ))
    } finally {
      await app.close()
    }
  })

  test('creates a new board with the command (pt)', async() => {
    const { app, page, file } = await openBoard('pt')
    try {
      await sendIpcToRenderer(app, 'mt::execute-command-by-id', 'kanban.new-board')
      const input = page.locator('.kanban-dialog input')
      await expect(input).toHaveValue('Kanban')
      await input.fill('Sprint 1')
      await page.keyboard.press('Enter')

      const created = path.join(path.dirname(file), 'Sprint 1.md')
      await expect.poll(() => fs.existsSync(created), { timeout: 10000 }).toBe(true)
      expect(fs.readFileSync(created, 'utf8')).toBe(`---
kanban-plugin: board
---

## A fazer

## Fazendo

## Concluído

**Concluído**

%% kanban:settings

\`\`\`
{"kanban-plugin":"board"}
\`\`\`

%%
`)
      await expect.poll(() => laneTitles(page), { timeout: 10000 }).toEqual(['A fazer', 'Fazendo', 'Concluído'])
      await expect(page.locator('.kanban-board-name')).toHaveText('Sprint 1')
      await expect(page.locator('.kanban-lane', { hasText: 'Concluído' }).locator('.kanban-lane-complete')).toBeVisible()
    } finally {
      await app.close()
    }
  })

  test('adds, edits and archives cards and adds a lane', async() => {
    const { app, page, file } = await openBoard('en')
    try {
      const original = fs.readFileSync(file, 'utf8')
      const doing = page.locator('.kanban-lane', { has: page.locator('.kanban-lane-title', { hasText: 'Doing' }) })
      await doing.locator('.kanban-new-card').fill('Review the PR #code')
      await doing.locator('.kanban-new-card').press('Enter')
      await expect.poll(() => cardTexts(page, 'Doing')).toEqual(['Fix the importer', 'Review the PR #code'])

      await doing.locator('.kanban-card', { hasText: 'Fix the importer' }).dblclick()
      const editor = doing.locator('.kanban-card textarea')
      await expect(editor).toHaveValue('Fix the importer')
      await editor.fill('Fix the importer @{2026-10-10}')
      await editor.press('Enter')
      await expect(doing.locator('.kanban-card').first().locator('.kanban-date')).toBeVisible()

      const todo = page.locator('.kanban-lane', { has: page.locator('.kanban-lane-title', { hasText: 'Todo' }) })
      await todo.locator('.kanban-card', { hasText: 'Prepare demo' }).locator('.kanban-menu-trigger').click()
      await page.locator('.kanban-menu [role="menuitem"]', { hasText: 'Archive' }).click()
      await expect(page.locator('.kanban-archive-toggle')).toContainText('Archive (2)')

      await page.locator('.kanban-add-lane-button').click()
      await page.locator('.kanban-add-lane-form input').fill('Review (2)')
      await page.locator('.kanban-add-lane-form input').press('Enter')
      await expect.poll(() => laneTitles(page)).toEqual(['Todo', 'Doing', 'Done', 'Review'])
      await expect(page.locator('.kanban-lane').last().locator('.kanban-lane-count')).toHaveText('0/2')

      expect(await save(app, page, file, original)).toBe(`---
kanban-plugin: board
---

## Todo

- [ ] Write release notes #release

## Doing

- [ ] Fix the importer @{2026-10-10}
- [ ] Review the PR #code

## Done

**Complete**

- [x] Set up the repository

## Review (2)

***

## Archive

- [x] Old card
- [ ] Prepare demo [[Alpha]]

%% kanban:settings

\`\`\`
{"kanban-plugin":"board","list-collapse":[false,false,false,false]}
\`\`\`

%%
`)
    } finally {
      await app.close()
    }
  })

  test('reorders lanes by dragging their handle', async() => {
    const { app, page, file } = await openBoard('en')
    try {
      const original = fs.readFileSync(file, 'utf8')
      const handle = page.locator('.kanban-lane', { has: page.locator('.kanban-lane-title', { hasText: 'Done' }) })
        .locator('.kanban-lane-handle')
      const from = (await handle.boundingBox())!
      const to = (await page.locator('.kanban-lane').first().boundingBox())!
      await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
      await page.mouse.down()
      await page.mouse.move(from.x - 20, from.y + 5, { steps: 5 })
      await page.mouse.move(to.x + 10, to.y + 20, { steps: 15 })
      await page.mouse.up()
      await expect.poll(() => laneTitles(page)).toEqual(['Done', 'Todo', 'Doing'])

      const done = '## Done\n\n**Complete**\n\n- [x] Set up the repository\n\n'
      expect(await save(app, page, file, original)).toBe(original.replace(done, '').replace('## Todo', `${done}## Todo`))
    } finally {
      await app.close()
    }
  })

  test('dims Obsidian comments in the editor without changing the text', async() => {
    const { app, page } = await launchWithMarkdown('Before %% hidden %% after\n\n%% kanban:settings\n', {
      preferences: { language: 'en' }
    })
    try {
      const comments = page.locator('.editor-component .mu-inline-obsidian-comment')
      await expect(comments).toHaveCount(2)
      await expect(comments.nth(0)).toHaveText('%% hidden %%')
      await expect(comments.nth(1)).toHaveText('%% kanban:settings')
      await expect(page.locator('.editor-component .mu-paragraph-content').first()).toHaveText('Before %% hidden %% after')
      const color = (selector: string): Promise<string> =>
        page.locator(selector).first().evaluate((element) => getComputedStyle(element).color)
      expect(await color('.editor-component .mu-inline-obsidian-comment')).not.toBe(
        await color('.editor-component .mu-paragraph-content')
      )
    } finally {
      await app.close()
    }
  })
})
