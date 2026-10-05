import { createApp } from 'vue'
import type { RendererPluginContext, RendererPluginModule } from '@/plugins/types'
import { DEFAULT_BASE_URL, resolveBaseUrl, resolveModel } from '../common/config'
import {
  AI_ACTIONS,
  MAX_INPUT_CHARS,
  type AiAction,
  type AiErrorCode,
  type AiErrorInfo,
  type CompleteRequest,
  type CompleteResponse
} from '../common/types'
import ConsentDialog from './components/ConsentDialog.vue'
import { correctionEdit, selectionSegments, type TextSegment } from './segments'
import { aiActions, aiUi, resetAiUi } from './state'

/** `fixText` sends one request per block; more blocks than this in one selection are refused to bound the cost. */
const MAX_FIX_BLOCKS = 20

const ERROR_KEYS: Record<AiErrorCode, string> = {
  CONSENT: 'errors.consent',
  NO_KEY: 'errors.noKey',
  NO_MODEL: 'errors.noModel',
  CONFIG: 'errors.config',
  AUTH: 'errors.auth',
  CREDITS: 'errors.credits',
  FORBIDDEN: 'errors.forbidden',
  MODEL_NOT_FOUND: 'errors.modelNotFound',
  RATE_LIMIT: 'errors.rateLimited',
  BAD_REQUEST: 'errors.requestFailed',
  SERVER: 'errors.requestFailed',
  NETWORK: 'errors.network',
  TIMEOUT: 'errors.timeout',
  EMPTY: 'errors.empty'
}

/** Errors only the user can fix in the plugin settings; reporting one also opens them. */
const SETTINGS_ERRORS: Partial<Record<AiErrorCode, true>> = { NO_KEY: true, NO_MODEL: true, CONFIG: true, AUTH: true, MODEL_NOT_FOUND: true }

