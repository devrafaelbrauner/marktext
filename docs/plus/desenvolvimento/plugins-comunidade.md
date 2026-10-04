# Plugins da comunidade

Desenho combinado do marco M7. **Não está implementado** neste commit: o
host só ativa os nove embutidos. A referência de quem escreve um plugin da
comunidade é o SDK, não esta página:

- [SDK (pt-BR)](../sdk/README.md)
- [SDK (English)](../sdk/README.en.md)

O isolamento só é real com `webSecurity: true`. Neste commit as janelas ainda
nascem com `webSecurity: false` (`src/main/config.ts`). O endurecimento liga
essa flag; o runtime da comunidade precisa da mesma linha para os testes de
isolamento valerem.

## O que foi combinado

Instalação em `<userData>/plugins/<id>/`, com `manifest.json`: `id`, `name`,
`version`, `minAppVersion`, `author`, `description` (texto ou `{ en, pt }`),
`main`, `permissions`, `panels` (`id`, `title`, `icon`, `entry`) e
`settings` no mesmo esquema dos embutidos.

Permissões: `editor:read`, `editor:write`, `editor:decorate`, `vault:read`,
`vault:write`, `metadata:read`, `network:<host>`, `ui:sidebar`,
`ui:statusbar`, `clipboard:write`. Comandos, notificações e configurações
são sempre permitidos.

O esquema `mt-plugin://<id>/<caminho>` é servido pelo processo principal,
só da pasta daquele plugin. Travessia, caminho absoluto, `..` e symlink que
escape são recusados. A resposta leva CSP
`default-src 'none'; script-src mt-plugin://<id>; style-src 'unsafe-inline' mt-plugin://<id>; img-src data: mt-plugin://<id>; connect-src 'none'`.
A CSP do renderer ganha `frame-src mt-plugin:` e nada mais é afrouxado.

Cada plugin da comunidade ligado tem um iframe
`<iframe sandbox="allow-scripts">` (origem opaca, sem preload) com um
bootstrap do host que importa o `main`. Painéis são outros iframes, com o
HTML de entrada deles.

A ponte: o host envia `{ type: 'mt-plugin:init', protocol: 1, manifest, language, settings }`
e transfere um `MessagePort`. RPC `{ id, method, args }` responde
`{ id, ok, value | error: { code, message } }`. Eventos são
`{ event, payload }`. Cada método é checado no host e executado no mesmo
contexto que os embutidos usam.

Limites da v1: sem sintaxe inline e sem componentes Vue. Um renderizador de
bloco de código devolve HTML, e o host sanitiza com DOMPurify antes de
inserir. Item de barra de status é só texto e dica. Decorações só com as
classes fixas `spelling`, `grammar`, `style` e uma classe `info`.

Ativação tem teto de 10 s. Queda ou estouro desliga o plugin e avisa.
`--safe` desliga todos os da comunidade. Desinstalar apaga a pasta.

O instalador aceita pasta ou `.zip`, sem zip-slip, com teto de tamanho,
manifesto validado e recusa de id que já seja embutido. A instalação entra
desligada. As permissões aparecem em português e em inglês. Ligar mostra um
diálogo de consentimento com a lista.
