<template>
  <section
    class="links-backlinks"
    :aria-label="ctx.t('panel.title')"
  >
    <div class="links-backlinks-header">
      <h2 class="links-backlinks-title">
        {{ ctx.t('panel.title') }}
      </h2>
      <button
        type="button"
        class="links-backlinks-refresh"
        :title="ctx.t('panel.refresh')"
        :aria-label="ctx.t('panel.refresh')"
        @click="reload"
      >
        ⟳
      </button>
    </div>
    <p
      v-if="message"
      class="links-backlinks-empty"
    >
      {{ message }}
    </p>
    <div
      v-else
      class="links-backlinks-body"
    >
      <h3 class="links-backlinks-section">
        {{ ctx.t('panel.linked') }}
        <span class="links-backlinks-count">{{ linkedCount }}</span>
      </h3>
      <p
        v-if="!linked.length"
        class="links-backlinks-empty"
      >
        {{ ctx.t('panel.noLinked') }}
      </p>
      <ul
        v-else
        class="links-backlinks-list"
        data-testid="links-linked"
      >
        <li
          v-for="group in linked"
          :key="group.sourcePath"
          class="links-backlinks-group"
        >
          <button
            type="button"
            class="links-backlinks-source"
            :title="ctx.t('panel.openSource', { name: group.name })"
            @click="open(group.sourcePath)"
          >
            {{ group.name }}
          </button>
          <ul class="links-backlinks-contexts">
            <li
              v-for="(line, index) in group.contexts"
              :key="index"
              class="links-backlinks-context"
            >
              {{ line }}
            </li>
          </ul>
        </li>
      </ul>

      <h3 class="links-backlinks-section">
        {{ ctx.t('panel.unlinked') }}
        <span class="links-backlinks-count">{{ unlinkedCount }}</span>
      </h3>
      <p
        v-if="!unlinked.length"
        class="links-backlinks-empty"
      >
        {{ ctx.t('panel.noUnlinked') }}
      </p>
      <ul
        v-else
        class="links-backlinks-list"
        data-testid="links-unlinked"
      >
        <li
          v-for="file in unlinked"
          :key="file.sourcePath"
          class="links-backlinks-group"
        >
          <button
            type="button"
            class="links-backlinks-source"
            :title="ctx.t('panel.openSource', { name: nameOf(file.sourcePath) })"
            @click="open(file.sourcePath)"
          >
            {{ nameOf(file.sourcePath) }}
          </button>
          <ul class="links-backlinks-contexts">
            <li
              v-for="mention in file.mentions"
              :key="mention.start"
              class="links-backlinks-context links-backlinks-mention"
            >
              <span class="links-backlinks-mention-text">{{ mention.context }}</span>
              <button
                type="button"
                class="links-backlinks-link"
                :disabled="busy"
                :title="ctx.t('panel.linkTitle', { name: targetName })"
                @click="linkMention(file, mention)"
              >
                {{ ctx.t('panel.link') }}
              </button>
            </li>
          </ul>
        </li>
      </ul>
      <p
        v-if="truncated"
        class="links-backlinks-empty"
      >
        {{ ctx.t('panel.truncated', { count: MAX_UNLINKED_MENTIONS }) }}
      </p>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowRef } from 'vue'
import type { Disposable, RendererPluginContext } from '@/plugins/types'
import { linkMentionInText } from '../common/linkMention'
import type { MentionMatch } from '../common/mentions'
import { noteName } from '../common/paths'
import { MAX_UNLINKED_MENTIONS, type UnlinkedMentionsResult } from '../common/protocol'
import { shortestLinkText } from '../common/linkText'
import type { VaultFiles } from './vaultFiles'

type MentionFile = UnlinkedMentionsResult['files'][number]

interface LinkedGroup {
  sourcePath: string
  name: string
  contexts: string[]
}

const props = defineProps<{ ctx: RendererPluginContext; files: VaultFiles }>()
const ctx = props.ctx

const message = ref<string | null>(null)
const linked = shallowRef<LinkedGroup[]>([])
const unlinked = shallowRef<MentionFile[]>([])
const truncated = ref(false)
const busy = ref(false)
const targetPath = ref<string | null>(null)

const nameOf = (path: string): string => noteName(path.replace(/\\/g, '/'))
const targetName = computed(() => (targetPath.value ? nameOf(targetPath.value) : ''))
const linkedCount = computed(() => linked.value.reduce((sum, group) => sum + group.contexts.length, 0))
const unlinkedCount = computed(() => unlinked.value.reduce((sum, file) => sum + file.mentions.length, 0))

let generation = 0

const reload = async (): Promise<void> => {
  const current = ++generation
  const tab = ctx.editor.getActiveTab()
  const path = tab?.kind === 'markdown' ? tab.pathname : null
  targetPath.value = path
  if (!props.files.getRoot()) {
    message.value = ctx.t('panel.noFolder')
    return
  }
  if (!path) {
    message.value = ctx.t('panel.noFile')
    return
  }
  if (!ctx.metadata.isReady()) {
    message.value = ctx.t('panel.indexing')
    return
  }
  const [backlinks, mentions] = await Promise.all([
    ctx.metadata.getBacklinks(path).catch(() => []),
    ctx.metadata
      .request<UnlinkedMentionsResult | null>('links.unlinkedMentions', { path })
      .catch(() => null)
  ])
  if (current !== generation) return
  const groups = new Map<string, LinkedGroup>()
  for (const entry of backlinks) {
    let group = groups.get(entry.sourcePath)
    if (!group) {
      group = { sourcePath: entry.sourcePath, name: nameOf(entry.sourcePath), contexts: [] }
      groups.set(entry.sourcePath, group)
    }
    group.contexts.push(entry.context.trim())
  }
  linked.value = [...groups.values()].sort((a, b) => a.name.localeCompare(b.name))
  unlinked.value = mentions?.files ?? []
  truncated.value = mentions?.truncated ?? false
  message.value = null
}

