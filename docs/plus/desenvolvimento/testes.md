# Testes

Na raiz, ou em `packages/desktop` com `pnpm -C packages/desktop`.

| Comando | O que roda |
| --- | --- |
| `pnpm test` | Vitest do desktop |
| `pnpm test:unit` | `vitest run test/unit` |
| `pnpm -C packages/desktop exec vitest run test/unit/specs/plugins` | Só os plugins |
| `pnpm test:e2e` | Playwright em `packages/desktop/test/e2e` |
| `pnpm typecheck` | Tipos do Muya e do desktop |
| `pnpm lint` | ESLint na raiz |

Testes unitários dos plugins:
`packages/desktop/test/unit/specs/plugins/<id>/`. Os analisadores
compartilhados estão em `test/unit/specs/markdown-ext-parsers.spec.ts` e
`test/unit/specs/vault-index.spec.ts`.

O cofre de fixture `packages/desktop/test/fixtures/vault` é byte a byte e
está no `.prettierignore`. Não o reformatar.

## e2e

`packages/desktop/test/e2e/helpers.ts` exporta `launchElectron`,
`launchWithMarkdown` e `launchWithDoc`. Cada lançamento ganha um
`--user-data-dir` temporário, apagado ao sair do processo.

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

`preferences` vira `preferences.json` antes da abertura. Chaves omitidas
recebem o padrão do aplicativo. `plugins` vira `plugins.json` no formato
`{ enabled, settings }`. Não plante `secrets.json` por esse helper: a chave
de API não é um setting comum.

Asserções de texto em inglês precisam de `preferences: { language: 'en' }`.
A primeira abertura segue o idioma do sistema; neste ambiente isso é pt-BR,
e a interface em português quebra um teste que procura uma string inglesa.

Specs de plugin já no repositório: `plugin-links`, `plugin-tags`,
`plugin-daily-notes`, `plugin-dataview`, `plugin-kanban`, `plugin-grammar`,
`plugin-icons`, `plugin-pdf-reader`.

Dois fracassos antigos, só de locale, não são destes plugins:
`i18n-shell.spec.ts` e a string de erro de regex do localizar/substituir.

`suppressErrorDialog: true` liga `MARKTEXT_ERROR_INTERACTION=1` e o contador
`expectNoRendererErrors`. Use só em spec que queira esse contador; nos
outros, um erro do renderer deve continuar aparecendo como diálogo.
