# PDF reader

Opens PDFs from the folder in a tab: search, zoom, outline, thumbnails, and
a link to one page. On by default. Id: `pdf-reader`. No settings.

The file must be inside the folder opened in this window, and at most
64 MiB. Larger, missing, damaged, or password-protected files show an error
and **Open in Default App**. Password-protected PDFs are not supported.
Forms, annotations, and in-PDF links are not interactive: the page is
painted, and the text layer is for selection and search.

## Open on a page

```markdown
[[report.pdf#page=3]]
[[report.pdf#page=3&zoom=50]]
```

`page` is 1-based. `zoom=` is ignored. The jump applies once per link;
switching tabs and coming back does not undo scrolling you did afterwards.

**PDF: Copy Link to This Page** (`pdf-reader.copy-page-link`), also on the
toolbar button, copies `[[name.pdf#page=N]]` using the shortest path among
PDFs in the folder. If the name contains `[]|#^`, the link is ordinary
markdown.

## Toolbar and shortcuts

These shortcuts apply while the PDF tab is active. They are not palette
commands.

| Key | Action |
| --- | --- |
| `Ctrl+F` / `Cmd+F` | Find |
| Enter, `F3`, `Ctrl+G` | Next match; Shift for the previous |
| Esc | Close find |
| `Ctrl+=` / `Ctrl+-` / `Ctrl+0` | Zoom; `0` fits width |
| `n` / `p`, or arrows | Next / previous page |
| Home / End | First / last page |

Find ignores case and accents. There is no regex and no whole-word mode.
Zoom runs from 25% to 500%, with fit width and fit page. The default on open
is fit width. Page, zoom, and the dark-pages switch do not survive quitting
the app.

The sidebar has the outline (if the PDF has one) and thumbnails. An outline
item that is a URL opens externally.

## Limitations

No plugin print command, no rotation, no annotations, no XFA. Only the
`page=` fragment is honored.