let reloadTimer: number | undefined
const scheduleReload = (): void => {
  window.clearTimeout(reloadTimer)
  reloadTimer = window.setTimeout(reload, 150)
}

const open = (path: string): void => {
  ctx.workspace.openFile(path).catch(() => {})
}

const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error))

const linkMention = async (file: MentionFile, mention: MentionMatch): Promise<void> => {
  const target = targetPath.value
  if (!target || busy.value) return
  busy.value = true
  try {
    const source = props.files.toVault(file.sourcePath) ?? ''
    const targetVault = props.files.toVault(target)
    if (targetVault === null) return
    const linkText = shortestLinkText(targetVault, source, props.files.getResolver())
    // An open, unsaved tab is the current text of the note, not the file on disk.
    const active = ctx.editor.getActiveTab()
    const fromTab = active?.pathname === file.sourcePath ? ctx.editor.getMarkdown() : null
    const content = fromTab ?? (await ctx.vault.readText(file.sourcePath)).content
    const next = linkMentionInText(content, mention, linkText)
    if (next === null) {
      ctx.ui.notify({ type: 'warning', message: ctx.t('panel.linkChanged') })
      return
    }
    await ctx.vault.writeText(file.sourcePath, next, fromTab === null ? { expectedMtimeMs: file.mtimeMs } : undefined)
  } catch (error) {
    const conflict = typeof error === 'object' && error !== null && 'code' in error && error.code === 'CONFLICT'
    ctx.ui.notify({
      type: conflict ? 'warning' : 'error',
      message: conflict ? ctx.t('panel.linkChanged') : ctx.t('panel.linkFailed', { message: errorMessage(error) })
    })
  } finally {
    busy.value = false
    await reload()
  }
}

const subscriptions: Disposable[] = [
  // The tab info also changes on every edit (saved state); only another file needs a reload.
  ctx.editor.onDidChangeActiveTab((tab) => {
    if ((tab?.kind === 'markdown' ? tab.pathname : null) !== targetPath.value) scheduleReload()
  }),
  ctx.metadata.onDidChange(scheduleReload),
  ctx.metadata.onDidBecomeReady(scheduleReload),
  ctx.workspace.onDidChangeRootPath(scheduleReload)
]
reload()

onBeforeUnmount(() => {
  window.clearTimeout(reloadTimer)
  generation++
  for (const subscription of subscriptions) subscription.dispose()
})
</script>

<style scoped>
.links-backlinks {
  height: 100%;
  display: flex;
  flex-direction: column;
  color: var(--sideBarColor);
  font-size: 13px;
  overflow: hidden;
}

.links-backlinks-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin: 37px 0 10px 0;
  padding: 0 15px 0 25px;
  flex-shrink: 0;
}

.links-backlinks-title {
  color: var(--sideBarTitleColor);
  font-weight: 600;
  font-size: 16px;
  margin: 0;
}

.links-backlinks-refresh {
  border: none;
  background: transparent;
  color: var(--sideBarIconColor);
  cursor: pointer;
  font-size: 15px;
  padding: 2px 4px;
  border-radius: 3px;
}

.links-backlinks-refresh:hover,
.links-backlinks-refresh:focus-visible {
  color: var(--themeColor);
  outline: none;
  background: var(--sideBarItemHoverBgColor);
}

.links-backlinks-body {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 0 15px 20px 15px;
}

.links-backlinks-section {
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  color: var(--sideBarTitleColor);
  margin: 14px 0 6px 10px;
  display: flex;
  gap: 6px;
}

.links-backlinks-count {
  color: var(--sideBarTextColor);
  font-weight: normal;
}

.links-backlinks-empty {
  color: var(--sideBarTextColor);
  font-size: 12px;
  padding: 0 10px 0 25px;
  margin: 6px 0;
}

.links-backlinks-body > .links-backlinks-empty {
  padding-left: 10px;
}

.links-backlinks-list,
.links-backlinks-contexts {
  list-style: none;
  margin: 0;
  padding: 0;
}

.links-backlinks-group {
  margin-bottom: 8px;
}

.links-backlinks-source {
  display: block;
  width: 100%;
  text-align: left;
  border: none;
  background: transparent;
  color: var(--sideBarColor);
  font-weight: 600;
  font-size: 13px;
  padding: 4px 10px;
  border-radius: 3px;
  cursor: pointer;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.links-backlinks-source:hover,
.links-backlinks-source:focus-visible {
  background: var(--sideBarItemHoverBgColor);
  color: var(--themeColor);
  outline: none;
}

.links-backlinks-context {
  color: var(--sideBarTextColor);
  font-size: 12px;
  line-height: 1.5;
  padding: 2px 10px 2px 18px;
  overflow-wrap: anywhere;
}

.links-backlinks-mention {
  display: flex;
  align-items: flex-start;
  gap: 6px;
}

.links-backlinks-mention-text {
  flex: 1;
  min-width: 0;
}

.links-backlinks-link {
  flex-shrink: 0;
  border: 1px solid var(--floatBorderColor);
  background: transparent;
  color: var(--themeColor);
  border-radius: 3px;
  font-size: 11px;
  padding: 1px 6px;
  cursor: pointer;
}

.links-backlinks-link:hover,
.links-backlinks-link:focus-visible {
  background: var(--sideBarItemHoverBgColor);
  outline: none;
}

.links-backlinks-link:disabled {
  opacity: 0.5;
  cursor: default;
}
</style>
