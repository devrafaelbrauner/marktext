# Building

Requirements, from the root `package.json`:

- Node.js `>= 20.19.0`
- pnpm `>= 10` (the repo pins `pnpm@10.33.4`)
- Python `>= 3.12` (node-gyp) and a C++ compiler

There is no `.nvmrc`. Pull-request CI uses Node 22.21.1.

```bash
corepack enable
corepack prepare pnpm@10.33.4 --activate
pnpm install
pnpm dev
```

`pnpm install` runs `postinstall`: it downloads Electron, applies patches,
rebuilds native modules, and generates `@muyajs/core` types.

## Scripts that exist

Run them from the repo root. They delegate to the `marktext` package
(`packages/desktop`).

| Command | What it does |
| --- | --- |
| `pnpm dev` | Development mode (`electron-vite dev`), with reload |
| `pnpm start` | Opens an already built bundle (`electron-vite preview`) |
| `pnpm build` | Writes the bundle to `packages/desktop/out/` only. No installer |
| `pnpm build:unpack` | Minifies locales and writes the same bundle |
| `pnpm build:mac` | macOS installer under `dist/` (`build:mac:x64`, `build:mac:arm64`) |
| `pnpm build:win` | Windows installer (`build:win:x64`, `build:win:arm64`) |
| `pnpm build:linux` | Linux packages |
| `pnpm lint` | ESLint at the repo root |
| `pnpm typecheck` | Muya types and desktop `vue-tsc` |
| `pnpm test` | Desktop unit tests (Vitest) |
| `pnpm test:e2e` | Playwright, from `packages/desktop` |
| `pnpm check` | `lint`, then `typecheck` |

The installer lands in `dist/` at the repo root (electron-builder writes to
`../../dist` from `packages/desktop`).

On Linux, development libraries are listed in
`packages/website/content/docs/dev/BUILD.md` (libX11, libxkbfile, libsecret,
fontconfig). That older page says `pnpm run build` produces the installer.
The `build` script in `package.json` does not. Use `build:linux`,
`build:mac`, or `build:win`.

## Development and `--safe`

Under `pnpm dev` the process replaces its arguments with
`--user-data-dir <appData>/marktext-dev`. Extra flags, including `--safe`,
never reach the app. Development data lives in `marktext-dev`, not in the
normal MarkText folder.

To try `--safe`, run the packaged binary, or `pnpm start` after a build,
and pass the flag to the executable.
