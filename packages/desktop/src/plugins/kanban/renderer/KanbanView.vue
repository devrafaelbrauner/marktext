<template>
  <div
    class="kanban-view"
    role="region"
    :aria-label="t('board.label', { name: boardName })"
  >
    <header class="kanban-toolbar">
      <span
        class="kanban-toolbar-icon"
        aria-hidden="true"
        v-html="BOARD_ICON"
      />
      <h1 class="kanban-board-name">
        {{ boardName }}
      </h1>
      <div class="kanban-filter">
        <input
          v-model="filterText"
          class="kanban-input"
          type="search"
          :placeholder="t('board.filterPlaceholder')"
          :aria-label="t('board.filterPlaceholder')"
          @keydown.esc="filterText = ''"
        >
        <button
          v-if="filterText"
          type="button"
          class="kanban-icon-button"
          :aria-label="t('board.clearFilter')"
          :title="t('board.clearFilter')"
          @click="filterText = ''"
          v-html="CLOSE_ICON"
        />
      </div>
      <button
        type="button"
        class="kanban-button kanban-archive-toggle"
        :aria-pressed="showArchive ? 'true' : 'false'"
        @click="showArchive = !showArchive"
      >
        <span
          class="kanban-button-icon"
          aria-hidden="true"
          v-html="ARCHIVE_ICON"
        />
        {{ t('board.archive', { count: archiveCards.length }) }}
      </button>
    </header>

    <div class="kanban-body">
      <div
        ref="lanesElement"
        class="kanban-lanes"
      >
        <KanbanLaneView
          v-for="lane in board.lanes"
          :key="lane.id"
          :lane="lane"
        />
        <div
          class="kanban-add-lane"
          :class="{ 'is-empty-board': board.lanes.length === 0 }"
        >
          <p
            v-if="board.lanes.length === 0"
            class="kanban-empty"
          >
            {{ t('board.empty') }}
          </p>
          <form
            v-if="addingLane"
            class="kanban-add-lane-form"
            @submit.prevent="commitLane"
          >
            <input
              ref="laneInput"
              v-model="laneDraft"
              class="kanban-input"
              :placeholder="t('board.laneNamePlaceholder')"
              :aria-label="t('board.laneNamePlaceholder')"
              @keydown.esc.prevent="addingLane = false"
              @blur="commitLane"
            >
          </form>
          <button
            v-else
            type="button"
            class="kanban-button kanban-add-lane-button"
            @click="startLane"
          >
            <span
              class="kanban-button-icon"
              aria-hidden="true"
              v-html="PLUS_ICON"
            />
            {{ t('board.addLane') }}
          </button>
        </div>
      </div>

      <aside
        v-if="showArchive"
        class="kanban-archive"
        :aria-label="t('board.archiveTitle')"
      >
        <header class="kanban-archive-header">
          <h2>{{ t('board.archiveTitle') }}</h2>
          <button
            type="button"
            class="kanban-icon-button"
            :aria-label="t('board.closeArchive')"
            :title="t('board.closeArchive')"
            @click="showArchive = false"
            v-html="CLOSE_ICON"
          />
        </header>
        <p
          v-if="archiveCards.length === 0"
          class="kanban-empty"
        >
          {{ t('board.archiveEmpty') }}
        </p>
        <ul class="kanban-archive-cards">
          <KanbanCardView
            v-for="card in archiveCards"
            :key="card.id"
            :card="card"
            archived
          >
            <template #actions>
              <KanbanMenu
                class="kanban-card-menu"
                :label="t('card.menu')"
                :items="archiveMenu(card.id)"
              />
            </template>
          </KanbanCardView>
        </ul>
      </aside>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, provide, ref, toRaw, watch } from 'vue'
