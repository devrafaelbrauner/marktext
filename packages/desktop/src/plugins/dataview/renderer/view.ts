import { watch } from 'vue'
import { generateGithubSlug } from '@muyajs/core'
import { getLinkExtension, isMarkdownExtension } from 'common/markdownExt'
import type { RendererPluginContext } from '@/plugins/types'
import type { QueryResponse, QueryResult, TaskItem } from '../common/engine'
import { QueryError, toErrorInfo, type QueryErrorInfo } from '../common/errors'
import { parseQuery } from '../common/parser'
import { QUERY_REQUEST, type DataviewQueryRequest } from '../common/protocol'
import { toggleTaskInContent } from '../common/tasks'
import { linkText, typeOf, type LinkValue, type ObjectValue, type Value } from '../common/values'
import {
  EMPTY_VALUE,
  formatQueryError,
  escapeHtml,
  formatValueText,
  resultToHtml,
  splitWikilinks,
  toIntlLocale,
  wikilinkLabel
} from './format'

/** Delay before re-running visible queries after the index reported changes. */
const INDEX_CHANGE_DEBOUNCE_MS = 500

type QueryOutcome =
  | { kind: 'result'; result: QueryResult }
  | { kind: 'error'; error: QueryErrorInfo }
  | { kind: 'noFolder' }
  | { kind: 'indexing' }

interface LiveView {
  refresh(): void
}

const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error))

const isMarkdownPath = (path: string): boolean => {
  const name = path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1)
  return isMarkdownExtension(getLinkExtension(name))
}

/**
 * Runs and renders ```dataview blocks. One instance per plugin activation
 * keeps the index/language listeners and re-runs every live preview when
 * the vault index changes (debounced), becomes ready, the folder changes or
 * the UI language changes.
 */
export class DataviewViews {
  private readonly views = new Set<LiveView>()
  private refreshTimer: number | undefined

  constructor(private readonly ctx: RendererPluginContext) {
    ctx.metadata.onDidChange(() => this.scheduleRefresh(INDEX_CHANGE_DEBOUNCE_MS))
    ctx.metadata.onDidBecomeReady(() => this.scheduleRefresh(0))
    ctx.workspace.onDidChangeRootPath(() => this.scheduleRefresh(0))
    const stopLanguageWatch = watch(ctx.language, () => this.scheduleRefresh(0))
    ctx.track({
      dispose: () => {
        stopLanguageWatch()
        window.clearTimeout(this.refreshTimer)
        this.views.clear()
      }
    })
  }

  private scheduleRefresh(delay: number): void {
    window.clearTimeout(this.refreshTimer)
    this.refreshTimer = window.setTimeout(() => {
      for (const view of [...this.views]) view.refresh()
    }, delay)
  }

  /** Runs `source` against the index of the window's folder, as the note `originPath`. */
  async run(source: string, originPath: string | null): Promise<QueryOutcome> {
    try {
      parseQuery(source)
    } catch (error) {
      if (error instanceof QueryError) return { kind: 'error', error: toErrorInfo(error, source) }
      throw error
    }
    if (!this.ctx.workspace.getRootPath()) return { kind: 'noFolder' }
    if (!this.ctx.metadata.isReady()) return { kind: 'indexing' }
    const request: DataviewQueryRequest = { query: source, originPath }
    const response = await this.ctx.metadata.request<QueryResponse | null>(QUERY_REQUEST, request)
    if (response === null) return { kind: 'noFolder' }
    return response.ok ? { kind: 'result', result: response.result } : { kind: 'error', error: response.error }
  }

  /** Static HTML of a query for HTML/PDF export (results, or the localized message shown instead). */
  async exportHtml(source: string): Promise<string> {
    const { t } = this.ctx
    const outcome = await this.run(source, this.ctx.editor.getActiveTab()?.pathname ?? null)
    const paragraph = (className: string, text: string): string => `<p class="${className}">${escapeHtml(text)}</p>`
    switch (outcome.kind) {
      case 'noFolder':
        return paragraph('dataview-status', t('status.noFolder'))
      case 'indexing':
        return paragraph('dataview-status', t('status.indexing'))
      case 'error':
        return paragraph('dataview-error', formatQueryError(outcome.error, t))
      case 'result': {
        const { result } = outcome
        return resultToHtml(result, {
          locale: toIntlLocale(this.ctx.language.value),
          file: t('table.file'),
          empty: t('status.empty'),
          truncated: truncationNotice(this.ctx, result)
        })
      }
    }
  }

  /** Mounts a live preview of `source` into `container`; the engine calls the returned cleanup before the next render and on removal. */
  mount(container: HTMLElement, source: string): () => void {
    const view = new QueryView(this.ctx, this, container, source, this.ctx.editor.getActiveTab()?.pathname ?? null)
    this.views.add(view)
    view.refresh()
    return () => {
      this.views.delete(view)
      view.dispose()
    }
  }
}

