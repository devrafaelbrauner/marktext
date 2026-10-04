import { acceleratorToTokens } from '@/util/accelerator'
import type { CommandDescriptor } from '@/commands'
import type { PluginKeybindings } from '../host/keybindings'
import type { Disposable, PluginCommand, RendererPluginContext } from '../types'

/** The command center store operations plugin commands need. */
export interface CommandCenterLike {
  rootCommand: { subcommands: CommandDescriptor[] }
  REGISTER_COMMAND(command: CommandDescriptor, describe?: () => string): void
  UNREGISTER_COMMAND(id: string): void
  SORT_COMMANDS(): void
}

export interface PluginCommandServices {
  commandCenter: CommandCenterLike
  keybindings: PluginKeybindings
  isMac: boolean
  /** Reports a command that threw or rejected; the app keeps running. */
  reportError(ctx: RendererPluginContext, command: PluginCommand, error: unknown): void
}

/**
 * Adds a plugin command to the command palette (title translated with the
 * plugin's `t`, re-translated on language change) and binds its keybinding.
 * Throws on an empty id or an id the palette already has.
 */
export const registerPluginCommand = (
  ctx: RendererPluginContext,
  command: PluginCommand,
  services: PluginCommandServices
): Disposable => {
  const { commandCenter, keybindings, isMac, reportError } = services
  if (!command.id || commandCenter.rootCommand.subcommands.some((c) => c.id === command.id)) {
    throw new Error(`Command id "${command.id}" is empty or already registered`)
  }
  const run = (): void => {
    try {
      Promise.resolve(command.run()).catch((err) => reportError(ctx, command, err))
    } catch (err) {
      reportError(ctx, command, err)
    }
  }
  const binding = command.keybinding ? keybindings.register(command.id, command.keybinding, run) : null
  const tokens = command.keybinding ? acceleratorToTokens(command.keybinding, isMac) : undefined
  const descriptor: CommandDescriptor = {
    id: command.id,
    // The palette only shows shortcuts that work: a colliding binding is inactive.
    get shortcut() {
      return binding && keybindings.isActive(command.id) ? tokens : undefined
    },
    execute: async() => run()
  }
  commandCenter.REGISTER_COMMAND(descriptor, () => ctx.t(command.title))
  commandCenter.SORT_COMMANDS()
  return {
    dispose: () => {
      binding?.dispose()
      commandCenter.UNREGISTER_COMMAND(command.id)
    }
  }
}
