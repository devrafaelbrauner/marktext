/**
 * Renderer-side plugin API. A built-in plugin's renderer part exports a
 * `RendererPluginModule`; the host calls `activate` with a context bound to
 * the plugin and disposes everything the plugin registered through it when
 * the plugin is disabled or the window closes.
 *
 * Shared, serializable types live in `@shared/plugins/types`; the main-process
 * counterpart is `src/main/plugins/types.ts`.
 */

import type { Component, Ref } from 'vue'
import type { Muya } from '@muyajs/core'
import type {
  BacklinkEntry,
  Disposable,
  FileMetadata,
  PluginManifest,
  PluginSettingValue,
  TagCount,
  VaultChangeEvent,
  VaultFileEntry
} from '@shared/plugins/types'

export type { Disposable } from '@shared/plugins/types'

/** Position of a content block in the engine state, as `block.path` in @muyajs/core. */
export type BlockPath = Array<string | number>

// ---------------------------------------------------------------------------
// Engine-level contributions (implemented by @muyajs/core, wrapped by the host)
// ---------------------------------------------------------------------------

/**
 * A render-only mark over `[start, end)` of one content block's markdown text
 * (UTF-16 offsets into `block.text`). Decorations never change the document;
 * the engine drops a block's decorations when that block's text changes.
 */
export interface DecorationRange {
  path: BlockPath
  start: number
  end: number
  /** CSS class(es) applied to the marked text. Must only use text-decoration/background/color. */
  className: string
  /** Rendered as `data-*` attributes and returned in click events. */
  data?: Record<string, string>
}

export interface DecorationClickEvent {
  range: DecorationRange
  /** Viewport rectangle of the clicked decorated span, for positioning popovers. */
  rect: DOMRect
  event: MouseEvent
}

/**
 * Replaces `[start, end)` of the block at `path` with `replacement` as one
 * undo step. Applied only when the current text of that range equals
 * `expected`; returns false otherwise (the document changed since the caller
 * computed the range).
 */
export interface RangeEdit {
  path: BlockPath
  start: number
  end: number
  expected: string
  replacement: string
}

/**
 * Prose of one block for proofreading. The parts of `annotation`, joined in
 * order (`text` and `markup` values), reproduce `text` exactly, so offsets
 * reported against the joined string are offsets into `text`.
 */
export interface CheckableBlock {
  path: BlockPath
  /** Engine block name, e.g. 'paragraph.content', 'atxheading.content', 'table.cell.content'. */
  blockName: string
  text: string
  annotation: AnnotationPart[]
}

/** LanguageTool `data.annotation` element: prose, or syntax to skip (optionally read as `interpretAs`). */
export type AnnotationPart = { text: string } | { markup: string; interpretAs?: string }

export interface InlineSyntaxMatch {
  /** Number of source characters the token consumes; > 0. */
  length: number
  /**
   * `[contentStart, contentEnd)`, relative to the match start, is the part shown
   * as token text; characters outside it are syntax markers that the engine
   * hides unless the caret is inside the token (like `[[` `]]`).
   */
  contentStart: number
  contentEnd: number
  /** Rendered as `data-*` attributes on the token element and passed to click handlers. */
  data: Record<string, string>
}

/**
 * Additional inline markdown syntax. The token renders as
 * `span.mu-inline-<name>` whose text content is exactly the matched source,
 * so the rule can never change the saved markdown; visuals beyond the text
 * (icons, pills) must come from CSS.
 */
export interface InlineSyntaxRule {
  /** Token type, /^[a-z][a-z0-9-]*$/; unique across plugins. */
  name: string
  /**
   * Where the rule runs among the engine's inline handlers:
   * - 'beforeEmphasis': before `*`/`_` emphasis (content may contain `_`, e.g. wikilinks);
   * - 'beforeEmoji': before `:shortcode:` emoji (icon shortcodes);
   * - 'afterHtml': after inline HTML and autolinks, before line breaks (hashtags).
   */
  precedence: 'beforeEmphasis' | 'beforeEmoji' | 'afterHtml'
  /**
   * Tests the block text at the lexer position. `src` runs from that position
   * to the end of the text; `prevChar` is the character before it ('' at the
   * start). Runs on every re-render of every block: keep it cheap and
   * ReDoS-safe.
   */
  match(src: string, prevChar: string): InlineSyntaxMatch | null
  /** Excludes the token from the browser spellchecker. */
  noSpellcheck?: boolean
  /** HTML for HTML/PDF export. Must escape user text. Default: escaped source text. */
  exportHtml?(raw: string, data: Record<string, string>): string
}

