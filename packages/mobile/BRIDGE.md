# Bridge Android (MarkText Plus)

O renderer e o preload do desktop rodam sem alterações dentro do WebView do Capacitor. O processo main do Electron é substituído pelo "main móvel" (`src/main/`), que registra handlers nos mesmos canais IPC, mais plugins nativos (`android/app/src/main/java/app/marktextplus/android/`).

Este documento é conferido por `test/bridge.spec.ts`:

- todo canal de `packages/desktop/src/shared/types/ipc.ts` tem exatamente uma linha;
- uma linha com status **Implementado** ou **Sem efeito no Android** existe se e somente se o boot registra um handler para o canal;
- os 15 globais do preload aparecem na tabela de globais.

Se um handler entrar ou sair, atualize a linha correspondente, senão o teste falha.

## Status

| Status                | Significado                                                                                                         |
| --------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Implementado          | handler registrado com o comportamento do desktop ou o equivalente Android descrito                                 |
| Sem efeito no Android | handler registrado que não faz nada, porque o recurso não existe no Android (menus nativos, janelas, recentes)      |
| Não suportado         | nenhum handler: `invoke` rejeita com "No handler registered" como no Electron; `send` gera um aviso único no Logcat |

## Caminhos

O renderer só vê caminhos POSIX absolutos virtuais (`window.path` é o pathe):

| Caminho                   | Origem                                                                                                                                |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `/data/marktext/...`      | `Context.getFilesDir()`: preferências, `dataCenter.json`, `keybindings.json`, `buffer.json`, imagens                                  |
| `/vault/<key>/<nome>/...` | árvore SAF concedida (`ACTION_OPEN_DOCUMENT_TREE`, permissão persistida); `<key>` = 8 hex do SHA-256 do URI, `<nome>` = nome da pasta |
| `/doc/<key>/<nome>`       | documento avulso (`ACTION_OPEN_DOCUMENT` / `ACTION_CREATE_DOCUMENT`)                                                                  |

O escopo de `mt::fs::*` segue o desktop (`src/main/scope.ts`): a pasta aberta, as pastas dos documentos abertos, documentos escolhidos em seletores, as pastas de imagem e as subpastas do app em `/data/marktext` (`images`, `screenshot`, `themes`, `logs`, `editorStates`, `vault-index`). A raiz `/data/marktext` fica fora. Fora do escopo, predicados respondem `false` e o resto rejeita com `PERMISSION_DENIED`.

Imagens locais: `toMtFileUrl` (`common/mtFileUrl.ts`) recebe um construtor de URL no boot móvel. No APK, a URL é `https://vault.local/<caminho virtual codificado>`, servida por `VaultRequestHandler`: só extensões de imagem, 404 se não existe, 403 fora das permissões, sem listagem de diretório. No build de navegador, a URL é um `blob:` do backend em memória. Caminhos UNC e `//host` continuam rejeitados.

## Arquivos Markdown

`src/main/markdownFile.ts` porta `loadMarkdownFile`/`writeMarkdownFile` do desktop para bytes:

- BOM UTF-8, UTF-16 LE e UTF-16 BE são detectados e restaurados ao salvar.
- Bytes que não são UTF-8 válido (com `autoGuessEncoding`) são lidos como Windows-1252. O addon `ced` do desktop é nativo; Windows-1252 mapeia todos os bytes, então nada se perde no round-trip.
- Ao salvar, são gravados UTF-8 (com ou sem BOM), UTF-16 LE/BE e Windows-1252. Outra codificação falha com `UnsupportedEncodingError`, mostrada pelo renderer via `mt::tab-save-failure`.
- LF/CRLF, `adjustLineEndingOnSave` e `trimTrailingNewline` seguem o desktop.
- Escrita atômica: em `/data/marktext`, temporário + rename. Em árvores SAF, temporário irmão + `DocumentsContract.renameDocument` quando o provedor suporta rename; senão, `openOutputStream(uri, "wt")`. Documentos `/doc` usam sempre `"wt"`, porque substituir o documento invalidaria a permissão persistida.

