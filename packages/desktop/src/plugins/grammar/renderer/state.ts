import { reactive, shallowRef } from 'vue'
import type { CheckStatus, Problem } from './scheduler'

/** Viewport position the popover is anchored to (a decorated span's rect). */
export interface AnchorRect {
  left: number
  top: number
  bottom: number
}

export interface GrammarActions {
  checkNow(): void
  openSettings(): void
  /** Shows the consent dialog (or checks right away when consent was given). */
  askConsent(): void
  answerConsent(accepted: boolean): void
  /** Selects the problem's range in the editor and opens the popover on it. */
  reveal(problem: Problem): void
  apply(problem: Problem, replacement: string): void
  ignore(problem: Problem): void
  ignoreRule(problem: Problem): void
  addToDictionary(problem: Problem): void
  openRuleInfo(problem: Problem): void
  closePopover(): void
}

/**
 * UI state of the grammar plugin in this window, shared by its status bar
 * item, sidebar panel, popover and consent dialog. Reset on deactivation.
 */
export const grammarUi = reactive({
  status: { kind: 'idle' } as CheckStatus,
  problems: [] as Problem[],
  /** Language code shown in the status bar. */
  language: 'pt-BR',
  popover: null as null | { problem: Problem; rect: AnchorRect; focus: boolean },
  /** Non-null while the consent dialog is open; `server` is the host the text would go to. */
  consent: null as null | { server: string }
})

export const grammarActions = shallowRef<GrammarActions | null>(null)

export const resetGrammarUi = (): void => {
  grammarUi.status = { kind: 'idle' }
  grammarUi.problems = []
  grammarUi.popover = null
  grammarUi.consent = null
  grammarActions.value = null
}
