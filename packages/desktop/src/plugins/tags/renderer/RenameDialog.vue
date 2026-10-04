<template>
  <el-dialog
    v-model="view.renameOpen"
    class="tags-rename-dialog"
    :title="ctx.t('rename.title')"
    width="460px"
    append-to-body
    :close-on-click-modal="!busy"
    :close-on-press-escape="!busy"
    :show-close="!busy"
    @opened="focusInput"
  >
    <form
      v-if="step === 'edit'"
      class="tags-rename-form"
      @submit.prevent="preview"
    >
      <label>
        <span>{{ ctx.t('rename.from') }}</span>
        <el-input
          v-model="fromInput"
          data-testid="tags-rename-from"
        />
      </label>
      <label>
        <span>{{ ctx.t('rename.to') }}</span>
        <el-input
          ref="toInputRef"
          v-model="toInput"
          data-testid="tags-rename-to"
        />
      </label>
      <p class="tags-rename-hint">
        {{ ctx.t('rename.nestedHint', { tag: fromTag ?? fromInput }) }}
      </p>
      <p
        v-if="error"
        class="tags-rename-error"
        role="alert"
      >
        {{ error }}
      </p>
      <!-- Lets Enter in either field submit the form. -->
      <button
        type="submit"
        hidden
      />
    </form>

    <p
      v-else-if="step === 'scanning'"
      class="tags-rename-status"
      role="status"
    >
      {{ ctx.t('rename.scanning', { tag: plan?.from ?? fromTag ?? '' }) }}
    </p>

    <div
      v-else-if="plan"
      class="tags-rename-preview"
    >
      <p
        class="tags-rename-status"
        role="status"
      >
        {{
          plan.files.length > 0
            ? ctx.t('rename.summary', {
              from: plan.from,
              to: plan.to,
              occurrences: plan.occurrences,
              files: plan.files.length
            })
            : ctx.t('rename.nothing', { tag: plan.from })
        }}
      </p>
      <ul
        v-if="plan.files.length > 0"
        class="tags-rename-files"
      >
        <li
          v-for="file of plan.files"
          :key="file.path"
          :title="file.path"
        >
          <span class="tags-rename-file">
            {{ noteLabel(file.path) }}
            <em v-if="file.mtimeMs === null">({{ ctx.t('rename.openInTab') }})</em>
          </span>
          <span class="tags-rename-count">{{ ctx.t('rename.occurrences', { count: file.count }) }}</span>
        </li>
      </ul>
      <p
        v-if="plan.files.some((file) => file.mtimeMs === null)"
        class="tags-rename-hint"
      >
        {{ ctx.t('rename.tabNote') }}
      </p>
      <p
        v-for="skipped of plan.skipped"
        :key="skipped.path"
        class="tags-rename-error"
      >
        {{ ctx.t('rename.readFailed', { file: noteLabel(skipped.path), message: skipped.message }) }}
      </p>
    </div>

    <template #footer>
      <el-button
        :disabled="busy"
        @click="step === 'preview' ? (step = 'edit') : (view.renameOpen = false)"
      >
        {{ step === 'preview' ? ctx.t('rename.back') : ctx.t('rename.cancel') }}
      </el-button>
      <el-button
        v-if="step === 'edit' || step === 'scanning'"
        type="primary"
        :loading="step === 'scanning'"
        @click="preview"
      >
        {{ ctx.t('rename.preview') }}
      </el-button>
      <el-button
        v-else
        type="primary"
        :loading="step === 'applying'"
        :disabled="!plan || plan.files.length === 0"
        @click="apply"
      >
        {{ ctx.t('rename.apply') }}
      </el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import type { RendererPluginContext } from '@/plugins/types'
import { parseTagInput, renameTagName } from '../common/rename'
import { describeNotePath } from './notePath'
import { applyTagRename, createRenameServices, planTagRename, type RenamePlan } from './renamePlan'
import type { TagsStore } from './store'

const props = defineProps<{ ctx: RendererPluginContext; store: TagsStore }>()