import dragula from 'dragula'
import { Archive, SquareKanban, Plus, X } from 'lucide-static'
import type { MarkdownViewProps } from '@/plugins/types'
import { getMarkersForLanguage, parseBoard, parseLaneTitle, serializeBoard, type KanbanBoard } from '../common/board'
import { getTriggers } from '../common/cardText'
import { addLane, deleteArchivedCard, getBoardMarkers, moveCard, moveLane, restoreArchivedCard } from '../common/operations'
import { KANBAN_CONTROLLER, type KanbanController } from './controller'
import KanbanCardView from './KanbanCard.vue'
import KanbanLaneView from './KanbanLane.vue'
import KanbanMenu, { type KanbanMenuItem } from './KanbanMenu.vue'
import { openHref, openWikilink } from './links'

const props = defineProps<MarkdownViewProps>()

const BOARD_ICON = SquareKanban
const ARCHIVE_ICON = Archive
const PLUS_ICON = Plus
const CLOSE_ICON = X
const t = props.ctx.t

const board = ref<KanbanBoard>(parseBoard(props.markdown))
const editing = ref<string | null>(null)
// Last markdown this view wrote, so its own update coming back through props is not re-parsed.
let written = props.markdown

watch(
  () => props.markdown,
  (markdown) => {
    if (markdown === written) return
    written = markdown
    board.value = parseBoard(markdown)
    // Card ids are new after parsing; an open editor would point at a card that no longer exists.
    editing.value = null
  }
)

const filterText = ref('')
const filter = computed({
  get: () => filterText.value.trim().toLowerCase(),
  set: (value: string) => {
    filterText.value = value
  }
})
const showArchive = ref(false)
const addingLane = ref(false)
const laneDraft = ref('')
const laneInput = ref<HTMLInputElement | null>(null)
const lanesElement = ref<HTMLElement | null>(null)

const boardName = computed(() => {
  const name = props.pathname?.split(/[/\\]/).pop() ?? ''
  return name.replace(/\.md$/i, '') || t('view.title')
})
const archiveCards = computed(() => board.value.archive?.cards ?? [])

const reportError = (target: string, error: unknown): void => {
  const message = error instanceof Error ? error.message : String(error)
  props.ctx.ui.notify({ type: 'error', message: t('errors.openLink', { target, message }) })
}

const controller: KanbanController = {
  ctx: props.ctx,
  board,
  apply: (change) => {
    change(board.value)
    const markdown = serializeBoard(toRaw(board.value))
    if (markdown === written) return
    written = markdown
    props.update(markdown)
  },
  markers: () => getBoardMarkers(board.value, getMarkersForLanguage(props.ctx.language.value)),
  triggers: () => getTriggers(board.value.settings),
  filter,
  locale: () => (props.ctx.language.value === 'pt' ? 'pt-BR' : props.ctx.language.value.replace('_', '-')),
  openWikilink: (raw) => {
    openWikilink(props.ctx, raw, props.pathname).catch((error) => reportError(raw, error))
  },
  openHref: (href) => {
    openHref(props.ctx, href, props.pathname).catch((error) => reportError(href, error))
  },
  editing
}
provide(KANBAN_CONTROLLER, controller)

const startLane = (): void => {
  laneDraft.value = ''
  addingLane.value = true
  nextTick(() => laneInput.value?.focus())
}

const commitLane = (): void => {
  if (!addingLane.value) return
  addingLane.value = false
  const { title, maxItems } = parseLaneTitle(laneDraft.value)
  if (title) controller.apply((target) => addLane(target, title, maxItems))
}

const archiveMenu = (id: string): KanbanMenuItem[] => {
  const index = (): number => archiveCards.value.findIndex((card) => card.id === id)
  return [
    {
      id: 'restore',
      label: t('board.restore'),
      disabled: board.value.lanes.length === 0,
      children: board.value.lanes.map((lane, laneIndex) => ({
        id: `lane-${lane.id}`,
        label: t('board.restoreTo', { lane: lane.title }),
        run: () => controller.apply((target) => restoreArchivedCard(target, index(), laneIndex))
      }))
    },
    {
      id: 'delete',
      label: t('card.delete'),
      danger: true,
      run: () => controller.apply((target) => deleteArchivedCard(target, index()))
    }
  ]
}

