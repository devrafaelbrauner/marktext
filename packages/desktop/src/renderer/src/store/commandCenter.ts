import { ref } from 'vue'
import { defineStore } from 'pinia'
import log from 'electron-log'
import bus from '../bus'
import { isMac } from '@/util'
import { acceleratorToTokens } from '@/util/accelerator'

import staticCommands, {
  RootCommand,
  getCommandsWithDescriptions,
  type CommandDescriptor
} from '../commands'

type Command = CommandDescriptor
type Root = { subcommands: Command[] }

export const useCommandCenterStore = defineStore('commandCenter', () => {
  const rootCommand = ref<Root>(
    new RootCommand(staticCommands as unknown as CommandDescriptor[]) as Root
  )

  // Runtime commands whose description depends on the UI language (plugin
  // commands). `getCommandsWithDescriptions` only knows static command ids and
  // resets every other description to the id, so these are re-applied after it.
  const localizedDescriptions = new Map<string, () => string>()

  function REGISTER_COMMAND(command: Command, describe?: () => string): void {
    if (describe) {
      localizedDescriptions.set(command.id, describe)
      command.description = describe()
    }
    rootCommand.value.subcommands.push(command)
  }

  function UNREGISTER_COMMAND(id: string): void {
    localizedDescriptions.delete(id)
    const index = rootCommand.value.subcommands.findIndex((c) => c.id === id)
    if (index !== -1) rootCommand.value.subcommands.splice(index, 1)
  }

  function SORT_COMMANDS(): void {
    rootCommand.value.subcommands.sort((a, b) =>
      (a.description ?? '').localeCompare(b.description ?? '')
    )
  }

  async function refreshDescriptions(): Promise<void> {
    rootCommand.value.subcommands = await getCommandsWithDescriptions()
    for (const entry of rootCommand.value.subcommands) {
      const describe = localizedDescriptions.get(entry.id)
      if (describe) entry.description = describe()
    }
    SORT_COMMANDS()
  }

  async function LISTEN_COMMAND_CENTER_BUS(): Promise<void> {
    await refreshDescriptions()

    // Listen for language changes and update command descriptions.
    bus.on('language-changed', refreshDescriptions)

    bus.on('cmd::sort-commands', () => {
      SORT_COMMANDS()
    })

    window.electron.ipcRenderer.on('mt::keybindings-response', (_e, keybindingMap) => {
      const map = keybindingMap as Record<string, string>
      const { subcommands } = rootCommand.value
      for (const entry of subcommands) {
        const value = map[entry.id]
        if (value) {
          entry.shortcut = normalizeAccelerator(value)
        }
      }
    })

    // Register commands that are created at runtime.
    bus.on('cmd::register-command', (command: unknown) => {
      REGISTER_COMMAND(command as Command)
    })

    // Allow other components to execute commands with predefined values.
    bus.on('cmd::execute', (commandId: unknown) => {
      executeCommand(rootCommand.value, String(commandId))
    })
    window.electron.ipcRenderer.on('mt::execute-command-by-id', (_e, commandId) => {
      executeCommand(rootCommand.value, String(commandId))
    })
  }

  return {
    rootCommand,
    REGISTER_COMMAND,
    UNREGISTER_COMMAND,
    SORT_COMMANDS,
    LISTEN_COMMAND_CENTER_BUS
  }
})

const executeCommand = (root: Root, commandId: string): void => {
  const { subcommands } = root
  const command = subcommands.find((c) => c.id === commandId)
  if (!command) {
    const errorMsg = `Cannot execute command "${commandId}" because it's missing.`
    log.error(errorMsg)
    throw new Error(errorMsg)
  }
  command.execute?.()
}

const normalizeAccelerator = (acc: string): string[] => {
  try {
    return acceleratorToTokens(acc, isMac)
  } catch {
    return [acc]
  }
}
