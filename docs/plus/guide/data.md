# Where data lives

The user-data folder is Electron's folder for the `marktext` app, unless
you move it:

| System | Default path |
| --- | --- |
| macOS | `~/Library/Application Support/marktext` |
| Windows | `%APPDATA%\marktext` |
| Linux | `$XDG_CONFIG_HOME/marktext` or `~/.config/marktext` |

Other locations:

- `--user-data-dir <folder>` — absolute; plugins, secrets, and the index
  move with it.
- Portable mode — if `marktext-user-data` exists beside the binary (two
  levels above `app.getAppPath()`), it becomes the data folder.
- `pnpm dev` — `<appData>/marktext-dev`, not the normal folder.

## Files this fork adds

### `plugins.json`

electron-store named `plugins`, at `<userData>/plugins.json`. A corrupt file
is reset on open (`clearInvalidConfig`).

```json
{
  "enabled": { "grammar": true, "links": false },
  "settings": {
    "grammar": { "server": "free", "consentGiven": true },
    "daily-notes": { "folder": "Daily", "format": "YYYY-MM-DD" }
  }
}
```

An id missing from `enabled` uses the manifest default (the grammar checker
starts off; the others start on). Secrets are not stored here. Grammar
consent is the boolean `settings.grammar.consentGiven`, not a separate file.

### `secrets.json`

`<userData>/secrets.json`, mode `0600`. Only the main process reads
plaintext. Each value is Electron `safeStorage` ciphertext (base64), grouped
by plugin id:

```json
{ "grammar": { "apiKey": "<base64>" } }
```

The only secret today is the grammar checker's API key. The account email
lives in `plugins.json`, in `username`. On Linux the app refuses to store
anything when the only backend is `basic_text` (Chromium's hard-coded key).

### Index cache

Folder `<userData>/vault-index/`. One file per opened folder:

```text
vault-index/<sha1 of the folder's absolute path>.json
```

There is no single `vault-index.json`. The body is
`{ version, rootPath, notes }`, with `version` 1. A mismatched version or
root is ignored and the index is rebuilt. Markdown notes larger than 5 MiB
are listed with empty metadata (the file is not read).

## Other files in the same folder

| File | Use |
| --- | --- |
| `preferences.json` | General preferences (electron-store `preferences`) |
| `keybindings.json` | User shortcuts; skipped with `--safe` |
| `recently-used-documents.json` | Recent documents |
| `dataCenter.json` | Image and screenshot folders |
| `editorStates/` | Tab state |
| `logs/<year><month>/` | Logs; the month is not zero-padded |

`EnvPaths.preferencesFilePath` still points at `preference.json` (singular).
That path is not what the app writes. The live file is `preferences.json`.
`preference.json` under `static/` is the shipped template, not user data.
