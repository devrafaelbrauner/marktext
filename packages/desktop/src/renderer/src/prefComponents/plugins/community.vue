<template>
  <section
    class="community-plugins"
    data-testid="community-plugins"
  >
    <h5>{{ t('preferences.plugins.community.title') }}</h5>
    <div class="description">
      {{ t('preferences.plugins.community.description') }}
    </div>
    <el-alert
      v-if="state?.safeMode"
      class="safe-mode"
      type="warning"
      :title="t('preferences.plugins.community.safeMode')"
      :closable="false"
      show-icon
    />
    <div class="community-actions">
      <el-button
        data-testid="community-install-folder"
        :disabled="!state || installing"
        @click="install('folder')"
      >
        {{ t('preferences.plugins.community.installFolder') }}
      </el-button>
      <el-button
        data-testid="community-install-zip"
        :disabled="!state || installing"
        @click="install('zip')"
      >
        {{ t('preferences.plugins.community.installZip') }}
      </el-button>
    </div>
    <div
      v-if="plugins.length === 0"
      class="description"
    >
      {{ t('preferences.plugins.community.empty') }}
    </div>
    <section
      v-for="plugin of plugins"
      :id="`plugin-${plugin.id}`"
      :key="plugin.id"
      class="plugin-card"
      :class="{ highlighted: plugin.id === highlightedId }"
      :data-testid="`community-plugin-${plugin.id}`"
    >
      <div class="plugin-header">
        <div class="plugin-text">
          <div class="plugin-name">
            {{ plugin.name }}
            <span class="plugin-version">{{ plugin.version }}</span>
          </div>
          <div class="plugin-description">
            {{ localizeDescription(plugin.description, language) }}
          </div>
          <div class="plugin-meta">
            {{ t('preferences.plugins.community.author') }}: {{ plugin.author }}
          </div>
          <ul class="permission-list">
            <li
              v-for="permission of plugin.permissions"
              :key="permission"
            >
              {{ permissionLabel(permission) }}
            </li>
            <li v-if="plugin.permissions.length === 0">
              {{ t('preferences.plugins.community.consentNone') }}
            </li>
          </ul>
        </div>
        <el-switch
          :model-value="!!state?.enabled[plugin.id]"
          :disabled="!state || state.safeMode"
          :aria-label="t('preferences.plugins.enabled')"
          :data-testid="`community-enable-${plugin.id}`"
          @change="(value: string | number | boolean) => onToggle(plugin, Boolean(value))"
        />
      </div>
      <div
        v-if="state && plugin.settings?.length"
        class="plugin-settings"
      >
        <h6 class="title">
          {{ t('preferences.plugins.settings') }}
        </h6>
        <setting-field
          v-for="schema of plugin.settings"
          :key="schema.key"
          :plugin-id="plugin.id"
          :schema="schema"
          :value="resolveSetting(state, toPluginManifest(plugin), schema.key)"
          :secret-set="!!state.secretsSet[plugin.id]?.[schema.key]"
          :on-save="(value: PluginSettingValue) => saveSetting(plugin, schema.label, () => client.setSetting(plugin.id, schema.key, value))"
          :on-save-secret="(value: string | null) => saveSetting(plugin, schema.label, () => client.setSecret(plugin.id, schema.key, value))"
        />
      </div>
      <div class="community-card-actions">
        <el-button
          type="danger"
          plain
          :data-testid="`community-uninstall-${plugin.id}`"
          @click="askUninstall(plugin)"
        >
          {{ t('preferences.plugins.community.uninstall') }}
        </el-button>
      </div>
    </section>

    <el-dialog
      v-model="consentOpen"
      :title="consentTitle"
      data-testid="community-consent"
      width="480px"
    >
      <p>{{ t('preferences.plugins.community.consentBody') }}</p>
      <ul class="permission-list">
        <li
          v-for="label of consentLabels"
          :key="label"
        >
          {{ label }}
        </li>
      </ul>
      <template #footer>
        <el-button @click="consentOpen = false">
          {{ t('preferences.plugins.community.consentCancel') }}
        </el-button>
        <el-button
          type="primary"
          data-testid="community-consent-confirm"
          @click="confirmConsent"
        >
          {{ t('preferences.plugins.community.consentConfirm') }}
        </el-button>
      </template>
    </el-dialog>

    <el-dialog
      v-model="uninstallOpen"
      :title="t('preferences.plugins.community.uninstall')"
      data-testid="community-uninstall-dialog"
      width="420px"
    >
      <p>{{ uninstallMessage }}</p>
      <template #footer>
        <el-button @click="uninstallOpen = false">
          {{ t('preferences.plugins.community.consentCancel') }}
        </el-button>
        <el-button
          type="danger"
          data-testid="community-uninstall-confirm"
          @click="confirmUninstall"
        >
          {{ t('preferences.plugins.community.uninstall') }}
        </el-button>
      </template>
    </el-dialog>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElMessage } from 'element-plus'
