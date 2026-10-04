/**
 * Sandboxed iframes for a community plugin. `allow-scripts` without
 * `allow-same-origin` gives the frame an opaque origin, so it cannot read
 * the host document. The host only talks to it through postMessage.
 */

import { defineComponent, h, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import type { Component } from 'vue'

export const communityStatus = reactive<Record<string, { text: string; tooltip: string }>>({})

export const createSandboxedFrame = (src: string, className: string): HTMLIFrameElement => {
  const iframe = document.createElement('iframe')
  iframe.setAttribute('sandbox', 'allow-scripts')
  iframe.setAttribute('referrerpolicy', 'no-referrer')
  iframe.className = className
  iframe.src = src
  return iframe
}

export const statusComponent = (id: string): Component => defineComponent({
  name: 'CommunityStatusText',
  setup() {
    return () => h('span', {
      class: 'community-status-text',
      title: communityStatus[id]?.tooltip || undefined
    }, communityStatus[id]?.text ?? '')
  }
})

export const panelComponent = (
  pluginId: string,
  entry: string,
  onFrame: (iframe: HTMLIFrameElement) => void
): Component => defineComponent({
  name: 'CommunityPanelFrame',
  setup() {
    const host = ref<HTMLElement | null>(null)
    let iframe: HTMLIFrameElement | null = null
    onMounted(() => {
      if (!host.value) return
      iframe = createSandboxedFrame(`mt-plugin://${pluginId}/${entry}`, 'community-panel-frame')
      onFrame(iframe)
      host.value.appendChild(iframe)
    })
    onBeforeUnmount(() => {
      iframe?.remove()
      iframe = null
    })
    return () => h('div', {
      ref: host,
      class: 'community-panel-host',
      'data-community-panel': pluginId
    })
  }
})

let styleMounted = false

/** Zero-size host for background iframes. Not `display: none`, which can skip loading. */
export const ensureBackgroundHost = (): HTMLElement => {
  let host = document.querySelector<HTMLElement>('.community-plugin-hosts')
  if (!host) {
    host = document.createElement('div')
    host.className = 'community-plugin-hosts'
    host.setAttribute('aria-hidden', 'true')
    document.body.appendChild(host)
  }
  if (!styleMounted) {
    styleMounted = true
    const style = document.createElement('style')
    style.textContent = `
      .community-plugin-hosts { position: absolute; width: 0; height: 0; overflow: hidden; }
      .community-plugin-frame { width: 0; height: 0; border: 0; }
      .community-panel-host { width: 100%; height: 100%; min-height: 120px; }
      .community-panel-frame { width: 100%; height: 100%; border: 0; background: transparent; }
    `
    document.head.appendChild(style)
  }
  return host
}
