# Corretor gramatical (LanguageTool)

Verifica ortografia, gramática e estilo enquanto você escreve. Português do
Brasil por padrão. **Desligado** até você ativar em Preferências → Plugins:
ele envia texto para um servidor.

Id: `grammar`. Só funciona na aba markdown do editor visual. Quadros Kanban,
PDFs e outras vistas de plugin não são verificados.

## Três servidores

| Valor de `server` | Padrão | Para onde vai |
| --- | --- | --- |
| `premium` | sim | `https://api.languagetoolplus.com/v2` |
| `free` | | `https://api.languagetool.org/v2` |
| `custom` | | a URL que você informar, terminando em `/v2` |

A API gratuita não entra sozinha se o Premium falhar. Cada modo é o que está
selecionado.

Limites que o aplicativo impõe por minuto (balde local, não um cabeçalho de
cota):

| Servidor | Pedidos | Caracteres | Teto por pedido |
| --- | --- | --- | --- |
| Premium | 80 | 300 000 | 60 000 |
| Gratuito | 20 | 75 000 | 20 000 |
| Personalizado | 80 | 300 000 | 60 000 |

O servidor próprio não tem esses tetos. O aplicativo usa os números do
Premium para não frear uma instância local abaixo do que a nuvem permite.
Em 429 ou 503 o pedido espera o `Retry-After` e tenta de novo.

### Premium

1. Crie a chave em
   <https://languagetool.org/editor/settings/access-tokens>.
   O aplicativo não abre essa página; a interface só diz “página da sua conta”.
2. Em **Usuário (e-mail)** (`username`) coloque o e-mail da conta Premium.
   Ele é enviado no campo de formulário `username`. O código não confere se
   é um e-mail: qualquer texto não vazio serve.
3. Em **Chave de API** (`apiKey`) cole a chave e salve. Ela vai criptografada
   para `secrets.json` e não volta a aparecer. O e-mail fica em
   `plugins.json`, não no cofre de segredos.

Sem os dois, o status mostra **Configurar** e nada é enviado.

Se usuário e chave estiverem preenchidos, eles também acompanham pedidos
gratuitos e personalizados. Só o Premium *exige* os dois.

### API pública gratuita

Mude **Servidor** para `free`. Não pede credenciais. Limites menores, acima.

### Servidor próprio

Mude **Servidor** para `custom` e preencha **URL do servidor personalizado**.
O placeholder das configurações é `http://localhost:8081/v2`. O aplicativo
não traz imagem de contêiner nem porta obrigatória: aponte a URL para um
LanguageTool que exponha `/v2/check`.

`http://` só é aceito para `localhost`, endereços `127.*` e `::1`. Um nome
que apenas resolve para a máquina local não passa. `https://` vale para
qualquer host. Redirecionamentos e cookies são recusados. Uma URL `http://`
fora do loopback pode ser salva e só falha na hora do pedido.

## Consentimento

Na primeira verificação aparece **Enviar texto ao LanguageTool?**. Aceitar
grava `consentGiven: true` em `plugins.json`. Recusar não grava nada; a
pergunta volta no próximo “Verificar documento agora”.

Para retirar: desligue **Permitir o envio de texto ao servidor**. Limitação:
se você aceitou nesta sessão e depois desliga o interruptor sem desativar o
plugin, os envios desta sessão continuam até o plugin ser desligado.

Não há texto “LGPD” no aplicativo. O aviso é o diálogo: o LanguageTool
processa o texto só para verificá-lo.

## O que sai da máquina

Só o processo principal fala com a rede. Antes do consentimento, nada é
enviado.

Blocos verificados: parágrafos (inclusive itens de lista e citações),
títulos e células de tabela. Nunca viram bloco de verificação:

- front matter
- blocos de código, matemática, diagrama e HTML
- linhas horizontais e definições de referência (`[ref]: …`)

Um arquivo com `languagetool: false` no front matter YAML é pulado por
inteiro. Também valem `off` e `no`, em qualquer caixa. A chave tem de ser
exatamente `languagetool`. Front matter TOML (`+++`) ou JSON não conta.

