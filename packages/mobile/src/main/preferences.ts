// User preferences and user data (desktop main/preferences and
// main/dataCenter) over the FileBackend. Desktop keeps them in electron-store
// files validated by schema.json; here they are plain JSON files under the
// app-private user data folder, checked against the same schema on load and
// on every change.
//
// Differences from desktop, all because there is one window and no OS menus:
// - a stored value the schema rejects is replaced by its default on load
//   (electron-store throws and the app fails to start);
// - a change the schema rejects is dropped and logged instead of throwing in
//   the IPC handler;
// - the first run detects the language from `navigator.language`.

import type { LineEnding } from '@shared/types/files'
import defaultPreferences from '../../../desktop/static/preference.json'
import preferenceSchema from '../../../desktop/src/main/preferences/schema.json'
import type { FileBackend } from './fs/backend'
import { isRecord } from './guards'

export const PREFERENCES_PATH = '/data/marktext/preferences.json'
export const USER_DATA_FILE_PATH = '/data/marktext/dataCenter.json'

export type PreferenceMap = Record<string, unknown>

interface SchemaEntry {
  type?: string
  enum?: unknown[]
  minimum?: number
  maximum?: number
  pattern?: string
  items?: { type?: string }
}

const SCHEMA: Record<string, SchemaEntry> = preferenceSchema

const SUPPORTED_LANGUAGES = ['en', 'zh-CN', 'zh-TW', 'es', 'fr', 'de', 'ja', 'ko', 'nl', 'pt', 'tr', 'ru']

/** Mirror of common/i18n.ts (that module reads locale files with fs). */
export function matchSupportedLanguage(locale: string): string | null {
  if (!locale) return null
  if (SUPPORTED_LANGUAGES.includes(locale)) return locale
  const primarySubtag = (locale.split('-')[0] ?? '').toLowerCase()
  // The zh family splits by script rather than region: traditional characters
  // are used in TW, HK and MO (zh-Hant), everything else is simplified.
  if (primarySubtag === 'zh') {
    const secondSubtag = (locale.split('-')[1] ?? '').toLowerCase()
    return ['tw', 'hk', 'mo', 'hant'].includes(secondSubtag) ? 'zh-TW' : 'zh-CN'
  }
  return SUPPORTED_LANGUAGES.find((lang) => (lang.split('-')[0] ?? '').toLowerCase() === primarySubtag) ?? null
}

/** JSON-schema `type` check for the types the preference schema uses. */
function matchesType(type: string | undefined, value: unknown): boolean {
  switch (type) {
    case undefined:
      return true
    case 'array':
      return Array.isArray(value)
    case 'boolean':
      return typeof value === 'boolean'
    case 'number':
      return typeof value === 'number' && !Number.isNaN(value)
    case 'string':
      return typeof value === 'string'
    default:
      return false
  }
}

/** The schema.json keywords the preference schema uses (type, enum, minimum, maximum, pattern, items). */
export function isValidPreference(key: string, value: unknown): boolean {
  const entry = SCHEMA[key]
  // Keys without a schema entry (treePathExcludePatterns) accept any JSON value.
  if (!entry) return key in defaultPreferences
  if (!matchesType(entry.type, value)) return false
  if (entry.enum && !entry.enum.includes(value)) return false
  if (typeof value === 'number') {
    if (entry.minimum !== undefined && value < entry.minimum) return false
    if (entry.maximum !== undefined && value > entry.maximum) return false
  }
  if (entry.pattern && typeof value === 'string' && !new RegExp(entry.pattern).test(value)) return false
  if (entry.items && Array.isArray(value)) return value.every((item) => matchesType(entry.items?.type, item))
  return true
}

async function readJson(backend: FileBackend, path: string): Promise<Record<string, unknown> | null> {
  if (!(await backend.stat(path))) return null
  try {
    const parsed: unknown = JSON.parse(await backend.readText(path))
    return isRecord(parsed) ? parsed : {}
  } catch (error) {
    console.error(`[preferences] ${path} is not valid JSON; using defaults`, error)
    return {}
  }
}

export interface LoadPreferencesOptions {
  /** BCP 47 tag of the system language, used on the first run only. */
  systemLanguage: string
  /** System dark mode, applied when `followSystemTheme` is on. */
  systemDark: boolean
}

/** Persists one JSON file; writes are serialized so the last change wins on disk. */
class JsonFile {
  private queue: Promise<void> = Promise.resolve()

