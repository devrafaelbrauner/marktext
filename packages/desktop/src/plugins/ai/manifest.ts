import type { PluginManifest, PluginSettingSchema } from '@shared/plugins/types'
import { BASE_URL_PATTERN, DEFAULT_BASE_URL, MODEL_ID_PATTERN, modelSettingKey } from './common/config'
import { AI_ACTIONS } from './common/types'

// Model ids are free text pasted from https://openrouter.ai/models: the list
// changes daily and the settings schema only supports static enums.
const modelOverrides: PluginSettingSchema[] = AI_ACTIONS.map((action) => ({
  key: modelSettingKey(action),
  type: 'string',
  label: `settings.${action}Model.label`,
  description: 'settings.overrideModel.description',
  default: '',
  placeholder: 'settings.overrideModel.placeholder',
  pattern: MODEL_ID_PATTERN
}))

export const manifest: PluginManifest = {
  id: 'ai',
  version: '1.0.0',
  name: 'name',
  description: 'description',
  // Sends text to OpenRouter: the user must opt in and bring an API key.
  defaultEnabled: false,
  settings: [
    { key: 'apiKey', type: 'secret', label: 'settings.apiKey.label', description: 'settings.apiKey.description' },
    {
      key: 'defaultModel',
      type: 'string',
      label: 'settings.defaultModel.label',
      description: 'settings.defaultModel.description',
      default: '',
      placeholder: 'anthropic/claude-sonnet-4',
      pattern: MODEL_ID_PATTERN
    },
    ...modelOverrides,
    {
      key: 'baseUrl',
      type: 'string',
      label: 'settings.baseUrl.label',
      description: 'settings.baseUrl.description',
      default: DEFAULT_BASE_URL,
      placeholder: DEFAULT_BASE_URL,
      pattern: BASE_URL_PATTERN
    },
    { key: 'consentGiven', type: 'boolean', label: 'settings.consentGiven.label', description: 'settings.consentGiven.description', default: false }
  ]
}
