# RFC 0001 — Plugin platform (draft for marktext/marktext#375)

Status: draft, not posted. Author: fork `devrafaelbrauner/marktext`, branch `plus/develop`.

## Problem

Muya's only extension point is `Muya.use()` for floating UI tools. Block types,
inline syntax, code block previews and export are closed lists, and the desktop
app has no way to add commands, panels or settings without patching it.
Meanwhile the preload bridge gives any renderer script unscoped filesystem and
process access, so plugins cannot simply be loaded into the renderer.

## Proposal

1. **Engine extension points in @muyajs/core** (useful without any plugin system):
   - decoration layers: `setDecorations(layerId, ranges)` / `clearDecorations()`,
     render-only marks merged with search highlights into disjoint segments;
   - `replaceRange({path, start, end, expected, replacement})` as one undo step;
   - `getCheckableBlocks()` returning prose with a LanguageTool-style annotation;
   - `registerInlineSyntax()`, `registerCodeBlockRenderer()`,
     `registerCompletionProvider()`;
   - a `content-set` event when a document is loaded.
2. **Desktop plugin host** with a typed contract (renderer and main contexts),
   per-plugin settings rendered from a declarative schema, secrets kept in the
   main process with `safeStorage`, `--safe` as a kill switch.
3. **Two trust tiers**: built-in plugins (bundled, reviewed) first; community
   plugins only after the IPC surface is scoped and they run in a sandboxed
   iframe with manifest permissions.

## Upstream-friendly pieces

Item 1 is self-contained and can land independently, one PR per extension
point, each with specs. The host (item 2) can follow once maintainers agree on
the contract.
