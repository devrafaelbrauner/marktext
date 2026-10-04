import { afterEach, describe, expect, it, vi } from 'vitest'
import { hashText } from '@plugins/grammar/common/document'
import type { CheckBlockInput, CheckResponse, GrammarMatch } from '@plugins/grammar/common/types'
import {
  CheckScheduler,
  type CheckStatus,
  type Problem,
  type SchedulerHost,
  type SchedulerSettings
} from '@plugins/grammar/renderer/scheduler'
import type { ActiveTabInfo, BlockPath, CheckableBlock, DecorationRange } from '@/plugins/types'

const match = (offset: number, length: number, overrides: Partial<GrammarMatch> = {}): GrammarMatch => ({
  offset,
  length,
  message: 'm',
  shortMessage: '',
  replacements: ['x'],
  ruleId: 'RULE',
  ruleDescription: '',
  issueType: 'grammar',
  categoryId: 'GRAMMAR',
  categoryName: 'Gramática',
  urls: [],
  ...overrides
})

interface Deferred {
  blocks: CheckBlockInput[]
  resolve(response: CheckResponse): void
}

class FakeHost implements SchedulerHost {
  markdown = 'doc'
  tab: ActiveTabInfo | null = { id: 't1', pathname: '/v/a.md', filename: 'a.md', isSaved: true, kind: 'markdown', viewId: null }
  blocks: CheckableBlock[] = []
  settings: SchedulerSettings = {
    request: { server: 'free', serverUrl: '', language: 'pt-BR', level: 'default', motherTongue: 'pt-BR', username: '' },
    filters: { disabledRules: [], disabledCategories: [], dictionary: [] },
    checkOnType: true,
    debounceMs: 800,
    consentGiven: true
  }

  configured = true
  caret: BlockPath | null = null
  consentAnswer = true
  consentRequests = 0
  decorations: DecorationRange[] = []
  status: CheckStatus = { kind: 'idle' }
  problems: Problem[] = []
  pending: Deferred[] = []
  /** When set, `check` answers immediately with this function's result. */
  answer: ((blocks: CheckBlockInput[]) => CheckResponse) | null = null

  setTexts(...texts: string[]): void {
    this.blocks = texts.map((text, i) => ({ path: [i], blockName: 'paragraph.content', text, annotation: [{ text }] }))
  }

  getActiveTab = () => this.tab
  getMarkdown = () => this.markdown
  getCheckableBlocks = () => this.blocks.map((b) => ({ ...b }))
  setDecorations = (ranges: DecorationRange[]) => {
    this.decorations = ranges
  }

  clearDecorations = () => {
    this.decorations = []
  }

  check = vi.fn((blocks: CheckBlockInput[]): Promise<CheckResponse> => {
    if (this.answer) return Promise.resolve(this.answer(blocks))
    return new Promise((resolve) => this.pending.push({ blocks, resolve }))
  })

  getSettings = () => this.settings
  isConfigured = () => this.configured
  getCaretPath = () => this.caret
  requestConsent = async() => {
    this.consentRequests++
    if (this.consentAnswer) this.settings = { ...this.settings, consentGiven: true }
    return this.consentAnswer
  }

  onDidUpdate = (status: CheckStatus, problems: Problem[]) => {
    this.status = status
    this.problems = problems
  }

  sentTexts(): string[] {
    return this.check.mock.calls.flatMap(([blocks]) => blocks.map((b) => b.annotation.map((p) => ('text' in p ? p.text : p.markup)).join('')))
  }
}

