# Obsidian vault compatibility

The goal is to read and write the same notes, not to run Obsidian plugins.
DataviewJS, sync, and the mobile app are out of scope.

Open the vault folder. The index skips hidden segments (`.obsidian`, `.git`,
`.trash`), `node_modules`, and the tree-exclude patterns. A markdown note
larger than 5 MiB is listed with empty metadata.

Front-matter metadata comes only from YAML (`---` on the first line, a
closer, then a blank line or end of file). TOML (`+++`) and JSON do not feed
tags, aliases, or the grammar opt-out.

## What round-trips

| Feature | On disk | In MarkText Plus |
| --- | --- | --- |
| Wikilink | `[[Note]]`, `[[Note\|label]]`, `[[Note#Heading]]`, `[[Note#^id]]`, `[[#Heading]]`, `![[file]]` | Read and written as-is. Click opens. See [Links](plugins/links.md) |
| Markdown link | `[text](Note.md#heading)` | Indexed. Rename rewrites the relative path |
| PDF | `[[doc.pdf#page=3]]` | Opens on that page. `zoom=` is ignored |
| Tag | `#a/b`, YAML `tags` / `tag` | Panel, completion, rename |
| Alias | `aliases` / `alias` | Stored. Used for unlinked mentions, not for resolution |
| Inline field | `key:: value`, `[key:: value]` | Becomes a Dataview property. Key is lower-cased |
| Task | `- [ ]` `- [x]` and other characters | Dataview TASK. Only `x`/`X` count as completed |
| Daily note | `YYYY-MM-DD.md`, or the configured format | Calendar. The index `file.day` field only sees `YYYY-MM-DD` |
| Daily template | `{{date}}`, `{{time}}`, `{{title}}`, `{{yesterday}}`, `{{tomorrow}}`, `{{date+1d:FORMAT}}` | Filled in on create. Templater variables stay literal |
| Kanban | `kanban-plugin: board`, lanes, cards, `%% kanban:settings` | [Kanban](plugins/kanban.md). Complete/Archive words also in Portuguese |
| Dataview | a `dataview` block with TABLE, LIST, TASK | Subset in [Dataview](plugins/dataview.md). The block is not rewritten |
| Mermaid | a `mermaid` block, class `internal-link` | Preview and modifier-click |
| Icon | `:lucide-name:` | Not Obsidian syntax. The file stays text |
| Comment | `%% text %%` | Dimmed. Omitted from HTML export |
| Opt-out | `languagetool: false` | Specific to this fork. Obsidian ignores the key |

Renaming or moving inside MarkText can rewrite links in other notes, if the
links plugin is set to **Ask every time** or **Always**. The open tab becomes
unsaved.

## What is not Obsidian

- `![[note]]` does not embed the content. It is a link.
- `[[front matter alias]]` does not resolve. Resolution is exact path, then
  relative path, then the shortest file name.
- `[[note#^block]]` opens the note and does not scroll to the block. There
  is no block index.
- The visible text of `[[note#Heading]]` is `note#Heading`, not just the
  heading.
- Numeric-only tags and the colours `#fff` / `#1e1e1e` are not tags. `#cafe`
  is.
- DataviewJS, `CALENDAR`, `GROUP BY`, `FLATTEN`, and inline queries do not
  run.
- A Kanban board whose language is neither English nor Portuguese does not
  recognize the complete-lane and archive words.
- Obsidian properties beyond YAML `tags`, `aliases`, and `key::` fields have
  no panel of their own. They show up as Dataview fields when they are in
  front matter.
- Plugins under `.obsidian/plugins` are not loaded.
- Callouts (`> [!note]`), heading embeds, and weekly periodic notes have no
  special handling.

The parsers live in `packages/desktop/src/common/markdownExt/`
(`wikilinks.ts`, `tags.ts`, `frontMatter.ts`, `inlineFields.ts`, `resolve.ts`,
`parseNote.ts`) and in the plugins linked above.