// Drag and drop: dragula moves the DOM node; the view puts it back and applies
// the move to the model, so Vue stays the only owner of the DOM.
let cardDrake: dragula.Drake | null = null
let laneDrake: dragula.Drake | null = null
let origin: { parent: Element; next: Node | null } | null = null
const DRAG_THRESHOLD_PX = 5

const nextSiblingId = (element: Element, selector: string, attribute: string): string | null => {
  let next = element.nextElementSibling
  while (next && (!next.matches(selector) || next.classList.contains('gu-mirror'))) next = next.nextElementSibling
  return next?.getAttribute(attribute) ?? null
}

const restoreOrigin = (element: Element): void => {
  if (origin) origin.parent.insertBefore(element, origin.next)
  origin = null
}

const syncContainers = (): void => {
  if (!cardDrake || !lanesElement.value) return
  cardDrake.containers.splice(0, cardDrake.containers.length, ...lanesElement.value.querySelectorAll('.kanban-lane-cards'))
}

onMounted(() => {
  if (!lanesElement.value) return
  cardDrake = dragula([], {
    moves: (element, _source, handle) =>
      !!element?.classList.contains('kanban-card') &&
      !editing.value &&
      !(handle as HTMLElement | undefined)?.closest('input, textarea, button, a, .kanban-tag, .kanban-menu-trigger'),
    accepts: (_element, target) => !!target?.classList.contains('kanban-lane-cards'),
    revertOnSpill: true,
    slideFactorX: DRAG_THRESHOLD_PX,
    slideFactorY: DRAG_THRESHOLD_PX
  })
    .on('drag', (element) => {
      origin = { parent: element.parentElement!, next: element.nextSibling }
    })
    .on('drop', (element, target) => {
      const cardId = element.getAttribute('data-card-id')
      const toLaneId = target?.getAttribute('data-lane-id')
      const beforeId = nextSiblingId(element, '.kanban-card', 'data-card-id')
      restoreOrigin(element)
      const lanes = board.value.lanes
      const fromLane = lanes.findIndex((lane) => lane.cards.some((card) => card.id === cardId))
      const toLane = lanes.findIndex((lane) => lane.id === toLaneId)
      if (fromLane === -1 || toLane === -1) return
      const fromIndex = lanes[fromLane].cards.findIndex((card) => card.id === cardId)
      const remaining = lanes[toLane].cards.filter((card) => card.id !== cardId)
      const before = beforeId ? remaining.findIndex((card) => card.id === beforeId) : -1
      controller.apply((target) => moveCard(target, fromLane, fromIndex, toLane, before === -1 ? remaining.length : before))
    })
    .on('cancel', (element) => restoreOrigin(element))

  laneDrake = dragula([lanesElement.value], {
    direction: 'horizontal',
    moves: (element, _source, handle) =>
      !!element?.classList.contains('kanban-lane') && !!(handle as HTMLElement | undefined)?.closest('.kanban-lane-handle'),
    revertOnSpill: true,
    slideFactorX: DRAG_THRESHOLD_PX,
    slideFactorY: DRAG_THRESHOLD_PX
  })
    .on('drag', (element) => {
      origin = { parent: element.parentElement!, next: element.nextSibling }
    })
    .on('drop', (element) => {
      const laneId = element.getAttribute('data-lane-id')
      const beforeId = nextSiblingId(element, '.kanban-lane', 'data-lane-id')
      restoreOrigin(element)
      const lanes = board.value.lanes
      const from = lanes.findIndex((lane) => lane.id === laneId)
      if (from === -1) return
      const remaining = lanes.filter((lane) => lane.id !== laneId)
      const before = beforeId ? remaining.findIndex((lane) => lane.id === beforeId) : -1
      controller.apply((target) => moveLane(target, from, before === -1 ? remaining.length : before))
    })
    .on('cancel', (element) => restoreOrigin(element))

  syncContainers()
})

watch(
  () => board.value.lanes.map((lane) => lane.id).join('\n'),
  () => nextTick(syncContainers),
  { flush: 'post' }
)

onBeforeUnmount(() => {
  cardDrake?.destroy()
  laneDrake?.destroy()
})
</script>
