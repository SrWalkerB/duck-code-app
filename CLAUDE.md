# Duck Codex

App desktop (Tauri 2 + React + shadcn/ui) inspirado no **Codex App da OpenAI**, que serve como interface visual para o **Claude Code CLI**.

## Conceito

Cada projeto aponta para um diretório local. Dentro de cada projeto, o usuário cria threads (conversas). Cada thread spawna uma instância do `claude` CLI via `--output-format stream-json --verbose -p`, recebendo streaming de respostas em tempo real.

## Stack

- **Tauri 2** (Rust) — gerencia SQLite, spawna processos `claude`, IPC com frontend
- **React 19 + Vite** — webview frontend
- **shadcn/ui + Tailwind CSS 4** — componentes e estilização
- **Zustand** — state management
- **SQLite (rusqlite)** — persistência local de projetos, threads e mensagens

## Estrutura

```
src/                    # Frontend React
  components/
    sidebar/            # Sidebar estilo Codex (projects, threads, settings)
    chat/               # Chat area, message bubbles, input bar
    ui/                 # shadcn components
  hooks/                # use-chat (streaming, events)
  stores/               # Zustand app store
  lib/                  # Types, utils, relative-time

src-tauri/src/          # Backend Rust
  commands/             # Tauri IPC commands (CRUD, send_message, pick_folder)
  db/                   # SQLite schema e queries
  process/              # Claude CLI process manager (spawn, stream, kill)
```

## Convenções

- UI em **PT-BR** para textos user-facing
- Dark theme como padrão, com toggle para light
- Markdown renderizado com `react-markdown` + `remark-gfm`
- Modelos usam aliases do Claude CLI: `claude-sonnet-4-6`, `claude-opus-4-6`, `claude-haiku-4-5`
- Effort level (Low/Medium/High/Max) mapeado para `--effort` flag do CLI
