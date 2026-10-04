<template>
  <div
    v-if="problem"
    ref="root"
    class="grammar-popover"
    role="dialog"
    :aria-label="ctx.t('popover.label')"
    :style="position"
    data-testid="grammar-popover"
    @keydown="onKeydown"
  >
    <div class="grammar-popover-header">
      <span
        class="grammar-popover-kind"
        :class="`grammar-popover-kind-${problem.kind}`"
      >{{ problem.match.categoryName || ctx.t(`kinds.${problem.kind}`) }}</span>
      <button
        type="button"
        class="grammar-popover-close"
        :aria-label="ctx.t('popover.close')"
        :title="ctx.t('popover.close')"
        @click="actions?.closePopover()"
      >
        ×
      </button>
    </div>
    <p class="grammar-popover-message">
      {{ problem.match.message }}
    </p>
    <div
      class="grammar-popover-replacements"
      role="group"
      :aria-label="ctx.t('popover.suggestions')"
    >
      <button
        v-for="replacement of replacements"
        :key="replacement"
        type="button"
        class="grammar-popover-replacement"
        data-testid="grammar-replacement"
        @click="actions?.apply(problem, replacement)"
      >
        {{ replacement || '∅' }}
      </button>
      <span
        v-if="replacements.length === 0"
        class="grammar-popover-none"
      >{{ ctx.t('popover.noSuggestions') }}</span>
    </div>
    <div class="grammar-popover-actions">
      <button
        type="button"
        @click="actions?.ignore(problem)"
      >
        {{ ctx.t('popover.ignore') }}
      </button>
      <button
        type="button"
        @click="actions?.ignoreRule(problem)"
      >
        {{ ctx.t('popover.ignoreRule') }}
      </button>
      <button
        v-if="problem.kind === 'spelling'"
        type="button"
        @click="actions?.addToDictionary(problem)"
      >
        {{ ctx.t('popover.addToDictionary') }}
      </button>
      <button
        v-if="infoUrl"
        type="button"
        @click="actions?.openRuleInfo(problem)"
      >
        {{ ctx.t('popover.moreInfo') }}
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { RendererPluginContext } from '@/plugins/types'
import { firstHttpsUrl } from '../../common/filters'
import { MAX_REPLACEMENTS } from '../../common/types'
import { grammarActions, grammarUi } from '../state'

defineProps<{ ctx: RendererPluginContext }>()

const WIDTH = 320
const GAP = 6

const root = ref<HTMLElement | null>(null)
const actions = computed(() => grammarActions.value)
const popover = computed(() => grammarUi.popover)
const problem = computed(() => grammarUi.popover?.problem ?? null)
const replacements = computed(() => problem.value?.match.replacements.slice(0, MAX_REPLACEMENTS) ?? [])
const infoUrl = computed(() => (problem.value ? firstHttpsUrl(problem.value.match.urls) : null))
const height = ref(0)

const position = computed(() => {
  const anchor = grammarUi.popover?.rect
  if (!anchor) return {}
  const left = Math.max(GAP, Math.min(anchor.left, window.innerWidth - WIDTH - GAP))
  const below = anchor.bottom + GAP
  const fitsBelow = below + height.value <= window.innerHeight - GAP
  const top = fitsBelow ? below : Math.max(GAP, anchor.top - GAP - height.value)
  return { left: `${left}px`, top: `${top}px`, width: `${WIDTH}px` }
})

watch(popover, async (value) => {
  if (!value) return
  await nextTick()
  height.value = root.value?.offsetHeight ?? 0
  if (value.focus) root.value?.querySelector<HTMLButtonElement>('button.grammar-popover-replacement, .grammar-popover-actions button')?.focus()
})

const onKeydown = (event: KeyboardEvent): void => {
  if (event.key !== 'Escape') return
  event.preventDefault()
  event.stopPropagation()
  actions.value?.closePopover()
}

// Esc anywhere (the editor keeps focus after a mouse click) and clicks outside close the popover.
const onDocumentKeydown = (event: KeyboardEvent): void => {
  if (event.key === 'Escape' && grammarUi.popover) onKeydown(event)
}
const onDocumentMousedown = (event: MouseEvent): void => {
  if (!grammarUi.popover) return
  const target = event.target as Node | null
  if (target && root.value?.contains(target)) return
  actions.value?.closePopover()
}
const onResize = (): void => actions.value?.closePopover()

onMounted(() => {
  document.addEventListener('keydown', onDocumentKeydown, true)
  document.addEventListener('mousedown', onDocumentMousedown, true)
  window.addEventListener('resize', onResize)
})

onBeforeUnmount(() => {
  document.removeEventListener('keydown', onDocumentKeydown, true)
  document.removeEventListener('mousedown', onDocumentMousedown, true)
  window.removeEventListener('resize', onResize)
})
</script>

<style scoped>
.grammar-popover {
  position: fixed;
  z-index: 2000;
  box-sizing: border-box;
  padding: 10px 12px;
  border-radius: 6px;
  border: 1px solid var(--floatBorderColor);
  background: var(--floatBgColor);
  box-shadow: var(--floatShadow);
  color: var(--editorColor);
  font-size: 13px;
  line-height: 1.45;
}

.grammar-popover-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 4px;
}

.grammar-popover-kind {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  color: var(--editorColor50);
  border-left: 3px solid var(--mu-decoration-style-color, #f59e0b);
  padding-left: 6px;
}

.grammar-popover-kind-spelling {
  border-left-color: var(--mu-decoration-spelling-color, #e5484d);
}

.grammar-popover-kind-grammar {
  border-left-color: var(--mu-decoration-grammar-color, #3b82f6);
}

.grammar-popover-close {
  border: none;
  background: transparent;
  color: var(--editorColor50);
  font-size: 18px;
  line-height: 1;
  cursor: pointer;
  padding: 0 2px;
}

.grammar-popover-message {
  margin: 0 0 8px;
}

.grammar-popover-replacements {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 10px;
}

.grammar-popover-replacement {
  border: 1px solid transparent;
  border-radius: 4px;
  background: var(--themeColor);
  color: #fff;
  padding: 2px 8px;
  font: inherit;
  font-weight: 600;
  cursor: pointer;
}

.grammar-popover-replacement:hover,
.grammar-popover-replacement:focus-visible {
  outline: none;
  border-color: var(--editorColor);
}

.grammar-popover-none {
  color: var(--editorColor50);
}

.grammar-popover-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 12px;
  border-top: 1px solid var(--floatBorderColor);
  padding-top: 8px;
}

.grammar-popover-actions button {
  border: none;
  background: transparent;
  color: var(--editorColor80);
  padding: 2px 0;
  font: inherit;
  cursor: pointer;
}

.grammar-popover-actions button:hover,
.grammar-popover-actions button:focus-visible {
  outline: none;
  color: var(--themeColor);
  text-decoration: underline;
}

.grammar-popover-close:hover,
.grammar-popover-close:focus-visible {
  outline: none;
  color: var(--themeColor);
}
</style>
