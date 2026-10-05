# Community plugins

Agreed design for milestone M7. **Not implemented** in this commit: the host
only activates the ten built-ins. The reference for someone writing a
community plugin is the SDK, not this page:

- [SDK (pt-BR)](../sdk/README.md)
- [SDK (English)](../sdk/README.en.md)

Isolation is real only with `webSecurity: true`. In this commit windows are
still created with `webSecurity: false` (`src/main/config.ts`). Hardening
turns that flag on; the community runtime must set the same line so its
isolation tests mean something.

## What was agreed

Install directory `<userData>/plugins/<id>/`, with `manifest.json`: `id`,
`name`, `version`, `minAppVersion`, `author`, `description` (a string or
`{ en, pt }`), `main`, `permissions`, `panels` (`id`, `title`, `icon`,
`entry`), and `settings` using the same schema as built-ins.

Permissions: `editor:read`, `editor:write`, `editor:decorate`, `vault:read`,
`vault:write`, `metadata:read`, `network:<host>`, `ui:sidebar`,
`ui:statusbar`, `clipboard:write`. Commands, notifications, and settings are
always allowed.

The `mt-plugin://<id>/<path>` scheme is served by main, from that plugin
folder only. Traversal, absolute paths, `..`, and symlinks that escape are
rejected. The response CSP is
`default-src 'none'; script-src mt-plugin://<id>; style-src 'unsafe-inline' mt-plugin://<id>; img-src data: mt-plugin://<id>; connect-src 'none'`.
The renderer CSP gains `frame-src mt-plugin:` and nothing else is relaxed.

Each enabled community plugin gets one
`<iframe sandbox="allow-scripts">` (opaque origin, no preload) loading a
host-generated bootstrap that imports `main`. Panels are further sandboxed
iframes with their own entry HTML.

The bridge: the host posts
`{ type: 'mt-plugin:init', protocol: 1, manifest, language, settings }` and
transfers a `MessagePort`. RPC `{ id, method, args }` answers
`{ id, ok, value | error: { code, message } }`. Events are
`{ event, payload }`. Every method is permission-checked in the host and
executed through the same context built-in plugins use.

v1 limits: no inline syntax and no Vue components. A code block renderer
returns an HTML string the host sanitizes with DOMPurify before insertion.
A status bar item is text and a tooltip only. Decorations only with the
fixed classes `spelling`, `grammar`, `style`, plus an `info` class.

Activation times out at 10 s. A crash or a timeout disables the plugin and
notifies. `--safe` disables every community plugin. Uninstall removes the
folder.

The installer accepts a folder or a `.zip`, zip-slip safe, with size caps,
a validated manifest, and rejection of an id that collides with a built-in.
Install lands disabled. Permissions are shown in Portuguese and English.
Enabling shows a consent dialog listing them.
