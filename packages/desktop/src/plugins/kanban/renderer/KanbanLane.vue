<template>
  <section
    class="kanban-lane"
    :class="{ 'is-complete': complete, 'is-over-limit': overLimit }"
    :data-lane-id="lane.id"
    :aria-label="lane.title"
  >
    <header class="kanban-lane-header">
      <span
        class="kanban-lane-handle"
        :title="t('lane.dragHandle', { title: lane.title })"
        aria-hidden="true"
        v-html="GRIP"
      />
      <input
        v-if="renaming"
        ref="renameInput"
        v-model="renameDraft"
        class="kanban-input kanban-lane-rename"
        :aria-label="t('lane.renameLabel')"
        @keydown.enter.prevent="commitRename"
        @keydown.esc.prevent="renaming = false"
        @blur="commitRename"
      >
      <h2
        v-else
        class="kanban-lane-title"
        :title="t('lane.rename')"
        @dblclick="startRename"
      >
        {{ lane.title }}
      </h2>
      <span
        v-if="complete"
        class="kanban-lane-complete"
        :title="t('lane.complete')"
        :aria-label="t('lane.complete')"
        role="img"
      >✓</span>
      <span
        class="kanban-lane-count"
        :title="countLabel"
        :aria-label="countLabel"
      >{{ lane.maxItems > 0 ? `${lane.cards.length}/${lane.maxItems}` : lane.cards.length }}</span>
      <KanbanMenu
        :label="t('lane.menu', { title: lane.title })"
        :items="laneMenu"
      />
    </header>
    <ul
      class="kanban-lane-cards"
      :data-lane-id="lane.id"
      :aria-label="t('lane.cardsLabel', { title: lane.title })"
    >
      <KanbanCardView
        v-for="card in visibleCards"
        :key="card.id"
        :ref="(component) => setCardRef(card.id, component)"
        :card="card"
        :menu-items="cardMenu(card.id)"
        @update-text="(text) => withCard(card.id, (lane, index) => updateCardText(controller.board.value, lane, index, text))"
        @toggle="(checked) => withCard(card.id, (lane, index) => setCardChecked(controller.board.value, lane, index, checked))"
        @keyboard-move="(direction) => keyboardMove(card.id, direction)"
      />
    </ul>
    <div class="kanban-lane-footer">
      <textarea
        ref="newCardInput"
        v-model="newCardText"
        class="kanban-textarea kanban-new-card"
        rows="1"
        :placeholder="t('lane.addCardPlaceholder')"
        :title="t('lane.addCardHint')"
        :aria-label="t('lane.addCard')"
        @keydown="onNewCardKeydown"
        @input="autosizeNewCard"
      />
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, inject, nextTick, ref } from 'vue'
import { GripVertical } from 'lucide-static'
import { parseLaneTitle, type KanbanLane } from '../common/board'
import {
  addCard,
  archiveCard,
  deleteCard,
  deleteLane,
  isCompleteLane,
  moveCard,
  moveLane,
  renameLane,
  setCardChecked,
  setLaneComplete,
  updateCardText
} from '../common/operations'
import { KANBAN_CONTROLLER } from './controller'
import { openDialog } from './dialog'
import KanbanCardView from './KanbanCard.vue'
import KanbanMenu, { type KanbanMenuItem } from './KanbanMenu.vue'

const props = defineProps<{
  lane: KanbanLane
}>()

const GRIP = GripVertical
const controller = inject(KANBAN_CONTROLLER)!
const t = controller.ctx.t

const renaming = ref(false)
const renameDraft = ref('')
const renameInput = ref<HTMLInputElement | null>(null)
const newCardText = ref('')
const newCardInput = ref<HTMLTextAreaElement | null>(null)
const cardRefs = new Map<string, { startEdit(): void } | null>()