const view = props.store.view
const services = createRenameServices(props.ctx)

const step = ref<'edit' | 'scanning' | 'preview' | 'applying'>('edit')
const fromInput = ref('')
const toInput = ref('')
const error = ref('')
const plan = ref<RenamePlan | null>(null)
const toInputRef = ref<{ focus(): void } | null>(null)

const busy = computed(() => step.value === 'scanning' || step.value === 'applying')
const fromTag = computed(() => parseTagInput(fromInput.value))

watch(
  () => view.renameOpen,
  (open) => {
    if (!open) return
    fromInput.value = view.renameFrom
    toInput.value = view.renameFrom
    error.value = ''
    plan.value = null
    step.value = 'edit'
  },
  { immediate: true }
)

// The dialog lives in the panel: leaving the panel closes it instead of reopening it later.
onBeforeUnmount(() => {
  view.renameOpen = false
})

const focusInput = (): void => {
  toInputRef.value?.focus()
}

const noteLabel = (path: string): string => {
  const { name, folder } = describeNotePath(path, props.ctx.workspace.getRootPath())
  return folder ? `${folder}/${name}` : name
}

const preview = async (): Promise<void> => {
  if (step.value !== 'edit') return
  const from = fromTag.value
  const to = parseTagInput(toInput.value)
  if (!from) {
    error.value = props.ctx.t('rename.invalidFrom', { tag: fromInput.value.trim() })
    return
  }
  if (!to) {
    error.value = props.ctx.t('rename.invalidTo')
    return
  }
  if (to === from) {
    error.value = props.ctx.t('rename.same')
    return
  }
  error.value = ''
  step.value = 'scanning'
  try {
    plan.value = await planTagRename(services, from, to)
    step.value = 'preview'
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
    step.value = 'edit'
  }
}

const apply = async (): Promise<void> => {
  const current = plan.value
  if (!current || step.value !== 'preview') return
  step.value = 'applying'
  const outcome = await applyTagRename(services, current)
  const list = (paths: string[]): string => paths.map(noteLabel).join(', ')

  if (outcome.renamed.length > 0) {
    props.ctx.ui.notify({
      type: 'info',
      message: props.ctx.t('rename.done', { from: current.from, to: current.to, files: outcome.renamed.length })
    })
  }
  if (outcome.conflicts.length > 0) {
    props.ctx.ui.notify({
      type: 'warning',
      timeout: 0,
      message: props.ctx.t('rename.conflicts', { files: list(outcome.conflicts) })
    })
  }
  if (outcome.failed.length > 0) {
    props.ctx.ui.notify({
      type: 'error',
      timeout: 0,
      message: props.ctx.t('rename.failed', {
        files: list(outcome.failed.map((failure) => failure.path)),
        message: outcome.failed[0].message
      })
    })
  }

  // Keep the panel on the renamed tag.
  if (view.selectedTag) view.selectedTag = renameTagName(view.selectedTag, current.from, current.to) ?? view.selectedTag
  if (view.filter) view.filter = renameTagName(view.filter.replace(/^#/, ''), current.from, current.to) ?? view.filter
  step.value = 'edit'
  view.renameOpen = false
}
</script>

<style>
.tags-rename-dialog .tags-rename-form {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.tags-rename-dialog .tags-rename-form label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 13px;
}

.tags-rename-dialog .tags-rename-hint,
.tags-rename-dialog .tags-rename-status {
  margin: 4px 0;
  font-size: 13px;
}

.tags-rename-dialog .tags-rename-error {
  margin: 4px 0;
  color: var(--deleteColor);
  font-size: 13px;
}

.tags-rename-dialog .tags-rename-files {
  max-height: 240px;
  margin: 8px 0;
  padding: 0;
  overflow-y: auto;
  list-style: none;
}

.tags-rename-dialog .tags-rename-files li {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 3px 0;
  font-size: 13px;
}

.tags-rename-dialog .tags-rename-file {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tags-rename-dialog .tags-rename-count {
  flex-shrink: 0;
  font-variant-numeric: tabular-nums;
}
</style>
