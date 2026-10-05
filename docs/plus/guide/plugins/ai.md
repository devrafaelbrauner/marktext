# AI (OpenRouter)

Fixes text, creates tables, does math, and answers questions with the AI
model you choose on [OpenRouter](https://openrouter.ai), using your own key.
**Off** until you enable it in Preferences → Plugins: it sends text to a
server.

Id: `ai`. It only works in the visual editor's markdown tab.

## Setup

1. In Preferences → Plugins, enable **AI (OpenRouter)**.
2. Create a key at <https://openrouter.ai/keys> and paste it into
   **OpenRouter API key** (`apiKey`). It is stored encrypted in
   `secrets.json` and is not shown again.
3. In **Default model** (`defaultModel`) paste a model id copied from
   <https://openrouter.ai/models>, for example `anthropic/claude-sonnet-4` or
   `openai/gpt-4o-mini`. The app fetches no model list: the id is free text
   and only OpenRouter checks it, on the request.
4. Optional: each command has its own model field (`fixTextModel`,
   `createTableModel`, `solveMathModel`, `researchModel`). Empty uses the
   default model.

For web search, append `:online` to the id (an OpenRouter feature), for
example `openai/gpt-4o-mini:online` as the **Research** model.

## Commands

Command palette. None has a shortcut.

| Id               | Name             | What it does                                 |
| ---------------- | ---------------- | -------------------------------------------- |
| `ai.fixText`     | AI: Fix text     | Replaces the text with the corrected version |
| `ai.createTable` | AI: Create table | Inserts a table below                        |
| `ai.solveMath`   | AI: Calculate    | Inserts the result below                     |
| `ai.research`    | AI: Research     | Inserts the answer below                     |

Input: the selection (it survives the palette taking focus) or, with just a
caret, the whole paragraph, heading, or table cell at the caret.

Examples:

- Select `Eu vai na escola` → **AI: Fix text** → `Eu vou na escola`.
- Caret on a line `2+2*2` → **AI: Calculate** → `6` appears on the line
  below.
- Caret on a line like `Populations of São Paulo, Rio and Belo Horizonte` →
  **AI: Create table** → a Markdown table appears below.
- Caret on a question → **AI: Research** → the answer appears below.

**Fix text** sends one request per selected block (at most 20 blocks). Each
correction is its own undo step and keeps the surrounding whitespace. If the
block changed while the model was answering, the correction is not applied.

**Create table**, **Calculate**, and **Research** send the selected text as
one request (at most 20 000 characters). The reply is parsed as Markdown and
inserted as new blocks _after_ the top-level block that contains the end of
the selection; the prompt text stays. It is all one undo step. If that block
changed in the meantime, the answer goes after the caret block.

## Consent

Before the first request, **Send text to OpenRouter?** appears, showing the
server and the model. Nothing is sent before consent, key, and model are set.
Accepting writes `consentGiven: true` to `plugins.json`. To withdraw, turn off
**Allow sending text to OpenRouter**.

## What leaves the machine

Only the main process talks to the network. Only the command's text is sent:
the selection or the caret block. Only checkable blocks are sent (paragraphs,
headings, table cells); front matter, code, math, and HTML never are. The
file path and other notes are not sent.

OpenRouter forwards the text to the provider of the chosen model. How the
text is used depends on OpenRouter's and that provider's policies.

## Cost

OpenRouter bills per token on your account, at the model's price. The app
shows neither cost nor balance. With no credits left, the request fails with
an error.

## Errors and limits

A missing or invalid key, model, or URL, a rejected key, or an unknown model
shows a notification and opens Preferences on the plugin settings.

| Case                               | Result                                                      |
| ---------------------------------- | ----------------------------------------------------------- |
| 401                                | Key rejected                                                |
| 402                                | No credits                                                  |
| 403                                | Refused (forbidden or moderation)                           |
| 404, or 400 "not a valid model ID" | Model not found                                             |
| 429, 502, 503, network failure     | Retried with backoff (honours `Retry-After`); then an error |
| Other 5xx                          | Server error                                                |
| No answer in 60 s                  | Timeout, not retried                                        |

The app allows 20 requests per minute. The reply arrives whole, no
streaming. Only one AI command runs at a time.

## Settings

| Key                | Default                        | Effect                                                     |
| ------------------ | ------------------------------ | ---------------------------------------------------------- |
| `apiKey`           | not set                        | Secret                                                     |
| `defaultModel`     | empty                          | Model id for every command                                 |
| `fixTextModel`     | empty                          | Fix text model                                             |
| `createTableModel` | empty                          | Create table model                                         |
| `solveMathModel`   | empty                          | Calculate model                                            |
| `researchModel`    | empty                          | Research model                                             |
| `baseUrl`          | `https://openrouter.ai/api/v1` | Only for a compatible proxy; `http://` only to `localhost` |
| `consentGiven`     | off                            | Permission to send                                         |
