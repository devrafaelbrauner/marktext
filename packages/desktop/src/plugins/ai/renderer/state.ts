import { reactive, shallowRef } from 'vue'

export interface AiActions {
  answerConsent(accepted: boolean): void
}

/** UI state of the AI plugin in this window, read by its consent dialog. Reset on deactivation. */
export const aiUi = reactive({
  /** Non-null while the consent dialog is open: where the text would go. */
  consent: null as null | { host: string; model: string }
})

export const aiActions = shallowRef<AiActions | null>(null)

export const resetAiUi = (): void => {
  aiUi.consent = null
  aiActions.value = null
}
