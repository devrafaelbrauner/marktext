/**
 * JSON Schema for `manifest.json` and a validator for the subset the schema
 * uses. Install rejects a manifest that does not match; there is no second,
 * looser parser.
 */

import type { PluginSettingSchema, PluginSettingValue } from './types'
import {
  isCommunityPermission,
  PLUGIN_ID_PATTERN,
  satisfiesMinAppVersion,
  type CommunityManifest,
  type CommunityPanel
} from './community'

export interface JsonSchema {
  type?: 'object' | 'string' | 'array' | 'boolean' | 'number' | 'integer'
  properties?: Record<string, JsonSchema>
  required?: string[]
  additionalProperties?: boolean
  items?: JsonSchema
  enum?: unknown[]
  const?: unknown
  pattern?: string
  minLength?: number
  maxLength?: number
  minItems?: number
  maxItems?: number
  minimum?: number
  maximum?: number
  oneOf?: JsonSchema[]
}

const settingBase = {
  type: 'object',
  additionalProperties: false,
  required: ['key', 'label', 'type'],
  properties: {
    key: { type: 'string', pattern: '^[a-zA-Z][a-zA-Z0-9_]{0,63}$' },
    label: { type: 'string', minLength: 1, maxLength: 200 },
    description: { type: 'string', minLength: 1, maxLength: 500 }
  }
} as const

const withConst = (type: string, extra: Record<string, JsonSchema>, required: string[] = []): JsonSchema => ({
  type: 'object',
  additionalProperties: false,
  required: [...settingBase.required, ...required],
  properties: {
    ...settingBase.properties,
    type: { const: type },
    ...extra
  }
})

const stringArray: JsonSchema = { type: 'array', items: { type: 'string', maxLength: 10_000 }, maxItems: 1_000 }

export const SETTING_SCHEMA: JsonSchema = {
  oneOf: [
    withConst('boolean', { default: { type: 'boolean' } }, ['default']),
    withConst('string', {
      default: { type: 'string', maxLength: 10_000 },
      placeholder: { type: 'string', maxLength: 200 },
      pattern: { type: 'string', maxLength: 500 },
      required: { type: 'boolean' }
    }, ['default']),
    withConst('number', {
      default: { type: 'number' },
      min: { type: 'number' },
      max: { type: 'number' },
      step: { type: 'number' }
    }, ['default']),
    withConst('enum', {
      default: { type: 'string', minLength: 1, maxLength: 200 },
      options: {
        type: 'array',
        minItems: 1,
        maxItems: 100,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['value', 'label'],
          properties: {
            value: { type: 'string', minLength: 1, maxLength: 200 },
            label: { type: 'string', minLength: 1, maxLength: 200 }
          }
        }
      }
    }, ['default', 'options']),
    withConst('stringList', { default: stringArray }, ['default']),
    withConst('secret', {})
  ]
}

const relativePath = (suffix: string): JsonSchema => ({
  type: 'string',
  minLength: 1,
  maxLength: 200,
  pattern: `^(?!/)(?!.*\\\\)(?!.*\\.\\.)[A-Za-z0-9_./-]+${suffix}$`
})

export const COMMUNITY_MANIFEST_SCHEMA: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'name', 'version', 'minAppVersion', 'author', 'description', 'main', 'permissions'],
  properties: {
    id: { type: 'string', pattern: '^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$' },
    name: { type: 'string', minLength: 1, maxLength: 80 },
    version: { type: 'string', pattern: '^\\d+\\.\\d+\\.\\d+(?:[-+][0-9A-Za-z.-]+)?$' },
    minAppVersion: { type: 'string', pattern: '^\\d+\\.\\d+\\.\\d+(?:[-+][0-9A-Za-z.-]+)?$' },
    author: { type: 'string', minLength: 1, maxLength: 80 },
    description: {
      oneOf: [
        { type: 'string', minLength: 1, maxLength: 500 },
        {
          type: 'object',
          additionalProperties: false,
          required: ['en'],
          properties: {
            en: { type: 'string', minLength: 1, maxLength: 500 },
            pt: { type: 'string', minLength: 1, maxLength: 500 }
          }
        }
      ]
    },
    main: relativePath('(?:js|mjs)'),
    permissions: {
      type: 'array',
      maxItems: 32,
      items: { type: 'string', minLength: 1, maxLength: 200 }
    },
    panels: {
      type: 'array',
      maxItems: 8,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'title', 'icon', 'entry'],
        properties: {
          id: { type: 'string', pattern: '^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$' },
          title: { type: 'string', minLength: 1, maxLength: 80 },
          icon: { type: 'string', minLength: 1, maxLength: 8_000 },
          entry: relativePath('html')
        }
      }
    },
    settings: { type: 'array', maxItems: 40, items: SETTING_SCHEMA }
  }
}

