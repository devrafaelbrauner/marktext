# Dataview

Mostra o resultado de consultas TABLE, LIST e TASK em blocos `dataview`,
calculadas com as notas da pasta aberta. Ligado por padrão. Id: `dataview`.
Sem configurações e sem comandos.

O bloco continua sendo código. A pré-visualização aparece embaixo e a
exportação HTML/PDF leva a tabela, não a consulta. Não há DataviewJS nem
consulta inline (`= isto`).

````markdown
```dataview
TABLE status, priority
FROM "Projetos"
WHERE status = "aberto"
SORT priority DESC
LIMIT 20
```
````

A consulta distingue maiúsculas só nos nomes de campo que não são palavras
reservadas. `TABLE` e `table` são a mesma coisa.

## O que a linguagem aceita

```text
TABLE [WITHOUT ID] campo, expressão AS "Nome"
LIST  [WITHOUT ID] [expressão]
TASK
FROM origem
WHERE expressão
SORT expressão [ASC|DESC], …
LIMIT inteiro
```

`FROM` só pode aparecer uma vez, antes dos outros comandos. Os comandos
rodam na ordem escrita: `LIMIT` antes de `SORT` corta e depois ordena o que
sobrou.

`TASK` não aceita expressão logo depois do tipo. Não existem `CALENDAR`,
`GROUP BY` nem `FLATTEN`.

### Origens

| Escrita | Seleciona |
| --- | --- |
| `#projeto` | a tag e as filhas (`#projeto/alfa`), sem diferenciar maiúsculas |
| `"Diario"` | prefixo de pasta, ou o caminho exato da nota, com ou sem `.md` |
| `[[Alpha]]` | notas que apontam para Alpha (link resolvido ou, se não resolver, o texto do alvo) |
| `outgoing([[Home]])` | notas para as quais Home aponta |

`AND` / `OR` / `NOT` (também `-` e `!`). `NOT` prende mais que `AND`, que
prende mais que `OR`. Parênteses funcionam. Não há `incoming()`. Caminho sem
aspas não é origem.

```dataview
LIST FROM #projeto AND -"Arquivo"
LIST FROM ("Diario" OR "Arquivo") AND NOT [[Home]]
```

### Campos

Cada nota é um objeto. Chaves do front matter e campos inline viram
propriedades. Campo inline repetido, ou que repete uma chave do front
matter, vira lista.

Campo inline, como o índice lê:

```markdown
status:: aberto
- [ ] Entregar [due:: 2026-10-04]
```

A chave é minúscula. `chave:: valor` na linha inteira, ou `[chave:: valor]`
e `(chave:: valor)`. `[[nota::x]]` é wikilink, não campo.

`file` tem: `name`, `path`, `folder`, `ext`, `link`, `size`, `ctime`,
`mtime`, `cday`, `mday`, `tags` (a tag e os pais, com `#`), `etags` (só a
folha, com `#`), `inlinks`, `outlinks`, `aliases`, `tasks`, `day`
(`YYYY-MM-DD` se o nome do arquivo for essa data, senão nulo),
`frontmatter`.

`this` é a nota que contém a consulta. `row` é a linha atual. Os dois nomes
diferenciam maiúsculas. Os outros campos não: espaço vira `-`.

Numa tarefa: `text`, `status` (o caractere dos colchetes), `checked`,
`completed` (só `x` ou `X`), `fullyCompleted`, `line`, `path`, `link`,
`tags`, e o `file` da nota. Clicar no checkbox grava `[x]` ou `[ ]`.

### Expressões

Comparações `=` `!=` `<` `<=` `>` `>=`. `and` / `or` (também `&` e `|`).
`+` `-` `*` `/` `%`. `!` e `-` unários. `.campo` e `[índice]`. Listas
`[1, "a", true, null]`. Strings só com aspas duplas.

Datas: `date(2026-10-04)`, `date(today)`, `date(now)`, `tomorrow`,
`yesterday`, `sow`, `eow`, `som`, `eom`, `soy`, `eoy`. `date(today)` é data;
`today` sozinho é nome de campo.

Durações: `dur(1 day)`, `dur(1 week, 2 days)`. Unidades: year, month, week,
day, hour, minute, second, e as abreviações `y` `mo` `w` `d` `h` `m` `s`.

Funções: `contains`, `length`, `lower`, `upper`, `default`, `choice`,
`round`, `min`, `max`, `sum`, `typeof`, `startswith`, `endswith`, `date`,
`dur`, `link`, `number`, `string`, `list`, `join`. `contains` é função, não
operador: `contains(file.tags, "#ideia")`.

```dataview
TABLE file.folder, status
FROM "Projetos"
WHERE contains(file.tags, "#projeto") AND due <= date(today)

TASK
FROM #projeto
WHERE !completed
SORT due ASC
```

Clicar num link de nota abre o arquivo. Título vira âncora. `^bloco` abre o
arquivo sem rolar até o bloco. `page=` de um PDF é repassado ao leitor.

## Limites

- Consulta com mais de 20 000 caracteres é recusada.
- A tabela mostra os primeiros 1 000 resultados e avisa o total.
- Avaliação longa demais pede para restringir com `FROM` ou `WHERE`.

## O que não existe

DataviewJS, `CALENDAR`, `GROUP BY`, `FLATTEN`, regex, aspas simples,
comentário de consulta, objeto `{…}`, lambdas, e qualquer função fora da
lista. Não há painel de configuração do plugin.
