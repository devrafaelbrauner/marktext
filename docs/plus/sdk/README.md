# SDK de plugins da comunidade

Plugins da comunidade rodam num `<iframe sandbox="allow-scripts">` sem preload,
num endereço opaco, carregados pelo esquema `mt-plugin://<id>/`. O processo
principal só serve ficheiros da pasta `<userData>/plugins/<id>/`. O plugin não
vê `window.electron`, o DOM do anfitrião nem a rede, excepto o que o manifesto
declara e o utilizador aceita.

O cliente é `@marktext-plus/plugin-sdk`. O anfitrião é a autoridade do
protocolo 1 (`packages/desktop/src/shared/plugins/community.ts`).

## Instalar

Preferências → Plugins → Comunidade. Pasta ou `.zip`. O plugin fica desligado.
Activar mostra as permissões. `--safe` deixa todos os plugins da comunidade
desligados. Desinstalar apaga a pasta.

Limites do pacote: zip até 32 MiB, conteúdo descomprimido até 64 MiB, ficheiro
até 8 MiB. Caminhos com `..`, absolutos e symlinks que saem da pasta são
recusados.

## manifest.json

```json
{
  "id": "word-counter",
  "name": "Word counter",
  "version": "1.0.0",
  "minAppVersion": "0.21.0",
  "author": "Autor",
  "description": { "en": "Counts words", "pt": "Conta palavras" },
  "main": "main.js",
  "permissions": ["editor:read", "ui:sidebar"],
  "panels": [
    { "id": "word-counter", "title": "Word count", "icon": "<svg></svg>", "entry": "panel.html" }
  ],
  "settings": [{ "key": "countCode", "label": "Count code", "type": "boolean", "default": true }]
}
```

`id` é kebab-case e não pode coincidir com um plugin integrado. `description`
é uma string ou `{ en, pt }`. `settings` usa o mesmo esquema das preferências
(`boolean`, `string`, `number`, `enum`, `stringList`, `secret`). Um `secret`
pode ser gravado nas preferências, mas o plugin da comunidade não o lê.

## Permissões e métodos RPC

Comandos, `notify` e settings não pedem permissão.

| Método                                                                                                                                                                                             | Permissão                           |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| `commands.register`, `dispose`, `notify`, `settings.get`, `settings.set`, `settings.subscribe`, `ui.openSettings`                                                                                  | sempre                              |
| `editor.getMarkdown`, `editor.getActiveTab`, `editor.getCheckableBlocks`, `editor.subscribeContent`, `editor.subscribeActiveTab`, `editor.subscribeSetContent`, `editor.registerCodeBlockRenderer` | `editor:read`                       |
| `editor.insertText`, `editor.replaceRange`                                                                                                                                                         | `editor:write`                      |
| `editor.setDecorations`, `editor.clearDecorations`, `editor.subscribeDecorationClick`                                                                                                              | `editor:decorate`                   |
| `vault.readText`, `vault.readBinary`, `vault.exists`, `vault.list`                                                                                                                                 | `vault:read`                        |
| `vault.writeText`, `vault.createText`                                                                                                                                                              | `vault:write`                       |
| `metadata.isReady`, `metadata.getFile`, `metadata.listFiles`, `metadata.resolveLink`, `metadata.getBacklinks`, `metadata.getTags`, `metadata.getFilesWithTag`, `metadata.subscribe`                | `metadata:read`                     |
| `net.fetch`                                                                                                                                                                                        | `network:<host>` do hostname do URL |
| `ui.registerSidebarPanel`, `ui.revealSidebarPanel`                                                                                                                                                 | `ui:sidebar`                        |
| `ui.registerStatusBarItem`, `ui.updateStatusBarItem`                                                                                                                                               | `ui:statusbar`                      |
| `clipboard.writeText`                                                                                                                                                                              | `clipboard:write`                   |

`network:api.example.com` não cobre subdomínios. HTTP só para loopback, pela
mesma `safeFetch` dos plugins integrados.

O anfitrião chama o plugin com `command.run`, `codeblock.render` e
`codeblock.exportHtml`. Eventos: `settings:change`, `editor:content-change`,
`editor:active-tab`, `editor:set-content`, `editor:decoration-click`,
`metadata:ready`, `metadata:change`, `host:language`, `host:shutdown`.

Um método sem permissão responde `{ ok: false, error: { code: "PERMISSION_DENIED" } }`.

## Limites da v1

Sem sintaxe inline e sem componentes Vue. Um renderer de bloco de código
devolve HTML; o anfitrião sanitiza com DOMPurify antes de inserir. A barra de
estado é texto e tooltip. Decorações só com as classes `spelling`, `grammar`,
`style` e `info`. O id de um comando tem de começar por `<id>.`.

A activação tem 10 s. Crash ou timeout desliga o plugin e notifica.

## Modelo

`templates/community-plugin` é o contador de palavras (Vite + TypeScript).
`pnpm build` gera `dist/word-counter.zip`. O painel é outro iframe com
`definePanel`.
