import { defineComponent, h, type PropType } from 'vue'
import calendarIcon from 'lucide-static/icons/calendar-days.svg?raw'
import type { RendererPluginContext, RendererPluginModule } from '@/plugins/types'
import { CALENDAR_PANEL_ID } from '../common/constants'
import CalendarPanel from './CalendarPanel.vue'
import { DailyNotesService } from './service'

// "Open on startup" fires once per window, not again when the plugin is re-enabled.
let startupHandled = false

const plugin: RendererPluginModule = {
  activate(ctx) {
    const service = new DailyNotesService(ctx)
    service.start()

    ctx.ui.registerSidebarPanel({
      id: CALENDAR_PANEL_ID,
      title: 'panel.title',
      icon: calendarIcon,
      order: 10,
      component: defineComponent({
        name: 'DailyNotesCalendarPanel',
        props: { ctx: { type: Object as PropType<RendererPluginContext>, required: true } },
        setup: (props) => () => h(CalendarPanel, { ctx: props.ctx, service })
      })
    })

    ctx.commands.register({
      id: 'daily-notes.open-today',
      title: 'commands.openToday',
      // CmdOrCtrl+Alt+D is the app's "Duplicate" on macOS and Windows.
      keybinding: 'CmdOrCtrl+Alt+Shift+D',
      run: () => service.openToday()
    })
    ctx.commands.register({
      id: 'daily-notes.open-previous',
      title: 'commands.openPrevious',
      run: () => service.openAdjacent(-1)
    })
    ctx.commands.register({
      id: 'daily-notes.open-next',
      title: 'commands.openNext',
      run: () => service.openAdjacent(1)
    })
    ctx.commands.register({
      id: 'daily-notes.open-calendar',
      title: 'commands.openCalendar',
      run: () => ctx.ui.revealSidebarPanel(CALENDAR_PANEL_ID)
    })

    if (startupHandled) return
    startupHandled = true
    if (!service.settings.value.openOnStartup) return
    if (ctx.workspace.getRootPath()) {
      service.openToday()
      return
    }
    // A folder window usually learns its folder shortly after the plugins start.
    const waitForFolder = ctx.workspace.onDidChangeRootPath((rootPath) => {
      if (!rootPath) return
      waitForFolder.dispose()
      service.openToday()
    })
  }
}

export default plugin