const complete = computed(() => isCompleteLane(props.lane))
const overLimit = computed(() => props.lane.maxItems > 0 && props.lane.cards.length > props.lane.maxItems)
const countLabel = computed(() => {
  const label = props.lane.maxItems > 0
    ? t('lane.countWithLimit', { count: props.lane.cards.length, max: props.lane.maxItems })
    : t('lane.count', { count: props.lane.cards.length })
  return overLimit.value ? `${label}. ${t('lane.overLimit')}` : label
})
const visibleCards = computed(() => {
  const filter = controller.filter.value
  return filter ? props.lane.cards.filter((card) => card.text.toLowerCase().includes(filter)) : props.lane.cards
})

const laneIndex = (): number => controller.board.value.lanes.findIndex((lane) => lane.id === props.lane.id)

const setCardRef = (id: string, component: unknown): void => {
  cardRefs.set(id, component as { startEdit(): void } | null)
}

/** Runs an edit on the card with `id`, located by id because indices shift between renders. */
const withCard = (id: string, change: (laneIndex: number, cardIndex: number) => void): void => {
  const lane = laneIndex()
  const index = props.lane.cards.findIndex((card) => card.id === id)
  if (lane === -1 || index === -1) return
  controller.apply(() => change(lane, index))
}

const focusCard = (id: string): void => {
  nextTick(() => {
    document.querySelector<HTMLElement>(`.kanban-card[data-card-id="${id}"]`)?.focus()
  })
}

const moveToLane = (id: string, targetLane: number, position: 'start' | 'end' = 'end'): void => {
  withCard(id, (lane, index) => {
    const target = controller.board.value.lanes[targetLane]
    const size = target.cards.length - (targetLane === lane ? 1 : 0)
    moveCard(controller.board.value, lane, index, targetLane, position === 'start' ? 0 : size)
  })
  focusCard(id)
}

const keyboardMove = (id: string, direction: 'up' | 'down' | 'left' | 'right'): void => {
  const lane = laneIndex()
  const index = props.lane.cards.findIndex((card) => card.id === id)
  if (direction === 'up' || direction === 'down') {
    const to = index + (direction === 'up' ? -1 : 1)
    if (to < 0 || to >= props.lane.cards.length) return
    withCard(id, (laneAt, cardAt) => moveCard(controller.board.value, laneAt, cardAt, laneAt, to))
    focusCard(id)
    return
  }
  const target = lane + (direction === 'left' ? -1 : 1)
  if (target < 0 || target >= controller.board.value.lanes.length) return
  const targetCards = controller.board.value.lanes[target].cards.length
  withCard(id, (laneAt, cardAt) => moveCard(controller.board.value, laneAt, cardAt, target, Math.min(cardAt, targetCards)))
  focusCard(id)
}

const cardMenu = (id: string): KanbanMenuItem[] => {
  const card = props.lane.cards.find((entry) => entry.id === id)
  const index = props.lane.cards.findIndex((entry) => entry.id === id)
  const checked = !!card && card.checkChar !== null && card.checkChar !== ' '
  const lanes = controller.board.value.lanes
  return [
    { id: 'edit', label: t('card.edit'), run: () => cardRefs.get(id)?.startEdit() },
    {
      id: 'toggle',
      label: checked ? t('card.incomplete') : t('card.complete'),
      run: () => withCard(id, (lane, at) => setCardChecked(controller.board.value, lane, at, !checked))
    },
    {
      id: 'move-to',
      label: t('card.moveTo'),
      disabled: lanes.length < 2,
      children: lanes
        .map((lane, laneAt) => ({ lane, laneAt }))
        .filter(({ lane }) => lane.id !== props.lane.id)
        .map(({ lane, laneAt }) => ({ id: `lane-${lane.id}`, label: lane.title, run: () => moveToLane(id, laneAt) }))
    },
    {
      id: 'move-up',
      label: t('card.moveUp'),
      disabled: index <= 0,
      run: () => keyboardMove(id, 'up')
    },
    {
      id: 'move-down',
      label: t('card.moveDown'),
      disabled: index === -1 || index >= props.lane.cards.length - 1,
      run: () => keyboardMove(id, 'down')
    },
    {
      id: 'archive',
      label: t('card.archive'),
      run: () => withCard(id, (lane, at) => archiveCard(controller.board.value, lane, at, controller.markers()))
    },
    {
      id: 'delete',
      label: t('card.delete'),
      danger: true,
      run: async () => {
        const confirmed = await openDialog({
          title: t('card.delete'),
          message: t('card.deleteConfirm'),
          confirmText: t('lane.deleteAction'),
          cancelText: t('dialog.cancel'),
          danger: true
        })
        if (confirmed !== null) withCard(id, (lane, at) => deleteCard(controller.board.value, lane, at))
      }
    }
  ]
}

