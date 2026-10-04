# Safe mode

```bash
marktext --safe
```

The flag is not stored. It applies only to that process. There is no
environment variable equivalent.

## What stops

- No plugin is activated, whether or not it is enabled in `plugins.json`.
- `<userData>/keybindings.json` is not applied.

Preferences → Plugins shows a warning that MarkText was started with
`--safe` and that no plugin is running. Switches and fields stay editable:
the change is saved and takes effect the next time you open the app without
`--safe`.

## What does not stop

The command-line help says “Disable plugins and other user configuration”.
The code does less than that:

- General preferences still load. `packages/desktop/src/main/preferences/index.ts`
  has a `TODO` about skipping them; that is not implemented.
- The system spellchecker is not turned off. That is a different flag:
  `--disable-spellcheck`.
- The folder index is still built.

`--safe` is not a preference. Under `pnpm dev` the flag is dropped; see
[Building](building.md).
