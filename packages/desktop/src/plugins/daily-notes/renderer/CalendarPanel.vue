<template>
  <div class="daily-notes-calendar">
    <div class="title">
      {{ ctx.t('panel.title') }}
    </div>
    <div class="dn-body">
      <div class="dn-header">
        <button
          type="button"
          class="dn-icon-button"
          :aria-label="ctx.t('panel.previousMonth')"
          :title="ctx.t('panel.previousMonth')"
          @click="shiftView(-1)"
        >
          <svg
            viewBox="0 0 24 24"
            aria-hidden="true"
          ><path d="m15 18-6-6 6-6" /></svg>
        </button>
        <div
          class="dn-month"
          aria-live="polite"
        >
          {{ monthTitle }}
        </div>
        <button
          type="button"
          class="dn-icon-button"
          :aria-label="ctx.t('panel.nextMonth')"
          :title="ctx.t('panel.nextMonth')"
          @click="shiftView(1)"
        >
          <svg
            viewBox="0 0 24 24"
            aria-hidden="true"
          ><path d="m9 18 6-6-6-6" /></svg>
        </button>
        <button
          type="button"
          class="dn-today-button"
          :title="ctx.t('panel.goToToday')"
          @click="goToToday"
        >
          {{ ctx.t('panel.today') }}
        </button>
      </div>
      <div
        ref="gridRef"
        class="dn-grid"
        role="grid"
        :aria-label="monthTitle"
        @keydown="onKeydown"
      >
        <div
          class="dn-row"
          role="row"
        >
          <div
            v-for="weekday in weekdays"
            :key="weekday.long"
            class="dn-weekday"
            role="columnheader"
            :title="weekday.long"
            :aria-label="weekday.long"
          >
            {{ weekday.short }}
          </div>
        </div>
        <div
          v-for="(week, weekIndex) in weeks"
          :key="weekIndex"
          class="dn-row"
          role="row"
        >
          <div
            v-for="cell in week"
            :key="cell.key"
            class="dn-cell"
            role="gridcell"
            :aria-selected="cell.key === focusedKey"
          >
            <button
              type="button"
              class="dn-day"
              :class="{ 'dn-outside': !cell.inMonth, 'dn-today': cell.key === todayKey, 'dn-has-note': cell.note }"
              :data-date="cell.key"
              :tabindex="cell.key === focusedKey ? 0 : -1"
              :aria-label="cell.label"
              :aria-current="cell.key === todayKey ? 'date' : undefined"
              @click="open(cell.key)"
              @focus="focusedKey = cell.key"
            >
              <span class="dn-day-number">{{ cell.day }}</span>
              <span
                class="dn-dot-slot"
                aria-hidden="true"
              >
                <span
                  v-if="cell.note"
                  class="dn-dot"
                  :class="`dn-dot-${cell.level}`"
                />
              </span>
            </button>
          </div>
        </div>
      </div>
      <p
        v-if="!service.rootPath.value"
        class="dn-empty"
      >
        {{ ctx.t('panel.noFolder') }}
      </p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref } from 'vue'
import type { RendererPluginContext } from '@/plugins/types'
import {
  addDays,
  addMonths,
  buildMonthGrid,
  dotLevel,
  formatFullDate,
  formatMonthTitle,
  formatWeekdays,
  monthOf,
  weekEdge,
  type CalendarCell
} from '../common/calendar'
import { dateToKey, dayjs, type DateKey } from '../common/dates'
import type { DailyNote } from '../common/noteIndex'
import type { DailyNotesService } from './service'

interface DayCell extends CalendarCell {
  note: DailyNote | null
  level: number
  label: string
}

const props = defineProps<{
  ctx: RendererPluginContext
  service: DailyNotesService
}>()

const todayKey = ref(dateToKey(dayjs()))
const focusedKey = ref(todayKey.value)
const view = ref(monthOf(todayKey.value))
const gridRef = ref<HTMLElement | null>(null)

// Keeps the highlight right when the panel stays open past midnight.
const todayTimer = window.setInterval(() => {
  todayKey.value = dateToKey(dayjs())
}, 60_000)
onBeforeUnmount(() => window.clearInterval(todayTimer))

const language = computed(() => props.ctx.language.value)
const weekStart = computed(() => props.service.settings.value.weekStart)
const monthTitle = computed(() => formatMonthTitle(view.value.year, view.value.month, language.value))
const weekdays = computed(() => formatWeekdays(weekStart.value, language.value))