const startRename = (): void => {
  renameDraft.value = props.lane.maxItems > 0 ? `${props.lane.title} (${props.lane.maxItems})` : props.lane.title
  renaming.value = true
  nextTick(() => {
    renameInput.value?.focus()
    renameInput.value?.select()
  })
}

const commitRename = (): void => {
  if (!renaming.value) return
  renaming.value = false
  // A typed `(n)` suffix sets the WIP limit, as in the file.
  const { title, maxItems } = parseLaneTitle(renameDraft.value)
  const index = laneIndex()
  if (title && index !== -1) controller.apply((board) => renameLane(board, index, title, maxItems))
}

const setLimit = async (): Promise<void> => {
  const value = await openDialog({
    title: t('lane.setLimit'),
    input: { label: t('lane.limitLabel'), value: String(props.lane.maxItems), type: 'number', min: 0 },
    confirmText: t('dialog.ok'),
    cancelText: t('dialog.cancel')
  })
  const max = Number(value)
  const index = laneIndex()
  if (value === null || !Number.isFinite(max) || max < 0 || index === -1) return
  controller.apply((board) => renameLane(board, index, props.lane.title, max))
}

const removeLane = async (): Promise<void> => {
  const confirmed = await openDialog({
    title: t('lane.deleteTitle'),
    message: t('lane.deleteConfirm', { title: props.lane.title, count: props.lane.cards.length }),
    confirmText: t('lane.deleteAction'),
    cancelText: t('dialog.cancel'),
    danger: true
  })
  const index = laneIndex()
  if (confirmed !== null && index !== -1) controller.apply((board) => deleteLane(board, index))
}

const laneMenu = computed<KanbanMenuItem[]>(() => {
  const index = laneIndex()
  const count = controller.board.value.lanes.length
  return [
    { id: 'rename', label: t('lane.rename'), run: startRename },
    { id: 'limit', label: t('lane.setLimit'), run: setLimit },
    {
      id: 'complete',
      label: complete.value ? t('lane.unmarkComplete') : t('lane.markComplete'),
      run: () => controller.apply((board) => setLaneComplete(board, laneIndex(), !complete.value, controller.markers()))
    },
    {
      id: 'move-left',
      label: t('lane.moveLeft'),
      disabled: index <= 0,
      run: () => controller.apply((board) => moveLane(board, laneIndex(), laneIndex() - 1))
    },
    {
      id: 'move-right',
      label: t('lane.moveRight'),
      disabled: index === -1 || index >= count - 1,
      run: () => controller.apply((board) => moveLane(board, laneIndex(), laneIndex() + 1))
    },
    { id: 'delete', label: t('lane.delete'), danger: true, run: removeLane }
  ]
})

const autosizeNewCard = (): void => {
  const element = newCardInput.value
  if (!element) return
  element.style.height = 'auto'
  element.style.height = `${element.scrollHeight}px`
}

const onNewCardKeydown = (event: KeyboardEvent): void => {
  event.stopPropagation()
  if (event.isComposing) return
  if (event.key === 'Escape') {
    newCardText.value = ''
    newCardInput.value?.blur()
  } else if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault()
    const text = newCardText.value.trim()
    const index = laneIndex()
    if (!text || index === -1) return
    const setting = controller.board.value.settings['new-card-insertion-method']
    const position = setting === 'prepend' || setting === 'prepend-compact' ? 'start' : 'end'
    controller.apply((board) => addCard(board, index, text, position))
    newCardText.value = ''
    nextTick(autosizeNewCard)
  }
}
</script>
