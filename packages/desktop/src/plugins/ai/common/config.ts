import type { AiAction } from './types'

export const DEFAULT_BASE_URL = 'https://openrouter.ai/api/v1'

/** Where users look up model ids; shown in the settings descriptions. */
export const MODELS_PAGE_URL = 'https://openrouter.ai/models'

/**
 * OpenRouter model ids look like `vendor/model`, optionally with a variant
 * suffix (`:free`, `:online`) or a date/version (`@2025-01-01`). Empty is
 * allowed: it means "not set".
 */
export const MODEL_ID_PATTERN = '^[A-Za-z0-9][A-Za-z0-9._:/@+-]*$'

export const BASE_URL_PATTERN = '^https?://'

/** Setting holding the model override of `action`; empty means "use `defaultModel`". */
export const modelSettingKey = (action: AiAction): string => `${action}Model`

/** Model id for `action`: its override when set, else the default model; '' when neither is set. */
export const resolveModel = (get: (key: string) => string, action: AiAction): string =>
  get(modelSettingKey(action)).trim() || get('defaultModel').trim()

/** API base without trailing slash, or null when `value` is not an http(s) URL with a host. */
export const resolveBaseUrl = (value: string): string | null => {
  const trimmed = value.trim().replace(/\/+$/, '')
  if (!new RegExp(BASE_URL_PATTERN, 'i').test(trimmed)) return null
  try {
    return new URL(trimmed).host ? trimmed : null
  } catch {
    return null
  }
}
