import type { ActiveTabInfo, BlockPath, CheckableBlock, DecorationRange } from '@/plugins/types'
import { annotationLength, BLOCK_SEPARATOR } from '../common/chunking'
import { hashText, isOptedOutByFrontMatter } from '../common/document'
import {
  classifyMatch,
  DECORATION_CLASS,
  ignoreKey,
  isMatchVisible,
  type MatchFilters,
  type ProblemKind
} from '../common/filters'
import { PLAN_LIMITS } from '../common/plans'
import type {
  CheckBlockInput,
  CheckResponse,
  GrammarErrorInfo,
  GrammarMatch,
  RequestSettings
} from '../common/types'

export interface Problem {
  /** Unique within one render; also the decoration's `data-ltid`. */
  id: string
  path: BlockPath
  /** Text of the block when the problem was found; used to detect edits before applying a fix. */
  blockText: string
  start: number
  end: number
  /** `blockText.slice(start, end)`. */
  flagged: string
  kind: ProblemKind
  match: GrammarMatch
}

export type CheckStatus =
  | { kind: 'idle' }
  | { kind: 'off' }
  | { kind: 'skipped' }
  | { kind: 'consent' }
  | { kind: 'config' }
  | { kind: 'checking' }
  | { kind: 'done' }
  | { kind: 'error'; code: 'AUTH' | 'QUOTA' | 'NETWORK' | 'SERVER'; message: string }

export interface SchedulerSettings {
  request: RequestSettings
  filters: Omit<MatchFilters, 'ignored'>
  checkOnType: boolean
  debounceMs: number
  consentGiven: boolean
}

/** What the scheduler needs from the plugin context; a seam for tests. */
export interface SchedulerHost {
  getActiveTab(): ActiveTabInfo | null
  getMarkdown(): string | null
  getCheckableBlocks(): CheckableBlock[]
  setDecorations(ranges: DecorationRange[]): void
  clearDecorations(): void
  check(blocks: CheckBlockInput[]): Promise<CheckResponse>
  getSettings(): SchedulerSettings
  /** False when the selected server lacks required settings (credentials, URL). */
  isConfigured(): boolean
  /** Path of the block holding the caret, or null. */
  getCaretPath(): BlockPath | null
  /** Asks the user for consent when it was not given yet; resolves to whether it is given now. */
  requestConsent(): Promise<boolean>
  onDidUpdate(status: CheckStatus, problems: Problem[]): void
}

interface DocumentBlock extends CheckableBlock {
  hash: string
  cacheKey: string
  length: number
}

/** Delay before checking a freshly loaded document, so tab switches in a row cost one check. */
export const LOAD_DELAY_MS = 50
const NETWORK_RETRY_MS = 30_000
const QUOTA_RETRY_MS = 60_000
const MAX_CACHE_ENTRIES = 5000
/** Blocks per `check` call; with the size limit it keeps results arriving progressively on long documents. */
const MAX_BLOCKS_PER_BATCH = 100
const LETTER = /\p{L}/u

const settingsKeyOf = (request: RequestSettings): string =>
  [request.server, request.server === 'custom' ? request.serverUrl : '', request.language, request.level, request.motherTongue, request.username].join('\u0001')

const samePath = (a: BlockPath, b: BlockPath): boolean => a.length === b.length && a.every((step, i) => step === b[i])

/**
 * Decides when and what to send for checking, and turns results into
 * decorations. Results are cached per block text (and request settings), so
 * only new or edited blocks are sent and moving blocks around costs nothing.
 * A result always describes the text that was sent: once a block's text
 * changes, its cache key changes and the stale result is never shown.
 */
export class CheckScheduler {
  private readonly cache = new Map<string, GrammarMatch[]>()
  private readonly ignored = new Set<string>()
  private enabled = true
  private timer: ReturnType<typeof setTimeout> | null = null
  private timerSends = false
  private running = false
  private rerun = false
  private disposed = false
  /** Requests are paused until this time (ms epoch) after QUOTA/NETWORK/SERVER errors. */
  private pausedUntil = 0
  /** Set after AUTH; cleared when request settings change or on an explicit check. */
  private authFailed = false
  /** The user declined consent in this session; asked again only on an explicit check. */
  private consentDeclined = false
  private status: CheckStatus = { kind: 'idle' }
  private problems: Problem[] = []
  private lastSignature = ''

  constructor(private readonly host: SchedulerHost) {}

  get currentStatus(): CheckStatus {
    return this.status
  }

  get currentProblems(): readonly Problem[] {
    return this.problems
  }

  get isEnabled(): boolean {
    return this.enabled
  }

  /** After an edit of the active document. */
  notifyEdit(): void {
    const { checkOnType, debounceMs } = this.host.getSettings()
    this.schedule(debounceMs, checkOnType)
  }

