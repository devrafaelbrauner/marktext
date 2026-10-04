# Icons

Lucide icons as `:lucide-name:`, with a picker and autocomplete. On by
default. Id: `icons`. The markdown keeps the shortcode; exported HTML and
PDF can show the SVG.

```markdown
Home :lucide-house: and a warning :lucide-triangle-alert:.
```

The opening `:` must not be glued to a letter or digit (`12:lucide-x:` stays
text). An unknown name is not a broken icon: it falls through to the emoji
rule, if any. In the editor the shortcode hides while the caret is outside
and the icon is drawn in its place. Inside a code block the shortcode stays
text.

There is only the Lucide pack. Search matches the name, Lucide tags, and
Portuguese synonyms, without accents (`coracao` finds `heart` when that
synonym exists).

## Insert

| Id | Shortcut | Name |
| --- | --- | --- |
| `icons.insert` | `Ctrl+Alt+Shift+I` / `Cmd+Alt+Shift+I` | Insert Icon |

`Ctrl+Shift+I` already inserts an image, so the icon command adds Alt. In
the picker: arrow keys, Enter inserts, Esc closes. Typing `:lucide-` also
opens the list, at most 50 items.

## Export

| `exportMode` | Default | Effect |
| --- | --- | --- |
| `svg` | yes | `<svg class="mt-icon">` at 1em, color `currentColor` |
| `shortcode` | | the text `:lucide-name:` |

There is no size or color setting beyond that.

The pack loads the first time a shortcode or the picker is used.
