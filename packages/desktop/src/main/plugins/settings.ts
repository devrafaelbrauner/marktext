import type {
  PluginManifest,
  PluginSettingSchema,
  PluginSettingValue
} from '@shared/plugins/types'

export type SettingValidation =
  | { ok: true; value: PluginSettingValue }
  | { ok: false; message: string }

/** Upper bound for string settings and each `stringList` entry, in UTF-16 code units. */
export const MAX_SETTING_STRING_LENGTH = 10_000
export const MAX_SETTING_LIST_LENGTH = 1_000

export const findSettingSchema = (
  manifest: PluginManifest,
  key: string
): PluginSettingSchema | undefined => manifest.settings?.find((s) => s.key === key)

/** Default of a non-secret setting; secrets have none. */
export const getSettingDefault = (schema: PluginSettingSchema): PluginSettingValue | undefined => {
  if (schema.type === 'secret') return undefined
  return Array.isArray(schema.default) ? [...schema.default] : schema.default
}

const compilePattern = (source: string): RegExp | null => {
  try {
    return new RegExp(source)
  } catch {
    return null
  }
}

/**
 * Checks `value` against `schema` (type, enum options, number range, string
 * pattern/required) and returns the value to store. `secret` settings are
 * never valid here: they go through the secrets store.
 */
export const validateSettingValue = (
  schema: PluginSettingSchema,
  value: unknown
): SettingValidation => {
  switch (schema.type) {
    case 'boolean':
      return typeof value === 'boolean'
        ? { ok: true, value }
        : { ok: false, message: `"${schema.key}" must be a boolean` }
    case 'number': {
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        return { ok: false, message: `"${schema.key}" must be a finite number` }
      }
      if (schema.min !== undefined && value < schema.min) {
        return { ok: false, message: `"${schema.key}" must be >= ${schema.min}` }
      }
      if (schema.max !== undefined && value > schema.max) {
        return { ok: false, message: `"${schema.key}" must be <= ${schema.max}` }
      }
      return { ok: true, value }
    }
    case 'string': {
      if (typeof value !== 'string') {
        return { ok: false, message: `"${schema.key}" must be a string` }
      }
      if (value.length > MAX_SETTING_STRING_LENGTH) {
        return { ok: false, message: `"${schema.key}" is too long` }
      }
      if (value === '') {
        return schema.required
          ? { ok: false, message: `"${schema.key}" is required` }
          : { ok: true, value }
      }
      if (schema.pattern !== undefined) {
        const pattern = compilePattern(schema.pattern)
        if (!pattern || !pattern.test(value)) {
          return { ok: false, message: `"${schema.key}" does not match the expected format` }
        }
      }
      return { ok: true, value }
    }
    case 'enum':
      return typeof value === 'string' && schema.options.some((o) => o.value === value)
        ? { ok: true, value }
        : { ok: false, message: `"${schema.key}" must be one of the listed options` }
    case 'stringList': {
      if (
        !Array.isArray(value) ||
        value.length > MAX_SETTING_LIST_LENGTH ||
        !value.every((v) => typeof v === 'string' && v.length <= MAX_SETTING_STRING_LENGTH)
      ) {
        return { ok: false, message: `"${schema.key}" must be a list of strings` }
      }
      return { ok: true, value: [...(value as string[])] }
    }
    case 'secret':
      return { ok: false, message: `"${schema.key}" is a secret and cannot be stored as a setting` }
  }
}

/**
 * Keeps only the stored values that still match the plugin's current schema,
 * so a plugin update that renames or retypes a setting falls back to defaults
 * instead of handing the plugin a value of the wrong type.
 */
export const sanitizeStoredSettings = (
  manifest: PluginManifest,
  stored: unknown
): Record<string, PluginSettingValue> => {
  const result: Record<string, PluginSettingValue> = {}
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return result
  for (const [key, value] of Object.entries(stored as Record<string, unknown>)) {
    const schema = findSettingSchema(manifest, key)
    if (!schema) continue
    const checked = validateSettingValue(schema, value)
    if (checked.ok) result[key] = checked.value
  }
  return result
}
