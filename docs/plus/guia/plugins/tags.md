# Tags

`#tags` no estilo do Obsidian: destaque no editor, sugestão ao digitar, painel
e renomeação na pasta. Ligado por padrão. Id: `tags`. Sem configurações.

Com o plugin ativo, `#` só vira título ATX se houver espaço depois (`# tag`
continua parágrafo; `# Título` continua título).

## Sintaxe

```markdown
#trabalho #a/b/c #reunião #Café_2
```

Uma tag precisa de pelo menos uma letra ou um emoji. `#2026` e `#2026-10`
não são tags. Caracteres: letras, marcas, dígitos, `_`, `-`, `/` e emoji.
Uma `/` no fim é ignorada no nome (`#a/b/` é a tag `a/b`).

Não abre tag depois de `#`, `&`, `\`, `/` ou crase. Por isso `##tag`,
`C#sharp`, `\#escapada` e o fragmento de uma URL não são tags. Cores
hexadecimais também não: `#fff`, `#ffffff`, `#1e1e1e`. `#cafe` e `#bad`
continuam tags.

Código, matemática, destino de link e comentário `%%` não são indexados.
Tags no front matter YAML entram junto com as do corpo:

```yaml
---
tags: [trabalho, a/b]
tag: leitura, #ideia
---
```

A chave pode ser `tags` ou `tag`, em qualquer caixa. Lista, ou texto
separado por vírgula e espaço. O `#` inicial é opcional. Front matter TOML
ou JSON não é lido. O `---` de fechamento precisa ser seguido de linha em
branco (ou ser o fim do arquivo).

`#a/b` conta para `a` e para `a/b`. A identidade ignora maiúsculas; a grafia
guardada é a da primeira ocorrência.

## Painel

Comando **Tags: Mostrar Painel de Tags** (`tags.showPanel`). A árvore segue
as `/`. O filtro ignora um `#` inicial. Clicar numa tag no editor abre essa
tag no painel. Clicar numa nota da lista abre o arquivo.

## Renomear

Comando **Tags: Renomear Tag…** (`tags.renameTag`), ou o botão do painel.
Há uma pré-visualização antes de aplicar.

`ideia` → `nota` também renomeia `#Ideia` e `#ideia/rascunho` para
`#nota/rascunho`. Não mexe em `#ideias` nem em `#minha/ideia`. O sufixo
aninhado mantém a própria caixa.

O novo nome precisa de letra ou emoji, e só `_`, `-` e `/`. `a//b` e cores
hexadecimais são recusados.

Notas abertas mudam na aba e ficam sem salvar. As outras só são gravadas se
não tiverem mudado no disco depois da pré-visualização.

## Limitações

Sem atalho e sem configurações próprias (não há lista de pastas ignoradas
só das tags). Tags dentro de código, links ou atributos HTML não são
renomeadas, de propósito.
