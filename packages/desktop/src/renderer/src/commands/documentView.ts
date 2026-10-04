import { delay } from '@/util'
import bus from '../bus'
import getCommandDescriptionById from './descriptions'
import notice from '../services/notification'
import { listMarkdownViews } from '../plugins/registries/tabViews'
import { t } from '../i18n'
import type { IFileState } from '@shared/types/files'

export const DOCUMENT_VIEW_COMMAND_ID = 'view.toggle-document-view'

interface DocumentViewSubcommand {
  id: string
  description: string
  value: string | null
}

interface DocumentViewEditor {
  currentFile: IFileState | null
  SET_TAB_VIEW(tabId: string, viewId: string | null): void
}

/**
 * Switches the active markdown tab between the editor and the markdown views
 * registered by plugins (e.g. a Kanban board). With one view it toggles
 * directly; with several it lists them in the command palette.
 */
class DocumentViewCommand {
  id: string
  description: string
  placeholder: string
  subcommands: DocumentViewSubcommand[]
  subcommandSelectedIndex: number
  private _editor: DocumentViewEditor

  constructor(editor: DocumentViewEditor) {
    this.id = DOCUMENT_VIEW_COMMAND_ID
    this.description = getCommandDescriptionById(DOCUMENT_VIEW_COMMAND_ID)
    this.placeholder = t('commandPalette.placeholders.selectOption')
    this.subcommands = []
    this.subcommandSelectedIndex = -1
    this._editor = editor
  }

  run = async(): Promise<void> => {
    const viewId = this._editor.currentFile?.viewId ?? null
    this.subcommands = [
      {
        id: `${DOCUMENT_VIEW_COMMAND_ID}.editor`,
        description: t('editor.tabView.editor'),
        value: null
      },
      ...listMarkdownViews().map(({ view, ctx }) => ({
        id: `${DOCUMENT_VIEW_COMMAND_ID}.${view.id}`,
        description: ctx.t(view.title),
        value: view.id
      }))
    ]
    this.subcommandSelectedIndex = this.subcommands.findIndex((entry) => entry.value === viewId)
  }

  execute = async(): Promise<void> => {
    const tab = this._editor.currentFile
    if (!tab || tab.kind !== 'markdown') return
    if (tab.viewId !== null) {
      this._editor.SET_TAB_VIEW(tab.id, null)
      return
    }

    const [onlyView, ...otherViews] = listMarkdownViews()
    if (!onlyView) {
      notice.notify({
        title: t('editor.tabView.noDocumentViews'),
        type: 'info',
        time: 3000,
        showConfirm: false
      })
    } else if (otherViews.length === 0) {
      this._editor.SET_TAB_VIEW(tab.id, onlyView.view.id)
    } else {
      // Timeout to hide the command palette and then show again to prevent issues.
      await delay(100)
      bus.emit('show-command-palette', this)
    }
  }

  executeSubcommand = async(_: string, value: string | null): Promise<void> => {
    const tab = this._editor.currentFile
    if (tab && tab.kind === 'markdown') {
      this._editor.SET_TAB_VIEW(tab.id, value)
    }
  }

  unload = (): void => {}
}

export default DocumentViewCommand
