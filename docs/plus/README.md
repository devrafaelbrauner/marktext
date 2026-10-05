# MarkText Plus — architecture and decisions

This fork (`plus/develop`) adds a plugin platform to MarkText and ships a set of
built-in, Obsidian-compatible plugins plus a pt-BR grammar checker backed by
LanguageTool and an AI plugin backed by OpenRouter. Generic engine and
platform pieces are written so they can be proposed upstream; feature plugins
stay in this fork.

## Documentation

User guide, Brazilian Portuguese first:
[guia](guia/README.md) (overview, build, `--safe`, data files, Preferences →
Plugins, one page per built-in, Obsidian round-trip). English:
[guide](guide/README.md).

Developer guide: [desenvolvimento](desenvolvimento/README.md) (pt-BR) and
[development](development/README.md) (architecture, built-in authoring, API
reference, tests). Community plugins are the agreed M7 design only; the SDK
reference is [sdk/README.md](sdk/README.md) and
[sdk/README.en.md](sdk/README.en.md), not duplicated here.

The pages below stay the decision record. Behaviour that the code actually
ships is in the guides; where they differ, the guides cite the file.

## Decisions

| #   | Decision                                                                                      | Consequence                                                                                              |
| --- | --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| D1  | Work in a fork; propose generic foundations (decorations, range replace, registries) upstream | Feature code lives in new directories; upstream files only get thin hooks, to keep rebases cheap         |
| D2  | Read/write compatibility with Obsidian vaults                                                 | `[[wikilinks]]`, `#tags`, `key:: value`, Kanban board format, `YYYY-MM-DD` daily notes, `%% comments %%` |
| D3  | Community plugins run in a sandboxed `mt-plugin:` iframe with manifest permissions (M7)       | Built-ins stay trusted in-process; community code has no preload                                         |
| D4  | LanguageTool Premium API by default, server URL configurable (self-hosted allowed)            | Credentials live only in the main process (Electron `safeStorage`)                                       |
| D5  | Turn off Chromium's spellchecker while the LanguageTool checker is active                     | No double underlines                                                                                     |
| D6  | Icons are written as `:pack-name:` shortcodes and exported as inline SVG                      | Source stays plain text; exported HTML/PDF shows the icon                                                |
| D7  | Mermaid keeps its dedicated diagram block for now                                             | Migration to the generic code-block preview registry happens after Dataview proves it                    |

Out of scope: running Obsidian plugins, DataviewJS (arbitrary code), sync, mobile.

## Trust model

| Tier                  | Runs in                                                         | Access                                                          |
| --------------------- | --------------------------------------------------------------- | --------------------------------------------------------------- |
| Built-in plugin       | Renderer (UI) and main process (services); bundled with the app | Full plugin API                                                 |
| Community plugin (M7) | Sandboxed iframe on `mt-plugin:`, no preload                    | Plugin API over a MessagePort, filtered by manifest permissions |

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
| Community SDK           | `docs/plus/sdk/README.md`, `packages/plugin-sdk`                                                                         |

## Adding a built-in plugin

1. Create `packages/desktop/src/plugins/<id>/` with `manifest.ts`, `locales/en.json`,
   `locales/pt.json`, and `renderer/index.ts` and/or `main/index.ts` exporting
   `activate(ctx)` (and optionally `deactivate()`).
2. Register the manifest in `src/plugins/manifests.ts`, the renderer part in
   `src/renderer/src/plugins/builtin.ts`, and the main part in
   `src/main/plugins/builtin.ts`.
3. Everything registered through `ctx` is disposed automatically when the plugin
   is disabled; `--safe` starts the app with every plugin disabled.

The longer version, including the index-worker glob, is
[desenvolvimento/plugin-embutido.md](desenvolvimento/plugin-embutido.md)
([English](development/builtin-plugin.md)).

## Grammar checker (`grammar`)

LanguageTool-backed spelling/grammar/style checking, pt-BR by default; off until
enabled in Preferences → Plugins.

User pages: [guia/plugins/corretor.md](guia/plugins/corretor.md),
[guide/plugins/grammar.md](guide/plugins/grammar.md).

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

## AI (`ai`)

Fix text, create tables, calculate and research with an OpenRouter model the
user picks, using the user's own API key; off until enabled in Preferences →
Plugins.

User pages: [guia/plugins/ia.md](guia/plugins/ia.md),
[guide/plugins/ai.md](guide/plugins/ai.md).

- **Where text goes.** Only the main part talks to the network (`ctx.net.fetch`):
  `POST {baseUrl}/chat/completions` (default `https://openrouter.ai/api/v1`,
  `http` only to loopback) with the key from `secrets.json` as a Bearer token.
  Nothing is sent before consent (`consentGiven`), key and model are set.
- **What is sent.** Only the command's input: the selection, or the checkable
  block at the caret. Front matter, code, math and HTML blocks are never sent.
  Fix text sends one request per block (max 20); the other commands send one
  prompt (max 20 000 characters).
- **Models are free text.** No model list is fetched; the user pastes ids from
  openrouter.ai/models, with an optional per-command override. Web search is
  OpenRouter's `:online` suffix, not app code.
- **Edits are guarded.** Corrections go through `replaceRange` (refused if the
  block changed, one undo step each); other answers are parsed as Markdown and
  inserted after the selection's top-level block with the new
  `insertMarkdownBlocks` (one undo step). The selection is read with
  `getSelection`, which survives the command palette taking focus.
- **Shared networking.** Buffered requests (no streaming), 60 s timeout,
  retries on 429/502/503 and network failures reuse the grammar checker's
  `RateLimiter`, `parseRetryAfter` and `DEFAULT_RETRY_POLICY`; client-side
  limit 20 requests per minute.