## Globais do preload

| Global                 | Status                | Observação                                                                                                                                                                                                                                    |
| ---------------------- | --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `window.electron`      | Implementado          | `ipcRenderer` → `src/main/ipc.ts`; `webFrame.setZoomFactor` usa CSS `zoom`; `webUtils.getPathForFile` devolve `''`, porque arquivos de outros apps não têm caminho; `shell`, `clipboard`, `windowControl` e `dialog` seguem as tabelas abaixo |
| `window.process`       | Implementado          | vem de `mt::boot-info`: `platform: 'linux'` mantém os ramos não-mac/não-win; `env.MARKTEXT_PLATFORM = 'android'`                                                                                                                              |
| `window.rgPath`        | Sem efeito no Android | `''`: não há binário do ripgrep                                                                                                                                                                                                               |
| `window.fileUtils`     | Implementado          | canais `mt::fs::*` abaixo; os predicados puros rodam no preload                                                                                                                                                                               |
| `window.path`          | Implementado          | pathe (puro, preload)                                                                                                                                                                                                                         |
| `window.commandExists` | Não suportado         | `mt::cmd::exists` sem handler                                                                                                                                                                                                                 |
| `window.i18nUtils`     | Implementado          | `mt::i18n::load`                                                                                                                                                                                                                              |
| `window.ripgrep`       | Não suportado         | `mt::rg::*` sem handler (busca usa o índice do vault)                                                                                                                                                                                         |
| `window.uploader`      | Não suportado         | `mt::uploader::upload` sem handler                                                                                                                                                                                                            |
| `window.fonts`         | Não suportado         | `mt::fonts::list` sem handler                                                                                                                                                                                                                 |
| `window.diagram`       | Não suportado         | `mt::diagram::fetch-plantuml` sem handler                                                                                                                                                                                                     |
| `window.plugins`       | Não suportado         | `mt::plugins::*`: fatia Plugins                                                                                                                                                                                                               |
| `window.community`     | Não suportado         | `mt::community::*`: fatia Plugins                                                                                                                                                                                                             |
| `window.vault`         | Não suportado         | `mt::vault::*`: fatia Plugins                                                                                                                                                                                                                 |
| `window.vaultIndex`    | Não suportado         | `mt::index::*`: fatia Plugins                                                                                                                                                                                                                 |

## Push (main → renderer) emitidos pelo main móvel

`mt::user-preference`, `mt::current-language`, `language-changed`, `mt::bootstrap-editor` (logo após o primeiro `mt::user-preference` da janela 1, para não ser descartado), `mt::keybindings-response`, `mt::open-directory`, `mt::update-object-tree` (varredura inicial com pastas antes do conteúdo; depois diffs após cada mutação do app e ao voltar ao primeiro plano), `mt::open-new-tab`, `mt::switch-tab-by-file_path`, `mt::open-asset-tab`, `mt::set-pathname`, `mt::tab-saved`, `mt::tab-save-failure`, `mt::force-close-tabs-by-id`, `mt::load-state`, `mt::update-file` (polling de 5 s dos documentos abertos enquanto visível, mais um ao voltar ao primeiro plano: SAF não notifica mudanças), `mt::show-notification`, `mt::editor-ask-file-save` e `mt::editor-ask-file-save-as` (atalhos de teclado físico `file.save` e `file.save-as` do mapa de atalhos).

## Canais IPC

### Boot

| Canal                 | Tipo   | Status       | Observação                                                                             |
| --------------------- | ------ | ------------ | -------------------------------------------------------------------------------------- |
| `mt::boot-info-async` | invoke | Implementado | mesmo objeto do canal síncrono                                                         |
| `mt::boot-info`       | sync   | Implementado | platform `linux`, userData `/data/marktext`, env `MARKTEXT_PLATFORM=android` (boot.ts) |

