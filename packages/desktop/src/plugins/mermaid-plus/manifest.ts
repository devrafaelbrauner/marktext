import type { PluginManifest } from '@shared/plugins/types'

export const manifest: PluginManifest = {
  id: 'mermaid-plus',
  version: '1.0.0',
  name: 'name',
  description: 'description',
  defaultEnabled: true,
  settings: [
    {
      key: 'theme',
      type: 'enum',
      label: 'settings.theme.label',
      description: 'settings.theme.description',
      default: 'auto',
      options: [
        { value: 'auto', label: 'settings.theme.auto' },
        { value: 'default', label: 'settings.theme.default' },
        { value: 'neutral', label: 'settings.theme.neutral' },
        { value: 'forest', label: 'settings.theme.forest' },
        { value: 'dark', label: 'settings.theme.dark' },
        { value: 'base', label: 'settings.theme.base' }
      ]
    },
    {
      key: 'look',
      type: 'enum',
      label: 'settings.look.label',
      description: 'settings.look.description',
      default: 'classic',
      options: [
        { value: 'classic', label: 'settings.look.classic' },
        { value: 'handDrawn', label: 'settings.look.handDrawn' }
      ]
    }
  ]
}