export interface CodeBlockRenderContext {
  /** Code block content, without fences. */
  source: string
  /** First word of the fence info string, lower-cased. */
  lang: string
  /** Aborted when a newer render supersedes this one or the block goes away. */
  signal: AbortSignal
  /** Replaces the code block content as one undoable edit (a new render follows). */
  setSource(next: string): void
}

/**
 * Live preview for fenced code blocks of the given languages, shown below the
 * block like diagram previews. The block itself stays a plain code block, so
 * the markdown round-trips unchanged.
 */
export interface CodeBlockRenderer {
  /** Lower-case fence languages, e.g. ['dataview']; must not be a built-in diagram language. */
  lang: string[]
  /** Renders into `container` (emptied before each call); may return a cleanup run before the next render and on removal. */
  render(container: HTMLElement, ctx: CodeBlockRenderContext): void | (() => void) | Promise<void | (() => void)>
  /** Delay after the last edit before re-rendering, in ms. Default 300. */
  debounceMs?: number
  /** Static HTML for HTML/PDF export; without it the block exports as code. */
  exportHtml?(source: string, lang: string): string | Promise<string>
}

export interface CompletionItem {
  label: string
  detail?: string
  /** Replaces the text matched by the trigger (and `consumeAfter`). */
  insertText: string
  /** Caret position inside `insertText` after insertion. Default: its end. */
  caretOffset?: number
}

/**
 * Autocomplete list shown while the text before the caret matches `trigger`
 * (e.g. `[[`, `#`, `:icon-`). While a provider's list is open, the engine's
 * emoji picker stays closed.
 */
export interface CompletionProvider {
  id: string
  /** Tested against the block text before the caret; must end with `$`. Group 1 is the query. */
  trigger: RegExp
  /** Text right after the caret that the insertion also replaces (e.g. auto-paired `]]`); must start with `^`. */
  consumeAfter?: RegExp
  getItems(query: string): CompletionItem[] | Promise<CompletionItem[]>
}

/** Engine behaviour switches plugins may request; the host ORs the requests of all active plugins. */
export interface EngineOptionRequests {
  /** `#` only becomes an ATX heading once followed by whitespace (keeps `#tag` at a paragraph start a paragraph). */
  atxHeadingRequiresSpace?: boolean
  /**
   * Forces the editor's native (Chromium) spellchecker off while requested, e.g.
   * by a proofreading plugin that draws its own underlines; the user's
   * spellcheck preference applies again once no active plugin requests it.
   */
  disableNativeSpellcheck?: boolean
  /**
   * Mermaid rendering of the live preview. Not ORed: the most recently made
   * request carrying `mermaid` wins. Without one, diagrams follow the app
   * theme (light/dark) with the classic look.
   */
  mermaid?: MermaidEngineOptions
}

export interface MermaidEngineOptions {
  /** Mermaid theme; absent = follow the app theme. */
  theme?: 'default' | 'neutral' | 'forest' | 'dark' | 'base'
  look?: 'classic' | 'handDrawn'
}

// ---------------------------------------------------------------------------
// Host APIs
// ---------------------------------------------------------------------------

export interface ActiveTabInfo {
  id: string
  /** Absolute path, or null for an unsaved new document. */
  pathname: string | null
  filename: string
  isSaved: boolean
  /** 'asset' tabs show non-markdown files (e.g. PDF) through a registered view. */
  kind: 'markdown' | 'asset'
  /** Id of the active `TabViewContribution`, or null for the default editor. */
  viewId: string | null
}

export interface ContentChangeEvent {
  tabId: string
  /** 'user' for typing/commands, 'api' for programmatic edits (undo, replaceRange, …). */
  source: 'user' | 'api'
}

