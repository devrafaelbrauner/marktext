import { describe, expect, it } from 'vitest'
import defaults from '../../desktop/static/preference.json'
import { MemoryFileBackend } from '../src/main/fs/memoryBackend'
import {
  PREFERENCES_PATH,
  Preferences,
  USER_DATA_FILE_PATH,
  UserData,
  isValidPreference,
  matchSupportedLanguage
} from '../src/main/preferences'

const light = { systemLanguage: 'en-US', systemDark: false }
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))
const stored = async(backend: MemoryFileBackend): Promise<Record<string, unknown>> =>
  JSON.parse(await backend.readText(PREFERENCES_PATH))

describe('matchSupportedLanguage', () => {
  it.each([
    ['pt-BR', 'pt'],
    ['pt', 'pt'],
    ['zh-HK', 'zh-TW'],
    ['zh-Hant-TW', 'zh-TW'],
    ['zh', 'zh-CN'],
    ['de-AT', 'de'],
    ['xx-YY', null],
    ['', null]
  ])('%j → %j', (locale, expected) => {
    expect(matchSupportedLanguage(locale)).toBe(expected)
  })
})

describe('Preferences.load', () => {
  it('first run: defaults, language from the system, theme from the system, written to disk', async() => {
    const backend = new MemoryFileBackend()
    const prefs = await Preferences.load(backend, { systemLanguage: 'pt-BR', systemDark: true })
    expect(prefs.getItem('language')).toBe('pt')
    expect(prefs.getItem('theme')).toBe(defaults.darkModeTheme)
    expect(prefs.getItem('fontSize')).toBe(defaults.fontSize)
    expect(await stored(backend)).toEqual(prefs.getAll())
  })

  it('falls back to English for an unsupported system language', async() => {
    const prefs = await Preferences.load(new MemoryFileBackend(), { systemLanguage: 'xx', systemDark: false })
    expect(prefs.getItem('language')).toBe('en')
  })

  it('merges a stored file like desktop: drops unknown keys, adds new ones, keeps valid values', async() => {
    const backend = new MemoryFileBackend({
      [PREFERENCES_PATH]: JSON.stringify({ language: 'de', fontSize: 20, removedSetting: true, followSystemTheme: false })
    })
    const prefs = await Preferences.load(backend, light)
    const all = prefs.getAll()
    expect(all.language).toBe('de')
    expect(all.fontSize).toBe(20)
    expect(all).not.toHaveProperty('removedSetting')
    expect(all.tabSize).toBe(defaults.tabSize)
    expect(Object.keys(all).sort()).toEqual(Object.keys(defaults).sort())
    expect(await stored(backend)).not.toHaveProperty('removedSetting')
  })

  it('replaces stored values the schema rejects with the default', async() => {
    const backend = new MemoryFileBackend({
      [PREFERENCES_PATH]: JSON.stringify({ fontSize: 99, endOfLine: 'cr', autoSave: 'yes' })
    })
    const prefs = await Preferences.load(backend, light)
    expect(prefs.getItem('fontSize')).toBe(defaults.fontSize)
    expect(prefs.getItem('endOfLine')).toBe(defaults.endOfLine)
    expect(prefs.getItem('autoSave')).toBe(defaults.autoSave)
  })

  it('migrates the 0.18.6 startUpAction value', async() => {
    const backend = new MemoryFileBackend({ [PREFERENCES_PATH]: JSON.stringify({ startUpAction: 'lastState' }) })
    expect((await Preferences.load(backend, light)).getItem('startUpAction')).toBe('openLastFolder')
  })

  it('keeps a stored theme when not following the system', async() => {
    const backend = new MemoryFileBackend({
      [PREFERENCES_PATH]: JSON.stringify({ followSystemTheme: false, theme: 'nord' })
    })
    expect((await Preferences.load(backend, { systemLanguage: 'en', systemDark: false })).getItem('theme')).toBe('nord')
  })

  it('uses defaults when the file is not JSON', async() => {
    const backend = new MemoryFileBackend({ [PREFERENCES_PATH]: '{oops' })
    expect((await Preferences.load(backend, light)).getItem('fontSize')).toBe(defaults.fontSize)
  })
})

describe('Preferences.setItems', () => {
  it('applies and persists valid entries, drops invalid ones, notifies with the applied partial', async() => {
    const backend = new MemoryFileBackend()
    const prefs = await Preferences.load(backend, light)
    const changes: unknown[] = []
    prefs.onChange((change) => changes.push(change))
    const applied = prefs.setItems({ fontSize: 18, lineHeight: 9, bulletListMarker: '*', unknownKey: 1 })
    expect(applied).toEqual({ fontSize: 18, bulletListMarker: '*' })
    expect(changes).toEqual([{ fontSize: 18, bulletListMarker: '*' }])
    await flush()
    expect(await stored(backend)).toMatchObject({ fontSize: 18, bulletListMarker: '*', lineHeight: defaults.lineHeight })
  })

  it('ignores a change without entries', async() => {
    const prefs = await Preferences.load(new MemoryFileBackend(), light)
    expect(prefs.setItems(null)).toEqual({})
    expect(prefs.setItems({ fontSize: 'big' })).toEqual({})
  })

  it('derives the preferred line ending like desktop on Linux', async() => {
    const prefs = await Preferences.load(new MemoryFileBackend(), light)
    expect(prefs.getPreferredEol()).toBe('lf')
    prefs.setItems({ endOfLine: 'crlf' })
    expect(prefs.getPreferredEol()).toBe('crlf')
    prefs.setItems({ endOfLine: 'default' })
    expect(prefs.getPreferredEol()).toBe('lf')
  })
})

describe('isValidPreference', () => {
  it('checks type, enum, range, pattern and array items', () => {
    expect(isValidPreference('autoSaveDelay', 999)).toBe(false)
    expect(isValidPreference('autoSaveDelay', 1000)).toBe(true)
    expect(isValidPreference('listIndentation', 2)).toBe(true)
    expect(isValidPreference('listIndentation', 5)).toBe(false)
    expect(isValidPreference('editorLineWidth', '80ch')).toBe(true)
    expect(isValidPreference('editorLineWidth', '80 ch')).toBe(false)
    expect(isValidPreference('searchExclusions', ['*.tmp'])).toBe(true)
    expect(isValidPreference('searchExclusions', [1])).toBe(false)
    expect(isValidPreference('treePathExcludePatterns', ['x'])).toBe(true)
    expect(isValidPreference('notASetting', true)).toBe(false)
  })
})

describe('UserData', () => {
  it('seeds the desktop data center defaults under the user data folder', async() => {
    const backend = new MemoryFileBackend()
    const data = await UserData.load(backend, '/data/marktext')
    expect(data.getAll()).toEqual({
      imageFolderPath: '/data/marktext/images',
      screenshotFolderPath: '/data/marktext/screenshot',
      webImages: [],
      cloudImages: [],
      currentUploader: 'picgo'
    })
    expect(JSON.parse(await backend.readText(USER_DATA_FILE_PATH))).toEqual(data.getAll())
  })

  it('migrates removed uploaders and persists changes', async() => {
    const backend = new MemoryFileBackend({ [USER_DATA_FILE_PATH]: JSON.stringify({ currentUploader: 'github' }) })
    const data = await UserData.load(backend, '/data/marktext')
    expect(data.getItem('currentUploader')).toBe('picgo')
    data.setItems({ imageFolderPath: '/vault/k/V/assets' })
    await flush()
    expect(JSON.parse(await backend.readText(USER_DATA_FILE_PATH)).imageFolderPath).toBe('/vault/k/V/assets')
  })
})