const truncationNotice = (ctx: RendererPluginContext, result: QueryResult): string | null => {
  const shown =
    result.type === 'table'
      ? result.rows.length
      : result.type === 'list'
        ? result.items.length
        : result.groups.reduce((count, group) => count + group.tasks.length, 0)
  return shown < result.total ? ctx.t('status.truncated', { shown, total: result.total }) : null
}

class QueryView implements LiveView {
  private readonly root: HTMLDivElement
  private generation = 0
  private disposed = false

  constructor(
    private readonly ctx: RendererPluginContext,
    private readonly views: DataviewViews,
    container: HTMLElement,
    private readonly source: string,
    private readonly originPath: string | null
  ) {
    this.root = document.createElement('div')
    this.root.className = 'dataview'
    container.append(this.root)
  }

  dispose(): void {
    this.disposed = true
    this.generation++
  }

  refresh(): void {
    const generation = ++this.generation
    this.views.run(this.source, this.originPath).then(
      (outcome) => {
        if (this.disposed || generation !== this.generation) return
        this.show(outcome)
      },
      (error: unknown) => {
        if (this.disposed || generation !== this.generation) return
        this.showMessage(this.ctx.t('status.failed', { message: errorMessage(error) }), 'dataview-error')
      }
    )
  }

  private get locale(): string {
    return toIntlLocale(this.ctx.language.value)
  }

  private show(outcome: QueryOutcome): void {
    const { t } = this.ctx
    switch (outcome.kind) {
      case 'noFolder':
        this.showMessage(t('status.noFolder'), 'dataview-status')
        return
      case 'indexing':
        this.showMessage(t('status.indexing'), 'dataview-status')
        return
      case 'error':
        this.showMessage(formatQueryError(outcome.error, t), 'dataview-error')
        return
      case 'result':
        this.showResult(outcome.result)
    }
  }

  private showMessage(text: string, className: 'dataview-status' | 'dataview-error'): void {
    const message = document.createElement('p')
    message.className = className
    message.setAttribute('role', className === 'dataview-error' ? 'alert' : 'status')
    message.textContent = text
    this.root.replaceChildren(message)
  }

  private showResult(result: QueryResult): void {
    const isEmpty =
      result.type === 'table' ? result.rows.length === 0 : result.type === 'list' ? result.items.length === 0 : result.groups.length === 0
    if (isEmpty) {
      this.showMessage(this.ctx.t('status.empty'), 'dataview-status')
      return
    }
    const content = result.type === 'table' ? this.renderTable(result) : result.type === 'list' ? this.renderList(result) : this.renderTasks(result)
    const nodes: Node[] = [content]
    const notice = truncationNotice(this.ctx, result)
    if (notice) {
      const note = document.createElement('p')
      note.className = 'dataview-note'
      note.textContent = notice
      nodes.push(note)
    }
    this.root.replaceChildren(...nodes)
  }

  private renderTable(result: Extract<QueryResult, { type: 'table' }>): HTMLElement {
    const wrap = document.createElement('div')
    wrap.className = 'dataview-table-wrap'
    const table = document.createElement('table')
    table.className = 'dataview-table'
    const headRow = table.createTHead().insertRow()
    const headers = [...(result.idColumn ? [this.ctx.t('table.file')] : []), ...result.headers]
    for (const header of headers) {
      const th = document.createElement('th')
      th.scope = 'col'
      th.textContent = header
      headRow.append(th)
    }
    const body = table.createTBody()
    for (const row of result.rows) {
      const tr = body.insertRow()
      if (result.idColumn) tr.insertCell().append(this.renderValue(row.link))
      for (const cell of row.cells) tr.insertCell().append(this.renderValue(cell))
    }
    wrap.append(table)
    return wrap
  }

  private renderList(result: Extract<QueryResult, { type: 'list' }>): HTMLElement {
    const list = document.createElement('ul')
    list.className = 'dataview-list'
    for (const item of result.items) {
      const li = document.createElement('li')
      if (result.idColumn || !result.hasValue) li.append(this.renderValue(item.link))
      if (result.hasValue) {
        if (result.idColumn) li.append(': ')
        li.append(this.renderValue(item.value))
      }
      list.append(li)
    }
    return list
  }

  private renderTasks(result: Extract<QueryResult, { type: 'task' }>): HTMLElement {
    const container = document.createElement('div')
    container.className = 'dataview-tasks'
    for (const group of result.groups) {
      const section = document.createElement('section')
      section.className = 'dataview-task-group'
      const heading = document.createElement('p')
      heading.className = 'dataview-task-file'
      heading.append(this.renderLink(group.link))
      const list = document.createElement('ul')
      list.className = 'dataview-task-list'
      for (const task of group.tasks) list.append(this.renderTask(group.link.path, task))
      section.append(heading, list)
      container.append(section)
    }
    return container
  }

