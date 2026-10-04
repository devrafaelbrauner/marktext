import { ref, shallowRef, watch, type Ref, type ShallowRef } from 'vue'
import type { RendererPluginContext } from '@/plugins/types'
import type { WeekStart } from '../common/calendar'
import { DEFAULT_DATE_FORMAT, NOTES_REQUEST } from '../common/constants'
import {
  basenameOf,
  dailyNoteRelativePath,
  dateToKey,
  dayjs,
  joinRoot,
  keyToDate,
  templateRelativePath,
  toDayjsLocale,
  type DailyNoteLocation,
  type Dayjs,
  type DateKey
} from '../common/dates'
import { DailyNoteIndex, type NotesResponse } from '../common/noteIndex'
import { renderTemplate } from '../common/template'

export interface DailyNoteSettings {
  folder: string
  format: string
  template: string
  weekStart: WeekStart
  openOnStartup: boolean
}

const readSettings = (ctx: RendererPluginContext): DailyNoteSettings => ({
  folder: ctx.settings.get<string>('folder'),
  format: ctx.settings.get<string>('format').trim() || DEFAULT_DATE_FORMAT,
  template: ctx.settings.get<string>('template'),
  weekStart: ctx.settings.get<string>('weekStart') === 'monday' ? 'monday' : 'sunday',
  openOnStartup: ctx.settings.get<boolean>('openOnStartup')
})

// Bursts of index changes (a sync client, a bulk rename) cause one refresh.
const REFRESH_DELAY_MS = 250

const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error))

/**
 * State and actions of the plugin for one activation: the daily notes of the
 * opened folder (rebuilt from the vault index on every change) and the
 * open/create commands shared by the command palette and the calendar.
 */
export class DailyNotesService {
  /** Daily notes of the opened folder; null without a folder or before the first answer of the index. */
  readonly index: ShallowRef<DailyNoteIndex | null> = shallowRef(null)
  readonly rootPath: Ref<string | null>
  readonly settings: ShallowRef<DailyNoteSettings>
  private refreshTimer: number | undefined
  private generation = 0
  private pending: Promise<DailyNoteIndex | null> | null = null
  private disposed = false

  constructor(private readonly ctx: RendererPluginContext) {
    this.rootPath = ref(ctx.workspace.getRootPath())
    this.settings = shallowRef(readSettings(ctx))
  }

  /** Subscribes to the folder, index, settings and language; everything is released with the plugin. */
  start(): void {
    const { ctx } = this
    ctx.workspace.onDidChangeRootPath((rootPath) => {
      this.rootPath.value = rootPath
      this.index.value = null
      this.refresh()
    })
    ctx.metadata.onDidBecomeReady(() => this.refresh())
    ctx.metadata.onDidChange(() => this.scheduleRefresh())
    ctx.settings.onDidChange(() => {
      this.settings.value = readSettings(ctx)
      this.refresh()
    })
    // Localized tokens (`MMMM`, `dddd`) read differently in another language.
    const stopLanguageWatch = watch(ctx.language, () => this.refresh())
    ctx.track({
      dispose: () => {
        stopLanguageWatch()
        this.disposed = true
        window.clearTimeout(this.refreshTimer)
      }
    })
    this.refresh()
  }

  location(): DailyNoteLocation {
    const { folder, format } = this.settings.value
    return { folder, format, locale: toDayjsLocale(this.ctx.language.value) }
  }

  private scheduleRefresh(): void {
    window.clearTimeout(this.refreshTimer)
    this.refreshTimer = window.setTimeout(() => {
      this.refreshTimer = undefined
      this.refresh()
    }, REFRESH_DELAY_MS)
  }

  /** Rebuilds `index` from the vault index; a newer call supersedes an older one still in flight. */
  refresh(): Promise<DailyNoteIndex | null> {
    const generation = ++this.generation
    const task: Promise<DailyNoteIndex | null> = this.load(generation).finally(() => {
      if (this.pending === task) this.pending = null
    })
    this.pending = task
    return task
  }

  private async load(generation: number): Promise<DailyNoteIndex | null> {
    if (!this.rootPath.value) {
      this.index.value = null
      return null
    }
    let response: NotesResponse
    try {
      response = await this.ctx.metadata.request<NotesResponse>(NOTES_REQUEST, null)
    } catch (error) {
      // The index of a folder that is still being opened rejects; onDidBecomeReady retries.
      console.warn('[daily-notes] could not list notes:', errorMessage(error))
      return this.index.value
    }
    if (this.disposed || generation !== this.generation) return this.pending ?? this.index.value
    const index = new DailyNoteIndex(response.rootPath, this.location(), response.notes)
    this.index.value = index
    return index
  }

  private async currentIndex(): Promise<DailyNoteIndex | null> {
    return this.index.value ?? (await (this.pending ?? this.refresh()))
  }

  private notify(type: 'info' | 'warning' | 'error', key: string, params?: Record<string, string | number>): void {
    this.ctx.ui.notify({ type, message: this.ctx.t(key, params) })
  }

  async openToday(): Promise<void> {
    await this.openDate(dateToKey(dayjs()))
  }

  /**
   * Opens the daily note of `date`: the file at the configured path, else
   * another file the calendar counts as that day's note, else a new note at
   * the configured path filled from the template.
   */
  async openDate(date: DateKey): Promise<void> {
    const root = this.ctx.workspace.getRootPath()
    if (!root) {
      this.notify('warning', 'notify.noFolder')
      return
    }
    const location = this.location()
    const day = keyToDate(date)
    const relative = dailyNoteRelativePath(day, location)
    if (!relative) {
      this.notify('error', 'notify.invalidFormat', { format: location.format })
      return
    }
    const path = joinRoot(root, relative)
    try {
      if (await this.ctx.vault.exists(path)) {
        await this.ctx.workspace.openFile(path)
        return
      }
      const existing = this.index.value?.get(date)
      if (existing) {
        await this.ctx.workspace.openFile(existing.path)
        return
      }
      const content = await this.renderNewNote(root, day, basenameOf(relative), location)
      await this.ctx.workspace.createAndOpenFile(path, content)
    } catch (error) {
      this.notify('error', 'notify.openFailed', { message: errorMessage(error) })
    }
  }

  private async renderNewNote(root: string, date: Dayjs, title: string, location: DailyNoteLocation): Promise<string> {
    const templatePath = templateRelativePath(this.settings.value.template)
    if (!templatePath) return ''
    let template: string
    try {
      template = (await this.ctx.vault.readText(joinRoot(root, templatePath))).content
    } catch {
      this.notify('warning', 'notify.templateMissing', { path: templatePath })
      return ''
    }
    return renderTemplate(template, { date, now: dayjs(), format: location.format, title, locale: location.locale })
  }

  /** Opens the nearest existing daily note before (-1) or after (+1) the one in the active tab. */
  async openAdjacent(direction: -1 | 1): Promise<void> {
    if (!this.ctx.workspace.getRootPath()) {
      this.notify('warning', 'notify.noFolder')
      return
    }
    const index = await this.currentIndex()
    const pathname = this.ctx.editor.getActiveTab()?.pathname
    const date = index && pathname ? index.dateOf(pathname) : null
    if (!index || !date) {
      this.notify('info', 'notify.notDailyNote')
      return
    }
    const target = index.adjacent(date, direction)
    if (!target) {
      this.notify('info', direction < 0 ? 'notify.noPrevious' : 'notify.noNext')
      return
    }
    try {
      await this.ctx.workspace.openFile(target.path)
    } catch (error) {
      this.notify('error', 'notify.openFailed', { message: errorMessage(error) })
    }
  }
}