export interface EditorApi {
  /** Engine of this window, or null before it is created. Prefer the typed helpers below. */
  getMuya(): Muya | null
  getActiveTab(): ActiveTabInfo | null
  onDidChangeActiveTab(listener: (tab: ActiveTabInfo | null) => void): Disposable
  /** Markdown of the active markdown tab, or null. */
  getMarkdown(): string | null
  /** After every committed edit of the active document. */
  onDidChangeContent(listener: (event: ContentChangeEvent) => void): Disposable
  /** After a whole document is loaded into the engine (file open, tab switch, reload); decorations are already cleared. */
  onDidSetContent(listener: (event: { tabId: string }) => void): Disposable
  setDecorations(layerId: string, ranges: DecorationRange[]): void
  clearDecorations(layerId: string): void
  onDidClickDecoration(layerId: string, listener: (event: DecorationClickEvent) => void): Disposable
  replaceRange(edit: RangeEdit): boolean
  /** Proofreadable blocks of the active document, optionally restricted to `paths`. Code, math, HTML and front matter are excluded. */
  getCheckableBlocks(paths?: BlockPath[]): CheckableBlock[]
  /** Inserts text at the caret of the active markdown document. */
  insertText(text: string): void
  registerInlineSyntax(rule: InlineSyntaxRule): Disposable
  /** Ctrl/Cmd-click on a token produced by `registerInlineSyntax`. */
  onDidClickInlineToken(
    name: string,
    listener: (event: { data: Record<string, string>; event: MouseEvent }) => void
  ): Disposable
  registerCodeBlockRenderer(renderer: CodeBlockRenderer): Disposable
  registerCompletionProvider(provider: CompletionProvider): Disposable
  requestEngineOptions(options: EngineOptionRequests): Disposable
}

export interface AssetViewProps {
  ctx: RendererPluginContext
  pathname: string
  /** Part after `#` of the link that opened the file (e.g. 'page=3'), or null. */
  subpath: string | null
  /** Reads the file through the vault API (same path checks). */
  readFile(maxBytes?: number): Promise<Uint8Array>
}

export interface MarkdownViewProps {
  ctx: RendererPluginContext
  tabId: string
  pathname: string | null
  markdown: string
  /** Replaces the tab's markdown; the tab becomes unsaved and the change is one undo step once the user returns to the editor. */
  update(markdown: string): void
}

export type TabViewContribution =
  | {
    id: string
    kind: 'asset'
      /** Lower-case extensions without the dot, e.g. ['pdf']. */
    extensions: string[]
      /** i18n key in the plugin namespace. */
    title: string
      /** Receives `AssetViewProps`. */
    component: Component
  }
  | {
    id: string
    kind: 'markdown'
      /** i18n key in the plugin namespace (used by the view toggle command). */
    title: string
      /** Receives `MarkdownViewProps`. */
    component: Component
      /** When it returns true for a freshly opened file, the tab opens in this view. */
    matches?(markdown: string): boolean
  }

/** Absolute paths before and after a rename/move; `isDirectory` when a folder moved with its contents. */
export interface FileRenameEvent {
  oldPath: string
  newPath: string
  isDirectory: boolean
}

export interface WorkspaceApi {
  /** Folder opened in this window, or null. */
  getRootPath(): string | null
  onDidChangeRootPath(listener: (rootPath: string | null) => void): Disposable
  /**
   * Opens `pathname` in a tab: markdown files in the editor (scrolled to the
   * heading slug `anchor`), other files in the asset view registered for their
   * extension (receiving `subpath`).
   */
  openFile(pathname: string, options?: { anchor?: string; subpath?: string }): Promise<void>
  /** Creates the file and missing folders when it does not exist yet, then opens it. */
  createAndOpenFile(pathname: string, content: string): Promise<void>
  registerTabView(view: TabViewContribution): Disposable
  /**
   * After the app itself renamed or moved a file or folder (menu Rename/Move
   * to, sidebar rename, sidebar cut/paste) and updated the open tabs. Changes
   * made by other programs are not reported.
   */
  onDidRenameFile(listener: (event: FileRenameEvent) => void): Disposable
}

/** Rejection reason of vault and IPC calls. */
export interface PluginErrorShape {
  code: 'OUTSIDE_VAULT' | 'CONFLICT' | 'EXISTS' | 'NOT_FOUND' | 'TOO_LARGE' | 'DISABLED' | 'UNKNOWN_METHOD' | 'FAILED'
  message: string
}

/**
 * File access limited to the folder opened in this window (or, with no folder
 * open, to the folder of the active file). Paths are absolute; anything else
 * rejects with code 'OUTSIDE_VAULT'.
 */
export interface VaultApi {
  readText(path: string): Promise<{ content: string; mtimeMs: number }>
  readBinary(path: string, maxBytes?: number): Promise<Uint8Array>
  /**
   * Writes UTF-8 text. If the file is open in a tab of this window, the edit
   * goes to that tab instead (unsaved, undoable) and `mtimeMs` is null. With
   * `expectedMtimeMs`, rejects with 'CONFLICT' when the file changed on disk.
   */
  writeText(path: string, content: string, options?: { expectedMtimeMs?: number }): Promise<{ mtimeMs: number | null }>
  /** Rejects with 'EXISTS' when the file exists; creates missing folders. */
  createText(path: string, content: string): Promise<void>
  exists(path: string): Promise<boolean>
  list(options?: { extensions?: string[] }): Promise<VaultFileEntry[]>
}

