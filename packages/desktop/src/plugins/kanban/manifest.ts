import type { PluginManifest } from '@shared/plugins/types'

export const manifest: PluginManifest = {
  id: 'kanban',
  version: '1.0.0',
  name: 'name',
  description: 'description',
  defaultEnabled: true,
  // Registers the `%% comment %%` inline syntax.
  affectsParsing: true
}
