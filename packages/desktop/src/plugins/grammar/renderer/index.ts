import { createApp, nextTick, watch } from 'vue'
import type { Disposable, RendererPluginContext, RendererPluginModule } from '@/plugins/types'
import { firstHttpsUrl } from '../common/filters'
import { isGrammarServer, resolveBaseUrl } from '../common/plans'
import type { CheckBlockInput, CheckResponse, GrammarServer, RequestSettings } from '../common/types'
import { applyReplacement } from './apply'
import Overlays from './components/Overlays.vue'
import ProblemsPanel from './components/ProblemsPanel.vue'
import StatusItem from './components/StatusItem.vue'
import { CheckScheduler, type Problem, type SchedulerSettings } from './scheduler'
import { grammarActions, grammarUi, resetGrammarUi } from './state'

const PANEL_ID = 'grammar.problems'
const LAYER = 'grammar'

/** Settings whose change makes cached results invalid. */
const REQUEST_KEYS: Record<string, true> = {
  server: true,
  serverUrl: true,
  language: true,
  level: true,
  motherTongue: true,
  username: true
}

// lucide "spell-check"
const PANEL_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 16 6-12 6 12"/><path d="M8 12h8"/><path d="m16 20 2 2 4-4"/></svg>'

const pathKey = (path: Array<string | number>): string => JSON.stringify(path)

