import type { PluginManifest } from '@shared/plugins/types'
import { DEFAULT_DATE_FORMAT } from './common/constants'

export const manifest: PluginManifest = {
  id: 'daily-notes',
  version: '1.0.0',
  name: 'name',
  description: 'description',
  defaultEnabled: true,
  settings: [
    {
      key: 'folder',
      type: 'string',
      label: 'settings.folder.label',
      description: 'settings.folder.description',
      default: '',
      placeholder: 'Daily'
    },
    {
      key: 'format',
      type: 'string',
      label: 'settings.format.label',
      description: 'settings.format.description',
      default: DEFAULT_DATE_FORMAT,
      placeholder: DEFAULT_DATE_FORMAT
    },
    {
      key: 'template',
      type: 'string',
      label: 'settings.template.label',
      description: 'settings.template.description',
      default: '',
      placeholder: 'Templates/Daily'
    },
    {
      key: 'weekStart',
      type: 'enum',
      label: 'settings.weekStart.label',
      description: 'settings.weekStart.description',
      default: 'sunday',
      options: [
        { value: 'sunday', label: 'settings.weekStart.sunday' },
        { value: 'monday', label: 'settings.weekStart.monday' }
      ]
    },
    {
      key: 'openOnStartup',
      type: 'boolean',
      label: 'settings.openOnStartup.label',
      description: 'settings.openOnStartup.description',
      default: false
    }
  ]
}
