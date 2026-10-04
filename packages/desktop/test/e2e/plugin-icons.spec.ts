import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import { getMarkdownContent, launchWithMarkdown, placeCaretInEditor } from './helpers'

// The icons plugin is enabled by default: no plugins.json needed.
test.describe('Icons plugin', () => {
  let app: ElectronApplication
  let page: Page

  test.beforeEach(async() => {
    const launched = await launchWithMarkdown('Start\n', { preferences: { language: 'en' } })
    app = launched.app
    page = launched.page
    await placeCaretInEditor(page)
  })

  test.afterEach(async() => {
    if (app) await app.close()
  })

  test('completes a Lucide shortcode and draws the icon with CSS', async() => {
    await page.keyboard.type(' :lucide-hou', { delay: 20 })

    // The first completion needs the lazily loaded icon set.
    const firstItem = page.locator('.mu-completion-picker-wrapper li.item').first()
    await expect(firstItem.locator('.label')).toHaveText('house', { timeout: 10000 })
    await page.keyboard.press('Enter')

    const paragraph = page.locator('.editor-component span.mu-paragraph-content').first()
    await expect(paragraph).toHaveText('Start :lucide-house:')
    await page.keyboard.type(' done', { delay: 20 })

    const token = paragraph.locator('span.mu-inline-icon[data-icon="house"]')
    await expect(token).toHaveCount(1)
    await expect(token).toHaveText(':lucide-house:')
    await expect
      .poll(() =>
        token.evaluate((element) => getComputedStyle(element, '::before').maskImage)
      )
      .toContain('data:image/svg+xml')
    expect(await token.evaluate((element) => getComputedStyle(element, '::before').width)).not.toBe('0px')

    const markdown = await getMarkdownContent(page, app)
    expect(markdown.trim()).toBe('Start :lucide-house: done')
  })

  test('leaves unknown shortcodes as plain text', async() => {
    await page.keyboard.type(' :lucide-not-an-icon: x', { delay: 20 })
    const paragraph = page.locator('.editor-component span.mu-paragraph-content').first()
    await expect(paragraph).toHaveText('Start :lucide-not-an-icon: x')
    await expect(paragraph.locator('span.mu-inline-icon')).toHaveCount(0)
  })
})
