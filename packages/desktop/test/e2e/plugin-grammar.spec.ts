import { expect, test, type Page } from '@playwright/test'
import * as http from 'node:http'
import type { AddressInfo } from 'node:net'
import { getMarkdownContent, launchWithMarkdown, sendIpcToRenderer, type LaunchOptions } from './helpers'

/**
 * Grammar plugin against a local fake LanguageTool server (custom server URL
 * on 127.0.0.1). The fake flags "Eu vai" like the real API does: the range
 * starts at "Eu" and ends after "vai", including markup in between
 * (`Eu **vai` for bold), with the replacement "Eu vou".
 */

interface FakeLanguageTool {
  url: string
  requests: Array<{ language: string | null; text: string }>
  close(): Promise<void>
}

const startFakeLanguageTool = async(): Promise<FakeLanguageTool> => {
  const requests: FakeLanguageTool['requests'] = []
  const server = http.createServer((req, res) => {
    let body = ''
    req.on('data', (chunk) => {
      body += chunk
    })
    req.on('end', () => {
      if (req.method !== 'POST' || req.url !== '/v2/check') {
        res.writeHead(404).end()
        return
      }
      const params = new URLSearchParams(body)
      const data = JSON.parse(params.get('data') ?? '{}') as { annotation: Array<{ text?: string; markup?: string }> }
      const text = data.annotation.map((part) => part.text ?? part.markup ?? '').join('')
      requests.push({ language: params.get('language'), text })
      const matches: unknown[] = []
      const pattern = /Eu (?:\*\*)?vai/g
      for (let found = pattern.exec(text); found; found = pattern.exec(text)) {
        matches.push({
          message: 'Possible agreement error.',
          shortMessage: 'Agreement',
          offset: found.index,
          length: found[0].length,
          replacements: [{ value: 'Eu vou' }],
          context: { text, offset: found.index, length: found[0].length },
          sentence: text,
          rule: {
            id: 'PT_VERB_AGREEMENT',
            description: 'Verb agreement',
            issueType: 'grammar',
            urls: [{ value: 'https://example.com/rule' }],
            category: { id: 'GRAMMAR', name: 'Grammar' }
          }
        })
      }
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ matches }))
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return {
    url: `http://127.0.0.1:${port}/v2`,
    requests,
    close: () => new Promise((resolve) => server.close(() => resolve()))
  }
}

/** Problems shown in the editor: a decoration crossing markup is painted as several spans sharing one id. */
const decoratedProblems = (page: Page): Promise<number> =>
  page.evaluate(() => new Set([...document.querySelectorAll('.mu-decoration-grammar')].map((el) => el.getAttribute('data-ltid'))).size)

/** The engine root carries the `spellcheck` attribute muya derives from its `spellcheckEnabled` option. */
const nativeSpellcheck = (page: Page): Promise<string | null> =>
  page.evaluate(() => document.querySelector('.editor-component[spellcheck]')?.getAttribute('spellcheck') ?? null)

const launchOptions = (lt: FakeLanguageTool, language: 'en' | 'pt', extra: Record<string, unknown> = {}): LaunchOptions => ({
  preferences: { language, spellcheckerEnabled: true },
  plugins: {
    enabled: { grammar: true },
    settings: {
      grammar: { server: 'custom', serverUrl: lt.url, consentGiven: true, debounceMs: 300, ...extra }
    }
  }
})

test.describe('Grammar plugin (LanguageTool)', () => {
  let lt: FakeLanguageTool

  test.beforeEach(async() => {
    lt = await startFakeLanguageTool()
  })

  test.afterEach(async() => {
    await lt.close()
  })

  test('decorates a problem, applies the suggestion keeping bold, and undo restores it', async() => {
    const { app, page } = await launchWithMarkdown('Eu **vai** na escola.\n', launchOptions(lt, 'en'))
    try {
      const decoration = page.locator('.mu-decoration-grammar')
      await expect.poll(() => decoratedProblems(page), { timeout: 15000 }).toBe(1)
      await expect(decoration).toHaveText(['Eu ', '**', 'vai'])
      await expect(page.getByTestId('grammar-status')).toHaveText('1 problem')
      expect(lt.requests[0]).toEqual({ language: 'pt-BR', text: 'Eu **vai** na escola.' })

      await decoration.last().click()
      const popover = page.getByTestId('grammar-popover')
      await expect(popover).toBeVisible()
      await expect(popover).toContainText('Possible agreement error.')
      await popover.getByTestId('grammar-replacement').filter({ hasText: 'Eu vou' }).click()
      await expect(popover).toHaveCount(0)

      const paragraph = page.locator('.mu-paragraph-content').first()
      await expect(paragraph.locator('strong')).toHaveText('vou')
      await expect(paragraph).toHaveText('Eu **vou** na escola.')
      await expect(page.getByTestId('grammar-status')).toHaveText('pt-BR ✓', { timeout: 10000 })
      expect(lt.requests.at(-1)?.text).toBe('Eu **vou** na escola.')

      // Ctrl/Cmd+Z is a menu accelerator, which synthesized key events do not reach;
      // trigger the IPC the Edit › Undo menu item sends.
      await sendIpcToRenderer(app, 'mt::editor-edit-action', 'undo')
      await expect(paragraph.locator('strong')).toHaveText('vai')
      await expect.poll(() => decoratedProblems(page), { timeout: 10000 }).toBe(1)
      expect(await getMarkdownContent(page, app)).toBe('Eu **vai** na escola.\n')
    } finally {
      await app.close()
    }
  })

  test('checks typed text and shows the count in Portuguese', async() => {
    const { app, page } = await launchWithMarkdown('', launchOptions(lt, 'pt'))
    try {
      await page.click('.editor-component')
      await page.keyboard.type('Ontem eu fui ao parque. Eu vai na escola amanhã.')
      await expect(page.locator('.mu-decoration-grammar')).toHaveText('Eu vai', { timeout: 15000 })
      await expect(page.getByTestId('grammar-status')).toHaveText('1 problema')
      expect(lt.requests.at(-1)?.text).toBe('Ontem eu fui ao parque. Eu vai na escola amanhã.')
    } finally {
      await app.close()
    }
  })

  test('asks for consent before sending any text', async() => {
    const { app, page } = await launchWithMarkdown('Eu vai na escola.\n', launchOptions(lt, 'pt', { consentGiven: false }))
    try {
      const dialog = page.getByTestId('grammar-consent')
      await expect(dialog).toBeVisible({ timeout: 15000 })
      await expect(dialog).toContainText('Enviar texto ao LanguageTool?')
      await expect(dialog).toContainText(new URL(lt.url).host)
      expect(lt.requests).toHaveLength(0)

      await page.getByTestId('grammar-consent-accept').click()
      await expect.poll(() => decoratedProblems(page), { timeout: 15000 }).toBe(1)
      expect(lt.requests).toHaveLength(1)
    } finally {
      await app.close()
    }
  })

  test('turns the native spellchecker off while active and recovers after disable and re-enable', async() => {
    const { app, page } = await launchWithMarkdown('Eu vai na escola.\n', launchOptions(lt, 'en'))
    try {
      await expect.poll(() => decoratedProblems(page), { timeout: 15000 }).toBe(1)
      expect(await nativeSpellcheck(page)).toBe('false')

      await page.evaluate(() => window.plugins.setEnabled('grammar', false))
      await expect.poll(() => decoratedProblems(page)).toBe(0)
      await expect(page.getByTestId('grammar-status')).toHaveCount(0)
      expect(await nativeSpellcheck(page)).toBe('true')

      await page.evaluate(() => window.plugins.setEnabled('grammar', true))
      await expect.poll(() => decoratedProblems(page), { timeout: 15000 }).toBe(1)
      await expect(page.getByTestId('grammar-status')).toHaveText('1 problem')
      expect(await nativeSpellcheck(page)).toBe('false')
      await page.locator('.mu-decoration-grammar').click()
      await expect(page.getByTestId('grammar-popover')).toBeVisible()
    } finally {
      await app.close()
    }
  })
})