  private renderTask(path: string, task: TaskItem): HTMLElement {
    const li = document.createElement('li')
    li.className = 'dataview-task'
    if (task.checked) li.classList.add('dataview-task-checked')
    const checkbox = document.createElement('input')
    checkbox.type = 'checkbox'
    checkbox.checked = task.checked
    checkbox.dataset.status = task.status
    checkbox.setAttribute('aria-label', this.ctx.t('task.toggle', { text: task.text }))
    checkbox.addEventListener('change', () => {
      li.classList.toggle('dataview-task-checked', checkbox.checked)
      this.toggleTask(path, task, checkbox)
    })
    const text = document.createElement('span')
    text.className = 'dataview-task-text'
    for (const segment of splitWikilinks(task.text)) {
      if ('text' in segment) {
        text.append(segment.text)
        continue
      }
      const { link } = segment
      text.append(
        this.createAnchor(wikilinkLabel(link), link.target || path, async() => {
          const target = link.target ? await this.ctx.metadata.resolveLink(link.target, path) : path
          if (target) await this.open(target, link.blockId ? `^${link.blockId}` : (link.heading ?? link.subpath ?? null))
        })
      )
    }
    li.append(checkbox, ' ', text)
    return li
  }

  private async toggleTask(path: string, task: TaskItem, checkbox: HTMLInputElement): Promise<void> {
    const { ctx } = this
    const checked = checkbox.checked
    const revert = (): void => {
      checkbox.checked = !checked
      checkbox.closest('li')?.classList.toggle('dataview-task-checked', !checked)
    }
    try {
      // The active document may hold unsaved edits: start from the editor's text then.
      const active = ctx.editor.getActiveTab()
      const fromEditor = active?.kind === 'markdown' && active.pathname === path ? ctx.editor.getMarkdown() : null
      const current = fromEditor !== null ? { content: fromEditor, mtimeMs: undefined } : await ctx.vault.readText(path)
      const next = toggleTaskInContent(current.content, task.line, task.text, checked)
      if (next === null) {
        revert()
        ctx.ui.notify({ type: 'warning', message: ctx.t('task.changed') })
        this.refresh()
        return
      }
      const options = current.mtimeMs === undefined ? undefined : { expectedMtimeMs: current.mtimeMs }
      await ctx.vault.writeText(path, next, options)
      task.checked = checked
      task.status = checked ? 'x' : ' '
    } catch (error) {
      revert()
      const code = (error as { code?: unknown } | null)?.code
      if (code === 'CONFLICT') {
        const name = path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1)
        ctx.ui.notify({ type: 'warning', message: ctx.t('task.conflict', { file: name }) })
        this.refresh()
      } else {
        ctx.ui.notify({ type: 'error', message: ctx.t('task.writeFailed', { message: errorMessage(error) }) })
      }
    }
  }

  private renderValue(value: Value): Node {
    switch (typeOf(value)) {
      case 'link':
        return this.renderLink(value as LinkValue)
      case 'array': {
        const items = value as Value[]
        if (items.length === 0) return document.createTextNode(EMPTY_VALUE)
        const fragment = document.createDocumentFragment()
        items.forEach((item, i) => {
          if (i > 0) fragment.append(', ')
          fragment.append(this.renderValue(item))
        })
        return fragment
      }
      case 'object': {
        const entries = Object.entries((value as ObjectValue).entries)
        if (entries.length === 0) return document.createTextNode(EMPTY_VALUE)
        const fragment = document.createDocumentFragment()
        entries.forEach(([key, entry], i) => {
          fragment.append(`${i > 0 ? ', ' : ''}${key}: `, this.renderValue(entry))
        })
        return fragment
      }
      default:
        return document.createTextNode(formatValueText(value, this.locale))
    }
  }

  private renderLink(link: LinkValue): Node {
    const label = linkText(link)
    if (!link.resolved) {
      const span = document.createElement('span')
      span.className = 'dataview-link dataview-link-unresolved'
      span.title = this.ctx.t('link.unresolved', { name: label })
      span.textContent = label
      return span
    }
    return this.createAnchor(label, link.path, () => this.open(link.path, link.subpath))
  }

  private createAnchor(label: string, title: string, activate: () => Promise<void>): HTMLAnchorElement {
    const anchor = document.createElement('a')
    anchor.className = 'dataview-link'
    anchor.href = '#'
    anchor.textContent = label
    anchor.title = title
    anchor.setAttribute('aria-label', this.ctx.t('link.open', { name: label }))
    anchor.addEventListener('click', (event) => {
      event.preventDefault()
      activate().catch((error: unknown) => {
        this.ctx.ui.notify({ type: 'error', message: errorMessage(error) })
      })
    })
    return anchor
  }

  private async open(path: string, subpath: string | null): Promise<void> {
    if (!subpath || subpath.startsWith('^')) return this.ctx.workspace.openFile(path)
    if (isMarkdownPath(path)) return this.ctx.workspace.openFile(path, { anchor: generateGithubSlug(subpath) })
    return this.ctx.workspace.openFile(path, { subpath })
  }
}
