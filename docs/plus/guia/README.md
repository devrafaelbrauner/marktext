# Guia do MarkText Plus

O MarkText Plus é um fork do MarkText com uma plataforma de plugins e recursos
compatíveis com cofres do Obsidian: wikilinks, tags, notas diárias, quadros
Kanban, consultas Dataview, diagramas Mermaid, ícones Lucide e um leitor de
PDF. O corretor gramatical usa o LanguageTool e fica desligado até você
ativá-lo.

Os plugins embutidos vêm com o aplicativo. Plugins de terceiros ainda não
rodam nesta versão; o desenho combinado está em
[Plugins da comunidade](../desenvolvimento/plugins-comunidade.md).

Abra uma pasta (Arquivo → Abrir pasta) para backlinks, tags, calendário,
consultas e links entre notas. Um arquivo solto não tem cofre.

Os comandos dos plugins aparecem na paleta (`Ctrl+Shift+P` no Windows e no
Linux, `Cmd+Shift+P` no macOS).

## Neste guia

| Página | Conteúdo |
| --- | --- |
| [Compilação](compilacao.md) | Como instalar dependências e rodar este fork |
| [Modo de segurança](modo-seguro.md) | O que `--safe` desliga de fato |
| [Onde ficam os dados](dados.md) | `plugins.json`, `secrets.json`, cache do índice |
| [Preferências → Plugins](preferencias.md) | Ativar, desativar, configurações e segredos |
| [Compatibilidade com o Obsidian](compatibilidade-obsidian.md) | O que vai e volta, e o que não |

### Plugins

| Plugin | Ligado por padrão |
| --- | --- |
| [Links](plugins/links.md) | sim |
| [Tags](plugins/tags.md) | sim |
| [Ícones](plugins/icones.md) | sim |
| [Calendário e notas diárias](plugins/notas-diarias.md) | sim |
| [Dataview](plugins/dataview.md) | sim |
| [Kanban](plugins/kanban.md) | sim |
| [Mermaid](plugins/mermaid.md) | sim |
| [Leitor de PDF](plugins/pdf.md) | sim |
| [Corretor gramatical](plugins/corretor.md) | não |

English: [User guide](../guide/README.md).
