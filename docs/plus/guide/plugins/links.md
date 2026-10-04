# Links

Obsidian-style `[[wikilinks]]`, with completion, backlinks, and link updates
when a note is renamed inside MarkText. On by default. Id: `links`.

Open a folder. Without one there is no index and no backlinks.

## Syntax

One line, no nested `]`.

```markdown
[[Note]]
[[Folder/Note|label]]
[[Note#Heading]]
[[Note#^block]]
[[#Local heading]]
![[diagram.png]]
[[doc.pdf#page=3|page 3]]
```

Inside a table the alias pipe is written `\|`: `[[Note\|label]]`.

What you see in the editor is the alias, if there is one. Without an alias,
the text between the brackets stays (`Note#Heading`, not just `Heading`).
The brackets hide while the caret is outside. `![[…]]` is recognized, but
the file is **not** embedded: the click opens the target, like a link.

Resolution, once the folder is indexed:

1. Exact vault path, with or without `.md`. A leading slash is stripped.
2. Path relative to the note (`./Note`, `../Other`).
3. The same file name, case-insensitive, preferring the shortest path.
   `Folder/Note` also matches a trailing path.
4. No extension means a `.md` note. With an extension (`doc.pdf`, `Note.md`),
   the file name must match.

`[[#Heading]]` is the current note. An unresolved target is dimmed.
`Ctrl`-click (`Cmd`-click on macOS) opens it. If the note does not exist,
the app asks whether to create an empty file next to the current note, or
under the folder root when the target contains `/`.

Heading jumps use a GitHub slug, not an Obsidian heading id. `^block` is
kept and exported, but the click does **not** scroll to the block.

Front-matter aliases (`aliases` / `alias`) do **not** resolve the link.
`[[Display name]]` does not open a note just because that text is in
`aliases`. Aliases are search terms for unlinked mentions.

## Completion

After `[[`, the list offers files. New link format (`newLinkFormat`, default
`shortest`):

| Value | Example |
| --- | --- |
| `shortest` | `[[Alpha]]` when the name is unique; otherwise `[[Archive/Notes]]`. A PDF keeps its extension |
| `relative` | `[[../Archive/Notes]]` from the current note |
| `absolute` | `[[Projects/Beta]]`, without `.md` |

`[[note#` completes headings of the resolved note, at most 50. It does not
complete block ids or aliases.

## Backlinks panel

Command **Links: Show Backlinks** (`links.showBacklinks`), no shortcut.

- **Linked mentions:** other notes whose link resolves here. Clicking opens
  the source note. Self-links are omitted.
- **Unlinked mentions:** the file name and aliases, whole word,
  case-insensitive, outside links, code, math, HTML, comments, and front
  matter. Cap 200; notes larger than 2 MiB are skipped. **Link** writes
  `[[Name]]` when the text is exactly the name, otherwise
  `[[shortest|mention]]`. That shortest text ignores `newLinkFormat`.

## Update on rename

Only renames and moves done by MarkText (menu, sidebar). Other programs do
not trigger an update.

| `updateLinksOnRename` | Default | Effect |
| --- | --- | --- |
| `ask` | yes | Asks, listing the notes |
| `always` | | Rewrites immediately |
| `never` | | Does nothing |

Alias, heading, `^block`, and written style are kept (`[[Beta|the beta]]`
becomes `[[Gamma|the beta]]`). Relative markdown links are rewritten as
paths, not shortest names. `https://` URLs are left alone. Front matter and
code are not rewritten. A note open in a tab becomes unsaved; undo applies.
Other notes are written if they have not changed on disk since the preview.

## Settings

| Key | Default |
| --- | --- |
| `newLinkFormat` | `shortest` |
| `updateLinksOnRename` | `ask` |

## Limitations

- No transclusion. No jump to `^block`. No alias resolution.
- HTML export is always an `<a>`, never embedded content.
- Unlinked mentions stop at 200 and skip large files.