const pathOf = (path: string): string => path || '/'

/** Errors of validating `value` against `schema`. Empty means it matches. */
export const validateJsonSchema = (value: unknown, schema: JsonSchema, path = ''): string[] => {
  if (schema.oneOf) {
    const matched = schema.oneOf.some((branch) => validateJsonSchema(value, branch, path).length === 0)
    return matched ? [] : [`${pathOf(path)} does not match any allowed schema`]
  }
  if (schema.const !== undefined && value !== schema.const) {
    return [`${pathOf(path)} must be ${JSON.stringify(schema.const)}`]
  }
  if (schema.enum && !schema.enum.includes(value)) {
    return [`${pathOf(path)} must be one of ${schema.enum.map((item) => JSON.stringify(item)).join(', ')}`]
  }
  switch (schema.type) {
    case 'object':
      return validateObject(value, schema, path)
    case 'array':
      return validateArray(value, schema, path)
    case 'string':
      return validateString(value, schema, path)
    case 'boolean':
      return typeof value === 'boolean' ? [] : [`${pathOf(path)} must be a boolean`]
    case 'number':
      return typeof value === 'number' && Number.isFinite(value) ? validateNumber(value, schema, path) : [`${pathOf(path)} must be a number`]
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value) ? validateNumber(value, schema, path) : [`${pathOf(path)} must be an integer`]
    default:
      return []
  }
}

const validateObject = (value: unknown, schema: JsonSchema, path: string): string[] => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [`${pathOf(path)} must be an object`]
  const errors: string[] = []
  const record = value as Record<string, unknown>
  for (const key of schema.required ?? []) {
    if (!(key in record)) errors.push(`${path}/${key} is required`)
  }
  const properties = schema.properties ?? {}
  for (const [key, child] of Object.entries(record)) {
    const childSchema = properties[key]
    if (childSchema) errors.push(...validateJsonSchema(child, childSchema, `${path}/${key}`))
    else if (schema.additionalProperties === false) errors.push(`${path}/${key} is not allowed`)
  }
  return errors
}

const validateArray = (value: unknown, schema: JsonSchema, path: string): string[] => {
  if (!Array.isArray(value)) return [`${pathOf(path)} must be an array`]
  const errors: string[] = []
  if (schema.minItems !== undefined && value.length < schema.minItems) errors.push(`${pathOf(path)} must have at least ${schema.minItems} items`)
  if (schema.maxItems !== undefined && value.length > schema.maxItems) errors.push(`${pathOf(path)} must have at most ${schema.maxItems} items`)
  if (schema.items) {
    value.forEach((item, index) => {
      errors.push(...validateJsonSchema(item, schema.items as JsonSchema, `${path}/${index}`))
    })
  }
  return errors
}

const validateString = (value: unknown, schema: JsonSchema, path: string): string[] => {
  if (typeof value !== 'string') return [`${pathOf(path)} must be a string`]
  const errors: string[] = []
  if (schema.minLength !== undefined && value.length < schema.minLength) errors.push(`${pathOf(path)} is too short`)
  if (schema.maxLength !== undefined && value.length > schema.maxLength) errors.push(`${pathOf(path)} is too long`)
  if (schema.pattern && !new RegExp(schema.pattern).test(value)) errors.push(`${pathOf(path)} does not match ${schema.pattern}`)
  return errors
}

const validateNumber = (value: number, schema: JsonSchema, path: string): string[] => {
  const errors: string[] = []
  if (schema.minimum !== undefined && value < schema.minimum) errors.push(`${pathOf(path)} is below ${schema.minimum}`)
  if (schema.maximum !== undefined && value > schema.maximum) errors.push(`${pathOf(path)} is above ${schema.maximum}`)
  return errors
}

const RESERVED_PANEL_IDS = new Set(['files', 'search', 'toc'])

