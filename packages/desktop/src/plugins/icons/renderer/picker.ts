import { createApp, type App } from 'vue'
import type { IconPack } from '../common/pack'
import IconPicker from './IconPicker.vue'

export interface IconPickerOptions {
  pack: IconPack
  t: (key: string, params?: Record<string, string | number>) => string
  maskUri: (name: string) => string | null
  /** Called after the modal closed because the user chose `name`. */
  onPick: (name: string) => void
  /** Called after the modal closed without a choice. */
  onCancel: () => void
}

/**
 * Shows the icon picker modal on top of the window. Returns a function that
 * closes it without calling either callback (used when the plugin is
 * disabled while the modal is open).
 */
export const openIconPicker = (options: IconPickerOptions): (() => void) => {
  const host = document.createElement('div')
  document.body.appendChild(host)
  let app: App | null = null
  const close = (): void => {
    app?.unmount()
    app = null
    host.remove()
  }
  app = createApp(IconPicker, {
    pack: options.pack,
    t: options.t,
    maskUri: options.maskUri,
    onPick: (name: string) => {
      close()
      options.onPick(name)
    },
    onClose: () => {
      close()
      options.onCancel()
    }
  })
  app.mount(host)
  return close
}