export interface MetadataApi {
  /** True once the initial scan of the opened folder finished. */
  isReady(): boolean
  onDidBecomeReady(listener: () => void): Disposable
  onDidChange(listener: (event: VaultChangeEvent) => void): Disposable
  getFile(path: string): Promise<FileMetadata | null>
  listFiles(): Promise<FileMetadata[]>
  /** Resolves a link target (`Note`, `Folder/Note`, `doc.pdf`) as Obsidian does: exact path, then shortest unique match. */
  resolveLink(target: string, sourcePath: string): Promise<string | null>
  getBacklinks(path: string): Promise<BacklinkEntry[]>
  getTags(): Promise<TagCount[]>
  /** Files carrying `tag` (without `#`); `includeNested` also matches `tag/child`. */
  getFilesWithTag(tag: string, options?: { includeNested?: boolean }): Promise<string[]>
  /** Calls a handler registered in the index worker (see src/main/vaultIndex); used by query engines. */
  request<T = unknown>(type: string, payload: unknown): Promise<T>
}

export interface PluginSettingsApi {
  /** Stored value, or the schema default. */
  get<T extends PluginSettingValue>(key: string): T
  set(key: string, value: PluginSettingValue): Promise<void>
  onDidChange(listener: (key: string, value: PluginSettingValue) => void): Disposable
  isSecretSet(key: string): boolean
}

export interface PluginIpcApi {
  /** Calls a method registered by the plugin's main part; rejects with 'DISABLED' or 'UNKNOWN_METHOD'. */
  invoke<T = unknown>(method: string, ...args: unknown[]): Promise<T>
  /** Events sent by the plugin's main part with `ctx.emit`. */
  on(event: string, listener: (payload: unknown) => void): Disposable
}

export interface PluginCommand {
  /** Globally unique, conventionally `<pluginId>.<action>`. */
  id: string
  /** i18n key in the plugin namespace, shown in the command palette. */
  title: string
  run(): void | Promise<void>
  /** Electron accelerator, e.g. 'CmdOrCtrl+Alt+D'; ignored when it collides with an app shortcut. */
  keybinding?: string
}

export interface SidebarPanelContribution {
  id: string
  /** i18n key in the plugin namespace. */
  title: string
  /** Raw single-colour SVG markup using `currentColor`; sanitized by the host. */
  icon: string
  /** Receives the prop `ctx: RendererPluginContext`. */
  component: Component
  order?: number
}

export interface StatusBarItemContribution {
  id: string
  /** Receives the prop `ctx: RendererPluginContext`. */
  component: Component
  order?: number
}

export interface UiApi {
  registerSidebarPanel(panel: SidebarPanelContribution): Disposable
  /** Shows `panelId` in the left sidebar. */
  revealSidebarPanel(panelId: string): void
  registerStatusBarItem(item: StatusBarItemContribution): Disposable
  notify(options: {
    title?: string
    message: string
    type?: 'primary' | 'info' | 'warning' | 'error'
    /** Auto-close delay in ms; 0 keeps it open. */
    timeout?: number
  }): void
  /** Opens Preferences on this plugin's settings. */
  openSettings(): void
}

export interface CommandsApi {
  register(command: PluginCommand): Disposable
}

export interface RendererPluginContext {
  readonly id: string
  readonly manifest: PluginManifest
  /** Translates a key of this plugin's namespace in the current UI language, falling back to English. */
  t(key: string, params?: Record<string, string | number>): string
  /** Current UI language code (reactive). */
  readonly language: Readonly<Ref<string>>
  readonly commands: CommandsApi
  readonly ui: UiApi
  readonly editor: EditorApi
  readonly workspace: WorkspaceApi
  readonly vault: VaultApi
  readonly metadata: MetadataApi
  readonly settings: PluginSettingsApi
  readonly ipc: PluginIpcApi
  /**
   * Ties a disposable to the plugin's lifetime; returns it. Everything returned
   * by the `register*`/`on*` methods of this context is already tracked.
   */
  track<T extends Disposable>(disposable: T): T
}

export interface RendererPluginModule {
  activate(ctx: RendererPluginContext): void | Promise<void>
  deactivate?(): void | Promise<void>
}
