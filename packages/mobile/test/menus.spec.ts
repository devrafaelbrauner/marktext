import { describe, expect, it, vi } from 'vitest'
import type { MenuTemplate } from '@shared/types/menu'
import { connectWindow } from '../src/main/ipc'
import { registerMenus, templateToSheet } from '../src/main/menus'

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

describe('templateToSheet', () => {
  it('flattens submenus under a heading, drops hidden items and edge separators', () => {
    const clicks: string[] = []
    const template: MenuTemplate = [
      { type: 'separator' },
      { id: 'a', label: 'New File' },
      { id: 'h', label: 'Hidden', visible: false },
      { label: 'Sort', submenu: [{ id: 's1', label: 'By name', type: 'radio', checked: true }] },
      { id: 'd', label: 'Delete', enabled: false },
      { type: 'separator' }
    ]
    const items = templateToSheet(template, (id) => clicks.push(id))
    expect(items.map((i) => [i.label, i.depth, i.enabled, i.checked])).toEqual([
      ['New File', 0, true, false],
      ['Sort', 0, true, false],
      ['By name', 1, true, true],
      ['Delete', 0, false, false]
    ])
    expect(items[1]?.run).toBeUndefined()
    items[2]?.run?.()
    expect(clicks).toEqual(['s1'])
  })
})

describe('mt::menu::popup', () => {
  it('renders the template and answers a tap with click then closed, to the caller only', async() => {
    registerMenus(() => 'en')
    const caller = connectWindow(7)
    const other = connectWindow(8)
    const events: unknown[] = []
    caller.on('mt::menu::click', (_e, message) => events.push(['click', message]))
    caller.on('mt::menu::closed', () => events.push(['closed']))
    const leaked = vi.fn()
    other.on('mt::menu::click', leaked)

    caller.send('mt::menu::popup', [{ id: 'mi-1', label: 'Rename' }, { id: 'mi-2', label: 'Delete' }])
    await flush()
    const rows = [...document.querySelectorAll('.mt-menu-sheet li[role=menuitem]')]
    expect(rows.map((row) => row.textContent)).toEqual(['Rename', 'Delete'])
    ;(rows[1] as HTMLElement).click()
    await flush()

    expect(events).toEqual([['click', { windowId: 7, id: 'mi-2' }], ['closed']])
    expect(leaked).not.toHaveBeenCalled()
    expect(document.querySelector('.mt-menu-backdrop')).toBeNull()
  })

  it('dismissing the sheet reports closed without a click', async() => {
    const caller = connectWindow(9)
    const events: string[] = []
    caller.on('mt::menu::click', () => events.push('click'))
    caller.on('mt::menu::closed', () => events.push('closed'))
    caller.send('mt::menu::popup', [{ id: 'x', label: 'Copy' }])
    await flush()
    ;(document.querySelector('.mt-menu-backdrop') as HTMLElement).click()
    await flush()
    expect(events).toEqual(['closed'])
  })
})
