import type { InjectionKey, Ref } from 'vue'
import type { RendererPluginContext } from '@/plugins/types'
import type { BoardMarkers, KanbanBoard } from '../common/board'
import type { CardTriggers } from '../common/cardText'

/** What the board view shares with its lanes and cards. */
export interface KanbanController {
  ctx: RendererPluginContext
  board: Ref<KanbanBoard>
  /** Runs an edit (see common/operations) and writes the serialized board to the tab. */
  apply(change: (board: KanbanBoard) => void): void
  markers(): BoardMarkers
  triggers(): CardTriggers
  /** Lower-cased filter text; cards not containing it are hidden. */
  filter: Ref<string>
  /** BCP 47 locale of the UI language. */
  locale(): string
  openWikilink(raw: string): void
  openHref(href: string): void
  /** Id of the card being edited; dragging is off meanwhile. */
  editing: Ref<string | null>
}

export const KANBAN_CONTROLLER: InjectionKey<KanbanController> = Symbol('kanban-controller')
