# Modo de segurança

```bash
marktext --safe
```

A flag não é gravada. Vale só para aquele processo. Não há variável de
ambiente equivalente.

## O que para

- Nenhum plugin é ativado, esteja ele ligado ou não em `plugins.json`.
- O arquivo `<userData>/keybindings.json` não é aplicado.

Em Preferências → Plugins aparece o aviso de que o MarkText foi iniciado com
`--safe` e que nenhum plugin está em execução. Os interruptores e os campos
continuam editáveis: a alteração é salva e passa a valer na próxima abertura
sem `--safe`.

## O que não para

O texto de ajuda da linha de comando diz “Disable plugins and other user
configuration”. O código faz menos do que isso:

- As preferências gerais continuam carregadas. Há um `TODO` em
  `packages/desktop/src/main/preferences/index.ts` para não carregá-las; isso
  não está feito.
- O corretor ortográfico do sistema não é desligado. Isso é outra flag:
  `--disable-spellcheck`.
- O índice da pasta continua sendo construído.

`--safe` também não existe como opção dentro das preferências. Em
`pnpm dev` a flag é descartada; veja [Compilação](compilacao.md).
