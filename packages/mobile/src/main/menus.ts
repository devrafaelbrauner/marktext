// Native menus, on Android: Electron pops OS menus for the renderer's context
// menus (`mt::menu::popup`, a serialized template) and for the title bar's
// application menu button. Here both render as an in-page action sheet. Item
// clicks travel back exactly as on desktop (`mt::menu::click` {windowId, id},
// then `mt::menu::closed`), so the renderer's popupContextMenu works as is.

import type { MenuTemplate, MenuTemplateItem } from '@shared/types/menu'
import { pushBackHandler } from './backButton'
import { translate } from './i18n'
import { EDITOR_WINDOW_ID, ipcMain, pushTo, rendererIpc, type MobileIpcEvent } from './ipc'
import { openSettingsWindow } from './settingsWindow'

interface SheetItem {
  label: string
  enabled: boolean
  checked: boolean
  depth: number
  run?: () => void
}

let openSheet: { close: () => void } | null = null

const SHEET_STYLE = `
.mt-menu-backdrop{position:fixed;inset:0;z-index:4000;background:rgba(0,0,0,.32);display:flex;align-items:flex-end;justify-content:center}
.mt-menu-sheet{width:min(100vw,480px);max-height:75vh;overflow-y:auto;margin:0;padding:6px 0 calc(6px + env(safe-area-inset-bottom,0px));list-style:none;
  background:var(--floatBgColor,#fff);color:var(--editorColor,#303133);border-radius:12px 12px 0 0;box-shadow:var(--floatShadow,0 -2px 12px rgba(0,0,0,.2));font-size:15px}
.mt-menu-sheet li{min-height:44px;display:flex;align-items:center;padding:0 20px;user-select:none}
.mt-menu-sheet li.item:active{background:var(--floatHoverColor,rgba(0,0,0,.06))}
.mt-menu-sheet li.disabled{opacity:.4}
.mt-menu-sheet li.heading{min-height:32px;font-size:12px;opacity:.6;text-transform:uppercase}
.mt-menu-sheet li.separator{min-height:0;height:1px;margin:6px 0;padding:0;background:var(--floatBorderColor,rgba(0,0,0,.1))}
.mt-menu-sheet .check{width:20px;flex:none}
`

function ensureStyle(): void {
  if (document.getElementById('mt-menu-style')) return
  const style = document.createElement('style')
  style.id = 'mt-menu-style'
  style.textContent = SHEET_STYLE
  document.head.append(style)
}

/** Shows `items` as a bottom sheet; `onClosed` runs once however it closes. */
export function showSheet(items: SheetItem[], onClosed: () => void = () => {}): void {
  openSheet?.close()
  ensureStyle()
  const backdrop = document.createElement('div')
  backdrop.className = 'mt-menu-backdrop'
  const list = document.createElement('ul')
  list.className = 'mt-menu-sheet'
  list.setAttribute('role', 'menu')

  let removeBack: () => void = () => {}
  const close = (): void => {
    if (openSheet !== sheet) return
    openSheet = null
    removeBack()
    backdrop.remove()
    onClosed()
  }
  const sheet = { close }

  for (const item of items) {
    const row = document.createElement('li')
    if (item.label === '-') {
      row.className = 'separator'
      row.setAttribute('role', 'separator')
    } else if (!item.run && item.enabled) {
      row.className = 'heading'
      row.textContent = item.label
    } else {
      row.className = item.enabled ? 'item' : 'item disabled'
      row.setAttribute('role', 'menuitem')
      row.setAttribute('aria-disabled', String(!item.enabled))
      row.style.paddingInlineStart = `${20 + item.depth * 16}px`
      const check = document.createElement('span')
      check.className = 'check'
      check.textContent = item.checked ? '✓' : ''
      const label = document.createElement('span')
      label.textContent = item.label
      row.append(check, label)
      if (item.enabled && item.run) {
        const run = item.run
        row.addEventListener('click', (event) => {
          event.stopPropagation()
          // Click before closed, as Electron does: the renderer drops its
          // click handlers when it hears `mt::menu::closed`.
          run()
          close()
        })
      }
    }
    list.append(row)
  }
  backdrop.addEventListener('click', (event) => {
    if (event.target === backdrop) close()
  })
  backdrop.append(list)
  document.body.append(backdrop)
  openSheet = sheet
  removeBack = pushBackHandler(close)
}

