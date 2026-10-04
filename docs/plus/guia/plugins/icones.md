# Ícones

Ícones Lucide como `:lucide-nome:` , com seletor e autocompletar. Ligado por
padrão. Id: `icons`. O markdown guarda o código; HTML e PDF exportados podem
mostrar o SVG.

```markdown
Casa :lucide-house: e um alerta :lucide-triangle-alert:.
```

O `:` de abertura não pode estar colado a uma letra ou dígito
(`12:lucide-x:` continua texto). Nome desconhecido não vira ícone quebrado:
cai na regra de emoji, se houver. No editor o código some enquanto o cursor
está fora e o ícone é desenhado no lugar. Dentro de bloco de código o código
permanece texto.

Só existe o pacote Lucide. A busca aceita o nome, as etiquetas do Lucide e
sinônimos em português, sem acento (`coracao` acha `heart` quando o sinônimo
existe).

## Inserir

| Id | Atalho | Nome |
| --- | --- | --- |
| `icons.insert` | `Ctrl+Alt+Shift+I` / `Cmd+Alt+Shift+I` | Inserir ícone |

`Ctrl+Shift+I` já insere imagem, por isso o ícone leva Alt. O seletor: setas,
Enter insere, Esc fecha. Digitar `:lucide-` também abre a lista, no máximo
50 itens.

## Exportação

| `exportMode` | Padrão | Efeito |
| --- | --- | --- |
| `svg` | sim | `<svg class="mt-icon">` de 1em, cor `currentColor` |
| `shortcode` | | o texto `:lucide-nome:` |

Não há ajuste de tamanho nem de cor além disso.

O pacote é carregado na primeira vez que um código ou o seletor é usado.
