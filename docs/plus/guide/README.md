# MarkText Plus user guide

MarkText Plus is a fork that adds a plugin platform and Obsidian-compatible
vault features: wikilinks, tags, daily notes, Kanban boards, Dataview
queries, Mermaid diagrams, Lucide icons, and a PDF reader. The grammar
checker (LanguageTool) and AI (OpenRouter) send text to a server and stay
off until you enable them.

Built-in plugins ship with the app. Third-party plugins do not run in this
version; the agreed design is in
[Community plugins](../development/community-plugins.md).

Open a folder (File → Open Folder) for backlinks, tags, the calendar,
queries, and links between notes. A lone file is not a vault.

Plugin commands show up in the command palette (`Ctrl+Shift+P` on Windows
and Linux, `Cmd+Shift+P` on macOS).

## In this guide

| Page                                                | Contents                                    |
| --------------------------------------------------- | ------------------------------------------- |
| [Building](building.md)                             | Install dependencies and run this fork      |
| [Android](android.md)                               | APK: build, install, use and differences    |
| [Safe mode](safe-mode.md)                           | What `--safe` actually disables             |
| [Where data lives](data.md)                         | `plugins.json`, `secrets.json`, index cache |
| [Preferences → Plugins](preferences.md)             | Enable, disable, settings, and secrets      |
| [Obsidian compatibility](obsidian-compatibility.md) | What round-trips, and what does not         |

### Plugins

| Plugin                                             | On by default |
| -------------------------------------------------- | ------------- |
| [Links](plugins/links.md)                          | yes           |
| [Tags](plugins/tags.md)                            | yes           |
| [Icons](plugins/icons.md)                          | yes           |
| [Calendar and daily notes](plugins/daily-notes.md) | yes           |
| [Dataview](plugins/dataview.md)                    | yes           |
| [Kanban](plugins/kanban.md)                        | yes           |
| [Mermaid](plugins/mermaid.md)                      | yes           |
| [PDF reader](plugins/pdf.md)                       | yes           |
| [Grammar checker](plugins/grammar.md)              | no            |
| [AI (OpenRouter)](plugins/ai.md)                   | no            |

Português: [Guia](../guia/README.md).
