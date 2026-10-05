<template>
  <div
    v-if="consent"
    class="ai-consent-backdrop"
    data-testid="ai-consent"
    @mousedown.self="answer(false)"
  >
    <div
      ref="dialog"
      class="ai-consent"
      role="dialog"
      aria-modal="true"
      aria-labelledby="ai-consent-title"
      aria-describedby="ai-consent-body"
      @keydown="onKeydown"
    >
      <h2 id="ai-consent-title">
        {{ ctx.t('consent.title') }}
      </h2>
      <p id="ai-consent-body">
        {{ ctx.t('consent.body') }}
      </p>
      <p class="ai-consent-target">
        {{ ctx.t('consent.server', { server: consent.host }) }}
      </p>
      <p class="ai-consent-target">
        {{ ctx.t('consent.model', { model: consent.model }) }}
      </p>
      <p class="ai-consent-note">
        {{ ctx.t('consent.privacy') }}
      </p>
      <div class="ai-consent-buttons">
        <button
          type="button"
          class="ai-consent-decline"
          @click="answer(false)"
        >
          {{ ctx.t('consent.decline') }}
        </button>
        <button
          ref="acceptButton"
          type="button"
          class="ai-consent-accept"
          data-testid="ai-consent-accept"
          @click="answer(true)"
        >
          {{ ctx.t('consent.accept') }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import type { RendererPluginContext } from '@/plugins/types'
import { aiActions, aiUi } from '../state'

defineProps<{ ctx: RendererPluginContext }>()

const dialog = ref<HTMLElement | null>(null)
const acceptButton = ref<HTMLButtonElement | null>(null)
const consent = computed(() => aiUi.consent)
let previousFocus: HTMLElement | null = null

watch(consent, async (value, old) => {
  if (value && !old) {
    previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    await nextTick()
    acceptButton.value?.focus()
  } else if (!value && old) {
    previousFocus?.focus()
    previousFocus = null
  }
})

const answer = (accepted: boolean): void => {
  aiActions.value?.answerConsent(accepted)
}

const onKeydown = (event: KeyboardEvent): void => {
  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    answer(false)
    return
  }
  if (event.key !== 'Tab' || !dialog.value) return
  // Keep keyboard focus inside the modal.
  const buttons = [...dialog.value.querySelectorAll<HTMLButtonElement>('button')]
  const first = buttons[0]
  const last = buttons[buttons.length - 1]
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first.focus()
  }
}
</script>

<style scoped>
.ai-consent-backdrop {
  position: fixed;
  inset: 0;
  z-index: 3000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.35);
}

.ai-consent {
  box-sizing: border-box;
  width: min(460px, calc(100vw - 40px));
  padding: 20px 24px;
  border-radius: 8px;
  border: 1px solid var(--floatBorderColor);
  background: var(--floatBgColor);
  box-shadow: var(--floatShadow);
  color: var(--editorColor);
  font-size: 14px;
  line-height: 1.5;
}

h2 {
  margin: 0 0 10px;
  font-size: 17px;
}

p {
  margin: 0 0 10px;
}

.ai-consent-target {
  font-family: var(--codeFontFamily, monospace);
  font-size: 13px;
  word-break: break-all;
}

.ai-consent-note {
  color: var(--editorColor50);
  font-size: 13px;
}

.ai-consent-buttons {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 16px;
}

.ai-consent-buttons button {
  padding: 6px 14px;
  border-radius: 4px;
  font: inherit;
  cursor: pointer;
}

.ai-consent-decline {
  border: 1px solid var(--buttonBorder, var(--floatBorderColor));
  background: var(--buttonBgColor, transparent);
  color: var(--buttonFontColor, var(--editorColor));
}

.ai-consent-accept {
  border: 1px solid var(--themeColor);
  background: var(--themeColor);
  color: #fff;
}

.ai-consent-buttons button:focus-visible {
  outline: 2px solid var(--themeColor);
  outline-offset: 2px;
}
</style>
