import { registerBackButton } from './backButton'
import { registerBoot } from './boot'
import { registerCore } from './core'
import { exposeMainToFrames, isChildFrame } from './frames'
import { registerPlugins } from './plugins'
import { registerSettingsWindow } from './settingsWindow'
import { registerVaultIndex } from './vaultIndex'

// The settings iframe reuses this bundle but not this side: its IPC goes to
// the parent document's handlers (src/main/frames.ts).
if (!isChildFrame()) {
  await registerBoot()
  await registerCore()
  registerSettingsWindow()
  await registerBackButton()
  await registerPlugins()
  registerVaultIndex()
  exposeMainToFrames()
}