```yaml
---
languagetool: false
---

Este arquivo não é enviado.
```

O que *é* enviado, de cada bloco verificável, vai como anotação do
LanguageTool: a prosa em `text`, a marcação em `markup`. Destinos de links,
código inline, matemática inline e HTML opaco entram no corpo do POST como
marcação, não como texto a corrigir. Regras ignoradas e o dicionário local
são filtrados *depois* da resposta: o parágrafo ainda é enviado.

Com Premium, as palavras do dicionário pessoal também são sincronizadas com
a conta (`/v2/words`, no máximo 500). Isso é outro envio, separado da
verificação.

Não são enviados: caminho do arquivo, outras notas, o conteúdo dos blocos
excluídos acima, nem a chave para lugar nenhum além do servidor escolhido.

## Como usar

O item na barra de status mostra o idioma, a contagem ou um erro. Clique
nele para abrir o painel **Problemas**, as configurações ou o consentimento,
conforme o estado.

Clique num sublinhado para o balão: aplicar uma sugestão (um passo de
desfazer; a formatação em volta é mantida, `Eu **vai**` vira `Eu **vou**`),
ignorar esta ocorrência até o fim da sessão, ignorar a regra (grava o id em
`disabledRules`) ou, em erro de ortografia, adicionar ao dicionário.

Classes dos sublinhados: `mu-decoration-spelling`, `mu-decoration-grammar`,
`mu-decoration-style`.

## Configurações

| Chave | Padrão | Efeito |
| --- | --- | --- |
| `server` | `premium` | Premium, gratuito ou personalizado |
| `serverUrl` | vazio | Base `/v2`; só no modo personalizado |
| `username` | vazio | E-mail da conta; campo `username` da API |
| `apiKey` | não definido | Segredo |
| `language` | `pt-BR` | `pt-BR`, `pt-PT`, `en-US`, `en-GB`, `es`, `fr`, `de`, `it`, `nl`, `auto` |
| `level` | `default` | `picky` também pede estilo e tipografia |
| `motherTongue` | `pt-BR` | Código para falsos cognatos; vazio não é enviado |
| `checkOnType` | ligado | Desligado: só ao abrir e pelo comando |
| `debounceMs` | `800` | Espera após a última tecla; 300–5000 |
| `disabledRules` | `[]` | Ids de regra, um por linha. `ID[subId]` também é aceito se você escrever |
| `disabledCategories` | `[]` | Ids de categoria, por exemplo `TYPOGRAPHY` |
| `dictionary` | `[]` | Palavras que não são apontadas como erro |
| `disableNativeSpellcheck` | ligado | Evita sublinhado duplo; a preferência do sistema volta ao desligar |
| `consentGiven` | desligado | Permissão de envio |

Com `language` em `auto` o pedido manda `preferredVariants=pt-BR,en-US,de-DE`.
A ortografia do LanguageTool depende de variante regional; `auto` não escolhe
uma só.

## Comandos

Paleta de comandos.

| Id | Atalho | Nome |
| --- | --- | --- |
| `grammar.checkNow` | — | Gramática: Verificar documento agora |
| `grammar.nextProblem` | `F8` | Gramática: Ir para o próximo problema |
| `grammar.toggle` | — | Gramática: Ligar/desligar a verificação |

`F8` só fica ativo se não colidir com um atalho do aplicativo. Ligar e
desligar pelo comando não é gravado: na próxima abertura, com o plugin
ativado, a verificação volta.

## Limitações

- Um bloco maior que o teto do plano não é enviado e não gera aviso.
- “Ignorar” dura a sessão. “Ignorar regra” fica em `plugins.json`.
- Trocar a chave sem apagá-la não invalida o cache dos resultados.
- No máximo cinco sugestões no balão. “Mais informações” só abre URL `https:`.
- O modo código-fonte não é um modo à parte da verificação: os sublinhados
  estão no editor visual.