const activate = (ctx: RendererPluginContext): void => {
  const { settings, editor } = ctx
  let pendingConsent: { promise: Promise<boolean>; resolve: (accepted: boolean) => void } | null = null
  /** True while a command waits for the model; commands do not overlap. */
  let busy = false

  const reportError = (error: AiErrorInfo, model: string): void => {
    const detail = error.status ? `HTTP ${error.status}: ${error.message}` : error.message
    ctx.ui.notify({ type: 'error', message: ctx.t(ERROR_KEYS[error.code], { model, message: detail }) })
    if (SETTINGS_ERRORS[error.code]) ctx.ui.openSettings()
  }

  /** Resolves true once consent is stored; shows the dialog when it was never given. */
  const requestConsent = async(model: string): Promise<boolean> => {
    if (settings.get<boolean>('consentGiven')) return true
    if (!pendingConsent) {
      let settle: (accepted: boolean) => void = () => {}
      const promise = new Promise<boolean>((resolve) => {
        settle = resolve
      })
      pendingConsent = { promise, resolve: settle }
      const baseUrl = resolveBaseUrl(settings.get<string>('baseUrl')) ?? DEFAULT_BASE_URL
      aiUi.consent = { host: new URL(baseUrl).host, model }
    }
    if (!(await pendingConsent.promise)) return false
    // Main reads the stored flag, so it must be saved before the first request.
    await settings.set('consentGiven', true)
    return true
  }

  aiActions.value = {
    answerConsent: (accepted) => {
      const pending = pendingConsent
      pendingConsent = null
      aiUi.consent = null
      pending?.resolve(accepted)
    }
  }

  const overlayHost = document.createElement('div')
  overlayHost.className = 'ai-plugin-overlays'
  document.body.appendChild(overlayHost)
  const overlay = createApp(ConsentDialog, { ctx })
  overlay.mount(overlayHost)
  ctx.track({
    dispose: () => {
      pendingConsent?.resolve(false)
      pendingConsent = null
      overlay.unmount()
      overlayHost.remove()
      resetAiUi()
    }
  })

  const complete = (action: AiAction, text: string): Promise<CompleteResponse> => {
    const request: CompleteRequest = { action, text, language: ctx.language.value }
    return ctx.ipc.invoke<CompleteResponse>('complete', request)
  }

  /**
   * Fixes each segment with its own request, in document order, and applies
   * each correction as its own undo step. Stops at the first failed request;
   * corrections already applied stay.
   */
  const fixSegments = async(segments: TextSegment[], model: string, tabId: string): Promise<void> => {
    let changed = 0
    let stale = 0
    for (const segment of segments) {
      const response = await complete('fixText', segment.text)
      if (!response.ok) {
        reportError(response.error, model)
        return
      }
      const edit = correctionEdit(segment, response.text)
      if (!edit) continue
      // replaceRange refuses the edit when the block changed meanwhile.
      if (editor.getActiveTab()?.id === tabId && editor.replaceRange(edit)) changed++
      else stale++
    }
    if (stale > 0) ctx.ui.notify({ type: 'warning', message: ctx.t('errors.replaceFailed') })
    else ctx.ui.notify({ type: 'info', message: ctx.t(changed > 0 ? 'notify.fixed' : 'notify.noChanges'), timeout: 3000 })
  }

  /**
   * Sends the segments as one prompt and inserts the reply as new blocks
   * after the top-level block of the last segment, so the prompt text stays
   * in the document above the answer. When that block changed while the
   * model worked, the reply goes after the block at the caret instead, so it
   * is never lost.
   */
  const answer = async(action: AiAction, segments: TextSegment[], model: string, tabId: string): Promise<void> => {
    const response = await complete(action, segments.map((segment) => segment.text).join('\n\n'))
    if (!response.ok) {
      reportError(response.error, model)
      return
    }
    if (editor.getActiveTab()?.id !== tabId) {
      ctx.ui.notify({ type: 'warning', message: ctx.t('errors.insertFailed') })
      return
    }
    const last = segments[segments.length - 1]
    const [current] = editor.getCheckableBlocks([last.path])
    const inserted =
      current?.text === last.blockText
        ? editor.insertMarkdownBlocks(response.text, last.path)
        : editor.insertMarkdownBlocks(response.text)
    if (inserted) ctx.ui.notify({ type: 'info', message: ctx.t('notify.inserted', { model: response.model }), timeout: 3000 })
    else ctx.ui.notify({ type: 'warning', message: ctx.t('errors.insertFailed') })
  }

  const run = async(action: AiAction): Promise<void> => {
    if (busy) {
      ctx.ui.notify({ type: 'info', message: ctx.t('notify.busy'), timeout: 2500 })
      return
    }
    const tab = editor.getActiveTab()
    if (!tab || tab.kind !== 'markdown' || tab.viewId !== null) {
      ctx.ui.notify({ type: 'warning', message: ctx.t('errors.noDocument') })
      return
    }
    // Same checks as main, made first so an unconfigured plugin never asks for consent.
    const model = resolveModel((key) => settings.get<string>(key), action)
    const missing: AiErrorCode | null = !settings.isSecretSet('apiKey') ? 'NO_KEY' : !model ? 'NO_MODEL' : null
    if (missing) {
      reportError({ code: missing, message: '' }, model)
      return
    }

    const selection = editor.getSelection()
    const segments = selection ? selectionSegments(editor.getCheckableBlocks(), selection) : []
    if (segments.length === 0) {
      ctx.ui.notify({ type: 'warning', message: ctx.t('errors.noText') })
      return
    }
    if (action === 'fixText' && segments.length > MAX_FIX_BLOCKS) {
      ctx.ui.notify({ type: 'warning', message: ctx.t('errors.tooManyBlocks', { max: MAX_FIX_BLOCKS }) })
      return
    }
    // Joined prompts add two characters per separator.
    const length = segments.reduce((total, segment) => total + segment.text.length + 2, -2)
    if (segments.some((segment) => segment.text.length > MAX_INPUT_CHARS) || (action !== 'fixText' && length > MAX_INPUT_CHARS)) {
      ctx.ui.notify({ type: 'warning', message: ctx.t('errors.tooLong', { max: MAX_INPUT_CHARS }) })
      return
    }

    busy = true
    try {
      if (!(await requestConsent(model))) return
      ctx.ui.notify({ type: 'info', message: ctx.t('notify.working', { model }), timeout: 3000 })
      if (action === 'fixText') await fixSegments(segments, model, tab.id)
      else await answer(action, segments, model, tab.id)
    } finally {
      busy = false
    }
  }

  for (const action of AI_ACTIONS) {
    ctx.commands.register({ id: `ai.${action}`, title: `commands.${action}`, run: () => run(action) })
  }
}

// Everything is registered through `ctx`, so disabling the plugin needs no `deactivate`.
const aiRenderer: RendererPluginModule = { activate }

export default aiRenderer
