import { expect, test } from '@playwright/test'
import { launchWithMarkdown, waitForEditor } from './helpers'

const DOC = [
  '$$',
  'E = mc^2',
  '$$',
  '',
  '```vega-lite',
  '{',
  '  "data": { "values": [{ "a": "A", "b": 28 }] },',
  '  "mark": "bar",',
  '  "encoding": {',
  '    "x": { "field": "a", "type": "nominal" },',
  '    "y": { "field": "b", "type": "quantitative" }',
  '  }',
  '}',
  '```',
  ''
].join('\n')

test('math and vega-lite still render with webSecurity on', async() => {
  const { app, page } = await launchWithMarkdown(DOC, { preferences: { language: 'en' } })
  try {
    await waitForEditor(page)
    await expect
      .poll(async() => page.locator('.mu-math-render, .katex').count(), { timeout: 15000 })
      .toBeGreaterThan(0)
    await expect
      .poll(async() => page.locator('.mu-diagram-preview svg').count(), { timeout: 15000 })
      .toBeGreaterThan(0)
  } finally {
    await app.close()
  }
})
