# Project Architecture

## Visao Geral
`duck-codex` e um app desktop em `Tauri 2 + React` para conversar com providers de IA por projeto e por thread. O frontend cuida da UI e do estado local; o backend Rust cuida de persistencia, processos, acesso a disco e integracoes com providers.

## Frontend
- `src/components/`: UI principal, incluindo sidebar, chat, settings e paines.
- `src/stores/`: estado global com Zustand.
- `src/hooks/use-chat.ts`: ponte entre eventos Tauri e estado de streaming.
- `src/lib/`: tipos, helpers de providers e utilitarios.

Fluxo:
- o usuario escolhe um projeto e uma thread;
- o chat envia mensagem via `invoke("send_message")`;
- eventos `chat:stream`, `chat:complete`, `chat:error` e `chat:done` atualizam a UI;
- mensagens persistidas sao recarregadas por thread.

## Backend
- `src-tauri/src/commands/mod.rs`: comandos Tauri expostos ao frontend.
- `src-tauri/src/db/mod.rs`: SQLite, CRUD de projetos, threads e mensagens.
- `src-tauri/src/process/mod.rs`: factory de providers e execucao de chat.
- `src-tauri/src/openai_api.rs`: armazenamento local da chave OpenAI e chamadas auxiliares da API.

## Persistencia
- SQLite guarda:
- `projects`
- `threads` com `provider`, `model`, `reasoning` e `session_id`
- `messages` com `metadata`

Cada thread representa uma conversa persistente dentro de um projeto. O `session_id` identifica continuidade de contexto no provider atual.

## Providers
- `claude`: integrado via `Claude Code CLI`
- `codex`: integrado via `codex exec`
- `openai`: integrado via `Responses API`

A factory de providers unifica:
- catalogo de modelos
- capabilities
- resolucao de versao
- spawn/execucao

## Decisoes Atuais
- streaming usa `run_id` para isolar execucoes concorrentes;
- o estado de streaming e associado a uma thread especifica;
- `chat:complete` e a fonte de verdade para persistir a resposta final;
- `plan mode` e tratado como comportamento do app, nao do transporte.
