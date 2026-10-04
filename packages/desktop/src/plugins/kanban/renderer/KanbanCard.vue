<template>
  <li
    ref="root"
    class="kanban-card"
    :class="{ 'is-checked': checked, 'is-editing': isEditing }"
    :data-card-id="card.id"
    :tabindex="isEditing ? -1 : 0"
    :aria-label="ariaLabel"
    @keydown.self="onCardKeydown"
    @dblclick="startEdit"
  >
    <input
      v-if="!archived"
      type="checkbox"
      class="kanban-card-check"
      :checked="checked"
      :aria-label="t('card.toggleLabel')"
      @change="toggle"
    >
    <div
      v-if="!isEditing"
      ref="body"
      class="kanban-card-body"
      @click="onBodyClick"
      @keydown.enter="onBodyClick"
    />
    <div
      v-else
      class="kanban-card-editor"
    >
      <textarea
        ref="editor"
        v-model="draft"
        class="kanban-textarea"
        rows="1"
        :aria-label="t('card.editLabel')"
        @keydown="onEditorKeydown"
        @input="autosize"
        @blur="commitEdit"
      />
    </div>
    <slot name="actions">
      <KanbanMenu
        v-if="!isEditing"
        class="kanban-card-menu"
        :label="t('card.menu')"
        :items="menuItems"
      />
    </slot>
  </li>
</template>

<script setup lang="ts">
import { computed, inject, nextTick, onMounted, ref, watch } from 'vue'
import type { KanbanCard } from '../common/board'
import { isCardChecked } from '../common/operations'
import { KANBAN_CONTROLLER } from './controller'
import KanbanMenu, { type KanbanMenuItem } from './KanbanMenu.vue'
import { renderCardContent } from './renderCard'

const props = defineProps<{
  card: KanbanCard
  /** Archived cards are read-only here; the archive panel supplies its own actions. */
  archived?: boolean
  menuItems?: KanbanMenuItem[]
}>()

const emit = defineEmits<{
  (event: 'update-text', text: string): void
  (event: 'toggle', checked: boolean): void
  /** Alt+arrow keyboard moves: vertical within the lane, horizontal to the neighbouring lane. */
  (event: 'keyboard-move', direction: 'up' | 'down' | 'left' | 'right'): void
}>()

const controller = inject(KANBAN_CONTROLLER)!
const t = controller.ctx.t
const root = ref<HTMLElement | null>(null)
const body = ref<HTMLElement | null>(null)
const editor = ref<HTMLTextAreaElement | null>(null)
const draft = ref('')

const checked = computed(() => isCardChecked(props.card))
const isEditing = computed(() => controller.editing.value === props.card.id)
const ariaLabel = computed(() => `${props.card.text.split('\n')[0]}. ${t('card.keyboardHint')}`)
const menuItems = computed(() => props.menuItems ?? [])

const startOfToday = (): Date => {
  const now = new Date()
  return new Date(now.getFullYear(), now.getMonth(), now.getDate())
}

const render = (): void => {
  if (!body.value) return
  renderCardContent(body.value, props.card.text, {
    triggers: controller.triggers(),
    locale: controller.locale(),
    checked: checked.value,
    today: startOfToday(),
    overdueLabel: t('card.overdue')
  })
  for (const link of body.value.querySelectorAll<HTMLElement>('a.kanban-wikilink')) {
    link.setAttribute('aria-label', t('card.openLink', { target: link.textContent ?? '' }))
  }
  for (const tag of body.value.querySelectorAll<HTMLElement>('.kanban-tag')) {
    tag.setAttribute('role', 'button')
    tag.tabIndex = 0
  }
}

onMounted(render)
watch(
  () => [props.card.text, checked.value, isEditing.value, controller.ctx.language.value],
  () => nextTick(render)
)

const toggle = (): void => {
  emit('toggle', !checked.value)
}

const autosize = (): void => {
  const element = editor.value
  if (!element) return
  element.style.height = 'auto'
  element.style.height = `${element.scrollHeight}px`
}

const startEdit = (event?: Event): void => {
  if (props.archived || isEditing.value) return
  if (event && (event.target as HTMLElement).closest('a, button, input, .kanban-tag')) return
  draft.value = props.card.text
  controller.editing.value = props.card.id
  nextTick(() => {
    autosize()
    editor.value?.focus()
    editor.value?.setSelectionRange(draft.value.length, draft.value.length)
  })
}

defineExpose({ startEdit })

const finishEdit = (save: boolean): void => {
  if (!isEditing.value) return
  controller.editing.value = null
  if (save && draft.value.trim() && draft.value.trim() !== props.card.text) {
    emit('update-text', draft.value)
  }
  nextTick(() => root.value?.focus())
}

const commitEdit = (): void => finishEdit(true)

const onEditorKeydown = (event: KeyboardEvent): void => {
  event.stopPropagation()
  if (event.isComposing) return
  if (event.key === 'Escape') {
    event.preventDefault()
    finishEdit(false)
  } else if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault()
    finishEdit(true)
  }
}

const onCardKeydown = (event: KeyboardEvent): void => {
  if (event.altKey && event.key.startsWith('Arrow')) {
    event.preventDefault()
    const direction = event.key.slice(5).toLowerCase() as 'up' | 'down' | 'left' | 'right'
    emit('keyboard-move', direction)
  } else if (event.key === 'Enter' && !props.archived) {
    event.preventDefault()
    startEdit()
  }
}

const onBodyClick = (event: Event): void => {
  const target = event.target as HTMLElement
  const anchor = target.closest('a')
  if (anchor) {
    event.preventDefault()
    event.stopPropagation()
    if (anchor.classList.contains('kanban-wikilink')) controller.openWikilink(anchor.dataset.raw ?? '')
    else if (anchor.getAttribute('href')) controller.openHref(anchor.getAttribute('href')!)
    return
  }
  const tag = target.closest<HTMLElement>('.kanban-tag')
  if (tag) {
    event.stopPropagation()
    controller.filter.value = `#${tag.dataset.tag ?? ''}`.toLowerCase()
  }
}
</script>
