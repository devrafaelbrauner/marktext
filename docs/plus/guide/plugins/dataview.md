# Dataview

Shows TABLE, LIST, and TASK queries written in `dataview` code blocks,
computed from the notes of the open folder. On by default. Id: `dataview`.
No settings and no commands.

The block stays a code block. The preview is drawn below it, and HTML/PDF
export includes the table, not the query. There is no DataviewJS and no
inline query (`= this`).

````markdown
```dataview
TABLE status, priority
FROM "Projects"
WHERE status = "open"
SORT priority DESC
LIMIT 20
```
````

The query is case-insensitive for keywords. `TABLE` and `table` are the same.

## What the language accepts

```text
TABLE [WITHOUT ID] field, expression AS "Name"
LIST  [WITHOUT ID] [expression]
TASK
FROM source
WHERE expression
SORT expression [ASC|DESC], …
LIMIT integer
```

`FROM` may appear once, before the other clauses. Clauses run in written
order: `LIMIT` before `SORT` cuts first, then sorts what remains.

`TASK` does not take an expression after the type. There is no `CALENDAR`,
`GROUP BY`, or `FLATTEN`.

### Sources

| Written | Selects |
| --- | --- |
| `#project` | the tag and its children (`#project/alpha`), case-insensitive |
| `"Daily"` | a folder prefix, or an exact note path, with or without `.md` |
| `[[Alpha]]` | notes that link to Alpha (resolved, or the written target if it does not resolve) |
| `outgoing([[Home]])` | notes Home links to |

`AND` / `OR` / `NOT` (also `-` and `!`). `NOT` binds tighter than `AND`,
which binds tighter than `OR`. Parentheses work. There is no `incoming()`.
An unquoted path is not a source.

```dataview
LIST FROM #project AND -"Archive"
LIST FROM ("Daily" OR "Archive") AND NOT [[Home]]
```

### Fields

Each note is an object. Front-matter keys and inline fields become
properties. A repeated inline key, or an inline key that repeats a
front-matter key, becomes a list.

Inline fields, as the index reads them:

```markdown
status:: open
- [ ] Ship [due:: 2026-10-04]
```

The key is lower-cased. `key:: value` on its own line, or `[key:: value]`
and `(key:: value)`. `[[note::x]]` is a wikilink, not a field.

`file` has: `name`, `path`, `folder`, `ext`, `link`, `size`, `ctime`,
`mtime`, `cday`, `mday`, `tags` (the tag and its parents, with `#`), `etags`
(the leaf only, with `#`), `inlinks`, `outlinks`, `aliases`, `tasks`, `day`
(`YYYY-MM-DD` when the file name is that date, otherwise null),
`frontmatter`.

`this` is the note that holds the query. `row` is the current row. Those two
names are case-sensitive. Other fields are not: a space becomes `-`.

On a task: `text`, `status` (the character in the brackets), `checked`,
`completed` (`x` or `X` only), `fullyCompleted`, `line`, `path`, `link`,
`tags`, and the note's `file`. Clicking the checkbox writes `[x]` or `[ ]`.

### Expressions

Comparisons `=` `!=` `<` `<=` `>` `>=`. `and` / `or` (also `&` and `|`).
`+` `-` `*` `/` `%`. Unary `!` and `-`. `.field` and `[index]`. Lists
`[1, "a", true, null]`. Strings are double-quoted only.

Dates: `date(2026-10-04)`, `date(today)`, `date(now)`, `tomorrow`,
`yesterday`, `sow`, `eow`, `som`, `eom`, `soy`, `eoy`. `date(today)` is a
date; a bare `today` is a field name.

Durations: `dur(1 day)`, `dur(1 week, 2 days)`. Units: year, month, week,
day, hour, minute, second, and the abbreviations `y` `mo` `w` `d` `h` `m`
`s`.

Functions: `contains`, `length`, `lower`, `upper`, `default`, `choice`,
`round`, `min`, `max`, `sum`, `typeof`, `startswith`, `endswith`, `date`,
`dur`, `link`, `number`, `string`, `list`, `join`. `contains` is a function,
not an operator: `contains(file.tags, "#idea")`.

```dataview
TABLE file.folder, status
FROM "Projects"
WHERE contains(file.tags, "#project") AND due <= date(today)

TASK
FROM #project
WHERE !completed
SORT due ASC
```

Clicking a note link opens the file. A heading becomes an anchor. `^block`
opens the file without scrolling to the block. A PDF `page=` is passed to
the reader.

## Limits

- A query longer than 20 000 characters is rejected.
- The table shows the first 1 000 results and reports the total.
- A query that takes too long asks you to narrow it with `FROM` or `WHERE`.

## What is not implemented

DataviewJS, `CALENDAR`, `GROUP BY`, `FLATTEN`, regex, single quotes, query
comments, object literals `{…}`, lambdas, and any function outside the list.
There is no plugin settings panel.
