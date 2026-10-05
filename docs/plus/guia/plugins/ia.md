# IA (OpenRouter)

Corrige texto, cria tabelas, faz contas e responde perguntas com o modelo de
IA que você escolher na [OpenRouter](https://openrouter.ai), usando a sua
própria chave. **Desligado** até você ativar em Preferências → Plugins: ele
envia texto para um servidor.

Id: `ai`. Só funciona na aba markdown do editor visual.

## Configurar

1. Em Preferências → Plugins, ative **IA (OpenRouter)**.
2. Crie uma chave em <https://openrouter.ai/keys> e cole em **Chave de API da
   OpenRouter** (`apiKey`). Ela vai criptografada para `secrets.json` e não
   volta a aparecer.
3. Em **Modelo padrão** (`defaultModel`) cole o id de um modelo copiado de
   <https://openrouter.ai/models>, por exemplo `anthropic/claude-sonnet-4` ou
   `openai/gpt-4o-mini`. O aplicativo não baixa lista de modelos: o id é
   texto livre e só é conferido pela OpenRouter no pedido.
4. Opcional: cada comando tem um campo de modelo próprio (`fixTextModel`,
   `createTableModel`, `solveMathModel`, `researchModel`). Vazio usa o modelo
   padrão.

Para pesquisa na web, acrescente `:online` ao id (recurso da OpenRouter), por
exemplo `openai/gpt-4o-mini:online` no modelo de **Pesquisar**.

## Comandos

Paleta de comandos. Nenhum tem atalho.

| Id               | Nome               | O que faz                               |
| ---------------- | ------------------ | --------------------------------------- |
| `ai.fixText`     | IA: Corrigir texto | Substitui o texto pela versão corrigida |
| `ai.createTable` | IA: Criar tabela   | Insere uma tabela abaixo                |
| `ai.solveMath`   | IA: Calcular       | Insere o resultado abaixo               |
| `ai.research`    | IA: Pesquisar      | Insere a resposta abaixo                |

Entrada: a seleção (ela sobrevive à paleta tomar o foco) ou, só com o cursor,
o parágrafo, título ou célula de tabela inteiro onde ele está.

Exemplos:

- Selecione `Eu vai na escola` → **IA: Corrigir texto** → `Eu vou na escola`.
- Cursor numa linha `2+2*2` → **IA: Calcular** → `6` aparece na linha de
  baixo.
- Cursor numa linha como `Populações de São Paulo, Rio e Belo Horizonte` →
  **IA: Criar tabela** → uma tabela Markdown aparece abaixo.
- Cursor numa pergunta → **IA: Pesquisar** → a resposta aparece abaixo.

**Corrigir texto** faz um pedido por bloco selecionado (no máximo 20 blocos).
Cada correção é um passo de desfazer próprio e mantém os espaços em volta.
Se o bloco mudou enquanto o modelo respondia, a correção não é aplicada.

**Criar tabela**, **Calcular** e **Pesquisar** mandam o texto selecionado
como um só pedido (no máximo 20 000 caracteres). A resposta é lida como
Markdown e inserida como blocos novos _depois_ do bloco de nível superior que
contém o fim da seleção; o texto do pedido fica. Tudo é um passo de desfazer.
Se esse bloco mudou nesse meio-tempo, a resposta vai depois do bloco do
cursor.

## Consentimento

Antes do primeiro pedido aparece **Enviar texto à OpenRouter?**, com o
servidor e o modelo. Nada é enviado antes do consentimento, da chave e do
modelo. Aceitar grava `consentGiven: true` em `plugins.json`. Para retirar,
desligue **Permitir o envio de texto à OpenRouter**.

## O que sai da máquina

Só o processo principal fala com a rede. Vai só o texto do comando: a seleção
ou o bloco do cursor. Só blocos verificáveis são enviados (parágrafos,
títulos, células de tabela); front matter, código, matemática e HTML nunca
vão. Não vão o caminho do arquivo nem outras notas.

A OpenRouter repassa o texto ao provedor do modelo escolhido. O uso do texto
depende das políticas da OpenRouter e desse provedor.

## Custo

A OpenRouter cobra por token na sua conta, conforme o preço do modelo. O
aplicativo não mostra custo nem saldo. Sem créditos, o pedido falha com erro.

## Erros e limites

Chave, modelo ou URL faltando ou inválidos, chave recusada ou modelo
desconhecido mostram uma notificação e abrem Preferências nas configurações
do plugin.

| Situação                           | Resultado                                                        |
| ---------------------------------- | ---------------------------------------------------------------- |
| 401                                | Chave recusada                                                   |
| 402                                | Sem créditos                                                     |
| 403                                | Recusado (proibido ou moderação)                                 |
| 404, ou 400 “not a valid model ID” | Modelo não encontrado                                            |
| 429, 502, 503, falha de rede       | Nova tentativa com espera (respeita `Retry-After`); depois, erro |
| Outro 5xx                          | Erro do servidor                                                 |
| 60 s sem resposta                  | Tempo esgotado, sem nova tentativa                               |

O aplicativo limita a 20 pedidos por minuto. A resposta chega inteira, sem
streaming. Só um comando de IA roda por vez.

## Configurações

| Chave              | Padrão                         | Efeito                                                     |
| ------------------ | ------------------------------ | ---------------------------------------------------------- |
| `apiKey`           | não definido                   | Segredo                                                    |
| `defaultModel`     | vazio                          | Id do modelo para todos os comandos                        |
| `fixTextModel`     | vazio                          | Modelo de Corrigir texto                                   |
| `createTableModel` | vazio                          | Modelo de Criar tabela                                     |
| `solveMathModel`   | vazio                          | Modelo de Calcular                                         |
| `researchModel`    | vazio                          | Modelo de Pesquisar                                        |
| `baseUrl`          | `https://openrouter.ai/api/v1` | Só para um proxy compatível; `http://` só para `localhost` |
| `consentGiven`     | desligado                      | Permissão de envio                                         |
