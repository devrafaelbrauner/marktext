<template>
  <button
    type="button"
    class="grammar-status"
    :class="`grammar-status-${view.tone}`"
    :title="view.tooltip"
    :aria-label="view.tooltip"
    data-testid="grammar-status"
    @click="onClick"
  >
    {{ view.label }}
  </button>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { RendererPluginContext } from '@/plugins/types'
import { grammarActions, grammarUi } from '../state'

const props = defineProps<{ ctx: RendererPluginContext }>()

type Action = 'panel' | 'settings' | 'consent' | 'checkNow' | null

const view = computed((): { label: string; tooltip: string; tone: string; action: Action } => {
  const { t } = props.ctx
  const status = grammarUi.status
  const count = grammarUi.problems.length
  switch (status.kind) {
    case 'checking':
      return { label: t('status.checking'), tooltip: t('status.tooltip.checking'), tone: 'muted', action: 'panel' }
    case 'off':
      return { label: t('status.off'), tooltip: t('status.tooltip.off'), tone: 'muted', action: 'checkNow' }
    case 'skipped':
      return { label: t('status.skipped'), tooltip: t('status.tooltip.skipped'), tone: 'muted', action: null }
    case 'config':
      return { label: t('status.config'), tooltip: t('status.tooltip.config'), tone: 'warn', action: 'settings' }
    case 'consent':
      return { label: t('status.consent'), tooltip: t('status.tooltip.consent'), tone: 'warn', action: 'consent' }
    case 'error': {
      const key = status.code === 'AUTH' ? 'auth' : status.code === 'QUOTA' ? 'quota' : status.code === 'NETWORK' ? 'network' : 'server'
      const message = key === 'server' ? t('errors.server', { message: status.message }) : t(`errors.${key}`)
      return {
        label: t(`status.${key}`),
        tooltip: t('status.tooltip.error', { message }),
        tone: 'warn',
        action: key === 'auth' ? 'settings' : 'checkNow'
      }
    }
    case 'idle':
    case 'done':
      if (count > 0) {
        return {
          label: count === 1 ? t('status.one') : t('status.many', { count }),
          tooltip: t('status.tooltip.problems'),
          tone: 'problems',
          action: 'panel'
        }
      }
      return { label: t('status.ok', { language: grammarUi.language }), tooltip: t('status.tooltip.ok'), tone: 'muted', action: 'panel' }
  }
  return { label: '', tooltip: '', tone: 'muted', action: null }
})

const onClick = (): void => {
  const actions = grammarActions.value
  switch (view.value.action) {
    case 'panel':
      props.ctx.ui.revealSidebarPanel('grammar.problems')
      return
    case 'settings':
      actions?.openSettings()
      return
    case 'consent':
      actions?.askConsent()
      return
    case 'checkNow':
      actions?.checkNow()
  }
}
</script>

<style scoped>
.grammar-status {
  border: none;
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 13px;
  padding: 0 4px;
  cursor: pointer;
  border-radius: 3px;
  white-space: nowrap;
}

.grammar-status:hover,
.grammar-status:focus-visible {
  color: var(--editorColor);
  outline: none;
  background: var(--floatHoverColor);
}

.grammar-status-problems {
  color: var(--themeColor);
}

.grammar-status-warn {
  color: var(--deleteColor, #e6a23c);
}
</style>
