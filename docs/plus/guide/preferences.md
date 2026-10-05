# Preferences → Plugins

Open Preferences and choose **Plugins** in the sidebar. The route is
`/preference/plugins`. A plugin can open its own card
(`/preference/plugins/<id>`), which scrolls to that card.

The page lists the ten built-in plugins, in registration order. You cannot
reorder them or install another plugin from here.

Each card shows the name, version `1.0.0`, the description, and an
**Enabled** switch. Turning one off stops its code immediately. Plugins that
change how markdown is read (`links`, `tags`, `icons`, `kanban`) reload open
documents into the editor. An app restart is not required.

## Settings

The form is rendered from the manifest. The plugin does not ship code into
the Preferences window.

| Type        | Control                                        |
| ----------- | ---------------------------------------------- |
| boolean     | switch                                         |
| string      | field; saved on change                         |
| number      | number field, with min, max, and step when set |
| enum        | menu                                           |
| string list | one entry per line                             |
| secret      | password field, Save and Clear                 |

Over-long text is rejected (10 000 characters; a list of at most 1 000
items). A value that does not match the field pattern is rejected too. The
message is “Could not save…”.

Two plugins have a secret: the grammar checker (**API key**) and AI
(**OpenRouter API key**). The renderer only knows
whether it is set. Plaintext stays in the main process, in
[`secrets.json`](data.md). Saving again replaces it; Clear deletes it. The
field does not show the previous value.

Other fields go to `plugins.json` as soon as you change them. There is no
global Apply button.

## Safe mode

If the app was started with `--safe`, a yellow warning says that no plugin
is running. Switches and fields still save. See [Safe mode](safe-mode.md).

## UI language

The Plugins page chrome exists in all 12 app languages. Each plugin's name,
description, and setting labels exist in English and Portuguese. In every
other UI language those labels fall back to English.
