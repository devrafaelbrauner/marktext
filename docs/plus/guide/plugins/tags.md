# Tags

Obsidian-style `#tags`: highlighted in the editor, suggested as you type,
listed in a sidebar panel, and renamable across the folder. On by default.
Id: `tags`. No settings.

While the plugin is on, `#` becomes an ATX heading only when a space
follows (`# tag` stays a paragraph; `# Title` stays a heading).

## Syntax

```markdown
#work #a/b/c #réunion #Café_2
```

A tag needs at least one letter or emoji. `#2026` and `#2026-10` are not
tags. Characters: letters, marks, digits, `_`, `-`, `/`, and emoji. A
trailing `/` is dropped from the name (`#a/b/` is the tag `a/b`).

A tag does not start after `#`, `&`, `\`, `/`, or a backtick. So `##tag`,
`C#sharp`, `\#escaped`, and a URL fragment are not tags. Hex colours are not
either: `#fff`, `#ffffff`, `#1e1e1e`. `#cafe` and `#bad` remain tags.

Code, math, link destinations, and `%%` comments are not indexed. YAML front
matter tags are merged with body tags:

```yaml
---
tags: [work, a/b]
tag: reading, #idea
---
```

The key may be `tags` or `tag`, any case. A list, or text split on commas
and whitespace. A leading `#` is optional. TOML or JSON front matter is not
read. The closing `---` must be followed by a blank line (or be the end of
the file).

`#a/b` counts for `a` and for `a/b`. Identity is case-insensitive; the stored
spelling is the first occurrence.

## Panel

Command **Tags: Show Tags Panel** (`tags.showPanel`). The tree follows `/`.
The filter ignores a leading `#`. Clicking a tag in the editor reveals it in
the panel. Clicking a note in the list opens the file.

## Rename

Command **Tags: Rename Tag…** (`tags.renameTag`), or the panel button. There
is a preview before apply.

`idea` → `note` also renames `#Idea` and `#idea/draft` to `#note/draft`. It
does not touch `#ideas` or `#my/idea`. A nested suffix keeps its own case.

The new name needs a letter or emoji, and only `_`, `-`, and `/`. `a//b` and
hex colours are rejected.

Open notes are edited in the tab and stay unsaved. Other files are written
only if they have not changed on disk since the preview.

## Limitations

No shortcut and no settings of its own (no tag-only ignore list). Tags
hidden in code, links, or HTML attributes are not renamed, on purpose.
