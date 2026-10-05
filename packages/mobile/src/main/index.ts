import { registerBackButton } from './backButton'
import { registerBoot } from './boot'
import { exposeMainToFrames, isChildFrame } from './frames'
import { registerSettingsWindow } from './settingsWindow'

// The settings iframe reuses this bundle but not this side: its IPC goes to
// the parent document's handlers (src/main/frames.ts).
if (!isChildFrame()) {
  await registerBoot()
  registerSettingsWindow()
  await registerBackButton()
  exposeMainToFrames()
}