  constructor(
    private readonly backend: FileBackend,
    private readonly path: string
  ) {}

  save(data: Record<string, unknown>): Promise<void> {
    const text = JSON.stringify(data, null, 2)
    this.queue = this.queue
      .then(() => this.backend.writeFile(this.path, text))
      .catch((error: unknown) => console.error(`[preferences] cannot write ${this.path}`, error))
    return this.queue
  }
}

export class Preferences {
  private readonly listeners = new Set<(change: PreferenceMap) => void>()

  private constructor(
    private readonly values: PreferenceMap,
    private readonly file: JsonFile
  ) {}

  static async load(backend: FileBackend, options: LoadPreferencesOptions): Promise<Preferences> {
    const stored = await readJson(backend, PREFERENCES_PATH)
    const values: PreferenceMap = { ...defaultPreferences }
    if (stored) {
      // electron-store migration 0.18.6.
      if (stored.startUpAction === 'lastState') stored.startUpAction = 'openLastFolder'
      // Keys outside the defaults are outdated settings and are dropped.
      for (const key of Object.keys(defaultPreferences)) {
        if (!(key in stored)) continue
        if (isValidPreference(key, stored[key])) {
          values[key] = stored[key]
        } else {
          console.error(`[preferences] invalid stored value for "${key}"; using the default`)
        }
      }
    } else {
      values.language = matchSupportedLanguage(options.systemLanguage) ?? 'en'
    }
    if (values.followSystemTheme === true) {
      values.theme = options.systemDark ? values.darkModeTheme : values.lightModeTheme
    }
    const preferences = new Preferences(values, new JsonFile(backend, PREFERENCES_PATH))
    await preferences.file.save(values)
    return preferences
  }

  getAll(): PreferenceMap {
    return { ...this.values }
  }

  getItem(key: string): unknown {
    return this.values[key]
  }

  /**
   * Applies the valid entries of `settings`, persists them and notifies
   * listeners with that partial. Returns the applied partial.
   */
  setItems(settings: unknown): PreferenceMap {
    if (!isRecord(settings)) {
      console.error('[preferences] cannot change settings without entries')
      return {}
    }
    const applied: PreferenceMap = {}
    for (const [key, value] of Object.entries(settings)) {
      if (!isValidPreference(key, value)) {
        console.error(`[preferences] rejected invalid value for "${key}"`, value)
        continue
      }
      this.values[key] = value
      applied[key] = value
    }
    if (Object.keys(applied).length === 0) return applied
    this.file.save(this.values)
    for (const listener of [...this.listeners]) listener(applied)
    return applied
  }

  onChange(listener: (change: PreferenceMap) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** Line ending of new documents: desktop getPreferredEol on a non-Windows platform. */
  getPreferredEol(): LineEnding {
    return this.values.endOfLine === 'crlf' ? 'crlf' : 'lf'
  }
}

/** Desktop dataCenter without the keychain (its encrypted key list is empty). */
export class UserData {
  private readonly listeners = new Set<(change: PreferenceMap) => void>()

  private constructor(
    private readonly values: PreferenceMap,
    private readonly file: JsonFile
  ) {}

  static async load(backend: FileBackend, userDataPath: string): Promise<UserData> {
    const stored = await readJson(backend, USER_DATA_FILE_PATH)
    const values: PreferenceMap = stored ?? {
      imageFolderPath: `${userDataPath}/images`,
      screenshotFolderPath: `${userDataPath}/screenshot`,
      webImages: [],
      cloudImages: [],
      currentUploader: 'picgo'
    }
    // Uploader values that no longer exist (dataCenter migration).
    if (values.currentUploader === 'none' || values.currentUploader === 'github') values.currentUploader = 'picgo'
    const userData = new UserData(values, new JsonFile(backend, USER_DATA_FILE_PATH))
    if (!stored) await userData.file.save(values)
    return userData
  }

  getAll(): PreferenceMap {
    return { ...this.values }
  }

  getItem(key: string): unknown {
    return this.values[key]
  }

  setItems(settings: unknown): PreferenceMap {
    if (!isRecord(settings)) return {}
    Object.assign(this.values, settings)
    this.file.save(this.values)
    for (const listener of [...this.listeners]) listener({ ...settings })
    return { ...settings }
  }

  onChange(listener: (change: PreferenceMap) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
}
