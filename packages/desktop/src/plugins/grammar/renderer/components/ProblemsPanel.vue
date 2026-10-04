<template>
  <div class="grammar-panel">
    <div class="title">
      {{ ctx.t('panel.title') }}
      <button
        type="button"
        class="grammar-panel-refresh"
        :title="ctx.t('panel.checkNow')"
        :aria-label="ctx.t('panel.checkNow')"
        @click="actions?.checkNow()"
      >
        <svg
          viewBox="0 0 24 24"
          width="14"
          height="14"
          aria-hidden="true"
        >
          <path
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            d="M21 12a9 9 0 1 1-3-6.7L21 8M21 3v5h-5"
          />
        </svg>
      </button>
    </div>
    <div
      class="grammar-panel-body"
      role="region"
      :aria-label="ctx.t('panel.title')"
    >
      <p
        v-if="notice"
        class="grammar-panel-notice"
      >
        {{ notice.text }}
        <button
          v-if="notice.action"
          type="button"
          class="grammar-panel-link"
          @click="notice.action.run()"
        >
          {{ notice.action.label }}
        </button>
      </p>
      <p
        v-else-if="groups.length === 0"
        class="grammar-panel-notice"
      >
        {{ status.kind === 'checking' ? ctx.t('status.checking') : ctx.t('panel.empty') }}
      </p>
      <section
        v-for="group of groups"
        :key="group.id"
        class="grammar-panel-group"
      >
        <h3 class="grammar-panel-group-title">
          <span>{{ group.name }}</span>
          <span class="grammar-panel-count">{{ ctx.t('panel.count', { count: group.problems.length }) }}</span>
        </h3>
        <ul>
          <li
            v-for="problem of group.problems"
            :key="problem.id"
          >
            <button
              type="button"
              class="grammar-panel-item"
              :class="`grammar-panel-item-${problem.kind}`"
              :aria-label="`${problem.flagged} — ${problem.match.message}`"
              @click="actions?.reveal(problem)"
            >
              <span class="grammar-panel-flagged">{{ problem.flagged }}</span>
              <span
                v-if="problem.match.replacements.length"
                class="grammar-panel-replacement"
              >→ {{ problem.match.replacements[0] }}</span>
              <span class="grammar-panel-message">{{ problem.match.shortMessage || problem.match.message }}</span>
            </button>
          </li>
        </ul>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { RendererPluginContext } from '@/plugins/types'
import type { Problem } from '../scheduler'
import { grammarActions, grammarUi } from '../state'

const props = defineProps<{ ctx: RendererPluginContext }>()

const actions = computed(() => grammarActions.value)
const status = computed(() => grammarUi.status)

const notice = computed((): { text: string; action?: { label: string; run: () => void } } | null => {
  const { t } = props.ctx
  switch (status.value.kind) {
    case 'off':
      return { text: t('panel.off'), action: { label: t('panel.checkNow'), run: () => actions.value?.checkNow() } }
    case 'skipped':
      return { text: t('panel.skipped') }
    case 'idle':
      return { text: t('panel.noDocument') }
    case 'consent':
      return { text: t('panel.consent'), action: { label: t('panel.allow'), run: () => actions.value?.askConsent() } }
    case 'config':
      return { text: t('errors.config'), action: { label: t('panel.openSettings'), run: () => actions.value?.openSettings() } }
    default:
      return null
  }
})

const groups = computed(() => {
  const byCategory = new Map<string, { id: string; name: string; problems: Problem[] }>()
  for (const problem of grammarUi.problems) {
    const id = problem.match.categoryId || problem.kind
    let group = byCategory.get(id)
    if (!group) {
      group = { id, name: problem.match.categoryName || props.ctx.t(`kinds.${problem.kind}`), problems: [] }
      byCategory.set(id, group)
    }
    group.problems.push(problem)
  }
  return [...byCategory.values()].sort((a, b) => b.problems.length - a.problems.length)
})
</script>

<style scoped>
.grammar-panel {
  height: calc(100% - 35px);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.title {
  color: var(--sideBarTitleColor);
  font-weight: 600;
  font-size: 16px;
  margin: 37px 0 10px 0;
  padding: 0 15px 0 25px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-shrink: 0;
}

.grammar-panel-refresh {
  border: none;
  background: transparent;
  color: var(--sideBarIconColor);
  cursor: pointer;
  padding: 4px;
  border-radius: 3px;
  display: flex;
}

.grammar-panel-refresh:hover,
.grammar-panel-refresh:focus-visible {
  color: var(--themeColor);
  outline: none;
  background: var(--sideBarItemHoverBgColor);
}

.grammar-panel-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 0 10px 20px 15px;
  color: var(--sideBarColor);
  font-size: 13px;
}

.grammar-panel-notice {
  padding: 0 10px;
  line-height: 1.5;
}

.grammar-panel-link {
  border: none;
  background: transparent;
  color: var(--themeColor);
  cursor: pointer;
  padding: 0;
  font: inherit;
  text-decoration: underline;
}

.grammar-panel-group-title {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
  color: var(--sideBarTitleColor);
  margin: 12px 10px 4px;
}

.grammar-panel-count {
  font-weight: normal;
  color: var(--sideBarColor);
}

ul {
  list-style: none;
  margin: 0;
  padding: 0;
}

.grammar-panel-item {
  display: flex;
  flex-wrap: wrap;
  gap: 2px 6px;
  width: 100%;
  text-align: left;
  border: none;
  border-left: 2px solid transparent;
  background: transparent;
  color: inherit;
  font: inherit;
  padding: 6px 10px;
  cursor: pointer;
  border-radius: 0 3px 3px 0;
}

.grammar-panel-item:hover,
.grammar-panel-item:focus-visible {
  outline: none;
  background: var(--sideBarItemHoverBgColor);
}

.grammar-panel-item-spelling {
  border-left-color: var(--mu-decoration-spelling-color, #e5484d);
}

.grammar-panel-item-grammar {
  border-left-color: var(--mu-decoration-grammar-color, #3b82f6);
}

.grammar-panel-item-style {
  border-left-color: var(--mu-decoration-style-color, #f59e0b);
}

.grammar-panel-flagged {
  text-decoration: line-through;
  opacity: 0.8;
}

.grammar-panel-replacement {
  color: var(--themeColor);
}

.grammar-panel-message {
  flex-basis: 100%;
  opacity: 0.75;
  font-size: 12px;
}
</style>
