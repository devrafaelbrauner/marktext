import type { PluginManifest } from '@shared/plugins/types'
import type { MainPluginModule } from './types'

/** Main-process part of a built-in plugin; its manifest must also be listed in `@plugins/manifests`. */
export interface BuiltinMainPlugin {
  manifest: PluginManifest
  load(): Promise<MainPluginModule>
}

export const BUILTIN_MAIN_PLUGINS: BuiltinMainPlugin[] = []