  /** After a document was loaded or the active tab changed. */
  notifyDocumentChanged(): void {
    this.schedule(LOAD_DELAY_MS, true)
  }

  /** Request settings changed: cached results no longer apply. */
  notifyRequestSettingsChanged(): void {
    this.cache.clear()
    this.authFailed = false
    this.pausedUntil = 0
    this.schedule(0, true)
  }

  /** Filters, consent or configuration changed. */
  notifySettingsChanged(): void {
    this.schedule(0, true)
  }

  /** Re-checks every block of the active document now, even when checking on type is off or after an error. */
  checkNow(): void {
    const settingsKey = settingsKeyOf(this.host.getSettings().request)
    for (const block of this.host.getCheckableBlocks()) this.cache.delete(`${settingsKey}\u0000${hashText(block.text)}`)
    this.authFailed = false
    this.pausedUntil = 0
    this.consentDeclined = false
    this.schedule(0, true)
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled
    this.schedule(0, true)
  }

  /** Hides `problem` (same rule and text) for the rest of the session. */
  ignore(problem: Problem): void {
    this.ignored.add(ignoreKey(problem.match, problem.flagged))
    this.schedule(0, false)
  }

  dispose(): void {
    this.disposed = true
    clearTimeout(this.timer ?? undefined)
    this.timer = null
  }

  /**
   * Runs `run` after `delay` ms; a later call replaces the pending one, and a
   * pending sending run is never downgraded to a render-only one.
   */
  private schedule(delay: number, send: boolean): void {
    if (this.disposed) return
    const sends = send || (this.timer !== null && this.timerSends)
    clearTimeout(this.timer ?? undefined)
    this.timerSends = sends
    this.timer = setTimeout(() => {
      this.timer = null
      this.run(sends).catch((err: unknown) => {
        console.error('[grammar] check failed:', err)
      })
    }, delay)
  }

  /** Runs one scheduling pass; exposed for tests that drive it without timers. */
  async run(send: boolean): Promise<void> {
    if (this.disposed) return
    if (this.running) {
      if (send) this.rerun = true
      else this.collectAndRender()
      return
    }
    if (!send) {
      this.collectAndRender()
      return
    }
    this.running = true
    try {
      await this.sendLoop()
    } finally {
      this.running = false
      if (this.rerun && !this.disposed) {
        this.rerun = false
        this.schedule(0, true)
      }
    }
  }

  private async sendLoop(): Promise<void> {
    for (;;) {
      const doc = this.collectAndRender()
      if (!doc || this.disposed) return
      const missing = this.missing(doc)
      if (missing.length === 0) {
        this.setStatus({ kind: 'done' })
        return
      }
      if (this.authFailed) return
      const pauseLeft = this.pausedUntil - Date.now()
      if (pauseLeft > 0) {
        // Edits replace the pending timer; keep the resume at the end of the pause.
        this.schedule(pauseLeft, true)
        return
      }

      const settings = this.host.getSettings()
      if (!settings.consentGiven) {
        if (this.consentDeclined || !(await this.host.requestConsent())) {
          this.consentDeclined = true
          this.setStatus({ kind: 'consent' })
          return
        }
        continue
      }

      const batch = this.takeBatch(missing, settings.request)
      const settingsKey = settingsKeyOf(settings.request)
      this.setStatus({ kind: 'checking' })
      let response: CheckResponse
      try {
        response = await this.host.check(batch.map((block) => ({ key: block.hash, annotation: block.annotation })))
      } catch (err) {
        response = { results: [], error: { code: 'SERVER', message: err instanceof Error ? err.message : String(err) } }
      }
      if (this.disposed) return
      // Results of a request made with other settings describe another check; drop them.
      if (settingsKeyOf(this.host.getSettings().request) === settingsKey) {
        for (const result of response.results) this.remember(`${settingsKey}\u0000${result.key}`, result.matches)
      }
      if (response.error) {
        this.handleError(response.error)
        this.collectAndRender()
        return
      }
    }
  }

  private handleError(error: GrammarErrorInfo): void {
    switch (error.code) {
      case 'CONSENT':
        this.consentDeclined = true
        this.setStatus({ kind: 'consent' })
        return
      case 'CONFIG':
        this.setStatus({ kind: 'config' })
        return
      case 'AUTH':
        this.authFailed = true
        break
      case 'QUOTA':
        this.pause(error.retryAfterMs ?? QUOTA_RETRY_MS)
        break
      default:
        this.pause(NETWORK_RETRY_MS)
    }
    this.setStatus({ kind: 'error', code: error.code, message: error.message })
  }

  private pause(ms: number): void {
    this.pausedUntil = Date.now() + ms
    this.schedule(ms, true)
  }

