import { describe, expect, it } from 'vitest'
import type { PluginLocaleMessages } from '@shared/plugins/types'
import { locales } from '@plugins/daily-notes/locales'
import { manifest } from '@plugins/daily-notes/manifest'

const flatten = (messages: PluginLocaleMessages, prefix = ''): Record<string, string> => {
  const result: Record<string, string> = {}
  for (const [key, value] of Object.entries(messages)) {
    if (typeof value === 'string') result[prefix + key] = value
    else Object.assign(result, flatten(value, `${prefix}${key}.`))
  }
  return result
}

describe('daily-notes locales', () => {
  const en = flatten(locales.en)
  const pt = flatten(locales.pt ?? {})

  it('ships the same keys in English and Portuguese', () => {
    expect(Object.keys(pt).sort()).toEqual(Object.keys(en).sort())
  })

  it('translates every key the manifest references', () => {
    const keys = [manifest.name, manifest.description]
    for (const setting of manifest.settings ?? []) {
      keys.push(setting.label)
      if (setting.description) keys.push(setting.description)
      if (setting.type === 'enum') keys.push(...setting.options.map((option) => option.label))
    }
    for (const key of keys) {
      expect(en[key], key).toBeTruthy()
      expect(pt[key], key).toBeTruthy()
    }
    expect(pt.name).toBe('Calendário e notas diárias')
  })

  it('keeps interpolation placeholders aligned and free of vue-i18n template braces', () => {
    const placeholders = (text: string): string[] => (text.match(/\{\w+\}/g) ?? []).sort()
    for (const key of Object.keys(en)) {
      expect(placeholders(pt[key]), key).toEqual(placeholders(en[key]))
      expect(en[key]).not.toContain('{{')
      expect(pt[key]).not.toContain('{{')
    }
  })
})