import type { CommunityPluginRecord } from '@shared/plugins/types'
import { localizeDescription, parseNetworkHost, toPluginManifest } from '@shared/plugins/community'
import type { PluginSettingValue } from '@shared/plugins/types'
import { resolveSetting, type PluginStateClient } from '@/plugins/host/pluginState'
import type { PluginHostState } from '@shared/plugins/types'
import SettingField from './settingField.vue'

const props = defineProps<{
  state: PluginHostState | null
  client: PluginStateClient
  highlightedId: string | null
}>()

const { t, locale } = useI18n()
const language = computed(() => locale.value)
const installing = ref(false)
const consentOpen = ref(false)
const uninstallOpen = ref(false)
const pending = ref<CommunityPluginRecord | null>(null)

const plugins = computed(() => props.state?.community ?? [])

const permissionKey: Record<string, string> = {
  'editor:read': 'editorRead',
  'editor:write': 'editorWrite',
  'editor:decorate': 'editorDecorate',
  'vault:read': 'vaultRead',
  'vault:write': 'vaultWrite',
  'metadata:read': 'metadataRead',
  'ui:sidebar': 'sidebar',
  'ui:statusbar': 'statusbar',
  'clipboard:write': 'clipboard'
}

const permissionLabel = (permission: string): string => {
  const host = parseNetworkHost(permission)
  if (host) return t('preferences.plugins.community.permission.network', { host })
  const key = permissionKey[permission]
  return key ? t(`preferences.plugins.community.permission.${key}`) : permission
}

const consentTitle = computed(() =>
  t('preferences.plugins.community.consentTitle', { name: pending.value?.name ?? '' })
)
const consentLabels = computed(() => {
  const list = pending.value?.permissions ?? []
  if (list.length === 0) return [t('preferences.plugins.community.consentNone')]
  return list.map(permissionLabel)
})
const uninstallMessage = computed(() =>
  t('preferences.plugins.community.uninstallConfirm', { name: pending.value?.name ?? '' })
)

const report = (key: string, message: string, name = ''): void => {
  ElMessage.error(t(key, { message, name }))
}

const install = async (kind: 'folder' | 'zip'): Promise<void> => {
  installing.value = true
  try {
    const result = await window.community.install(kind)
    if (!result.ok) {
      if (result.error.message === 'CANCELED') return
      report('preferences.plugins.community.installFailed', result.error.message)
      return
    }
    ElMessage.success(t('preferences.plugins.community.installed', { name: result.value.name }))
  } catch (err) {
    report('preferences.plugins.community.installFailed', err instanceof Error ? err.message : String(err))
  } finally {
    installing.value = false
  }
}

const onToggle = (plugin: CommunityPluginRecord, enabled: boolean): void => {
  if (!enabled) {
    window.community.setEnabled(plugin.id, false).then((result) => {
      if (!result.ok) report('preferences.plugins.community.enableFailed', result.error.message, plugin.name)
    }).catch(() => {})
    return
  }
  pending.value = plugin
  consentOpen.value = true
}

const confirmConsent = async (): Promise<void> => {
  const plugin = pending.value
  consentOpen.value = false
  if (!plugin) return
  const result = await window.community.setEnabled(plugin.id, true)
  if (!result.ok) report('preferences.plugins.community.enableFailed', result.error.message, plugin.name)
}

const askUninstall = (plugin: CommunityPluginRecord): void => {
  pending.value = plugin
  uninstallOpen.value = true
}

const confirmUninstall = async (): Promise<void> => {
  const plugin = pending.value
  uninstallOpen.value = false
  if (!plugin) return
  const result = await window.community.uninstall(plugin.id)
  if (!result.ok) report('preferences.plugins.community.uninstallFailed', result.error.message, plugin.name)
}

const saveSetting = async (_plugin: CommunityPluginRecord, label: string, write: () => Promise<void>): Promise<void> => {
  try {
    await write()
  } catch (err) {
    ElMessage.error(t('preferences.plugins.saveFailed', {
      setting: label,
      message: err instanceof Error ? err.message : String(err)
    }))
    throw err
  }
}
</script>

<style scoped>
.community-plugins {
  margin-top: 28px;
}

.plugin-card {
  margin: 16px 0;
  padding: 12px 16px;
  border: 1px solid var(--itemBgColor);
  border-radius: 6px;
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

.plugin-description,
.plugin-meta {
  margin-top: 4px;
  font-size: 13px;
  color: var(--editorColor50);
}

.plugin-settings {
  margin-top: 12px;
  border-top: 1px solid var(--itemBgColor);
}

.community-actions,
.community-card-actions {
  display: flex;
  gap: 8px;
  margin-top: 12px;
}

.plugin-meta,
.permission-list {
  margin-top: 6px;
  font-size: 12px;
  color: var(--editorColor50);
}

.permission-list {
  padding-left: 18px;
}
</style>