  private remember(key: string, matches: GrammarMatch[]): void {
    this.cache.delete(key)
    this.cache.set(key, matches)
    while (this.cache.size > MAX_CACHE_ENTRIES) {
      const oldest = this.cache.keys().next().value
      if (oldest === undefined) break
      this.cache.delete(oldest)
    }
  }

  private missing(doc: DocumentBlock[]): DocumentBlock[] {
    const seen = new Set<string>()
    return doc.filter((block) => {
      if (this.cache.has(block.cacheKey) || seen.has(block.cacheKey)) return false
      seen.add(block.cacheKey)
      return true
    })
  }

  /** Blocks closest to the caret first, packed up to the plan's request size. */
  private takeBatch(missing: DocumentBlock[], request: RequestSettings): DocumentBlock[] {
    const { maxCharsPerRequest } = PLAN_LIMITS[request.server]
    const caret = this.host.getCaretPath()
    const caretIndex = caret ? Math.max(0, missing.findIndex((block) => samePath(block.path, caret))) : 0
    const ordered = missing
      .map((block, index) => ({ block, distance: Math.abs(index - caretIndex) }))
      .sort((a, b) => a.distance - b.distance)
      .map(({ block }) => block)

    const batch: DocumentBlock[] = []
    let size = 0
    for (const block of ordered) {
      if (block.length > maxCharsPerRequest) {
        // Too long for any request: remember it as checked so it is not retried forever.
        this.remember(block.cacheKey, [])
        continue
      }
      const added = (batch.length > 0 ? BLOCK_SEPARATOR.markup.length : 0) + block.length
      if (size + added > maxCharsPerRequest || batch.length >= MAX_BLOCKS_PER_BATCH) break
      batch.push(block)
      size += added
    }
    return batch
  }

  /** Reads the active document, updates decorations from the cache and returns its blocks (null when not checkable). */
  private collectAndRender(): DocumentBlock[] | null {
    const doc = this.collect()
    if (doc) this.render(doc)
    return doc
  }

  private collect(): DocumentBlock[] | null {
    if (!this.enabled) return this.stop({ kind: 'off' })
    const tab = this.host.getActiveTab()
    const markdown = tab && tab.kind === 'markdown' && !tab.viewId ? this.host.getMarkdown() : null
    if (markdown === null) return this.stop({ kind: 'idle' })
    if (isOptedOutByFrontMatter(markdown)) return this.stop({ kind: 'skipped' })
    if (!this.host.isConfigured()) return this.stop({ kind: 'config' })

    const settingsKey = settingsKeyOf(this.host.getSettings().request)
    const blocks: DocumentBlock[] = []
    for (const block of this.host.getCheckableBlocks()) {
      if (!block.annotation.some((part) => 'text' in part && LETTER.test(part.text))) continue
      const hash = hashText(block.text)
      blocks.push({ ...block, hash, cacheKey: `${settingsKey}\u0000${hash}`, length: annotationLength(block.annotation) })
    }
    if (this.status.kind === 'idle' || this.status.kind === 'off' || this.status.kind === 'skipped' || this.status.kind === 'config') {
      this.setStatus({ kind: 'done' })
    }
    return blocks
  }

  private stop(status: CheckStatus): null {
    if (this.problems.length > 0 || this.lastSignature !== '') {
      this.problems = []
      this.lastSignature = ''
      this.host.clearDecorations()
    }
    this.setStatus(status)
    return null
  }

  private render(doc: DocumentBlock[]): void {
    const filters: MatchFilters = { ...this.host.getSettings().filters, ignored: this.ignored }
    const problems: Problem[] = []
    const ranges: DecorationRange[] = []
    doc.forEach((block, index) => {
      const matches = this.cache.get(block.cacheKey)
      if (!matches) return
      for (const match of matches) {
        const end = match.offset + match.length
        if (end > block.text.length || !isMatchVisible(match, block.text, filters)) continue
        const kind = classifyMatch(match)
        const id = `${index}-${match.offset}-${match.length}-${problems.length}`
        problems.push({
          id,
          path: block.path,
          blockText: block.text,
          start: match.offset,
          end,
          flagged: block.text.slice(match.offset, end),
          kind,
          match
        })
        ranges.push({ path: block.path, start: match.offset, end, className: DECORATION_CLASS[kind], data: { ltid: id } })
      }
    })
    this.problems = problems
    const signature = JSON.stringify(ranges)
    if (signature !== this.lastSignature) {
      this.lastSignature = signature
      this.host.setDecorations(ranges)
    }
    this.host.onDidUpdate(this.status, this.problems)
  }

  private setStatus(status: CheckStatus): void {
    this.status = status
    this.host.onDidUpdate(status, this.problems)
  }
}
