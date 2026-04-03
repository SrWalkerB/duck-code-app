# TODO Programming Runtime

## Objetivo
Evoluir o app de chat funcional para um ambiente de programacao confiavel, com tools locais, aprovacoes, sessoes persistentes e agentes.

## Fase 1: Base Segura
- Mover a `OpenAI API key` para secure storage/keychain do sistema.
- Exibir custo real por mensagem com base em `usage` e tabela de precos por modelo.
- Melhorar telemetria local: `thread_id`, `run_id`, provider, duracao, erros e tool calls.
- Adicionar timeout configuravel por execucao com erro amigavel na UI.

## Fase 2: Tools Locais
- Implementar tools backend para `read_file`, `write_file`, `list_directory`, `search_text`.
- Implementar `run_command` com sandbox e limites por projeto.
- Persistir cada tool call e resultado em SQLite para replay e debug.
- Mostrar tool activity no chat de forma consistente entre providers.

## Fase 3: Aprovacoes
- Criar fluxo real de aprovacoes por tool:
- `default`: perguntar para tudo sensivel.
- `acceptEdits`: autoaprovar leitura e edicao simples.
- `plan`: bloquear execucao e permitir apenas plano/perguntas.
- `auto` / `bypass`: permitir execucao ampla com aviso claro.
- Exibir diffs antes de confirmar escrita destrutiva.

## Fase 4: Agents
- Definir runtime de agentes por thread e sub-agentes por tarefa.
- Permitir delegacao de subtarefas com contexto compartilhado controlado.
- Registrar traces de agent, handoff e resultados.
- Adicionar UI para acompanhar agentes ativos e resultados parciais.

## Fase 5: UX de Programacao
- Melhorar preview de diff, arquivos alterados e status de comando.
- Adicionar retry granular por tool/comando.
- Criar painel de execucoes com logs filtrados por `run_id`.
- Tornar perguntas de clarificacao e selects estruturados entre providers.

## Critério de Pronto
- Mesma thread mantém contexto e ferramentas entre mensagens.
- Ferramentas funcionam com aprovacoes previsiveis.
- Erros sao rastreaveis por logs e replay.
- O app consegue executar tarefas reais de coding sem depender de CLI externo.
