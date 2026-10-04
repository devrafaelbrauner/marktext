<template>
  <div class="pref-plugins">
    <h4>{{ t('preferences.plugins.title') }}</h4>
    <div class="description">
      {{ t('preferences.plugins.description') }}
    </div>
    <el-alert
      v-if="state?.safeMode"
      class="safe-mode"
      type="warning"
      :title="t('preferences.plugins.safeMode')"
      :closable="false"
      show-icon
    />
    <div
      v-if="plugins.length === 0"
      class="description"
    >
      {{ t('preferences.plugins.empty') }}
    </div>
    <section
      v-for="{ manifest } of plugins"
      :id="`plugin-${manifest.id}`"
      :key="manifest.id"
      class="plugin-card"
      :class="{ highlighted: manifest.id === highlightedId }"
    >
      <div class="plugin-header">
        <div class="plugin-text">
          <div class="plugin-name">
            {{ translatePluginKey(manifest.id, manifest.name) }}
            <span class="plugin-version">{{ manifest.version }}</span>
          </div>
          <div class="plugin-description">
            {{ translatePluginKey(manifest.id, manifest.description) }}
          </div>
        </div>
        <el-switch
          :model-value="!!state?.enabled[manifest.id]"
          :disabled="!state"
          :aria-label="t('preferences.plugins.enabled')"
          @change="(value: string | number | boolean) => setEnabled(manifest.id, Boolean(value))"
        />
      </div>
      <div
        v-if="state && manifest.settings?.length"
        class="plugin-settings"
      >
        <h6 class="title">
          {{ t('preferences.plugins.settings') }}
        </h6>
        <setting-field
          v-for="schema of manifest.settings"
          :key="schema.key"
          :plugin-id="manifest.id"
          :schema="schema"
          :value="resolveSetting(state, manifest, schema.key)"
          :secret-set="!!state.secretsSet[manifest.id]?.[schema.key]"
          :on-save="(value: PluginSettingValue) => saveSetting(manifest.id, schema.label, () => client.setSetting(manifest.id, schema.key, value))"
          :on-save-secret="(value: string | null) => saveSetting(manifest.id, schema.label, () => client.setSecret(manifest.id, schema.key, value))"
        />
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { ElMessage } from 'element-plus'
import type { PluginSettingValue } from '@shared/plugins/types'
import { BUILTIN_PLUGINS } from '@plugins/manifests'
import { translatePluginKey } from '@/i18n'
import { PluginStateClient, resolveSetting } from '@/plugins/host/pluginState'
import SettingField from './settingField.vue'

const { t } = useI18n()
const route = useRoute()

const plugins = BUILTIN_PLUGINS
const client = new PluginStateClient(window.plugins)
const state = client.state

const highlightedId = computed(() => {
  const { pluginId } = route.params
  return typeof pluginId === 'string' ? pluginId : null
})

const reportFailure = (pluginId: string, labelKey: string, error: unknown): void => {
  ElMessage.error(
    t('preferences.plugins.saveFailed', {
      setting: translatePluginKey(pluginId, labelKey),
      message: error instanceof Error ? error.message : String(error)
    })
  )
}

const setEnabled = (pluginId: string, enabled: boolean): void => {
  const plugin = plugins.find((p) => p.manifest.id === pluginId)
  client.setEnabled(pluginId, enabled).catch((err) => reportFailure(pluginId, plugin?.manifest.name ?? pluginId, err))
}

const saveSetting = async (pluginId: string, labelKey: string, write: () => Promise<void>): Promise<void> => {
  try {
    await write()
  } catch (err) {
    reportFailure(pluginId, labelKey, err)
    throw err
  }
}

const revealHighlighted = async (): Promise<void> => {
  if (!highlightedId.value) return
  await nextTick()
  document.getElementById(`plugin-${highlightedId.value}`)?.scrollIntoView({ block: 'start' })
}

watch(highlightedId, revealHighlighted)

onMounted(async () => {
  try {
    await client.load()
  } catch (err) {
    console.error('Failed to load plugin state:', err)
  }
  revealHighlighted()
})

onBeforeUnmount(() => client.dispose())
</script>

<style scoped>
.pref-plugins {
  & .description {
    margin-top: 10px;
    font-size: 14px;
    color: var(--editorColor);
  }
}

.safe-mode {
  margin: 16px 0;
}

.plugin-card {
  margin: 16px 0;
  padding: 12px 16px;
  border: 1px solid var(--itemBgColor);
  border-radius: 6px;
}

.plugin-card.highlighted {
  border-color: var(--themeColor);
}

.plugin-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.plugin-name {
  font-size: 15px;
  font-weight: 600;
  color: var(--editorColor);
}

.plugin-version {
  margin-left: 6px;
  font-size: 12px;
  font-weight: normal;
  color: var(--editorColor50);
}

.plugin-description {
  margin-top: 4px;
  font-size: 13px;
  color: var(--editorColor50);
}

.plugin-settings {
  margin-top: 12px;
  border-top: 1px solid var(--itemBgColor);
}
</style>
