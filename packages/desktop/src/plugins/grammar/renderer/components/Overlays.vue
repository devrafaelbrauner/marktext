<template>
  <grammar-popover :ctx="ctx" />
  <consent-dialog :ctx="ctx" />
</template>

<script setup lang="ts">
import type { RendererPluginContext } from '@/plugins/types'
import ConsentDialog from './ConsentDialog.vue'
import GrammarPopover from './GrammarPopover.vue'

defineProps<{ ctx: RendererPluginContext }>()
</script>
