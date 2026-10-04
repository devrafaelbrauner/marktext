import type { PluginManifest } from '@shared/plugins/types'

export const manifest: PluginManifest = {
  id: 'icons',
  version: '1.0.0',
  name: 'name',
  description: 'description',
  defaultEnabled: true,
  affectsParsing: true,
  settings: [
    {
      key: 'exportMode',
      type: 'enum',
      label: 'settings.exportMode.label',
      description: 'settings.exportMode.description',
      default: 'svg',
      options: [
        { value: 'svg', label: 'settings.exportMode.svg' },
        { value: 'shortcode', label: 'settings.exportMode.shortcode' }
      ]
    }
  ]
}
