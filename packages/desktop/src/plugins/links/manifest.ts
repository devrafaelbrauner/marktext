import type { PluginManifest } from '@shared/plugins/types'

export const manifest: PluginManifest = {
  id: 'links',
  version: '1.0.0',
  name: 'name',
  description: 'description',
  defaultEnabled: true,
  affectsParsing: true,
  settings: [
    {
      key: 'newLinkFormat',
      type: 'enum',
      label: 'settings.newLinkFormat.label',
      description: 'settings.newLinkFormat.description',
      default: 'shortest',
      options: [
        { value: 'shortest', label: 'settings.newLinkFormat.shortest' },
        { value: 'relative', label: 'settings.newLinkFormat.relative' },
        { value: 'absolute', label: 'settings.newLinkFormat.absolute' }
      ]
    },
    {
      key: 'updateLinksOnRename',
      type: 'enum',
      label: 'settings.updateLinksOnRename.label',
      description: 'settings.updateLinksOnRename.description',
      default: 'ask',
      options: [
        { value: 'ask', label: 'settings.updateLinksOnRename.ask' },
        { value: 'always', label: 'settings.updateLinksOnRename.always' },
        { value: 'never', label: 'settings.updateLinksOnRename.never' }
      ]
    }
  ]
}
