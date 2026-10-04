# RFC 0003 — Wikilinks and backlinks (draft for marktext/marktext#2329, #2018)

Status: draft, not posted.

## Proposal

- Obsidian-compatible `[[note]]`, `[[note|alias]]`, `[[note#Heading]]` and
  `[[file.pdf#page=3]]`, resolved like Obsidian (exact path, then the shortest
  path with the same basename).
- A vault metadata index running in an Electron `utilityProcess`, fed by the
  existing folder watcher, providing backlinks, tags and link resolution
  without blocking the main process. It also replaces today's initial scan that
  sends every markdown file's full content to every window.
- Autocomplete after `[[`, Ctrl/Cmd-click to open, a Backlinks panel, and link
  rewriting when a file is renamed or moved (open tabs become unsaved and the
  change can be undone).

## Engine requirements

`registerInlineSyntax()` and `registerCompletionProvider()` from RFC 0001. The
inline rule keeps the rendered text identical to the markdown source, so it can
never alter a document.
