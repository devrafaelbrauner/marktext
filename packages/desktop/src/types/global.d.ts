// Renderer-side global declarations: build-time defines (electron-vite
// `define` block in electron.vite.config.ts), the contextBridge surface
// exposed by src/preload/index.ts, and a handful of legacy globals that
// survived the sandbox migration.

import type {
  IpcInvokeChannels,
  IpcSendChannels,
  IpcSyncChannels,
  IpcMainEventChannels,
  BootInfo,
  PlantumlFetchResult,
  PluginIpcResult,
  SaveDialogRequest,
  VaultIndexReadyState
} from '@shared/types/ipc'
import type { MenuTemplate, MenuPopupPosition } from '@shared/types/menu'
import type { SerializedStat } from '@shared/types/files'
import type {
  BacklinkEntry,
  FileMetadata,
  PluginHostState,
  PluginSettingValue,
  TagCount,
  VaultChangeEvent,
  VaultFileEntry
} from '@shared/plugins/types'

declare global {
  // ---- Build-time defines (electron-vite `define`) ----
  const MARKTEXT_VERSION: string
  const MARKTEXT_VERSION_STRING: string
  const __static: string

  // ---- contextBridge surface ----

  interface ElectronIpcRenderer {
    send<K extends keyof IpcSendChannels>(channel: K, ...args: IpcSendChannels[K]): void
    sendSync<K extends keyof IpcSyncChannels>(
      channel: K,
      ...args: IpcSyncChannels[K]['args']
    ): IpcSyncChannels[K]['ret']
    invoke<K extends keyof IpcInvokeChannels>(
      channel: K,
      ...args: IpcInvokeChannels[K]['args']
    ): Promise<IpcInvokeChannels[K]['ret']>
    on<K extends keyof IpcMainEventChannels>(
      channel: K,
      listener: (event: unknown, ...args: IpcMainEventChannels[K]) => void
    ): () => void
    once<K extends keyof IpcMainEventChannels>(
      channel: K,
      listener: (event: unknown, ...args: IpcMainEventChannels[K]) => void
    ): () => void
    removeAllListeners(channel: keyof IpcMainEventChannels | string): void
  }

  interface ElectronShellAPI {
    openExternal(url: string): Promise<void>
    showItemInFolder(fullPath: string): void
    openPath(fullPath: string): Promise<string>
  }

  interface ElectronClipboardAPI {
    writeText(text: string): void
    readText(): Promise<string>
    guessFilePath(): Promise<string | null>
    writeImage(png: Uint8Array): Promise<boolean>
  }

  interface ElectronDialogAPI {
    showSave(request: SaveDialogRequest): Promise<string | null>
  }

  interface ElectronWebFrameAPI {
    setZoomFactor(factor: number): void
    setZoomLevel(level: number): void
  }

  interface ElectronWebUtilsAPI {
    getPathForFile(file: File): string
  }

  interface ElectronWindowControlAPI {
    minimize(): void
    maximize(): void
    unmaximize(): void
    toggleMaximize(): void
    close(): void
    setFullScreen(flag: boolean): void
    toggleFullScreen(): void
    isMaximized(): Promise<boolean>
    isFullScreen(): Promise<boolean>
    popupMenu(template: MenuTemplate, position?: MenuPopupPosition): void
    popupApplicationMenu(position?: MenuPopupPosition): void
  }

  interface ElectronAPI {
    ipcRenderer: ElectronIpcRenderer
    shell: ElectronShellAPI
    clipboard: ElectronClipboardAPI
    webFrame: ElectronWebFrameAPI
    webUtils: ElectronWebUtilsAPI
    process: {
      platform: NodeJS.Platform
      arch?: string
      versions: Record<string, string>
      env: Record<string, string>
      resourcesPath?: string
      cwd?: string
    }
    paths: Partial<BootInfo['paths']>
    isUpdatable: boolean
    windowControl: ElectronWindowControlAPI
    dialog: ElectronDialogAPI
  }

  interface DiagramAPI {
    fetchPlantuml(
      server: string,
      encoded: string,
      format: 'svg' | 'png'
    ): Promise<PlantumlFetchResult>
  }

  interface FileUtilsAPI {
    isFile(p: string): Promise<boolean>
    isDirectory(p: string): Promise<boolean>
    copy(src: string, dest: string): Promise<void>
    copyWithContentHash(src: string, outputDir: string): Promise<string>
    ensureDir(p: string): Promise<void>
    outputFile(p: string, data: string | Uint8Array): Promise<void>
    move(src: string, dest: string): Promise<void>
    stat(p: string): Promise<SerializedStat>
    writeFile(p: string, data: string | Uint8Array): Promise<void>
    readFile(p: string, encoding?: string): Promise<string | Uint8Array>
    pathExists(p: string): Promise<boolean>
    readdir(p: string): Promise<string[]>
    isExecutable(p: string): Promise<boolean>
    isChildOfDirectory(dir: string, child: string): boolean
    hasMarkdownExtension(filename: string): boolean
    isSamePathSync(a: string, b: string, isNormalized?: boolean): boolean
    isImageFile(p: string): Promise<boolean>
    MARKDOWN_INCLUSIONS: string[]
  }

  interface PathAPI {
    basename(path: string, ext?: string): string
    dirname(path: string): string
    extname(path: string): string
    join(...paths: string[]): string
    resolve(...paths: string[]): string
    relative(from: string, to: string): string
    isAbsolute(path: string): boolean
    normalize(path: string): string
    parse(path: string): { root: string; dir: string; base: string; ext: string; name: string }
    format(pathObject: {
      root?: string
      dir?: string
      base?: string
      ext?: string
      name?: string
    }): string
    sep: string
    delimiter: string
  }

  interface CommandExistsAPI {
    exists(name: string): Promise<boolean>
  }

  interface I18nUtilsAPI {
    loadTranslations(language: string): Promise<Record<string, unknown>>
  }

  interface RipgrepAPI {
    start(req: unknown): Promise<{ searchId: string }>
    cancel(searchId: string): void
    onMatch(handler: (payload: unknown) => void): () => void
    onProgress(handler: (payload: unknown) => void): () => void
    onDone(handler: (payload: unknown) => void): () => void
    onError(handler: (payload: unknown) => void): () => void
    onCancelled(handler: (payload: unknown) => void): () => void
  }

  interface UploaderAPI {
    uploadImage(req: unknown): Promise<unknown>
  }

  interface FontsAPI {
    list(): Promise<string[]>
  }

  /** Plugin host bridge; failures resolve as `{ ok: false, error }` (see `PluginIpcResult`). */
  interface PluginsAPI {
    getState(): Promise<PluginHostState>
    setEnabled(pluginId: string, enabled: boolean): Promise<PluginIpcResult<null>>
    setSetting(pluginId: string, key: string, value: PluginSettingValue): Promise<PluginIpcResult<null>>
    setSecret(pluginId: string, key: string, value: string | null): Promise<PluginIpcResult<null>>
    invoke(pluginId: string, method: string, args: unknown[]): Promise<PluginIpcResult<unknown>>
    openSettings(pluginId: string): void
    onStateChanged(handler: (state: PluginHostState) => void): () => void
    onEvent(handler: (pluginId: string, event: string, payload: unknown) => void): () => void
  }

  /** Plugin file access scoped by main to the window's vault; failures resolve as `{ ok: false, error }`. */
  interface VaultAPI {
    readText(p: string): Promise<PluginIpcResult<{ content: string; mtimeMs: number }>>
    readBinary(p: string, maxBytes?: number): Promise<PluginIpcResult<Uint8Array>>
    writeText(p: string, content: string, expectedMtimeMs?: number): Promise<PluginIpcResult<{ mtimeMs: number }>>
    createText(p: string, content: string): Promise<PluginIpcResult<null>>
    exists(p: string): Promise<PluginIpcResult<boolean>>
    list(extensions?: string[]): Promise<PluginIpcResult<VaultFileEntry[]>>
    setActiveFile(pathname: string | null): void
  }

  /** Vault metadata index of the window's opened folder; empty/null results without one. */
  interface VaultIndexAPI {
    isReady(): Promise<boolean>
    getFile(p: string): Promise<FileMetadata | null>
    listFiles(): Promise<FileMetadata[]>
    resolveLink(target: string, sourcePath: string): Promise<string | null>
    getBacklinks(p: string): Promise<BacklinkEntry[]>
    getTags(): Promise<TagCount[]>
    getFilesWithTag(tag: string, options?: { includeNested?: boolean }): Promise<string[]>
    request(type: string, payload: unknown): Promise<unknown>
    onChanged(handler: (event: VaultChangeEvent) => void): () => void
    onReadyState(handler: (state: VaultIndexReadyState) => void): () => void
  }

  interface ProcessShim {
    platform: NodeJS.Platform
    arch?: string
    versions: Record<string, string>
    env: Record<string, string>
    resourcesPath?: string
    cwd: () => string | undefined
    nextTick: (fn: (...args: unknown[]) => void, ...args: unknown[]) => void
  }

  interface Window {
    electron: ElectronAPI
    fileUtils: FileUtilsAPI
    path: PathAPI
    commandExists: CommandExistsAPI
    i18nUtils: I18nUtilsAPI
    ripgrep: RipgrepAPI
    uploader: UploaderAPI
    fonts: FontsAPI
    diagram: DiagramAPI
    plugins: PluginsAPI
    vault: VaultAPI
    vaultIndex: VaultIndexAPI
    process: ProcessShim
    rgPath: string
    // Set by the legacy editor store at runtime; consumed by muya internals.
    DIRNAME: string
    marktext?: {
      env?: { windowId: number; [key: string]: unknown }
      initialState?: {
        codeFontFamily?: string | null
        codeFontSize?: string | null
        hideScrollbar?: boolean
        theme?: string | null
        titleBarStyle?: string | null
        [key: string]: unknown
      }
      paths?: { ripgrepBinaryPath?: string; [key: string]: unknown }
      [key: string]: unknown
    }
  }
}

export {}