### Preferências, idioma e atalhos

| Canal                                     | Tipo   | Status        | Observação                                                                                                                                           |
| ----------------------------------------- | ------ | ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mt::i18n::is-supported`                  | invoke | Implementado  |                                                                                                                                                      |
| `mt::i18n::load`                          | invoke | Implementado  | locales do desktop como chunks preguiçosos do build web; idioma não suportado → `null` como no desktop                                               |
| `mt::i18n::supported`                     | invoke | Implementado  |                                                                                                                                                      |
| `mt::keybinding-get-keyboard-info`        | invoke | Não suportado | `native-keymap` não existe no Android; a página de atalhos já trata a falha                                                                          |
| `mt::keybinding-get-pref-keybindings`     | invoke | Implementado  |                                                                                                                                                      |
| `mt::keybinding-save-user-keybindings`    | invoke | Implementado  | grava `keybindings.json` e reenvia `mt::keybindings-response`; sintaxe do acelerador não é validada (sem electron-localshortcut)                     |
| `mt::spellchecker-switch-language`        | invoke | Não suportado | o WebView Android não expõe o corretor do Chromium                                                                                                   |
| `broadcast-user-data-changed`             | send   | Não suportado | canal interno do main do desktop (ipcMain.emit); o renderer não o envia                                                                              |
| `mt::ask-for-user-data`                   | send   | Implementado  | responde `mt::user-preference` com os dados de `/data/marktext/dataCenter.json`                                                                      |
| `mt::ask-for-user-preference`             | send   | Implementado  | responde `mt::user-preference` completo; na janela 1 dispara `mt::bootstrap-editor` logo depois                                                      |
| `mt::cmd-toggle-autosave`                 | send   | Implementado  | alterna `autoSave`                                                                                                                                   |
| `mt::get-current-language`                | send   | Implementado  | responde `mt::current-language`; 1ª execução detecta `navigator.language`                                                                            |
| `mt::keybinding-debug-dump-keyboard-info` | send   | Não suportado | `native-keymap` não existe no Android                                                                                                                |
| `mt::open-keybindings-config`             | send   | Não suportado | não há gerenciador de arquivos para abrir o JSON; editar pela página de atalhos                                                                      |
| `mt::request-keybindings`                 | send   | Implementado  | mapa Linux do desktop + `/data/marktext/keybindings.json`                                                                                            |
| `mt::set-user-data`                       | send   | Implementado  | grava `dataCenter.json` e difunde o parcial                                                                                                          |
| `mt::set-user-preference`                 | send   | Implementado  | valida contra schema.json, grava `/data/marktext/preferences.json`, difunde o parcial (sem `titleBarStyle`); `language-changed` quando o idioma muda |
| `set-user-preference`                     | send   | Não suportado | canal interno do main do desktop (ipcMain.emit); o renderer não o envia                                                                              |

### Arquivos, abas e pastas (janela do editor)

| Canal                                  | Tipo   | Status        | Observação                                                                                                                                     |
| -------------------------------------- | ------ | ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `update-buffer-state`                  | invoke | Implementado  | grava `/data/marktext/buffer.json`; restaurado com `mt::load-state` quando `startUpAction` é `restoreAll`                                      |
| `app-create-editor-window`             | send   | Não suportado | canal interno do main do desktop (ipcMain.emit); o renderer não o envia                                                                        |
| `app-open-directory-by-id`             | send   | Não suportado | canal interno do main do desktop (ipcMain.emit); o renderer não o envia                                                                        |
| `app-open-file-by-id`                  | send   | Não suportado | canal interno do main do desktop (ipcMain.emit); o renderer não o envia                                                                        |
| `app-open-files-by-id`                 | send   | Não suportado | canal interno do main do desktop (ipcMain.emit); o renderer não o envia                                                                        |
| `app-open-markdown-by-id`              | send   | Não suportado | canal interno do main do desktop (ipcMain.emit); o renderer não o envia                                                                        |
| `mt::app-try-quit`                     | send   | Não suportado | `mt::ask-for-close` nunca é enviado: o Android encerra o processo e o estado fica em `update-buffer-state`                                     |
| `mt::ask-for-open-project-in-sidebar`  | send   | Implementado  | seletor SAF de árvore, como `mt::cmd-open-folder`                                                                                              |
| `mt::close-window`                     | send   | Não suportado | `mt::ask-for-close` nunca é enviado: o Android encerra o processo e o estado fica em `update-buffer-state`                                     |
| `mt::close-window-confirm`             | send   | Não suportado | `mt::ask-for-close` nunca é enviado: o Android encerra o processo e o estado fica em `update-buffer-state`                                     |
| `mt::cmd-close-window`                 | send   | Não suportado | `mt::ask-for-close` nunca é enviado: o Android encerra o processo e o estado fica em `update-buffer-state`                                     |
| `mt::cmd-import-file`                  | send   | Não suportado | importação via pandoc/arrastar fora do MVP                                                                                                     |
| `mt::cmd-new-editor-window`            | send   | Não suportado | uma única janela de editor                                                                                                                     |
| `mt::cmd-open-file`                    | send   | Implementado  | seletor SAF `ACTION_OPEN_DOCUMENT` → `/doc/<key>/<nome>` (ou `/vault/...` se estiver numa árvore concedida)                                    |
| `mt::cmd-open-folder`                  | send   | Implementado  | seletor SAF `ACTION_OPEN_DOCUMENT_TREE` → `mt::open-directory` + árvore via `mt::update-object-tree`                                           |
| `mt::format-link-click`                | send   | Não suportado | abrir links pelo main fora do MVP                                                                                                              |
| `mt::open-file`                        | send   | Implementado  | scope check → `mt::open-new-tab` / `mt::switch-tab-by-file_path` / `mt::open-asset-tab` (pdf); erro → `mt::show-notification`                  |
| `mt::open-file-by-window-id`           | send   | Implementado  | como `mt::open-file` (uma janela)                                                                                                              |
| `mt::rename`                           | send   | Implementado  | confirma substituição com `window.confirm`; `mt::set-pathname` com `oldPathname`                                                               |
| `mt::response-file-move-to`            | send   | Implementado  | seletor SAF de criação, copia sobre o documento criado e remove a origem                                                                       |
| `mt::response-file-save`               | send   | Implementado  | escrita atômica quando o provedor permite; sem caminho → seletor SAF de criação; `mt::tab-saved` / `mt::set-pathname` / `mt::tab-save-failure` |
| `mt::response-file-save-as`            | send   | Implementado  | sempre abre o seletor SAF de criação                                                                                                           |
| `mt::save-and-close-tabs`              | send   | Implementado  | duas perguntas `window.confirm` (salvar? / descartar?) no lugar da caixa de 3 botões → `mt::force-close-tabs-by-id`                            |
| `mt::save-tabs`                        | send   | Implementado  | um por vez (abas sem título abrem um seletor cada)                                                                                             |
| `mt::select-default-directory-to-open` | send   | Não suportado | pasta padrão escolhida pelo seletor de pasta                                                                                                   |
| `mt::window-add-file-path`             | send   | Não suportado | canal interno do main do desktop (ipcMain.emit); o renderer não o envia                                                                        |
| `mt::window-tab-closed`                | send   | Implementado  | para de observar o arquivo e o tira do escopo                                                                                                  |
| `mt::window::drop`                     | send   | Não suportado | importação via pandoc/arrastar fora do MVP                                                                                                     |
| `watcher-unwatch-all-by-id`            | send   | Não suportado | canal interno do main do desktop (ipcMain.emit); o renderer não o envia                                                                        |
| `watcher-unwatch-directory`            | send   | Não suportado | canal interno do main do desktop (ipcMain.emit); o renderer não o envia                                                                        |
| `watcher-unwatch-file`                 | send   | Não suportado | canal interno do main do desktop (ipcMain.emit); o renderer não o envia                                                                        |
| `watcher-watch-directory`              | send   | Não suportado | canal interno do main do desktop (ipcMain.emit); o renderer não o envia                                                                        |
| `watcher-watch-file`                   | send   | Não suportado | canal interno do main do desktop (ipcMain.emit); o renderer não o envia                                                                        |
| `window-add-file-path`                 | send   | Não suportado | canal interno do main do desktop (ipcMain.emit); o renderer não o envia                                                                        |
| `window-change-file-path`              | send   | Não suportado | canal interno do main do desktop (ipcMain.emit); o renderer não o envia                                                                        |
| `window-file-saved`                    | send   | Não suportado | canal interno do main do desktop (ipcMain.emit); o renderer não o envia                                                                        |

### `window.fileUtils` / `mt::fs::*`

| Canal                            | Tipo   | Status                | Observação                                                                                      |
| -------------------------------- | ------ | --------------------- | ----------------------------------------------------------------------------------------------- |
| `mt::dialog::show-save`          | invoke | Implementado          | seletor SAF de criação; o caminho escolhido entra no escopo                                     |
| `mt::fs-trash-item`              | invoke | Implementado          | Android não tem lixeira: confirma e exclui permanentemente                                      |
| `mt::fs::copy`                   | invoke | Implementado          | arquivos e pastas (recursivo)                                                                   |
| `mt::fs::copy-with-content-hash` | invoke | Implementado          | SHA-1 via WebCrypto                                                                             |
| `mt::fs::empty-dir`              | invoke | Não suportado         | sem handler também no desktop                                                                   |
| `mt::fs::ensure-dir`             | invoke | Implementado          |                                                                                                 |
| `mt::fs::is-directory`           | invoke | Implementado          | `false` fora do escopo                                                                          |
| `mt::fs::is-executable`          | invoke | Implementado          | sempre `false`: apps Android não executam arquivos                                              |
| `mt::fs::is-file`                | invoke | Implementado          | `false` fora do escopo                                                                          |
| `mt::fs::move`                   | invoke | Implementado          | sem sobrescrever (`EEXIST`)                                                                     |
| `mt::fs::output-file`            | invoke | Implementado          | cria pastas pai; o `add` da árvore leva o documento (arquivo novo pela barra lateral)           |
| `mt::fs::path-exists`            | invoke | Implementado          | `false` fora do escopo                                                                          |
| `mt::fs::read-file`              | invoke | Implementado          | bytes, ou texto em `utf8`/`latin1`/`base64`; outras codificações → `UNSUPPORTED_ON_ANDROID`     |
| `mt::fs::readdir`                | invoke | Implementado          |                                                                                                 |
| `mt::fs::stat`                   | invoke | Implementado          | `ctimeMs` = `mtimeMs`, `isSymbolicLink` = false (SAF não expõe)                                 |
| `mt::fs::unlink`                 | invoke | Não suportado         | sem handler também no desktop                                                                   |
| `mt::fs::write-file`             | invoke | Implementado          | cria pastas pai; atualiza a árvore                                                              |
| `mt::paths::is-image`            | invoke | Implementado          | extensão de imagem + arquivo existente dentro do escopo                                         |
| `mt::fs::grant-user-path`        | send   | Sem efeito no Android | permissões vêm só dos seletores SAF; arquivos colados/arrastados de outros apps não têm caminho |
| `mt::paths::is-same-sync`        | sync   | Implementado          | caminhos virtuais diferenciam maiúsculas: iguais só se idênticos                                |

### Clipboard e shell

| Canal                            | Tipo   | Status        | Observação                                                                  |
| -------------------------------- | ------ | ------------- | --------------------------------------------------------------------------- |
| `mt::clipboard::guess-file-path` | invoke | Não suportado | o clipboard Android não carrega caminhos de arquivo                         |
| `mt::clipboard::read-text`       | invoke | Implementado  | `@capacitor/clipboard`                                                      |
| `mt::clipboard::write-image`     | invoke | Implementado  | responde `false`: o plugin de clipboard coloca imagens como texto data-URL  |
| `mt::shell::open-external`       | invoke | Implementado  | só `https:`/`http:`/`mailto:`, via `Intent.ACTION_VIEW` (MtFs.openExternal) |
| `mt::shell::open-path`           | invoke | Não suportado | sem gerenciador de arquivos; os plugins escondem o botão no Android         |
| `mt::clipboard::write-text`      | send   | Implementado  | `@capacitor/clipboard`                                                      |
| `mt::shell::open-external`       | send   | Implementado  | só `https:`/`http:`/`mailto:`, via `Intent.ACTION_VIEW`                     |
| `mt::shell::show-item`           | send   | Não suportado | sem gerenciador de arquivos; os plugins escondem o botão no Android         |

### Janela, menus e estado de UI

| Canal                                 | Tipo   | Status                | Observação                                                                        |
| ------------------------------------- | ------ | --------------------- | --------------------------------------------------------------------------------- |
| `mt::win::is-fullscreen`              | invoke | Implementado          | sempre `false`                                                                    |
| `mt::win::is-maximized`               | invoke | Implementado          | sempre `false`                                                                    |
| `menu-add-recently-used`              | send   | Sem efeito no Android | lista de recentes do SO; documentos vêm das permissões SAF                        |
| `menu-clear-recently-used`            | send   | Sem efeito no Android | lista de recentes do SO; documentos vêm das permissões SAF                        |
| `mt::add-recently-used-document`      | send   | Sem efeito no Android | lista de recentes do SO; documentos vêm das permissões SAF                        |
| `mt::editor-selection-changed`        | send   | Sem efeito no Android | só atualiza menus nativos do desktop                                              |
| `mt::menu::popup`                     | send   | Não suportado         | menus de contexto nativos: fatia de UI responsiva                                 |
| `mt::menu::popup-application`         | send   | Não suportado         | menus de contexto nativos: fatia de UI responsiva                                 |
| `mt::set-editor-format-menus-enabled` | send   | Sem efeito no Android | só atualiza menus nativos do desktop                                              |
| `mt::update-format-menu`              | send   | Sem efeito no Android | só atualiza menus nativos do desktop                                              |
| `mt::update-line-ending-menu`         | send   | Sem efeito no Android | só atualiza menus nativos do desktop                                              |
| `mt::update-sidebar-menu`             | send   | Sem efeito no Android | só atualiza menus nativos do desktop                                              |
| `mt::view-layout-changed`             | send   | Sem efeito no Android | só atualiza menus nativos do desktop                                              |
| `mt::win::close`                      | send   | Implementado          | janela 2 (configurações) fecha o overlay; janela 1 manda o app para segundo plano |
| `mt::win::maximize`                   | send   | Sem efeito no Android | uma janela em tela cheia, sem controles de janela                                 |
| `mt::win::minimize`                   | send   | Sem efeito no Android | uma janela em tela cheia, sem controles de janela                                 |
| `mt::win::set-fullscreen`             | send   | Sem efeito no Android | uma janela em tela cheia, sem controles de janela                                 |
| `mt::win::toggle-fullscreen`          | send   | Sem efeito no Android | uma janela em tela cheia, sem controles de janela                                 |
| `mt::win::toggle-maximize`            | send   | Sem efeito no Android | uma janela em tela cheia, sem controles de janela                                 |
| `mt::win::unmaximize`                 | send   | Sem efeito no Android | uma janela em tela cheia, sem controles de janela                                 |
| `mt::window-initialized`              | send   | Sem efeito no Android | só atualiza menus nativos do desktop                                              |
| `mt::window-toggle-always-on-top`     | send   | Sem efeito no Android | uma janela em tela cheia, sem controles de janela                                 |
| `window-close-by-id`                  | send   | Não suportado         | canal interno do main do desktop (ipcMain.emit); o renderer não o envia           |
| `window-reload-by-id`                 | send   | Não suportado         | canal interno do main do desktop (ipcMain.emit); o renderer não o envia           |
| `window-toggle-always-on-top`         | send   | Não suportado         | canal interno do main do desktop (ipcMain.emit); o renderer não o envia           |

### Plugins, vault e comunidade

| Canal                        | Tipo   | Status        | Observação                                                                        |
| ---------------------------- | ------ | ------------- | --------------------------------------------------------------------------------- |
| `mt::community::fetch`       | invoke | Não suportado | responsabilidade da fatia Plugins (MobilePlugins); integrador atualiza ao mesclar |
| `mt::community::install`     | invoke | Não suportado | responsabilidade da fatia Plugins (MobilePlugins); integrador atualiza ao mesclar |
| `mt::community::set-enabled` | invoke | Não suportado | responsabilidade da fatia Plugins (MobilePlugins); integrador atualiza ao mesclar |
| `mt::community::uninstall`   | invoke | Não suportado | responsabilidade da fatia Plugins (MobilePlugins); integrador atualiza ao mesclar |
| `mt::plugins::get-state`     | invoke | Não suportado | responsabilidade da fatia Plugins (MobilePlugins); integrador atualiza ao mesclar |
| `mt::plugins::invoke`        | invoke | Não suportado | responsabilidade da fatia Plugins (MobilePlugins); integrador atualiza ao mesclar |
| `mt::plugins::set-enabled`   | invoke | Não suportado | responsabilidade da fatia Plugins (MobilePlugins); integrador atualiza ao mesclar |
| `mt::plugins::set-secret`    | invoke | Não suportado | responsabilidade da fatia Plugins (MobilePlugins); integrador atualiza ao mesclar |
| `mt::plugins::set-setting`   | invoke | Não suportado | responsabilidade da fatia Plugins (MobilePlugins); integrador atualiza ao mesclar |
| `mt::vault::create-text`     | invoke | Não suportado | responsabilidade da fatia Plugins (MobilePlugins); integrador atualiza ao mesclar |
| `mt::vault::exists`          | invoke | Não suportado | responsabilidade da fatia Plugins (MobilePlugins); integrador atualiza ao mesclar |
| `mt::vault::list`            | invoke | Não suportado | responsabilidade da fatia Plugins (MobilePlugins); integrador atualiza ao mesclar |
| `mt::vault::read-binary`     | invoke | Não suportado | responsabilidade da fatia Plugins (MobilePlugins); integrador atualiza ao mesclar |
| `mt::vault::read-text`       | invoke | Não suportado | responsabilidade da fatia Plugins (MobilePlugins); integrador atualiza ao mesclar |
| `mt::vault::write-text`      | invoke | Não suportado | responsabilidade da fatia Plugins (MobilePlugins); integrador atualiza ao mesclar |
| `mt::plugins::open-settings` | send   | Não suportado | responsabilidade da fatia Plugins (MobilePlugins); integrador atualiza ao mesclar |
| `mt::vault::set-active-file` | send   | Não suportado | responsabilidade da fatia Plugins (MobilePlugins); integrador atualiza ao mesclar |

### Índice do vault

| Canal                       | Tipo   | Status        | Observação                                                                 |
| --------------------------- | ------ | ------------- | -------------------------------------------------------------------------- |
| `mt::index::backlinks`      | invoke | Não suportado | índice do vault — fatia Plugins/VaultIndex; integrador atualiza ao mesclar |
| `mt::index::files-with-tag` | invoke | Não suportado | índice do vault — fatia Plugins/VaultIndex; integrador atualiza ao mesclar |
| `mt::index::get-file`       | invoke | Não suportado | índice do vault — fatia Plugins/VaultIndex; integrador atualiza ao mesclar |
| `mt::index::is-ready`       | invoke | Não suportado | índice do vault — fatia Plugins/VaultIndex; integrador atualiza ao mesclar |
| `mt::index::list-files`     | invoke | Não suportado | índice do vault — fatia Plugins/VaultIndex; integrador atualiza ao mesclar |
| `mt::index::request`        | invoke | Não suportado | índice do vault — fatia Plugins/VaultIndex; integrador atualiza ao mesclar |
| `mt::index::resolve-link`   | invoke | Não suportado | índice do vault — fatia Plugins/VaultIndex; integrador atualiza ao mesclar |
| `mt::index::tags`           | invoke | Não suportado | índice do vault — fatia Plugins/VaultIndex; integrador atualiza ao mesclar |

### Outros

| Canal                                          | Tipo   | Status        | Observação                                                              |
| ---------------------------------------------- | ------ | ------------- | ----------------------------------------------------------------------- |
| `mt::ask-for-image-path`                       | invoke | Não suportado | uploader/captura/diálogo de pasta de imagens fora do MVP                |
| `mt::cmd::exists`                              | invoke | Não suportado | não há comandos de shell                                                |
| `mt::diagram::fetch-plantuml`                  | invoke | Não suportado | fetch de PlantUML no main fora do MVP                                   |
| `mt::fonts::list`                              | invoke | Não suportado | lista de fontes do SO indisponível                                      |
| `mt::rg::start`                                | invoke | Não suportado | ripgrep fora do MVP (sem binário no Android)                            |
| `mt::spellchecker-get-available-dictionaries`  | invoke | Não suportado | o WebView Android não expõe o corretor do Chromium                      |
| `mt::spellchecker-get-custom-dictionary-words` | invoke | Não suportado | o WebView Android não expõe o corretor do Chromium                      |
| `mt::spellchecker-remove-word`                 | invoke | Não suportado | o WebView Android não expõe o corretor do Chromium                      |
| `mt::spellchecker-set-enabled`                 | invoke | Não suportado | o WebView Android não expõe o corretor do Chromium                      |
| `mt::uploader::upload`                         | invoke | Não suportado | uploader/captura/diálogo de pasta de imagens fora do MVP                |
| `app-create-settings-window`                   | send   | Não suportado | canal interno do main do desktop (ipcMain.emit); o renderer não o envia |
| `broadcast-preferences-changed`                | send   | Não suportado | canal interno do main do desktop (ipcMain.emit); o renderer não o envia |
| `mt::NEED_UPDATE`                              | send   | Não suportado | atualização pela loja, não pelo app                                     |
| `mt::ask-for-image-auto-path`                  | send   | Não suportado | uploader/captura/diálogo de pasta de imagens fora do MVP                |
| `mt::ask-for-modify-image-folder-path`         | send   | Não suportado | uploader/captura/diálogo de pasta de imagens fora do MVP                |
| `mt::check-for-update`                         | send   | Não suportado | atualização pela loja, não pelo app                                     |
| `mt::handle-renderer-error`                    | send   | Implementado  | `console.error` (Logcat)                                                |
| `mt::make-screenshot`                          | send   | Não suportado | uploader/captura/diálogo de pasta de imagens fora do MVP                |
| `mt::open-setting-window`                      | send   | Implementado  | settingsWindow.ts: iframe em tela cheia (janela 2)                      |
| `mt::response-export`                          | send   | Não suportado | exportação/impressão/pandoc fora do MVP                                 |
| `mt::response-pandoc-export`                   | send   | Não suportado | exportação/impressão/pandoc fora do MVP                                 |
| `mt::response-print`                           | send   | Não suportado | exportação/impressão/pandoc fora do MVP                                 |
| `mt::rg::cancel`                               | send   | Não suportado | ripgrep fora do MVP (sem binário no Android)                            |
| `screen-capture`                               | send   | Não suportado | uploader/captura/diálogo de pasta de imagens fora do MVP                |
| `set-image-folder-path`                        | send   | Não suportado | uploader/captura/diálogo de pasta de imagens fora do MVP                |
