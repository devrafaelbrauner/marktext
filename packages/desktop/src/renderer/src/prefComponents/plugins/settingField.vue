<template>
  <div class="plugin-setting">
    <div class="plugin-setting-text">
      <label
        class="plugin-setting-label"
        :for="inputId"
      >{{ label }}</label>
      <div
        v-if="description"
        class="plugin-setting-description"
      >
        {{ description }}
      </div>
    </div>
    <div class="plugin-setting-control">
      <el-switch
        v-if="schema.type === 'boolean'"
        :id="inputId"
        :model-value="value === true"
        @change="(next: string | number | boolean) => save(Boolean(next))"
      />
      <el-input
        v-else-if="schema.type === 'string'"
        :id="inputId"
        v-model="draftText"
        :placeholder="schema.placeholder ? translate(schema.placeholder) : ''"
        @change="save(draftText)"
      />
      <el-input-number
        v-else-if="schema.type === 'number'"
        :id="inputId"
        :model-value="typeof value === 'number' ? value : undefined"
        :min="schema.min"
        :max="schema.max"
        :step="schema.step ?? 1"
        controls-position="right"
        @change="(next: number | undefined) => next !== undefined && save(next)"
      />
      <el-select
        v-else-if="schema.type === 'enum'"
        :id="inputId"
        :model-value="value"
        @change="(next: string) => save(next)"
      >
        <el-option
          v-for="option of schema.options"
          :key="option.value"
          :label="translate(option.label)"
          :value="option.value"
        />
      </el-select>
      <el-input
        v-else-if="schema.type === 'stringList'"
        :id="inputId"
        v-model="draftText"
        type="textarea"
        :autosize="{ minRows: 2, maxRows: 8 }"
        :placeholder="t('preferences.plugins.stringListPlaceholder')"
        @change="save(parseList(draftText))"
      />
      <div
        v-else-if="schema.type === 'secret'"
        class="plugin-secret"
      >
        <span
          class="plugin-secret-status"
          :class="{ set: secretSet }"
        >{{ secretSet ? t('preferences.plugins.secretSet') : t('preferences.plugins.secretNotSet') }}</span>
        <el-input
          :id="inputId"
          v-model="draftSecret"
          type="password"
          autocomplete="off"
          show-password
          :placeholder="t('preferences.plugins.secretPlaceholder')"
          @keyup.enter="saveSecret"
        />
        <el-button
          :disabled="!draftSecret"
          @click="saveSecret"
        >
          {{ t('preferences.plugins.save') }}
        </el-button>
        <el-button
          :disabled="!secretSet"
          @click="onSaveSecret(null)"
        >
          {{ t('preferences.plugins.clear') }}
        </el-button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { PluginSettingSchema, PluginSettingValue } from '@shared/plugins/types'
import { translatePluginKey } from '@/i18n'

const props = defineProps<{
  pluginId: string
  schema: PluginSettingSchema
  /** Stored value or schema default; undefined for secrets. */
  value: PluginSettingValue | undefined
  secretSet: boolean
  /** Persists a value; rejects when main refuses it. */
  onSave: (value: PluginSettingValue) => Promise<void>
  /** Stores (string) or clears (null) a secret; rejects when main refuses it. */
  onSaveSecret: (value: string | null) => Promise<void>
}>()

const { t } = useI18n()

const inputId = computed(() => `plugin-setting-${props.pluginId}-${props.schema.key}`)
const translate = (key: string): string => translatePluginKey(props.pluginId, key)
const label = computed(() => translate(props.schema.label))
const description = computed(() => (props.schema.description ? translate(props.schema.description) : ''))

const textOf = (value: PluginSettingValue | undefined): string =>
  Array.isArray(value) ? value.join('\n') : typeof value === 'string' ? value : ''

// Text inputs edit a draft that follows the stored value, so a rejected value
// snaps back to what main holds.
const draftText = ref(textOf(props.value))
watch(
  () => props.value,
  (value) => {
    draftText.value = textOf(value)
  }
)
const draftSecret = ref('')

const parseList = (text: string): string[] =>
  text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)

const save = (value: PluginSettingValue): void => {
  props.onSave(value).catch(() => {
    draftText.value = textOf(props.value)
  })
}

const saveSecret = (): void => {
  if (!draftSecret.value) return
  props.onSaveSecret(draftSecret.value).then(
    () => {
      draftSecret.value = ''
    },
    () => {}
  )
}
</script>

<style scoped>
.plugin-setting {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin: 12px 0;
  font-size: 14px;
  color: var(--editorColor);
}

.plugin-setting-text {
  flex: 1;
  min-width: 0;
}

.plugin-setting-description {
  margin-top: 4px;
  font-size: 12px;
  color: var(--editorColor50);
}

.plugin-setting-control {
  flex: 0 0 auto;
  width: 260px;
  display: flex;
  justify-content: flex-end;
}

.plugin-secret {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: 6px;
  width: 100%;
}

.plugin-secret-status {
  width: 100%;
  text-align: right;
  font-size: 12px;
  color: var(--editorColor50);
}

.plugin-secret-status.set {
  color: var(--themeColor);
}

.plugin-secret .el-button + .el-button {
  margin-left: 0;
}
</style>
