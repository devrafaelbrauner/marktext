import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { launchElectron, launchWithMarkdown } from './helpers'

const WORD_COUNTER = path.resolve(__dirname, '../fixtures/community-plugins/word-counter')
const PROBE = path.resolve(__dirname, '../fixtures/community-plugins/probe')
const MARKDOWN = '# Alpha\n\none two three\n\n## Beta\n\nfour five\n'

const openPlugins = async(app: ElectronApplication): Promise<Page> => {
  const settingsWindow = app.waitForEvent('window')
  await app.evaluate(({ ipcMain }) => {
    ipcMain.emit('app-create-settings-window', 'plugins')
  })
  const settings = await settingsWindow
  await settings.waitForLoadState('domcontentloaded')
  await expect(settings.getByRole('heading', { name: 'Plugins' })).toBeVisible({ timeout: 15000 })
  await expect(settings.locator('[data-testid="community-plugins"]')).toBeVisible({ timeout: 15000 })
  return settings
}

const mockOpenDialog = async(app: ElectronApplication, folder: string): Promise<void> => {
  await app.evaluate(({ dialog }, selected) => {
    dialog.showOpenDialog = async() => ({ canceled: false, filePaths: [selected] })
  }, folder)
}

const editorWindow = async(app: ElectronApplication): Promise<Page> => {
  for (const page of app.windows()) {
    if (await page.locator('.editor-component, .mu-editor').count()) return page
  }
  return app.windows()[0]
}

test.describe('Community plugins', () => {
  test('installs the example, consents, runs the command and renders the panel', async() => {
    const launched = await launchWithMarkdown(MARKDOWN, { preferences: { language: 'en' } })
    const { app } = launched
    try {
      await mockOpenDialog(app, WORD_COUNTER)
      const settings = await openPlugins(app)
      await settings.locator('[data-testid="community-install-folder"]').click()
      const card = settings.locator('[data-testid="community-plugin-word-counter"]')
      await expect(card).toBeVisible({ timeout: 15000 })
      await expect(card).toContainText('Word counter')
      await expect(card).toContainText('MarkText Plus')
      await expect(card).toContainText('Read the open document')
      await settings.locator('[data-testid="community-enable-word-counter"]').click()
      await expect(settings.locator('[data-testid="community-consent"]')).toBeVisible()
      await settings.locator('[data-testid="community-consent-confirm"]').click()
      await expect(settings.locator('[data-testid="community-enable-word-counter"]')).toHaveClass(/is-checked/, { timeout: 10000 })
      await settings.close()

      const page = await editorWindow(app)
      await page.locator('.left-column li[title="Word count"]').click({ timeout: 15000 })
      const panel = page.frameLocator('iframe.community-panel-frame')
      await expect(panel.locator('[data-title="Alpha"] .count')).toHaveText('3', { timeout: 15000 })
      await expect(panel.locator('[data-title="Beta"] .count')).toHaveText('2')

      await app.evaluate(({ BrowserWindow }) => {
        for (const win of BrowserWindow.getAllWindows()) {
          if (!win.isDestroyed()) win.webContents.send('mt::show-command-palette')
        }
      })
      await page.bringToFront()
      const search = page.locator('.search-wrapper input.search, input.search').first()
      await expect(search).toBeVisible({ timeout: 10000 })
      await search.fill('Count words in sections')
      await page.locator('.command-palette li, .el-dialog li', { hasText: 'Count words in sections' }).first().click()
      await expect(page.locator('.mt-notification')).toContainText('Counted 5 words', { timeout: 10000 })
    } finally {
      await app.close()
    }
  })

  test('a probe cannot reach the host, and a method without permission is rejected', async() => {
    const launched = await launchWithMarkdown('Probe\n', { preferences: { language: 'en' } })
    const { app } = launched
    try {
      await mockOpenDialog(app, PROBE)
      const settings = await openPlugins(app)
      await settings.locator('[data-testid="community-install-folder"]').click()
      await expect(settings.locator('[data-testid="community-plugin-probe"]')).toBeVisible({ timeout: 15000 })
      await settings.locator('[data-testid="community-enable-probe"]').click()
      await settings.locator('[data-testid="community-consent-confirm"]').click()
      const page = await editorWindow(app)
      const notice = page.locator('.mt-notification', { hasText: 'electron' })
      await expect(notice).toContainText('"electron":false', { timeout: 15000 })
      await expect(notice).toContainText('"parentDocument":"throw"')
      await expect(notice).toContainText('"hostDom":"throw"')
      await expect(notice).toContainText('"fetch":"throw"')
      await expect(notice).toContainText('"netFetch":"PERMISSION_DENIED"')
      await expect(notice).toContainText('"editorRead":"PERMISSION_DENIED"')
    } finally {
      await app.close()
    }
  })

  test('uninstall removes the plugin folder', async() => {
    const launched = await launchWithMarkdown(MARKDOWN, { preferences: { language: 'en' } })
    const { app, userDataDir } = launched
    try {
      await mockOpenDialog(app, WORD_COUNTER)
      const settings = await openPlugins(app)
      await settings.locator('[data-testid="community-install-folder"]').click()
      await expect(settings.locator('[data-testid="community-plugin-word-counter"]')).toBeVisible({ timeout: 15000 })
      await settings.locator('[data-testid="community-uninstall-word-counter"]').click()
      await settings.locator('[data-testid="community-uninstall-confirm"]').click()
      await expect(settings.locator('[data-testid="community-plugin-word-counter"]')).toHaveCount(0, { timeout: 10000 })
      expect(fs.existsSync(path.join(userDataDir, 'plugins', 'word-counter'))).toBe(false)
    } finally {
      await app.close()
    }
  })

  test('--safe keeps an enabled community plugin off', async() => {
    const seeded = await launchElectron([], { preferences: { language: 'en' } })
    const { userDataDir } = seeded
    await seeded.app.close()
    fs.mkdirSync(path.join(userDataDir, 'plugins'), { recursive: true })
    fs.cpSync(WORD_COUNTER, path.join(userDataDir, 'plugins', 'word-counter'), { recursive: true })
    fs.writeFileSync(path.join(userDataDir, 'plugins.json'), JSON.stringify({
      enabled: { 'word-counter': true },
      settings: {}
    }))
    const safe = await launchElectron(['--safe'], { userDataDir, preferences: { language: 'en' } })
    try {
      const state = await safe.page.evaluate(() => window.plugins.getState())
      expect(state.safeMode).toBe(true)
      expect(state.enabled['word-counter']).toBe(true)
      expect(await safe.page.locator('iframe.community-plugin-frame').count()).toBe(0)
    } finally {
      await safe.app.close()
    }
  })
})