export interface ManifestValidation {
  ok: true
  manifest: CommunityManifest
}

export interface ManifestRejection {
  ok: false
  issues: string[]
}

export interface ManifestCheckOptions {
  appVersion?: string
  builtinIds?: readonly string[]
}

/**
 * Schema-checks `value`, then rejects duplicate permissions, unknown
 * permission names, reserved panel ids, a minAppVersion the app does not
 * satisfy, and an id that belongs to a built-in plugin.
 */
export const validateCommunityManifest = (
  value: unknown,
  options: ManifestCheckOptions = {}
): ManifestValidation | ManifestRejection => {
  const issues = validateJsonSchema(value, COMMUNITY_MANIFEST_SCHEMA)
  if (issues.length > 0 || !value || typeof value !== 'object') return { ok: false, issues }
  const manifest = value as CommunityManifest
  if (!PLUGIN_ID_PATTERN.test(manifest.id)) issues.push('/id is not a valid plugin id')
  const seen = new Set<string>()
  for (const permission of manifest.permissions) {
    if (seen.has(permission)) issues.push(`/permissions contains duplicate "${permission}"`)
    seen.add(permission)
    if (!isCommunityPermission(permission)) issues.push(`/permissions "${permission}" is not a known permission`)
  }
  const panelIds = new Set<string>()
  for (const panel of manifest.panels ?? []) {
    if (panelIds.has(panel.id)) issues.push(`/panels id "${panel.id}" is duplicated`)
    panelIds.add(panel.id)
    if (RESERVED_PANEL_IDS.has(panel.id)) issues.push(`/panels id "${panel.id}" is reserved`)
  }
  const settingKeys = new Set<string>()
  for (const setting of manifest.settings ?? []) {
    if (settingKeys.has(setting.key)) issues.push(`/settings key "${setting.key}" is duplicated`)
    settingKeys.add(setting.key)
    if (setting.type === 'string' && setting.pattern) {
      try {
        // The schema only checks that `pattern` is a string; an uncompilable
        // expression would throw later, when the user saves a value.
        RegExp(setting.pattern)
      } catch {
        issues.push(`/settings/${setting.key} pattern is not a valid regular expression`)
      }
    }
    if (setting.type === 'enum' && !setting.options.some((option) => option.value === setting.default)) {
      issues.push(`/settings/${setting.key} default is not one of its options`)
    }
  }
  if (options.builtinIds?.includes(manifest.id)) {
    issues.push(`/id "${manifest.id}" is a built-in plugin`)
  }
  if (options.appVersion && !satisfiesMinAppVersion(options.appVersion, manifest.minAppVersion)) {
    issues.push(`/minAppVersion ${manifest.minAppVersion} is newer than this MarkText (${options.appVersion})`)
  }
  if (issues.length > 0) return { ok: false, issues }
  return { ok: true, manifest: cloneManifest(manifest) }
}

const cloneManifest = (manifest: CommunityManifest): CommunityManifest => ({
  id: manifest.id,
  name: manifest.name,
  version: manifest.version,
  minAppVersion: manifest.minAppVersion,
  author: manifest.author,
  description: typeof manifest.description === 'string'
    ? manifest.description
    : { en: manifest.description.en, ...(manifest.description.pt ? { pt: manifest.description.pt } : {}) },
  main: manifest.main,
  permissions: [...manifest.permissions],
  ...(manifest.panels ? { panels: manifest.panels.map((panel): CommunityPanel => ({ ...panel })) } : {}),
  ...(manifest.settings ? { settings: manifest.settings.map((setting) => cloneSetting(setting)) } : {})
})

const cloneSetting = (setting: PluginSettingSchema): PluginSettingSchema => {
  if (setting.type === 'stringList') return { ...setting, default: [...setting.default] }
  if (setting.type === 'enum') return { ...setting, options: setting.options.map((option) => ({ ...option })) }
  return { ...setting }
}

/** Non-secret defaults, for the init message. Secrets are never sent. */
export const defaultSettings = (manifest: CommunityManifest): Record<string, PluginSettingValue> => {
  const settings: Record<string, PluginSettingValue> = {}
  for (const setting of manifest.settings ?? []) {
    if (setting.type === 'secret') continue
    settings[setting.key] = Array.isArray(setting.default) ? [...setting.default] : setting.default
  }
  return settings
}