const activate = (ctx: RendererPluginContext): void => {
  const { settings, editor } = ctx
  let consentAcceptedThisSession = false
  let pendingConsent: { promise: Promise<boolean>; resolve: (accepted: boolean) => void } | null = null

  const server = (): GrammarServer => {
    const value = settings.get<string>('server')
    return isGrammarServer(value) ? value : 'premium'
  }

  const readSettings = (): SchedulerSettings => {
    const request: RequestSettings = {
      server: server(),
      serverUrl: settings.get<string>('serverUrl'),
      language: settings.get<string>('language'),
      level: settings.get<string>('level'),
      motherTongue: settings.get<string>('motherTongue'),
      username: settings.get<string>('username')
    }
    return {
      request,
      filters: {
        disabledRules: settings.get<string[]>('disabledRules'),
        disabledCategories: settings.get<string[]>('disabledCategories'),
        dictionary: settings.get<string[]>('dictionary')
      },
      checkOnType: settings.get<boolean>('checkOnType'),
      debounceMs: settings.get<number>('debounceMs'),
      consentGiven: consentAcceptedThisSession || settings.get<boolean>('consentGiven')
    }
  }

  const serverHost = (): string => {
    const base = resolveBaseUrl(server(), settings.get<string>('serverUrl'))
    if (!base) return '—'
    try {
      return new URL(base).host
    } catch {
      return base
    }
  }

  const requestConsent = (): Promise<boolean> => {
    if (readSettings().consentGiven) return Promise.resolve(true)
    if (pendingConsent) return pendingConsent.promise
    let settle: (accepted: boolean) => void = () => {}
    const promise = new Promise<boolean>((resolve) => {
      settle = resolve
    })
    pendingConsent = { promise, resolve: settle }
    grammarUi.consent = { server: serverHost() }
    return promise
  }

  const scheduler = new CheckScheduler({
    getActiveTab: () => editor.getActiveTab(),
    getMarkdown: () => editor.getMarkdown(),
    getCheckableBlocks: () => editor.getCheckableBlocks(),
    setDecorations: (ranges) => editor.setDecorations(LAYER, ranges),
    clearDecorations: () => editor.clearDecorations(LAYER),
    check: (blocks: CheckBlockInput[]) => ctx.ipc.invoke<CheckResponse>('check', blocks),
    getSettings: readSettings,
    isConfigured: () => {
      const selected = server()
      if (selected === 'premium') return settings.get<string>('username').trim() !== '' && settings.isSecretSet('apiKey')
      if (selected === 'custom') return resolveBaseUrl('custom', settings.get<string>('serverUrl')) !== null
      return true
    },
    getCaretPath: () => {
      try {
        return editor.getMuya()?.getSelection()?.anchor.path ?? null
      } catch {
        return null
      }
    },
    requestConsent,
    onDidUpdate: (status, problems) => {
      grammarUi.status = status
      grammarUi.problems = [...problems]
      const open = grammarUi.popover
      if (open && !problems.some((p) => p.id === open.problem.id && p.blockText === open.problem.blockText)) {
        grammarUi.popover = null
      }
    }
  })

  const findDecoration = (problem: Problem): HTMLElement | null =>
    document.querySelector<HTMLElement>(`[data-mu-decoration-layer][data-ltid="${CSS.escape(problem.id)}"]`)

  const openPopover = (problem: Problem, element: HTMLElement | null, focus: boolean): void => {
    if (!element) return
    const rect = element.getBoundingClientRect()
    grammarUi.popover = { problem, rect: { left: rect.left, top: rect.top, bottom: rect.bottom }, focus }
  }

  const reveal = (problem: Problem, focus: boolean): void => {
    editor.getMuya()?.setCursor({ path: problem.path, start: { offset: problem.start }, end: { offset: problem.end } })
    nextTick(() => {
      const element = findDecoration(problem)
      element?.scrollIntoView({ block: 'center' })
      openPopover(problem, element, focus)
    })
  }

  const appendToList = async(key: 'disabledRules' | 'dictionary', value: string): Promise<void> => {
    const list = settings.get<string[]>(key)
    if (!value || list.includes(value)) return
    await settings.set(key, [...list, value])
  }

  grammarActions.value = {
    checkNow: () => {
      if (!scheduler.isEnabled) scheduler.setEnabled(true)
      scheduler.checkNow()
    },
    openSettings: () => ctx.ui.openSettings(),
    askConsent: () => scheduler.checkNow(),
    answerConsent: (accepted) => {
      const pending = pendingConsent
      pendingConsent = null
      grammarUi.consent = null
      if (!pending) return
      if (!accepted) {
        pending.resolve(false)
        return
      }
      consentAcceptedThisSession = true
      settings.set('consentGiven', true).catch((err: unknown) => {
        ctx.ui.notify({ type: 'error', message: err instanceof Error ? err.message : String(err) })
      })
      pending.resolve(true)
    },
    reveal: (problem) => reveal(problem, true),
    apply: (problem, replacement) => {
      grammarUi.popover = null
      if (!applyReplacement(editor, problem, replacement)) {
        ctx.ui.notify({ type: 'warning', message: ctx.t('errors.replaceFailed') })
      }
    },
    ignore: (problem) => {
      grammarUi.popover = null
      scheduler.ignore(problem)
    },
    ignoreRule: (problem) => {
      grammarUi.popover = null
      appendToList('disabledRules', problem.match.ruleId).catch((err: unknown) => {
        ctx.ui.notify({ type: 'error', message: err instanceof Error ? err.message : String(err) })
      })
    },
    addToDictionary: (problem) => {
      grammarUi.popover = null
      appendToList('dictionary', problem.flagged.trim()).catch(() => {
        ctx.ui.notify({ type: 'error', message: ctx.t('errors.dictionaryFailed') })
      })
    },
    openRuleInfo: (problem) => {
      const url = firstHttpsUrl(problem.match.urls)
      if (url) window.electron.shell.openExternal(url).catch(() => {})
    },
    closePopover: () => {
      grammarUi.popover = null
    }
  }
  grammarUi.language = settings.get<string>('language')

  const overlayHost = document.createElement('div')
  overlayHost.className = 'grammar-plugin-overlays'
  document.body.appendChild(overlayHost)
  const overlays = createApp(Overlays, { ctx })
  overlays.mount(overlayHost)

  let spellcheckRequest: Disposable | null = null
  const syncSpellcheckRequest = (): void => {
    const wanted = settings.get<boolean>('disableNativeSpellcheck')
    if (wanted && !spellcheckRequest) spellcheckRequest = editor.requestEngineOptions({ disableNativeSpellcheck: true })
    if (!wanted && spellcheckRequest) {
      spellcheckRequest.dispose()
      spellcheckRequest = null
    }
  }
  syncSpellcheckRequest()

  const stopSecretWatch = watch(
    () => settings.isSecretSet('apiKey'),
    () => scheduler.notifyRequestSettingsChanged()
  )

  ctx.track({
    dispose: () => {
      stopSecretWatch()
      scheduler.dispose()
      pendingConsent?.resolve(false)
      pendingConsent = null
      overlays.unmount()
      overlayHost.remove()
      resetGrammarUi()
    }
  })

  settings.onDidChange((key) => {
    if (key === 'language') grammarUi.language = settings.get<string>('language')
    if (key === 'disableNativeSpellcheck') {
      syncSpellcheckRequest()
      return
    }
    if (REQUEST_KEYS[key] === true) scheduler.notifyRequestSettingsChanged()
    else scheduler.notifySettingsChanged()
  })

  editor.onDidChangeContent(() => {
    grammarUi.popover = null
    scheduler.notifyEdit()
  })
  editor.onDidSetContent(() => {
    grammarUi.popover = null
    scheduler.notifyDocumentChanged()
  })
  ctx.editor.onDidChangeActiveTab(() => {
    grammarUi.popover = null
    scheduler.notifyDocumentChanged()
  })
  editor.onDidClickDecoration(LAYER, ({ range, rect }) => {
    const problem = grammarUi.problems.find((p) => p.id === range.data?.ltid)
    if (!problem) return
    grammarUi.popover = { problem, rect: { left: rect.left, top: rect.top, bottom: rect.bottom }, focus: false }
  })

  ctx.ui.registerSidebarPanel({ id: PANEL_ID, title: 'panel.title', icon: PANEL_ICON, component: ProblemsPanel, order: 50 })
  ctx.ui.registerStatusBarItem({ id: 'grammar.status', component: StatusItem, order: 10 })

  ctx.commands.register({
    id: 'grammar.checkNow',
    title: 'commands.checkNow',
    run: () => grammarActions.value?.checkNow()
  })
  ctx.commands.register({
    id: 'grammar.nextProblem',
    title: 'commands.next',
    keybinding: 'F8',
    run: () => {
      const problems = grammarUi.problems
      if (problems.length === 0) {
        ctx.ui.notify({ type: 'info', message: ctx.t('notify.noProblems'), timeout: 2500 })
        return
      }
      const order = new Map(editor.getCheckableBlocks().map((block, index) => [pathKey(block.path), index]))
      const rank = (path: Array<string | number>): number => order.get(pathKey(path)) ?? -1
      const sorted = [...problems].sort((a, b) => rank(a.path) - rank(b.path) || a.start - b.start)
      const selection = editor.getMuya()?.getSelection() ?? null
      const caretRank = selection ? rank(selection.focus.path) : -1
      const caretOffset = selection ? Math.max(selection.anchor.offset, selection.focus.offset) : -1
      const next =
        sorted.find((p) => rank(p.path) > caretRank || (rank(p.path) === caretRank && p.start >= caretOffset)) ??
        sorted[0]
      reveal(next, true)
    }
  })
  ctx.commands.register({
    id: 'grammar.toggle',
    title: 'commands.toggle',
    run: () => {
      const enabled = !scheduler.isEnabled
      scheduler.setEnabled(enabled)
      ctx.ui.notify({ type: 'info', message: ctx.t(enabled ? 'notify.on' : 'notify.off'), timeout: 2500 })
    }
  })

  scheduler.notifyDocumentChanged()
}

// Everything is registered through `ctx`, so disabling the plugin needs no `deactivate`.
const grammarRenderer: RendererPluginModule = { activate }

export default grammarRenderer
