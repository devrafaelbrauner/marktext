<template>
  <span class="kanban-menu-host">
    <button
      ref="trigger"
      type="button"
      class="kanban-icon-button kanban-menu-trigger"
      :aria-label="label"
      :title="label"
      aria-haspopup="menu"
      :aria-expanded="open ? 'true' : 'false'"
      @click.stop="toggle"
      @keydown.down.prevent="show(0)"
      v-html="ELLIPSIS"
    />
    <Teleport to="body">
      <div
        v-if="open"
        class="kanban-menu-overlay"
        @mousedown.self="close(false)"
      >
        <ul
          ref="list"
          class="kanban-menu"
          role="menu"
          :aria-label="label"
          :style="position"
          @keydown="onKeydown"
        >
          <li
            v-for="(item, index) in visibleItems"
            :key="item.id"
            role="menuitem"
            :tabindex="index === active ? 0 : -1"
            :aria-disabled="item.disabled ? 'true' : undefined"
            :aria-haspopup="item.children ? 'menu' : undefined"
            :class="['kanban-menu-item', { 'is-danger': item.danger, 'is-disabled': item.disabled }]"
            :data-menu-item="item.id"
            @click="activate(item)"
            @mouseenter="focusItem(index)"
            @focus="active = index"
          >
            {{ item.label }}
          </li>
        </ul>
      </div>
    </Teleport>
  </span>
</template>

<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import { Ellipsis } from 'lucide-static'

export interface KanbanMenuItem {
  id: string
  label: string
  run?: () => void
  /** Opens a second level in place of the menu (e.g. the lanes of "Move to…"). */
  children?: KanbanMenuItem[]
  disabled?: boolean
  danger?: boolean
}

const props = defineProps<{
  label: string
  items: KanbanMenuItem[]
}>()

const ELLIPSIS = Ellipsis
const trigger = ref<HTMLButtonElement | null>(null)
const list = ref<HTMLUListElement | null>(null)
const open = ref(false)
const active = ref(0)
const submenu = ref<KanbanMenuItem[] | null>(null)
const position = ref<Record<string, string>>({})

const visibleItems = computed(() => submenu.value ?? props.items)

const focusItem = (index: number): void => {
  active.value = index
  nextTick(() => {
    const items = list.value?.querySelectorAll<HTMLElement>('[role="menuitem"]')
    items?.[index]?.focus()
  })
}

const show = (index: number): void => {
  const rect = trigger.value?.getBoundingClientRect()
  if (rect) {
    const right = Math.max(8, window.innerWidth - rect.right)
    const below = window.innerHeight - rect.bottom > 220
    position.value = below
      ? { top: `${rect.bottom + 4}px`, right: `${right}px` }
      : { bottom: `${window.innerHeight - rect.top + 4}px`, right: `${right}px` }
  }
  submenu.value = null
  open.value = true
  focusItem(index)
}

const close = (restoreFocus: boolean): void => {
  open.value = false
  submenu.value = null
  if (restoreFocus) trigger.value?.focus()
}

const toggle = (): void => {
  if (open.value) close(false)
  else show(0)
}

const activate = (item: KanbanMenuItem): void => {
  if (item.disabled) return
  if (item.children) {
    submenu.value = item.children
    focusItem(0)
    return
  }
  close(true)
  item.run?.()
}

const onKeydown = (event: KeyboardEvent): void => {
  const count = visibleItems.value.length
  switch (event.key) {
    case 'ArrowDown':
      focusItem((active.value + 1) % count)
      break
    case 'ArrowUp':
      focusItem((active.value - 1 + count) % count)
      break
    case 'Home':
      focusItem(0)
      break
    case 'End':
      focusItem(count - 1)
      break
    case 'Enter':
    case ' ':
      activate(visibleItems.value[active.value])
      break
    case 'Escape':
    case 'ArrowLeft':
      if (submenu.value) {
        submenu.value = null
        focusItem(0)
      } else if (event.key === 'Escape') {
        close(true)
      }
      break
    case 'Tab':
      close(false)
      return
    default:
      return
  }
  event.preventDefault()
  event.stopPropagation()
}
</script>
