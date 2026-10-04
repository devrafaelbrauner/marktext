# Compilação

Requisitos, do `package.json` da raiz:

- Node.js `>= 20.19.0`
- pnpm `>= 10` (o repositório fixa `pnpm@10.33.4`)
- Python `>= 3.12` (node-gyp) e um compilador C++

Não há `.nvmrc`. O CI de pull request usa Node 22.21.1.

```bash
corepack enable
corepack prepare pnpm@10.33.4 --activate
pnpm install
pnpm dev
```

`pnpm install` roda o `postinstall`: baixa o Electron, aplica patches,
recompila nativos e gera os tipos do `@muyajs/core`.

## Scripts que existem

Rode na raiz. Eles delegam para o pacote `marktext` (`packages/desktop`).

| Comando | O que faz |
| --- | --- |
| `pnpm dev` | Modo de desenvolvimento (`electron-vite dev`), com recarga |
| `pnpm start` | Abre o bundle já gerado (`electron-vite preview`) |
| `pnpm build` | Só gera o bundle em `packages/desktop/out/`. Não cria instalador |
| `pnpm build:unpack` | Minifica locales e gera o mesmo bundle |
| `pnpm build:mac` | Instalador macOS em `dist/` (`build:mac:x64` e `build:mac:arm64`) |
| `pnpm build:win` | Instalador Windows (`build:win:x64`, `build:win:arm64`) |
| `pnpm build:linux` | Pacotes Linux |
| `pnpm lint` | ESLint na raiz |
| `pnpm typecheck` | Tipos do Muya e `vue-tsc` do desktop |
| `pnpm test` | Testes unitários do desktop (Vitest) |
| `pnpm test:e2e` | Playwright, em `packages/desktop` |
| `pnpm check` | `lint` e depois `typecheck` |

O instalador sai em `dist/` na raiz (o electron-builder grava em `../../dist`
a partir de `packages/desktop`).

No Linux, as bibliotecas de desenvolvimento estão em
`packages/website/content/docs/dev/BUILD.md` (libX11, libxkbfile, libsecret,
fontconfig). Esse arquivo antigo diz que `pnpm run build` gera o instalador;
o script `build` do `package.json` não faz isso. Use `build:linux`,
`build:mac` ou `build:win`.

## Desenvolvimento e `--safe`

Em `pnpm dev` o processo substitui os argumentos por
`--user-data-dir <appData>/marktext-dev`. Flags extras, inclusive `--safe`,
não chegam ao aplicativo. Os dados de desenvolvimento ficam em
`marktext-dev`, não na pasta normal do MarkText.

Para testar `--safe`, rode o binário empacotado ou `pnpm start` depois do
build, passando a flag ao executável.
