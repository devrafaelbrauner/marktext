# Android

The APK runs the desktop editor (muya) and Vue UI inside a WebView
(Capacitor 8). Electron's main process is replaced by a TypeScript "mobile
main" (`packages/mobile/src/main/`) plus native Java plugins. What every IPC
channel does on Android is listed in
[`packages/mobile/BRIDGE.md`](../../../packages/mobile/BRIDGE.md) (pt-BR).

## Build and install

On top of the [desktop requirements](building.md): JDK 21 and an Android SDK
with `platforms;android-36` and `build-tools` (point
`packages/mobile/android/local.properties` at it with `sdk.dir=...`).

```bash
pnpm install
export JAVA_HOME=/path/to/jdk-21
pnpm -C packages/mobile build:apk
adb install -r packages/mobile/android/app/build/outputs/apk/debug/app-debug.apk
```

| Command (in `packages/mobile`)                 | What it does                                                                 |
| ---------------------------------------------- | ---------------------------------------------------------------------------- |
| `pnpm build:web`                               | Web bundle in `dist/`, reusing the desktop renderer config                   |
| `pnpm sync`                                    | `build:web` + `cap sync android` (copies the bundle into the Gradle project) |
| `pnpm build:apk`                               | `sync` + `./gradlew assembleDebug`                                           |
| `pnpm test`                                    | Vitest specs of the mobile main side                                         |
| `npx vite preview --config vite.web.config.ts` | Runs the bundle in a browser with an in-memory demo vault                    |

## Using it

- **Open folder**: ☰ (top left) → _Open Folder…_. The Android picker (Storage
  Access Framework) asks for a folder; the grant is kept and the folder
  reopens next time.
- **Open file / Save as**: from ☰ too, through the system pickers.
- **Save**: ☰ → _Save_, `Ctrl+S` on a hardware keyboard, or auto save
  (Preferences → General).
- **Sidebar**: on narrow screens it opens as a drawer over the editor. Back
  closes the drawer, then the settings, then sends the app to the background
  (it never closes a document).
- **Selection**: long-press selects a word with the system handles; the
  editor's format toolbar shows below the selection. Context menus (long-press
  a file in the tree) show as an action sheet.
- **Links**: a tap on a `[[wikilink]]` opens the note; on a `#tag`, the tags
  panel. Desktop needs `Ctrl`+click for the same.
- **AI**: ☰ → _Command Palette_ → type "AI". Without a selection a command uses
  the paragraph at the caret.
- **Settings**: ☰ → _Preferences_, full screen.
- **Plugins**: the same ten built-ins as desktop. API keys (grammar, AI) are
  kept in the Android Keystore. Community plugins install from a folder or
  `.zip` picked in the system picker.

## Differences from desktop

| Feature                    | On Android                                                                                                           |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Find in folder             | JavaScript search in the index worker, no ripgrep                                                                    |
| Changes made by other apps | Picked up when the app returns to the foreground, and every 5 s for open documents (SAF has no change notifications) |
| Delete file                | Permanent: there is no trash                                                                                         |
| Encodings                  | UTF-8 (with/without BOM), UTF-16 LE/BE and Windows-1252; others fail on save with a notice                           |
| Plain HTTP                 | Only to the device itself (`127.0.0.1`, `localhost`), as on desktop                                                  |
| Not in this version        | Export/print/Pandoc, image upload, PlantUML, system font list, Chromium spellchecker, auto update                    |
