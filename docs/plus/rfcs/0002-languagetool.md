# RFC 0002 — Grammar checking with LanguageTool (draft for marktext/marktext#2789)

Status: draft, not posted.

## Proposal

- A grammar checker that sends only prose to a LanguageTool server (Premium API,
  free public API or a self-hosted instance) and underlines the matches in the
  WYSIWYG editor.
- Markdown never reaches the checker as text: each block is sent as a
  LanguageTool `data.annotation` where syntax, URLs, code and math are
  `markup`. LanguageTool reports offsets against the original text including
  markup (verified against the public API), so matches map 1:1 to block
  offsets.
- Suggestions that span markup (e.g. `Eu **vai**` → `Eu vou`) are applied with
  a character diff on the prose only, keeping the formatting.
- Requests are batched per block, cached by content hash, prioritised for the
  visible viewport and rate-limited to the plan's limits (Premium: 80
  requests/min, 300k characters/min, 60k characters/request).
- Credentials stay in the main process (Electron `safeStorage`); the renderer
  only knows whether they are set. Users get an explicit consent prompt
  because text leaves the machine, and can exclude files.

## Engine requirements

Decoration layers, `replaceRange` and `getCheckableBlocks` from RFC 0001.