/** Flattens an Electron template; submenus become indented groups. */
export function templateToSheet(
  template: MenuTemplate,
  onClick: (id: string) => void,
  depth = 0
): SheetItem[] {
  const out: SheetItem[] = []
  for (const item of template) {
    if (item.visible === false) continue
    if (item.type === 'separator') {
      out.push({ label: '-', enabled: true, checked: false, depth })
      continue
    }
    const label = labelOf(item)
    if (item.submenu && item.submenu.length > 0) {
      out.push({ label, enabled: true, checked: false, depth })
      out.push(...templateToSheet(item.submenu, onClick, depth + 1))
      continue
    }
    const id = item.id
    out.push({
      label,
      enabled: item.enabled !== false && typeof id === 'string',
      checked: !!item.checked,
      depth,
      run: typeof id === 'string' ? () => onClick(id) : undefined
    })
  }
  // A leading or trailing separator (from hidden items) reads as noise.
  while (out[0]?.label === '-') out.shift()
  while (out[out.length - 1]?.label === '-') out.pop()
  return out
}

const labelOf = (item: MenuTemplateItem): string => item.label ?? item.role ?? ''

function popupTemplate(event: MobileIpcEvent, template: MenuTemplate): void {
  const windowId = event.sender.id
  const items = templateToSheet(template, (id) =>
    // Desktop's contract types the click as `[menuId]` but sends this record
    // (popupMenu.ts reads `.id`).
    event.sender.send('mt::menu::click', { windowId, id } as unknown as string)
  )
  showSheet(items, () => event.sender.send('mt::menu::closed'))
}

const editor = pushTo(EDITOR_WINDOW_ID)

async function applicationMenu(language: string): Promise<SheetItem[]> {
  const entries: Array<[string, () => void] | '-'> = [
    ['menu.file.newTab', () => editor('mt::new-untitled-tab', true)],
    ['menu.file.openFile', () => rendererIpc.send('mt::cmd-open-file')],
    ['menu.file.openFolder', () => rendererIpc.send('mt::cmd-open-folder')],
    ['menu.file.save', () => editor('mt::editor-ask-file-save')],
    ['menu.file.saveAs', () => editor('mt::editor-ask-file-save-as')],
    ['menu.file.rename', () => editor('mt::editor-rename-file')],
    '-',
    ['menu.edit.undo', () => editor('mt::editor-edit-action', 'undo')],
    ['menu.edit.redo', () => editor('mt::editor-edit-action', 'redo')],
    ['menu.edit.find', () => editor('mt::editor-edit-action', 'find')],
    ['menu.edit.replace', () => editor('mt::editor-edit-action', 'replace')],
    ['menu.edit.findInFolder', () => editor('mt::editor-edit-action', 'findInFolder')],
    '-',
    ['menu.view.toggleSidebar', () => editor('mt::toggle-view-layout-entry', 'showSideBar')],
    ['menu.view.toggleTabbar', () => editor('mt::toggle-view-layout-entry', 'showTabBar')],
    ['menu.view.commandPalette', () => editor('mt::show-command-palette')],
    ['menu.view.sourceCodeMode', () => editor('mt::toggle-view-mode-entry', 'sourceCode')],
    ['menu.view.focusMode', () => editor('mt::toggle-view-mode-entry', 'focus')],
    ['menu.view.typewriterMode', () => editor('mt::toggle-view-mode-entry', 'typewriter')],
    '-',
    ['menu.file.preferences', () => openSettingsWindow()]
  ]
  return Promise.all(
    entries.map(async(entry) =>
      entry === '-'
        ? { label: '-', enabled: true, checked: false, depth: 0 }
        : { label: await translate(language, entry[0]), enabled: true, checked: false, depth: 0, run: entry[1] }
    )
  )
}

export function registerMenus(getLanguage: () => string): void {
  ipcMain.on('mt::menu::popup', (event, template) => {
    popupTemplate(event, Array.isArray(template) ? (template as MenuTemplate) : [])
  })
  ipcMain.on('mt::menu::popup-application', (event) => {
    if (event.sender.id !== EDITOR_WINDOW_ID) return
    applicationMenu(getLanguage())
      .then((items) => showSheet(items))
      .catch((error: unknown) => console.error(error))
  })
}
