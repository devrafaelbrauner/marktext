// Android back button. Overlays (settings, drawers) push a handler while
// open; with none left the app moves to the background instead of finishing
// the activity, so a document with unsaved edits is never torn down.

import { App } from '@capacitor/app'
import { Capacitor } from '@capacitor/core'

const handlers: Array<() => void> = []

/** Registers `handler` for the next back press; returns its removal. */
export function pushBackHandler(handler: () => void): () => void {
  handlers.push(handler)
  return () => {
    const index = handlers.lastIndexOf(handler)
    if (index !== -1) handlers.splice(index, 1)
  }
}

/** Runs the newest handler; `false` when none is registered. */
export function handleBack(): boolean {
  const handler = handlers.pop()
  if (!handler) return false
  handler()
  return true
}

export async function registerBackButton(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return
  await App.addListener('backButton', () => {
    if (!handleBack()) void App.minimizeApp()
  })
}
