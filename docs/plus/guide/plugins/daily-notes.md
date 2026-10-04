# Calendar and daily notes

Obsidian-compatible daily notes, with a calendar in the sidebar. On by
default. Id: `daily-notes`.

The calendar needs an open folder.

## Where the note is created

| Key | Default | Effect |
| --- | --- | --- |
| `folder` | empty | Vault folder. Empty = root. Example: `Daily` |
| `format` | `YYYY-MM-DD` | File name, moment tokens. `/` creates subfolders |
| `template` | empty | Vault path of a template note. `.md` is added if missing |
| `weekStart` | `sunday` | `sunday` or `monday` |
| `openOnStartup` | off | Opens today's note when a window opens with a folder |

```text
folder: Daily
format: YYYY/MM/YYYY-MM-DD
```

creates `Daily/2026/10/2026-10-04.md`. An empty format falls back to
`YYYY-MM-DD`.

Tokens the code exercises: `YYYY`, `MM`, `DD`, `dddd`, `MMMM`, `Do`, `Q`,
`ww` / `WW`, `gggg` / `GGGG`. With the UI in Portuguese, day and month names
come out in pt-BR. Every other UI language formats in English.

The vault index marks a file as a day only when the basename is exactly
`YYYY-MM-DD`. This plugin also recognizes the configured format. When several
files claim one day, the exact configured path wins, then a file inside the
daily-notes folder.

## Template

Double-brace variables, optional spaces:

| Variable | Becomes |
| --- | --- |
| `{{date}}` | the note's day, in the format setting |
| `{{date:dddd, MMMM Do}}` | that moment format |
| `{{date+1d}}` `{{date-1M:YYYY-MM}}` | offset. Units: `y` `q` `M` `w` `d` `h` `m` `s` |
| `{{time}}` | current time, `HH:mm` (not the note's time) |
| `{{time:HH:mm:ss}}` `{{time+30m}}` | custom format or time offset |
| `{{title}}` | file name without extension |
| `{{yesterday}}` `{{tomorrow}}` | the previous or next day, in the note format |

`q` is three months, not a calendar quarter. `{{yesterday}}` and
`{{tomorrow}}` take neither an offset nor their own format:
`{{yesterday+1d}}` and `{{title:X}}` stay as written. Unknown names
(`{{weather}}`) do too.

```markdown
# {{title}}

[[{{yesterday}}]] · {{date:dddd}}
```

If the template file cannot be read, the note is created empty and a warning
is shown.

## Commands

| Id | Shortcut | Name |
| --- | --- | --- |
| `daily-notes.open-today` | `Ctrl+Alt+Shift+D` / `Cmd+Alt+Shift+D` | Open today's daily note |
| `daily-notes.open-previous` | — | Open previous daily note |
| `daily-notes.open-next` | — | Open next daily note |
| `daily-notes.open-calendar` | — | Open calendar |

`Ctrl+Alt+D` is already Duplicate, so today's note uses an extra Shift.

Previous and next open the nearest existing daily note, and only if the
active tab is already a daily note. They do not create the empty neighbour.

## Calendar

Six weeks. A dot marks a day with a note; its size follows the index word
count. Click creates or opens. Arrow keys move by day; Home and End jump to
the week edges.

## Limitations

There is no separate weekly-notes feature: whatever the format string
produces is what exists. `openOnStartup` fires once per window, not again if
you re-enable the plugin. Renaming the note is an ordinary rename; the links
plugin may update links if it is on.
