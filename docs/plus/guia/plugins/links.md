# Links

`[[wikilinks]]` no estilo do Obsidian, com autocompletar, backlinks e
atualização quando uma nota é renomeada dentro do MarkText. Ligado por
padrão. Id: `links`.

Abra uma pasta. Sem pasta não há índice nem backlinks.

## Sintaxe

Uma linha, sem `]` aninhado.

```markdown
[[Nota]]
[[Pasta/Nota|rótulo]]
[[Nota#Título]]
[[Nota#^bloco]]
[[#Título local]]
![[diagrama.png]]
[[doc.pdf#page=3|página 3]]
```

Dentro de tabela o pipe do rótulo se escreve `\|`: `[[Nota\|rótulo]]`.

O que você vê no editor é o rótulo, se houver. Sem rótulo, o texto entre os
colchetes permanece (`Nota#Título`, não só `Título`). Os colchetes somem
enquanto o cursor está fora. `![[…]]` é reconhecido, mas **não** incorpora o
arquivo: o clique abre o alvo, como um link.

A resolução, com a pasta indexada:

1. Caminho exato no cofre, com ou sem `.md`. Uma barra inicial é ignorada.
2. Caminho relativo à nota (`./Nota`, `../Outra`).
3. O arquivo de mesmo nome, sem diferenciar maiúsculas, preferindo o caminho
   mais curto. `Pasta/Nota` também casa com o fim do caminho.
4. Sem extensão, procura uma nota `.md`. Com extensão (`doc.pdf`, `Nota.md`),
   o nome do arquivo tem de bater.

`[[#Título]]` é a própria nota. Um alvo que não resolve fica esmaecido.
`Ctrl`+clique (ou `Cmd`+clique no macOS) abre. Se a nota não existe, o
aplicativo pergunta se cria um arquivo vazio ao lado da nota atual, ou na
raiz da pasta quando o alvo contém `/`.

O salto de título usa o slug do GitHub, não o id de heading do Obsidian.
`^bloco` é guardado e reexportado, mas o clique **não** rola até o bloco.

Aliases do front matter (`aliases` / `alias`) **não** resolvem o link.
`[[Nome de exibição]]` não abre a nota só porque esse texto está em
`aliases`. Eles entram na busca de menções sem link.

## Autocompletar

Depois de `[[`, a lista oferece arquivos. O formato dos novos links
(`newLinkFormat`, padrão `shortest`):

| Valor | Exemplo |
| --- | --- |
| `shortest` | `[[Alpha]]` se o nome for único; senão `[[Arquivo/Notas]]`. PDF mantém a extensão |
| `relative` | `[[../Arquivo/Notas]]` em relação à nota atual |
| `absolute` | `[[Projetos/Beta]]`, sem `.md` |

`[[nota#` completa títulos da nota resolvida, no máximo 50. Não completa
bloco nem alias.

## Painel Backlinks

Comando **Links: Mostrar backlinks** (`links.showBacklinks`), sem atalho.

- **Menções com link:** outras notas cujo link resolve para esta. O clique
  abre a nota de origem. Auto-links não entram.
- **Menções sem link:** o nome do arquivo e os aliases, palavra inteira, sem
  diferenciar maiúsculas, fora de links, código, matemática, HTML, comentários
  e front matter. No máximo 200; notas maiores que 2 MiB são puladas.
  **Vincular** escreve `[[Nome]]` se o texto for exatamente o nome, senão
  `[[nome-curto|menção]]`. Esse texto curto ignora `newLinkFormat`.

## Atualizar ao renomear

Só renomeações e movimentos feitos pelo MarkText (menu, barra lateral).
Outros programas não disparam a atualização.

| `updateLinksOnRename` | Padrão | Efeito |
| --- | --- | --- |
| `ask` | sim | Pergunta, listando as notas |
| `always` | | Reescreve na hora |
| `never` | | Não mexe |

O rótulo, o título, o `^bloco` e o estilo escrito são mantidos
(`[[Beta|o beta]]` vira `[[Gamma|o beta]]`). Links markdown relativos são
reescritos como caminho, não como nome curto. URLs `https://` não mudam.
Front matter e código não são reescritos. A nota aberta numa aba fica sem
salvar; o desfazer vale. As outras são gravadas se não tiverem mudado no
disco desde a pré-visualização.

## Configurações

| Chave | Padrão |
| --- | --- |
| `newLinkFormat` | `shortest` |
| `updateLinksOnRename` | `ask` |

## Limitações

- Sem transclusão. Sem salto para `^bloco`. Sem resolver alias.
- A exportação HTML é sempre um `<a>`, nunca o conteúdo incorporado.
- Menções sem link param em 200 e ignoram arquivos grandes.
