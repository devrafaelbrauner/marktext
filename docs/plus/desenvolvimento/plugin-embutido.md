# Escrever um plugin embutido

Plugin embutido é código revisado, empacotado com o aplicativo. Ele usa a
mesma API que a comunidade deverá ver depois, mas hoje não há checagem de
permissão: o processo é confiável.

## Arquivos

```text
packages/desktop/src/plugins/<id>/
  manifest.ts
  locales/en.json      # obrigatório
  locales/pt.json      # os dez atuais têm; os outros idiomas caem no inglês
  locales/index.ts
  renderer/index.ts    # export default { activate, deactivate? }
  main/index.ts        # só se precisar de rede, segredo ou CPU fora do renderer
  worker/index.ts      # só se a consulta rodar no índice
```

`id` é kebab-case e estável: ele nomeia configurações, segredos, chaves de
i18n e métodos IPC.

`locales/en.json` na raiz do namespace. `t('panel.title')` lê
`plugins.<id>.panel.title`. `name` e `description` do manifesto são chaves
desse namespace, não o texto final.

## Manifesto

```ts
import type { PluginManifest } from '@shared/plugins/types'

export const manifest: PluginManifest = {
  id: 'exemplo',
  version: '1.0.0',
  name: 'name',
  description: 'description',
  defaultEnabled: true,
  affectsParsing: false,
  settings: [{ key: 'ligado', type: 'boolean', label: 'settings.ligado', default: true }]
}
```

Tipos de setting: `boolean`, `string` (`pattern`, `placeholder`, `required`),
`number` (`min`, `max`, `step`), `enum` (`options[].label` é chave i18n),
`stringList`, `secret`. Segredo não tem `default` e não entra em
`plugins.json`.

`affectsParsing: true` quando o plugin registra sintaxe inline ou um
renderizador de bloco: o host recarrega os documentos abertos ao alternar.

## Registrar

1. `{ manifest, locales }` em `BUILTIN_PLUGINS`
   (`src/plugins/manifests.ts`).
2. Entrada lazy em `BUILTIN_RENDERER_PLUGINS`
   (`src/renderer/src/plugins/builtin.ts`):

   ```ts
   load: () => import('@plugins/exemplo/renderer').then((m) => m.default)
   ```

3. Se houver parte principal, o mesmo em `src/main/plugins/builtin.ts`.
4. Handler do índice: `registerWorkerHandler` no import de
   `worker/index.ts`. O glob em `vaultIndex/worker/entry.ts` carrega; não há
   terceira lista. Prefixe o tipo (`exemplo.consulta`).

O renderer chama o principal com `ctx.ipc.invoke('metodo', …)`. O principal
responde com `ctx.handle` e empurra eventos com `ctx.emit`.

## Ciclo

```ts
const activate = (ctx: RendererPluginContext): void => {
  ctx.commands.register({
    id: 'exemplo.fazer',
    title: 'commands.fazer',
    keybinding: 'CmdOrCtrl+Alt+Shift+E',
    run: () => ctx.ui.notify({ message: ctx.t('notify.ok') })
  })
}

export default { activate }
```

`activate` pode ser async. `deactivate` é opcional: o host já descarta o que
`register*` / `on*` / `track` devolveram. Não guarde listener fora do `ctx`.

Um atalho que colide com o do aplicativo é registrado e fica inativo. A
paleta só mostra o atalho enquanto ele está ativo.

Preferências → Plugins desenha o formulário a partir de `settings`. Não
importe Vue nessa janela.

## O que não colocar num embutido novo sem necessidade

- Rede no renderer. Use `ctx.net.fetch` na parte principal.
- Ler `apiKey` no renderer. Só `ctx.secrets.get` no principal, e só para
  chaves declaradas `secret`.
- Escrever fora da pasta aberta. `ctx.vault` recusa.
