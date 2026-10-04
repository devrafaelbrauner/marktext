# Onde ficam os dados

A pasta de dados do usuário é a do Electron para o aplicativo `marktext`, a
menos que você mude:

| Sistema | Caminho padrão |
| --- | --- |
| macOS | `~/Library/Application Support/marktext` |
| Windows | `%APPDATA%\marktext` |
| Linux | `$XDG_CONFIG_HOME/marktext` ou `~/.config/marktext` |

Outros lugares:

- `--user-data-dir <pasta>` — absoluta; plugins, segredos e o índice vão junto.
- Modo portátil — se existir `marktext-user-data` ao lado do binário (dois
  níveis acima de `app.getAppPath()`), ela vira a pasta de dados.
- `pnpm dev` — `<appData>/marktext-dev`, não a pasta normal.

## Arquivos deste fork

### `plugins.json`

electron-store de nome `plugins`, em `<userData>/plugins.json`. Um arquivo
corrompido é zerado na abertura (`clearInvalidConfig`).

```json
{
  "enabled": { "grammar": true, "links": false },
  "settings": {
    "grammar": { "server": "free", "consentGiven": true },
    "daily-notes": { "folder": "Diario", "format": "YYYY-MM-DD" }
  }
}
```

Um id ausente em `enabled` usa o padrão do manifesto (o corretor começa
desligado; os outros, ligados). Segredos não entram aqui. O consentimento do
corretor é o booleano `settings.grammar.consentGiven`, não um arquivo à parte.

### `secrets.json`

`<userData>/secrets.json`, modo `0600`. Só o processo principal lê o texto
claro. Cada valor é ciphertext do `safeStorage` do Electron (base64),
agrupado pelo id do plugin:

```json
{ "grammar": { "apiKey": "<base64>" } }
```

Hoje o único segredo é a chave de API do corretor. O e-mail da conta fica em
`plugins.json`, no campo `username`. No Linux o aplicativo recusa gravar se o
backend for só `basic_text` (chave fixa do Chromium).

### Cache do índice

Pasta `<userData>/vault-index/`. Um arquivo por pasta aberta:

```text
vault-index/<sha1 do caminho absoluto da pasta>.json
```

Não existe um único `vault-index.json`. O conteúdo é
`{ version, rootPath, notes }`, com `version` 1. Se a versão ou a pasta não
baterem, o cache é ignorado e o índice é refeito. Notas markdown maiores que
5 MiB entram na lista com metadados vazios (o arquivo não é lido).

## Outros arquivos na mesma pasta

| Arquivo | Uso |
| --- | --- |
| `preferences.json` | Preferências gerais (electron-store `preferences`) |
| `keybindings.json` | Atalhos do usuário; ignorado com `--safe` |
| `recently-used-documents.json` | Documentos recentes |
| `dataCenter.json` | Pastas de imagens e capturas |
| `editorStates/` | Estado das abas |
| `logs/<ano><mês>/` | Logs; o mês não leva zero à esquerda |

O código ainda aponta `EnvPaths.preferencesFilePath` para `preference.json`
(singular). Esse caminho não é o que o aplicativo grava. O arquivo vivo é
`preferences.json`. O `preference.json` dentro de `static/` é só o modelo
embutido, não os dados do usuário.