/** Answers each block with a match on the first occurrence of `vai` (if any). */
const answerVai = (blocks: CheckBlockInput[]): CheckResponse => ({
  results: blocks.map((block) => {
    const text = block.annotation.map((p) => ('text' in p ? p.text : p.markup)).join('')
    const offset = text.indexOf('vai')
    return { key: block.key, matches: offset >= 0 ? [match(offset, 3)] : [] }
  })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('grammar check scheduler', () => {
  it('sends only blocks without a cached result and decorates from the cache', async() => {
    const host = new FakeHost()
    host.answer = answerVai
    host.setTexts('Eu vai.', 'Tudo certo.')
    const scheduler = new CheckScheduler(host)

    await scheduler.run(true)
    expect(host.sentTexts()).toEqual(['Eu vai.', 'Tudo certo.'])
    expect(host.check.mock.calls[0][0].map((b) => b.key)).toEqual([hashText('Eu vai.'), hashText('Tudo certo.')])
    expect(host.decorations).toEqual([
      { path: [0], start: 3, end: 6, className: 'mu-decoration-grammar', data: { ltid: host.problems[0].id } }
    ])
    expect(host.status).toEqual({ kind: 'done' })

    // A new block above shifts paths; only it is sent, the known blocks keep their results.
    host.setTexts('Nós vai.', 'Eu vai.', 'Tudo certo.')
    await scheduler.run(true)
    expect(host.check).toHaveBeenCalledTimes(2)
    expect(host.check.mock.calls[1][0].map((b) => b.key)).toEqual([hashText('Nós vai.')])
    expect(host.decorations.map((d) => [d.path, d.start])).toEqual([
      [[0], 4],
      [[1], 3]
    ])
    expect(host.problems.map((p) => p.flagged)).toEqual(['vai', 'vai'])
  })

  it('discards a response whose block text changed while it was in flight', async() => {
    const host = new FakeHost()
    host.setTexts('Eu vai na escola.')
    const scheduler = new CheckScheduler(host)
    const running = scheduler.run(true)
    await vi.waitFor(() => expect(host.pending).toHaveLength(1))

    host.setTexts('Eu vou na escola, mas ele vai.')
    host.pending[0].resolve({ results: [{ key: host.pending[0].blocks[0].key, matches: [match(3, 3)] }] })
    // The loop sends the edited text next; leave it unanswered to inspect the state in between.
    await vi.waitFor(() => expect(host.pending).toHaveLength(2))
    expect(host.decorations).toEqual([])
    expect(host.pending[1].blocks[0].key).toBe(hashText('Eu vou na escola, mas ele vai.'))

    host.pending[1].resolve({ results: [{ key: host.pending[1].blocks[0].key, matches: [match(26, 3)] }] })
    await running
    expect(host.decorations.map((d) => [d.start, d.end])).toEqual([[26, 29]])
  })

  it('sends nothing before consent and asks only once per session unless checked explicitly', async() => {
    const host = new FakeHost()
    host.answer = answerVai
    host.settings.consentGiven = false
    host.consentAnswer = false
    host.setTexts('Eu vai.')
    const scheduler = new CheckScheduler(host)

    await scheduler.run(true)
    expect(host.consentRequests).toBe(1)
    expect(host.check).not.toHaveBeenCalled()
    expect(host.status).toEqual({ kind: 'consent' })

    await scheduler.run(true)
    expect(host.consentRequests).toBe(1)
    expect(host.check).not.toHaveBeenCalled()

    host.consentAnswer = true
    vi.useFakeTimers()
    scheduler.checkNow()
    await vi.runAllTimersAsync()
    expect(host.consentRequests).toBe(2)
    expect(host.check).toHaveBeenCalledTimes(1)
    expect(host.decorations).toHaveLength(1)
  })

  it('skips files that opt out in front matter and clears their decorations', async() => {
    const host = new FakeHost()
    host.answer = answerVai
    host.setTexts('Eu vai.')
    const scheduler = new CheckScheduler(host)
    await scheduler.run(true)
    expect(host.decorations).toHaveLength(1)

    host.markdown = '---\nlanguagetool: false\n---\n\nEu vai.'
    host.setTexts('Eu vai. Nós vai.')
    await scheduler.run(true)
    expect(host.check).toHaveBeenCalledTimes(1)
    expect(host.decorations).toEqual([])
    expect(host.problems).toEqual([])
    expect(host.status).toEqual({ kind: 'skipped' })
  })

  it('does nothing for asset tabs, custom views or an unconfigured server', async() => {
    const host = new FakeHost()
    host.answer = answerVai
    host.setTexts('Eu vai.')
    const scheduler = new CheckScheduler(host)

    const tab: ActiveTabInfo = { id: 't1', pathname: '/v/a.md', filename: 'a.md', isSaved: true, kind: 'asset', viewId: null }
    host.tab = tab
    await scheduler.run(true)
    host.tab = { ...tab, kind: 'markdown', viewId: 'kanban' }
    await scheduler.run(true)
    expect(host.status).toEqual({ kind: 'idle' })

    host.tab = { ...tab, kind: 'markdown' }
    host.configured = false
    await scheduler.run(true)
    expect(host.status).toEqual({ kind: 'config' })
    expect(host.check).not.toHaveBeenCalled()
  })

  it('sends the blocks around the caret first and skips blocks without letters', async() => {
    const host = new FakeHost()
    host.answer = answerVai
    host.setTexts('Um.', 'Dois.', '123', 'Três.', 'Quatro.', 'Cinco.')
    host.caret = [4]
    await new CheckScheduler(host).run(true)
    expect(host.sentTexts()).toEqual(['Quatro.', 'Três.', 'Cinco.', 'Dois.', 'Um.'])
  })

  it('applies rule, category, dictionary and session filters without new requests', async() => {
    const host = new FakeHost()
    host.answer = (blocks) => ({
      results: blocks.map((b) => ({
        key: b.key,
        matches: [
          match(0, 7, { ruleId: 'HUNSPELL', categoryId: 'TYPOS', issueType: 'misspelling' }),
          match(8, 3, { ruleId: 'AGREEMENT' }),
          match(12, 4, { ruleId: 'COMMA', categoryId: 'PUNCTUATION', issueType: 'typographical' })
        ]
      }))
    })
    host.setTexts('Obsidan vai bem.')
    const scheduler = new CheckScheduler(host)
    await scheduler.run(true)
    expect(host.decorations.map((d) => d.className)).toEqual([
      'mu-decoration-spelling',
      'mu-decoration-grammar',
      'mu-decoration-style'
    ])

    host.settings = { ...host.settings, filters: { disabledRules: ['AGREEMENT'], disabledCategories: ['PUNCTUATION'], dictionary: ['Obsidan'] } }
    await scheduler.run(false)
    expect(host.decorations).toEqual([])

    host.settings = { ...host.settings, filters: { disabledRules: [], disabledCategories: [], dictionary: [] } }
    await scheduler.run(false)
    scheduler.ignore(host.problems[1])
    await scheduler.run(false)
    expect(host.problems.map((p) => p.match.ruleId)).toEqual(['HUNSPELL', 'COMMA'])
    expect(host.check).toHaveBeenCalledTimes(1)
  })

  it('re-checks everything after request settings change', async() => {
    vi.useFakeTimers()
    const host = new FakeHost()
    host.answer = answerVai
    host.setTexts('Eu vai.')
    const scheduler = new CheckScheduler(host)
    await scheduler.run(true)

    host.settings = { ...host.settings, request: { ...host.settings.request, language: 'pt-PT' } }
    scheduler.notifyRequestSettingsChanged()
    await vi.runAllTimersAsync()
    expect(host.check).toHaveBeenCalledTimes(2)
  })

  it('drops results that arrive after the request settings changed', async() => {
    const host = new FakeHost()
    host.setTexts('Eu vai.')
    const scheduler = new CheckScheduler(host)
    const running = scheduler.run(true)
    await vi.waitFor(() => expect(host.pending).toHaveLength(1))
    host.settings = { ...host.settings, request: { ...host.settings.request, level: 'picky' } }
    host.pending[0].resolve({ results: [{ key: host.pending[0].blocks[0].key, matches: [match(3, 3)] }] })
    await vi.waitFor(() => expect(host.pending).toHaveLength(2))
    expect(host.decorations).toEqual([])
    host.pending[1].resolve({ results: [{ key: host.pending[1].blocks[0].key, matches: [] }] })
    await running
  })

  it('stops after an authentication error until settings change', async() => {
    vi.useFakeTimers()
    const host = new FakeHost()
    host.answer = () => ({ results: [], error: { code: 'AUTH', message: 'bad key' } })
    host.setTexts('Eu vai.')
    const scheduler = new CheckScheduler(host)
    await scheduler.run(true)
    expect(host.status).toEqual({ kind: 'error', code: 'AUTH', message: 'bad key' })

    scheduler.notifyEdit()
    await vi.runAllTimersAsync()
    expect(host.check).toHaveBeenCalledTimes(1)

    host.answer = answerVai
    scheduler.notifyRequestSettingsChanged()
    await vi.runAllTimersAsync()
    expect(host.check).toHaveBeenCalledTimes(2)
    expect(host.status).toEqual({ kind: 'done' })
  })

  it('pauses for Retry-After after a quota error and resumes by itself', async() => {
    vi.useFakeTimers()
    const host = new FakeHost()
    host.answer = () => ({ results: [], error: { code: 'QUOTA', message: 'limit', retryAfterMs: 10_000 } })
    host.setTexts('Eu vai.')
    const scheduler = new CheckScheduler(host)
    await scheduler.run(true)
    expect(host.status).toMatchObject({ kind: 'error', code: 'QUOTA' })

    host.answer = answerVai
    scheduler.notifyEdit()
    await vi.advanceTimersByTimeAsync(5000)
    expect(host.check).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(5000)
    expect(host.check).toHaveBeenCalledTimes(2)
    expect(host.decorations).toHaveLength(1)
  })

  it('debounces edits and only renders when checking on type is off', async() => {
    vi.useFakeTimers()
    const host = new FakeHost()
    host.answer = answerVai
    host.setTexts('Eu vai.')
    const scheduler = new CheckScheduler(host)
    scheduler.notifyEdit()
    await vi.advanceTimersByTimeAsync(500)
    scheduler.notifyEdit()
    await vi.advanceTimersByTimeAsync(500)
    expect(host.check).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(300)
    expect(host.check).toHaveBeenCalledTimes(1)

    host.settings = { ...host.settings, checkOnType: false }
    host.setTexts('Eu vai.', 'Nós vai.')
    scheduler.notifyEdit()
    await vi.runAllTimersAsync()
    expect(host.check).toHaveBeenCalledTimes(1)
    expect(host.decorations).toHaveLength(1)

    scheduler.notifyDocumentChanged()
    await vi.runAllTimersAsync()
    expect(host.check).toHaveBeenCalledTimes(2)
    expect(host.decorations).toHaveLength(2)
  })

  it('clears everything when turned off and checks again when turned on', async() => {
    vi.useFakeTimers()
    const host = new FakeHost()
    host.answer = answerVai
    host.setTexts('Eu vai.')
    const scheduler = new CheckScheduler(host)
    await scheduler.run(true)
    scheduler.setEnabled(false)
    await vi.runAllTimersAsync()
    expect(host.decorations).toEqual([])
    expect(host.status).toEqual({ kind: 'off' })
    scheduler.setEnabled(true)
    await vi.runAllTimersAsync()
    expect(host.decorations).toHaveLength(1)
    expect(host.check).toHaveBeenCalledTimes(1)
  })
})