const weeks = computed<DayCell[][]>(() => {
  const index = props.service.index.value
  const cells = buildMonthGrid(view.value.year, view.value.month, weekStart.value).map((cell): DayCell => {
    const note = index?.get(cell.key) ?? null
    const fullDate = formatFullDate(cell.key, language.value)
    return {
      ...cell,
      note,
      level: note ? dotLevel(note.wordCount) : 0,
      label: note ? `${fullDate}, ${props.ctx.t('panel.hasNote', { count: note.wordCount })}` : fullDate
    }
  })
  return Array.from({ length: cells.length / 7 }, (_, week) => cells.slice(week * 7, week * 7 + 7))
})

const showMonthOf = (key: DateKey): void => {
  const target = monthOf(key)
  if (target.year !== view.value.year || target.month !== view.value.month) view.value = target
}

const shiftView = (months: number): void => {
  focusedKey.value = addMonths(focusedKey.value, months)
  view.value = monthOf(focusedKey.value)
}

const focusDay = async (key: DateKey): Promise<void> => {
  focusedKey.value = key
  showMonthOf(key)
  await nextTick()
  gridRef.value?.querySelector<HTMLElement>(`[data-date="${key}"]`)?.focus()
}

const goToToday = (): void => {
  todayKey.value = dateToKey(dayjs())
  focusedKey.value = todayKey.value
  view.value = monthOf(todayKey.value)
}

const open = (key: DateKey): void => {
  focusedKey.value = key
  props.service.openDate(key)
}

const onKeydown = (event: KeyboardEvent): void => {
  const current = focusedKey.value
  let next: DateKey | null = null
  switch (event.key) {
    case 'ArrowLeft':
      next = addDays(current, -1)
      break
    case 'ArrowRight':
      next = addDays(current, 1)
      break
    case 'ArrowUp':
      next = addDays(current, -7)
      break
    case 'ArrowDown':
      next = addDays(current, 7)
      break
    case 'Home':
      next = weekEdge(current, weekStart.value, 'start')
      break
    case 'End':
      next = weekEdge(current, weekStart.value, 'end')
      break
    case 'PageUp':
      next = addMonths(current, event.shiftKey ? -12 : -1)
      break
    case 'PageDown':
      next = addMonths(current, event.shiftKey ? 12 : 1)
      break
  }
  if (!next) return
  event.preventDefault()
  focusDay(next)
}
</script>

<style scoped>
.daily-notes-calendar {
  height: calc(100% - 35px);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  color: var(--sideBarColor);
}

.title {
  color: var(--sideBarTitleColor);
  font-weight: 600;
  font-size: 16px;
  margin: 37px 0 10px 0;
  padding-left: 25px;
  flex-shrink: 0;
}

.dn-body {
  padding: 0 12px 12px;
  overflow-y: auto;
}

.dn-header {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-bottom: 8px;
}

.dn-month {
  flex: 1;
  min-width: 0;
  text-align: center;
  font-weight: 600;
  font-size: 14px;
  color: var(--sideBarTitleColor);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

button {
  font: inherit;
  color: inherit;
  background: none;
  border: none;
  cursor: pointer;
}

button:focus-visible {
  outline: 2px solid var(--themeColor);
  outline-offset: -2px;
}

.dn-icon-button {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0;
  border-radius: 4px;
  color: var(--sideBarIconColor);
}

.dn-icon-button svg {
  width: 16px;
  height: 16px;
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.dn-icon-button:hover,
.dn-today-button:hover,
.dn-day:hover {
  background: var(--sideBarItemHoverBgColor);
}

.dn-today-button {
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 12px;
  color: var(--themeColor);
}

.dn-grid {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.dn-row {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  gap: 2px;
}

.dn-weekday {
  text-align: center;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  color: var(--sideBarIconColor);
  padding: 2px 0 4px;
  overflow: hidden;
  white-space: nowrap;
}

.dn-day {
  width: 100%;
  min-height: 34px;
  padding: 3px 0 2px;
  border-radius: 4px;
  display: flex;
  flex-direction: column;
  align-items: center;
  font-size: 13px;
  font-variant-numeric: tabular-nums;
}

.dn-outside {
  opacity: 0.45;
}

.dn-today .dn-day-number {
  color: var(--themeColor);
  font-weight: 700;
}

.dn-today {
  box-shadow: inset 0 0 0 1px var(--themeColor);
}

.dn-dot-slot {
  height: 9px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.dn-dot {
  border-radius: 50%;
  background: var(--themeColor);
}

.dn-dot-1 {
  width: 3px;
  height: 3px;
}

.dn-dot-2 {
  width: 5px;
  height: 5px;
}

.dn-dot-3 {
  width: 7px;
  height: 7px;
}

.dn-dot-4 {
  width: 9px;
  height: 9px;
}

.dn-empty {
  margin: 12px 4px 0;
  font-size: 12px;
  color: var(--sideBarIconColor);
}
</style>
