# Preferências → Plugins

Abra Preferências e escolha **Plugins** na barra lateral. A rota é
`/preference/plugins`. Um plugin pode abrir a própria ficha
(`/preference/plugins/<id>`), que rola até o cartão.

A página lista os dez plugins embutidos, na ordem em que são registrados.
Não dá para reordenar nem instalar outro daqui.

Cada cartão tem o nome, a versão `1.0.0`, a descrição e um interruptor
**Ativado**. Desligar para o código na hora. Plugins que mudam a leitura do
markdown (`links`, `tags`, `icons`, `kanban`) recarregam os documentos
abertos no editor. Não é preciso reiniciar o aplicativo.

## Configurações

O formulário sai do manifesto. O plugin não coloca código na janela de
preferências.

| Tipo            | Controle                                                  |
| --------------- | --------------------------------------------------------- |
| booleano        | interruptor                                               |
| texto           | campo; grava ao alterar                                   |
| número          | campo numérico, com mínimo, máximo e passo quando existem |
| lista de opções | menu                                                      |
| lista de textos | uma entrada por linha                                     |
| segredo         | senha, botões Salvar e Limpar                             |

Texto longo demais é recusado (10 000 caracteres; lista com no máximo 1 000
itens). Um valor que não casa com o padrão do campo também é recusado. A
mensagem aparece como “Não foi possível salvar…”.

Dois plugins têm um segredo: o corretor (**Chave de API**) e a IA
(**Chave de API da OpenRouter**). O renderer só sabe se ela está
configurada. O texto claro fica no processo principal, em
[`secrets.json`](dados.md). Salvar de novo substitui; Limpar apaga. O campo
não mostra o valor anterior.

Os outros campos vão para `plugins.json` assim que você os altera. Não há
botão “Aplicar” geral.

## Modo de segurança

Se o aplicativo foi aberto com `--safe`, um aviso amarelo explica que nenhum
plugin está rodando. Os interruptores e os campos ainda salvam. Veja
[Modo de segurança](modo-seguro.md).

## Idioma da interface

Os textos da página de plugins existem nos 12 idiomas do aplicativo. Os
nomes, descrições e rótulos de cada plugin existem em inglês e em português.
Nos outros idiomas da interface, esses rótulos caem no inglês.
