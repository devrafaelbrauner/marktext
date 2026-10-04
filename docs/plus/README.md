# MarkText Plus — architecture and decisions

This fork (`plus/develop`) adds a plugin platform to MarkText and ships a set of
built-in, Obsidian-compatible plugins plus a pt-BR grammar checker backed by
LanguageTool. Generic engine and platform pieces are written so they can be
proposed upstream; feature plugins stay in this fork.

## Decisions

| #   | Decision                                                                                      | Consequence                                                                                              |
| --- | --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| D1  | Work in a fork; propose generic foundations (decorations, range replace, registries) upstream | Feature code lives in new directories; upstream files only get thin hooks, to keep rebases cheap         |
| D2  | Read/write compatibility with Obsidian vaults                                                 | `[[wikilinks]]`, `#tags`, `key:: value`, Kanban board format, `YYYY-MM-DD` daily notes, `%% comments %%` |
| D3  | No third-party plugins until the sandbox and IPC hardening land (milestone M7)                | Built-in plugins are trusted code using the same public API                                              |
| D4  | LanguageTool Premium API by default, server URL configurable (self-hosted allowed)            | Credentials live only in the main process (Electron `safeStorage`)                                       |
| D5  | Turn off Chromium's spellchecker while the LanguageTool checker is active                     | No double underlines                                                                                     |
| D6  | Icons are written as `:pack-name:` shortcodes and exported as inline SVG                      | Source stays plain text; exported HTML/PDF shows the icon                                                |
| D7  | Mermaid keeps its dedicated diagram block for now                                             | Migration to the generic code-block preview registry happens after Dataview proves it                    |

Out of scope: running Obsidian plugins, DataviewJS (arbitrary code), sync, mobile.

## Trust model

| Tier                  | Runs in                                                         | Access                                                          |
| --------------------- | --------------------------------------------------------------- | --------------------------------------------------------------- |
| Built-in plugin       | Renderer (UI) and main process (services); bundled with the app | Full plugin API                                                 |
| Community plugin (M7) | Sandboxed iframe on a dedicated scheme, no preload              | Plugin API over a MessagePort, filtered by manifest permissions |

Electron's `utilityProcess` is a Node child process, not a sandbox: it only
hosts trusted services such as the vault index.

## Where things live

| Piece                   | Path                                                                                                                     |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| API contract            | `packages/desktop/src/shared/plugins/types.ts`, `src/renderer/src/plugins/types.ts`, `src/main/plugins/types.ts`         |
| Renderer host           | `packages/desktop/src/renderer/src/plugins/`                                                                             |
| Main host               | `packages/desktop/src/main/plugins/`                                                                                     |
| Security primitives     | `packages/desktop/src/main/security/` (secrets store, safe fetch, sender validation)                                     |
| Vault index             | `packages/desktop/src/main/vaultIndex/` (utility process) and `src/common/markdownExt/` (parsers shared with the editor) |
| Engine extension points | `packages/muya/src/` (decorations, range replace, inline syntax, code block previews, completion)                        |
| Built-in plugins        | `packages/desktop/src/plugins/<id>/`                                                                                     |

## Adding a built-in plugin

1. Create `packages/desktop/src/plugins/<id>/` with `manifest.ts`, `locales/en.json`,
   `locales/pt.json`, and `renderer/index.ts` and/or `main/index.ts` exporting
   `activate(ctx)` (and optionally `deactivate()`).
2. Register the manifest in `src/plugins/manifests.ts`, the renderer part in
   `src/renderer/src/plugins/builtin.ts`, and the main part in
   `src/main/plugins/builtin.ts`.
3. Everything registered through `ctx` is disposed automatically when the plugin
   is disabled; `--safe` starts the app with every plugin disabled.

## Grammar checker (`grammar`)

LanguageTool-backed spelling/grammar/style checking, pt-BR by default; off until
enabled in Preferences → Plugins.

- **Where text goes.** Only the main part talks to the network (`ctx.net.fetch`):
  Premium (`api.languagetoolplus.com`, username + API key from `secrets.json`),
  the free public API, or a self-hosted server (`http` only to loopback).
  Nothing is sent before the consent dialog was accepted (`consentGiven`);
  front matter, code, math and HTML blocks are never sent, and a file with
  `languagetool: false` in its front matter is skipped.
- **What is sent.** Muya's checkable blocks as LanguageTool `data.annotation`
  (markup kept as markup), packed below the plan's per-request size with a
  `\n\n` separator, throttled per minute (requests and characters) and retried
  with backoff on 429/503 (Retry-After honoured). Results are cached per block
  text, so only new or edited blocks are re-sent.
- **Fixes keep formatting.** A suggestion for a range that contains markup is
  diffed against the prose LanguageTool read and applied to the prose only
  (`Eu **vai**` → `Eu **vou**`), as one undo step.
- **Native spellchecker.** The plugin asks the engine host for
  `disableNativeSpellcheck` (setting, on by default); the user's spellcheck
  preference is restored when the request is released.
