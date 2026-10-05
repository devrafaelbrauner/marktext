# Android

O APK roda o mesmo editor (muya) e a mesma interface Vue do desktop dentro de
um WebView (Capacitor 8). O processo main do Electron foi substituído por um
"main móvel" em TypeScript (`packages/mobile/src/main/`) e plugins nativos em
Java. A lista de cada canal IPC e o que ele faz no Android está em
[`packages/mobile/BRIDGE.md`](../../../packages/mobile/BRIDGE.md).

## Compilar e instalar

Requisitos além dos do [desktop](compilacao.md): JDK 21 e Android SDK com
`platforms;android-36` e `build-tools` (o caminho vai em
`packages/mobile/android/local.properties`, `sdk.dir=...`).

```bash
pnpm install
export JAVA_HOME=/caminho/do/jdk-21
pnpm -C packages/mobile build:apk
adb install -r packages/mobile/android/app/build/outputs/apk/debug/app-debug.apk
```

| Comando (em `packages/mobile`)                 | O que faz                                                                   |
| ---------------------------------------------- | --------------------------------------------------------------------------- |
| `pnpm build:web`                               | Gera o bundle web em `dist/` reaproveitando a config do renderer do desktop |
| `pnpm sync`                                    | `build:web` + `cap sync android` (copia o bundle para o projeto Gradle)     |
| `pnpm build:apk`                               | `sync` + `./gradlew assembleDebug`                                          |
| `pnpm test`                                    | Testes vitest do main móvel                                                 |
| `npx vite preview --config vite.web.config.ts` | Abre o bundle num navegador com um cofre de demonstração em memória         |

## Usar

- **Abrir pasta**: botão ☰ (canto superior esquerdo) → _Abrir pasta…_. O seletor
  do Android (Storage Access Framework) pede acesso a uma pasta; o app guarda a
  permissão e reabre a pasta na próxima vez.
- **Abrir arquivo / Salvar como**: também pelo ☰, com os seletores do sistema.
- **Salvar**: ☰ → _Salvar_, `Ctrl+S` num teclado físico, ou salvamento
  automático (Preferências → Geral).
- **Barra lateral**: em telas estreitas ela abre como gaveta por cima do
  editor; o botão voltar do Android fecha a gaveta, depois as configurações,
  depois manda o app para segundo plano (nunca fecha um documento).
- **Seleção**: toque longo seleciona a palavra e mostra as alças do sistema e
  a barra de formatação do editor. Menus de contexto (toque longo num arquivo
  da árvore) aparecem como folha de ações.
- **Configurações**: ☰ → _Preferências_, em tela cheia.
- **Plugins**: os mesmos dez embutidos do desktop. As chaves de API (corretor,
  IA) ficam no Android Keystore. Plugins da comunidade instalam de uma pasta ou
  `.zip` escolhidos no seletor.

## Diferenças em relação ao desktop

| Recurso                         | No Android                                                                                                                      |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Busca na pasta                  | Feita em JavaScript no worker do índice, sem ripgrep                                                                            |
| Mudanças feitas por outros apps | Detectadas ao voltar ao app e a cada 5 s no documento aberto (o SAF não avisa)                                                  |
| Excluir arquivo                 | Apaga de vez: não há lixeira                                                                                                    |
| Codificação                     | UTF-8 (com/sem BOM), UTF-16 LE/BE e Windows-1252; outras falham ao salvar com aviso                                             |
| HTTP sem TLS                    | Só para o próprio aparelho (`127.0.0.1`, `localhost`), como no desktop                                                          |
| Fora desta versão               | Exportar/imprimir/Pandoc, upload de imagens, PlantUML, lista de fontes do sistema, corretor do Chromium, atualização automática |
