# Testing

From the repo root, or from `packages/desktop` with
`pnpm -C packages/desktop`.

| Command | What runs |
| --- | --- |
| `pnpm test` | Desktop Vitest |
| `pnpm test:unit` | `vitest run test/unit` |
| `pnpm -C packages/desktop exec vitest run test/unit/specs/plugins` | Plugins only |
| `pnpm test:e2e` | Playwright in `packages/desktop/test/e2e` |
| `pnpm typecheck` | Muya and desktop types |
| `pnpm lint` | ESLint at the repo root |

Plugin unit tests live in
`packages/desktop/test/unit/specs/plugins/<id>/`. Shared parsers are in
`test/unit/specs/markdown-ext-parsers.spec.ts` and
`test/unit/specs/vault-index.spec.ts`.

The fixture vault `packages/desktop/test/fixtures/vault` is byte-exact and
prettier-ignored. Do not reformat it.

## e2e

`packages/desktop/test/e2e/helpers.ts` exports `launchElectron`,
`launchWithMarkdown`, and `launchWithDoc`. Each launch gets a temporary
`--user-data-dir`, removed when the process exits.

```ts
import { launchElectron, launchWithMarkdown } from './helpers'

const launched = await launchElectron([vaultDir], {
  preferences: { language: 'en' },
  plugins: {
    enabled: { grammar: true },
    settings: { grammar: { server: 'custom', serverUrl: lt.url, consentGiven: true } }
  }
})
```

`preferences` is written as `preferences.json` before launch. Omitted keys
get the app default. `plugins` is written as `plugins.json` in the shape
`{ enabled, settings }`. Do not seed `secrets.json` through this helper: an
API key is not an ordinary setting.

Assertions on English UI strings need `preferences: { language: 'en' }`.
First launch follows the system language; on this machine that is pt-BR, and
a Portuguese UI breaks a test that looks for an English string.

Plugin specs already in the repo: `plugin-links`, `plugin-tags`,
`plugin-daily-notes`, `plugin-dataview`, `plugin-kanban`, `plugin-grammar`,
`plugin-icons`, `plugin-pdf-reader`.

Two older failures are locale-only and are not these plugins:
`i18n-shell.spec.ts`, and the find-replace regex error string.

`suppressErrorDialog: true` sets `MARKTEXT_ERROR_INTERACTION=1` and the
`expectNoRendererErrors` counter. Use it only in a spec that wants that
counter; otherwise a renderer error should still surface as a dialog.
