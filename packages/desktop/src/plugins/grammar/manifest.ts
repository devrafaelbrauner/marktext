import type { PluginManifest } from '@shared/plugins/types'
import { SERVER_URL_PATTERN } from './common/plans'

const LANGUAGES = ['pt-BR', 'pt-PT', 'en-US', 'en-GB', 'es', 'fr', 'de', 'it', 'nl', 'auto']

export const manifest: PluginManifest = {
  id: 'grammar',
  version: '1.0.0',
  name: 'name',
  description: 'description',
  // Sends text to a server: the user must opt in (and Premium needs credentials).
  defaultEnabled: false,
  settings: [
    {
      key: 'server',
      type: 'enum',
      label: 'settings.server.label',
      description: 'settings.server.description',
      default: 'premium',
      options: [
        { value: 'premium', label: 'settings.server.premium' },
        { value: 'free', label: 'settings.server.free' },
        { value: 'custom', label: 'settings.server.custom' }
      ]
    },
    {
      key: 'serverUrl',
      type: 'string',
      label: 'settings.serverUrl.label',
      description: 'settings.serverUrl.description',
      default: '',
      placeholder: 'http://localhost:8081/v2',
      pattern: SERVER_URL_PATTERN
    },
    { key: 'username', type: 'string', label: 'settings.username.label', description: 'settings.username.description', default: '' },
    { key: 'apiKey', type: 'secret', label: 'settings.apiKey.label', description: 'settings.apiKey.description' },
    {
      key: 'language',
      type: 'enum',
      label: 'settings.language.label',
      description: 'settings.language.description',
      default: 'pt-BR',
      options: LANGUAGES.map((value) => ({ value, label: `settings.language.options.${value}` }))
    },
    {
      key: 'level',
      type: 'enum',
      label: 'settings.level.label',
      description: 'settings.level.description',
      default: 'default',
      options: [
        { value: 'default', label: 'settings.level.default' },
        { value: 'picky', label: 'settings.level.picky' }
      ]
    },
    {
      key: 'motherTongue',
      type: 'string',
      label: 'settings.motherTongue.label',
      description: 'settings.motherTongue.description',
      default: 'pt-BR',
      placeholder: 'pt-BR'
    },
    { key: 'checkOnType', type: 'boolean', label: 'settings.checkOnType.label', description: 'settings.checkOnType.description', default: true },
    {
      key: 'debounceMs',
      type: 'number',
      label: 'settings.debounceMs.label',
      description: 'settings.debounceMs.description',
      default: 800,
      min: 300,
      max: 5000,
      step: 100
    },
    { key: 'disabledRules', type: 'stringList', label: 'settings.disabledRules.label', description: 'settings.disabledRules.description', default: [] },
    {
      key: 'disabledCategories',
      type: 'stringList',
      label: 'settings.disabledCategories.label',
      description: 'settings.disabledCategories.description',
      default: []
    },
    { key: 'dictionary', type: 'stringList', label: 'settings.dictionary.label', description: 'settings.dictionary.description', default: [] },
    {
      key: 'disableNativeSpellcheck',
      type: 'boolean',
      label: 'settings.disableNativeSpellcheck.label',
      description: 'settings.disableNativeSpellcheck.description',
      default: true
    },
    { key: 'consentGiven', type: 'boolean', label: 'settings.consentGiven.label', description: 'settings.consentGiven.description', default: false }
  ]
}
