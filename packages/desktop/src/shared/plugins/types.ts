/**
 * Contract shared by the plugin host (main + renderer) and the built-in
 * plugins. Built-in plugins live in `src/plugins/<id>/` and are trusted code
 * shipped with the app; they reach the app only through the context objects
 * described in `src/renderer/src/plugins/types.ts` and
 * `src/main/plugins/types.ts`, so the same API can later be offered to
 * sandboxed community plugins.
 *
 * Everything in this file must stay serializable (it crosses IPC) and free of
 * Electron, Node and Vue imports.
 */
import type { CommunityPluginRecord } from './community'

export type { CommunityPluginRecord } from './community'

export interface Disposable {
  dispose(): void
}

/**
 * Nested i18n messages of one plugin for one UI language. Keys are resolved
 * relative to the plugin namespace: a plugin calling `t('panel.title')` reads
 * `plugins.<id>.panel.title` from the merged vue-i18n messages.
 */
export interface PluginLocaleMessages {
  [key: string]: string | PluginLocaleMessages
}

/**
 * Locale bundles of a plugin keyed by app UI language code (`en`, `pt`, …,
 * see SUPPORTED_LANGUAGES in common/i18n.ts). `en` is mandatory and is the
 * fallback for every language the plugin does not ship.
 */
export type PluginLocales = { en: PluginLocaleMessages } & Partial<
  Record<string, PluginLocaleMessages>
>

interface PluginSettingBase {
  /** Unique within the plugin; also the storage key. */
  key: string
  /** i18n key in the plugin namespace. */
  label: string
  /** i18n key in the plugin namespace. */
  description?: string
}

/**
 * Declarative description of one plugin setting. Preferences → Plugins renders
 * the form from these entries, so plugins never ship code into the
 * Preferences window.
 */
export type PluginSettingSchema =
  | (PluginSettingBase & { type: 'boolean'; default: boolean })
  | (PluginSettingBase & {
    type: 'string'
    default: string
    placeholder?: string
      /** JavaScript regular expression source the value must match (empty string allowed unless `required`). */
    pattern?: string
    required?: boolean
  })
  | (PluginSettingBase & { type: 'number'; default: number; min?: number; max?: number; step?: number })
  | (PluginSettingBase & {
    type: 'enum'
    default: string
      /** `label` is an i18n key in the plugin namespace. */
    options: Array<{ value: string; label: string }>
  })
  | (PluginSettingBase & { type: 'stringList'; default: string[] })
  /**
   * Write-only value encrypted with Electron safeStorage in the main process.
   * The renderer can only set/clear it and ask whether it is set; only the
   * plugin's main part can read it.
   */
  | (PluginSettingBase & { type: 'secret' })

export type PluginSettingValue = boolean | string | number | string[]

export interface PluginManifest {
  /** Kebab-case, unique, stable: it namespaces settings, secrets, i18n keys and IPC methods. */
  id: string
  version: string
  /** i18n key in the plugin namespace. */
  name: string
  /** i18n key in the plugin namespace. */
  description: string
  defaultEnabled: boolean
  settings?: PluginSettingSchema[]
  /**
   * True when enabling/disabling the plugin changes how markdown is parsed or
   * rendered by the engine (inline syntax, code block renderers). The host
   * then reloads the open documents into the engine after toggling it.
   */
  affectsParsing?: boolean
}

/** Snapshot the main process sends to every window (`mt::plugins::get-state` / `mt::plugins::state-changed`). */
export interface PluginHostState {
  /** True when the app runs with `--safe`: no plugin is activated regardless of `enabled`. */
  safeMode: boolean
  enabled: Record<string, boolean>
  /** Non-secret settings per plugin id; missing keys mean "use the schema default". */
  settings: Record<string, Record<string, PluginSettingValue>>
  /** Which `secret` settings are currently stored, per plugin id. */
  secretsSet: Record<string, Record<string, boolean>>
  /**
   * Installed community plugins. The host always sends this; tests that build
   * a state by hand may omit it.
   */
  community?: CommunityPluginRecord[]
}

// ---------------------------------------------------------------------------
// Vault metadata (produced by the vault index, see src/main/vaultIndex)
// ---------------------------------------------------------------------------

export interface LinkReference {
  /** Link target as written, without alias/heading/block parts, e.g. `Folder/Note` or `doc.pdf`. */
  target: string
  alias?: string
  /** Heading part of `[[note#Heading]]` or the fragment of `[x](note.md#heading)`. */
  heading?: string
  /** Block id of `[[note#^id]]`. */
  blockId?: string
  /** Raw subpath after `#` for non-markdown targets, e.g. `page=3` in `[[doc.pdf#page=3]]`. */
  subpath?: string
  embed: boolean
  kind: 'wikilink' | 'markdown'
  /** 0-based line of the link start. */
  line: number
  /** 0-based UTF-16 column of the link start within its line. */
  column: number
  /** Absolute path the target resolves to, or null when it does not resolve. */
  resolved: string | null
}

export interface HeadingEntry {
  level: number
  /** Plain text of the heading (markup stripped). */
  text: string
  line: number
}

export interface TaskEntry {
  /** Task text without the list marker and checkbox. */
  text: string
  checked: boolean
  /** Character inside the brackets: ' ', 'x', 'X', '-', '/', … */
  status: string
  line: number
  /** Inline fields declared on the task line (`[due:: 2026-10-04]`, `due:: …`). */
  fields: Record<string, unknown>
}

export interface FileMetadata {
  /** Absolute path. */
  path: string
  /** File name with extension. */
  name: string
  /** File name without extension. */
  basename: string
  /** Absolute path of the containing folder. */
  folder: string
  size: number
  ctimeMs: number
  mtimeMs: number
  /** Parsed YAML front matter, or null when absent or invalid. */
  frontmatter: Record<string, unknown> | null
  /** From front matter `aliases`/`alias`. */
  aliases: string[]
  /**
   * Tags from the body (`#tag`) and front matter (`tags`/`tag`), without the
   * leading `#`, in original case, de-duplicated case-insensitively.
   */
  tags: string[]
  headings: HeadingEntry[]
  links: LinkReference[]
  tasks: TaskEntry[]
  /** Inline `key:: value` fields of the body; a repeated key becomes an array. Keys are lower-cased. */
  fields: Record<string, unknown>
  /** `YYYY-MM-DD` when the file is a daily note (date-shaped basename), else null. */
  day: string | null
  wordCount: number
}

export interface BacklinkEntry {
  /** Absolute path of the file containing the link. */
  sourcePath: string
  link: LinkReference
  /** The text of the line containing the link, for previews. */
  context: string
}

export interface TagCount {
  /** Tag without `#`, original case of its first occurrence. */
  tag: string
  count: number
}

export interface VaultFileEntry {
  path: string
  name: string
  extension: string
  size: number
  mtimeMs: number
}

export interface VaultChangeEvent {
  /** Absolute paths whose metadata was (re)computed. */
  changed: string[]
  removed: string[]
}
