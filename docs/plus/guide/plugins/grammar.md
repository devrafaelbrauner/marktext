# Grammar checker (LanguageTool)

Checks spelling, grammar, and style as you write. Brazilian Portuguese by
default. **Off** until you enable it in Preferences → Plugins: it sends text
to a server.

Id: `grammar`. It only checks the visual editor's markdown tab. Kanban
boards, PDFs, and other plugin views are not checked.

## Three servers

| `server` | Default | Where text goes |
| --- | --- | --- |
| `premium` | yes | `https://api.languagetoolplus.com/v2` |
| `free` | | `https://api.languagetool.org/v2` |
| `custom` | | the URL you set, ending in `/v2` |

The free API is not a fallback when Premium fails. The selected mode is the
one that is called.

Limits the app enforces per minute (a local bucket, not a quota header):

| Server | Requests | Characters | Per-request cap |
| --- | --- | --- | --- |
| Premium | 80 | 300 000 | 60 000 |
| Free | 20 | 75 000 | 20 000 |
| Custom | 80 | 300 000 | 60 000 |

A self-hosted server has no such caps. The app uses the Premium numbers so a
local instance is not throttled below what the cloud allows. On 429 or 503
the request waits for `Retry-After` and tries again.

### Premium

1. Create the key at
   <https://languagetool.org/editor/settings/access-tokens>.
   The app does not open that page; the UI only says “your LanguageTool
   account page”.
2. In **Username (email)** (`username`) put the Premium account email. It is
   sent as the form field `username`. The code does not check that it is an
   email: any non-empty string is accepted.
3. In **API key** (`apiKey`) paste the key and save. It is encrypted into
   `secrets.json` and is never shown again. The email stays in
   `plugins.json`, not in the secrets file.

Without both, the status shows **Set up** and nothing is sent.

If username and key are filled in, they are also attached to free and custom
checks. Only Premium *requires* both.

### Free public API

Set **Server** to `free`. No credentials. Lower limits, above.

### Your own server

Set **Server** to `custom` and fill in **Custom server URL**. The settings
placeholder is `http://localhost:8081/v2`. The app does not ship a container
image or a required port: point the URL at a LanguageTool that exposes
`/v2/check`.

Plain `http://` is accepted only for `localhost`, `127.*` addresses, and
`::1`. A name that merely resolves to this machine does not pass. `https://`
is allowed to any host. Redirects and cookies are rejected. A non-loopback
`http://` URL can be saved and only fails when the request is made.

## Consent

The first check shows **Send text to LanguageTool?**. Accepting stores
`consentGiven: true` in `plugins.json`. Declining stores nothing; the
question comes back on the next “Check document now”.

To withdraw: turn off **Allow sending text to the server**. Limitation: if
you accepted in this session and then turn the switch off without disabling
the plugin, sends in that session continue until the plugin is disabled.

The app has no “LGPD” string. The notice is the dialog: LanguageTool
processes the text only to check it.

## What leaves the machine

Only the main process talks to the network. Nothing is sent before consent.

Checked blocks: paragraphs (including list items and quotes), headings, and
table cells. Never a checkable block:

- front matter
- code, math, diagram, and HTML blocks
- thematic breaks and reference definitions (`[ref]: …`)

A file with `languagetool: false` in YAML front matter is skipped entirely.
`off` and `no` count too, any case. The key must be exactly `languagetool`.
TOML (`+++`) or JSON front matter does not count.

```yaml
---
languagetool: false
---

This file is not sent.
```

What *is* sent, for each checkable block, goes as a LanguageTool annotation:
prose in `text`, markup in `markup`. Link destinations, inline code, inline
math, and opaque HTML are in the POST body as markup, not as text to
correct. Ignored rules and the local dictionary are filtered *after* the
response: the paragraph is still sent.

With Premium, personal-dictionary words are also synced to the account
(`/v2/words`, at most 500). That is a separate send from checking.

Not sent: the file path, other notes, the contents of the excluded blocks
above, or the key to anywhere but the server you chose.

## Using it

The status-bar item shows the language, the count, or an error. Click it to
open the **Problems** panel, settings, or the consent dialog, depending on
the state.

Click an underline for the popover: apply a suggestion (one undo step;
surrounding formatting is kept, `Eu **vai**` becomes `Eu **vou**`), ignore
this occurrence for the rest of the session, ignore the rule (stores the id
in `disabledRules`), or, for a spelling error, add it to the dictionary.

Underline classes: `mu-decoration-spelling`, `mu-decoration-grammar`,
`mu-decoration-style`.

## Settings

| Key | Default | Effect |
| --- | --- | --- |
| `server` | `premium` | Premium, free, or custom |
| `serverUrl` | empty | `/v2` base; custom mode only |
| `username` | empty | Account email; API field `username` |
| `apiKey` | unset | Secret |
| `language` | `pt-BR` | `pt-BR`, `pt-PT`, `en-US`, `en-GB`, `es`, `fr`, `de`, `it`, `nl`, `auto` |
| `level` | `default` | `picky` also asks for style and typography |
| `motherTongue` | `pt-BR` | Code for false friends; empty is not sent |
| `checkOnType` | on | Off: only on open and via the command |
| `debounceMs` | `800` | Wait after the last keystroke; 300–5000 |
| `disabledRules` | `[]` | Rule ids, one per line. `ID[subId]` is honored if you type it |
| `disabledCategories` | `[]` | Category ids, for example `TYPOGRAPHY` |
| `dictionary` | `[]` | Words never reported as misspelled |
| `disableNativeSpellcheck` | on | Avoids double underlines; the system preference returns when this is off |
| `consentGiven` | off | Permission to send text |

With `language` set to `auto` the request sends
`preferredVariants=pt-BR,en-US,de-DE`. LanguageTool spelling depends on a
regional variant; `auto` does not pick a single one.

## Commands

Command palette.

| Id | Shortcut | Name |
| --- | --- | --- |
| `grammar.checkNow` | — | Grammar: Check document now |
| `grammar.nextProblem` | `F8` | Grammar: Go to next problem |
| `grammar.toggle` | — | Grammar: Turn checking on/off |

`F8` is active only if it does not collide with an app shortcut. The toggle
command is not stored: the next launch, with the plugin enabled, checks
again.

## Limitations

- A block larger than the plan cap is not sent, and there is no notice.
- “Ignore” lasts for the session. “Ignore rule” is stored in `plugins.json`.
- Replacing the key without clearing it does not invalidate the result cache.
- At most five suggestions in the popover. “More information” opens `https:`
  URLs only.
- Source mode is not a separate check mode: underlines live on the visual
  editor.
