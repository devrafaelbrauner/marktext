# Kanban boards

Opens Obsidian Kanban notes as boards and dims `%% comments %%` in the
editor. On by default. Id: `kanban`. No Preferences settings.

A note is a board when front matter has `kanban-plugin` set to any non-empty
string, including the older `basic`:

````markdown
---
kanban-plugin: board
---

## To do

- [ ] First card
- [x] Done @{2026-10-04}

## Doing

## Done

**Complete**

%% kanban:settings

```
{"kanban-plugin":"board"}
```

%%
````

**New Kanban board** (`kanban.new-board`) asks for a name and creates the
file next to the active note, or at the folder root. Default lanes are To
do, Doing, and Done when the UI is English; in Portuguese, A fazer, Fazendo,
and Concluído. The last lane is marked complete.

To see the markdown, use the app command that toggles the document view.
Returning to the board re-reads the file.

## Format

- One heading per lane. WIP limit: `## Title (3)`. `<br>` in a title is a
  line break.
- One list item per card (`-`, `*`, `+`, or `1.`), with or without a
  checkbox. Continuation indented by four spaces or a tab. `^id` at the end
  of the first line is a block id.
- A complete lane: a paragraph `Complete` or `Concluído`, usually
  `**Complete**`. A card moved in is checked; a card moved out is unchecked.
- Archive: a `***` line (or `---` / `___`) and then `## Archive` or
  `## Arquivado`. A heading named Archive without that break is a normal lane.
- The `%% kanban:settings` footer holds JSON. Invalid JSON is kept and not
  rewritten.

Dates on a card: `@{2026-10-04}`, `@[[2026-10-04]]` (opens the daily note),
and time `@@{10:30}`. Triggers come from the board JSON (`date-trigger`,
default `@`; `time-trigger`, default `@@`). Only an ISO date becomes a chip.
Chips before today, on an unchecked card, show as overdue.

`[[links]]` and `#tags` on a card are clickable. A missing note is created
next to the board. `http`, `https`, and `mailto` open externally.

## On the board

- Lane: rename, WIP limit, mark complete, move, drag, delete.
- Card: Enter edits, Shift+Enter breaks the line, Esc cancels. Alt+arrows
  move the card. Drag between lanes. Archive and restore.
- Filter: a case-insensitive substring. Clicking a tag filters by `#tag`.
- `new-card-insertion-method` in the JSON: `prepend` or `prepend-compact`
  inserts at the top; anything else, at the end.

## What round-trips to Obsidian

What the board does not edit stays byte for byte, including CRLF and unknown
sections. An edited card is rewritten as `- [ ]` or `- [x]`, indented by
four spaces.

Not fully compatible:

- Only the words *Complete* / *Concluído* and *Archive* / *Arquivado* are
  recognized. A board from another Obsidian language treats those headings
  as ordinary lanes.
- `list-collapse` is kept in the JSON when it is already a list, but the UI
  does not collapse lanes.
- Lane width, linked-page cards, non-ISO date formats, and other Obsidian
  Kanban keys are preserved and ignored.
- Archived cards can only be restored or deleted.
