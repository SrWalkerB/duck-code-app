# Guia de Estudo — Construir Editor de Código Agentico

Roadmap técnico pra dominar antes/durante construção do duck-codex. Baseado em análise de `example/claude-code` (Anthropic CLI) e `example/openclaude` (OpenAI/multi-provider).

Cada seção: **conceito → o que estudar → onde olhar nos exemplos → critério de "sei o suficiente"**.

---

## 1. Loop de Agente (Agentic Loop)

### Conceito
Núcleo de qualquer assistente que usa tools. Pseudocódigo:

```
messages = [system, user_input]
loop:
  response = call_model(messages, tools)
  stream_text_to_ui(response)
  if response.stop_reason != "tool_use": break
  for tool_call in response.tool_uses:
    result = exec_tool(tool_call)  # pode pedir aprovação user
    messages.append(assistant_block(tool_call))
    messages.append(tool_result_block(result))
  # volta pro topo
```

### Estudar
- Diferença entre `stop_reason`: `end_turn`, `tool_use`, `max_tokens`, `stop_sequence`.
- Ordering: Anthropic exige `tool_result` no próximo `user` turn, mesma ordem dos `tool_use`. OpenAI usa `role: "tool"` com `tool_call_id`.
- Multi-tool por turno (modelo pode chamar N tools antes de responder).
- Quando interromper o loop (cancel do user, erro fatal, max iterations).

### Onde olhar
- `example/claude-code/query/QueryEngine.ts` — loop principal Anthropic.
- `example/claude-code/query.ts` — entry point.
- `example/openclaude/src/assistant/` — loop OpenAI-style.
- `example/openclaude/src/coordinator/` — orquestração.

### Sei o suficiente quando
Consigo desenhar no papel o fluxo completo de uma conversa com 2 tool calls aninhadas e explicar onde cada mensagem é appendada.

---

## 2. Streaming

### Conceito
Modelo retorna SSE (Server-Sent Events). Eventos chegam como deltas: `message_start`, `content_block_start`, `content_block_delta` (text ou input_json), `content_block_stop`, `message_delta`, `message_stop`.

### Estudar
- Parser SSE (linhas `data: {...}`, `event: name`).
- Acumular text deltas pra render incremental no UI.
- Acumular `input_json_delta` (tool args chegam fragmentados, parse só no `content_block_stop`).
- Backpressure — UI não pode travar com muitos deltas/seg (throttle/RAF).
- AbortController propagado pro `fetch` pra cancelar mid-stream.
- Reconnect/retry em erro de rede vs erro de API.

### Onde olhar
- Provider adapters em `electron/main/services/providers/claude.ts` e `openai.ts` (teu projeto).
- `example/openclaude/src/bridge/` — multi-provider streaming.

### Sei o suficiente quando
Implemento parser SSE do zero e cancelo um stream em curso sem leak de memória.

---

## 3. Tool Calling Protocol

### Conceito
Modelo recebe schema JSON das tools. Decide quando chamar. Retorna `tool_use` block. Você executa, devolve `tool_result`.

### Estudar
- **Schema JSON**: `name`, `description`, `input_schema` (JSONSchema). Description é prompt — escreva pensando que o modelo vai ler.
- **Diferença Anthropic vs OpenAI**:
  - Anthropic: `tools: [{name, description, input_schema}]`, response tem `content: [{type:"tool_use", id, name, input}]`.
  - OpenAI: `tools: [{type:"function", function:{name, description, parameters}}]`, response tem `tool_calls: [{id, function:{name, arguments}}]` (arguments é string JSON).
- **tool_choice**: `auto`, `any`, `none`, `{name:"X"}` pra forçar.
- **Parallel tool calls**: OpenAI `parallel_tool_calls: false` pra desligar.
- **Validação**: validar input contra schema antes de exec (Zod, Ajv).

### Onde olhar
- `example/claude-code/Tool.ts` — interface base.
- `example/claude-code/tools/*/` — N implementações.
- `electron/main/services/tools/tool.ts` (teu).

### Sei o suficiente quando
Adapto a mesma tool pra Anthropic e OpenAI sem mudar o handler, só o schema wrapper.

---

## 4. Context Window Management

### Conceito
Janela finita (200k Claude, 128k GPT-4). Conversas longas estouram. Precisa contar, comprimir, cachear.

### Estudar
- **Token counting**: tiktoken (OpenAI), Anthropic `/v1/messages/count_tokens`.
- **Prompt caching Anthropic**: `cache_control: {type:"ephemeral"}` em system, tools, ou messages. 5min TTL. Cache breakpoints — não invalidar cache topo da conv.
- **Compactação**: quando passa X% da janela, sumarizar mensagens antigas com sub-call ao modelo, substituir por resumo.
- **Sliding window** vs **summarization** vs **hierarchical summary**.
- **File content**: ler arquivo grande gasta tokens — usar offset/limit, ou buscar trechos via grep.

### Onde olhar
- `example/claude-code/cost-tracker.ts`, `costHook.ts`.
- `example/claude-code/context/` — compactação.

### Sei o suficiente quando
Conversa de 500 turnos não estoura janela e mantém cache hit > 80%.

---

## 5. Provider Abstraction

### Conceito
Uma interface, N backends (Anthropic, OpenAI, Ollama, LM Studio, Gemini, OpenRouter).

### Estudar
- Adapter pattern: normalizar messages, tools, streaming events, usage.
- **Auth**: API key header, Bearer token, OAuth (claude.ai login flow), CLI subprocess (claude-code/codex).
- **OpenAI-compatible endpoints**: maioria dos locais (Ollama, LM Studio, vLLM, llama.cpp) expõe `/v1/chat/completions` — um adapter cobre vários.
- **Capabilities**: nem todo provider suporta tool use, vision, streaming. Feature detection.
- **Cost calc**: input/output token price por modelo.

### Onde olhar
- `electron/main/services/providers/` (teu).
- `example/openclaude/src/bridge/`.

### Sei o suficiente quando
Adicionar novo provider OpenAI-compatible leva < 50 linhas.

---

## 6. Tool System — Filesystem Tools (CRÍTICO)

### Conceito
Read/edit/write robustos são o que separa toy de editor diário. Edge cases destroem confiança.

### Estudar — read_file
- Encoding detection (utf-8, utf-16 LE/BE, BOM strip).
- Binary detection (null bytes nos primeiros 8KB → recusar).
- Line numbering format (`cat -n` style: padding + tab).
- offset/limit (pular N linhas, ler M).
- Truncation pra arquivos enormes (avisar "showing 2000 of 50000 lines").
- Image files (retornar base64 + mime).
- PDF/notebook (parse especializado).
- Symlinks (resolver vs recusar).
- Path normalization (absolute path enforcement, prevent `..` escape).

### Estudar — edit_file
- **Exact match unique replace**: `old_string` deve aparecer 1x. Se 0 → erro. Se >1 → exigir mais contexto OU `replace_all: true`.
- **Read-before-edit guard**: bloquear edit se arquivo nunca foi lido na sessão (evita hallucination).
- Preservar line endings (detectar CRLF vs LF, manter).
- Preservar trailing newline.
- Preservar indentação (não normalizar tab/space).
- Diff preview pra UI (jsdiff ou diff library).
- Atomic write (escrever em `.tmp`, rename).
- Backup opcional.
- Permission check (read-only file → erro claro).
- Concurrent edit detection (mtime comparison).

### Estudar — write_file
- Atomic via tmp+rename (mesma partição!).
- mkdir -p do parent.
- Overwrite warning se arquivo existe e não foi lido.
- Encoding default utf-8 sem BOM.
- chmod preservation em overwrite.

### Estudar — glob/grep
- Usar `ripgrep` (rg) via spawn — ordens de magnitude mais rápido que JS puro.
- Respeitar `.gitignore` por default, opção pra desligar.
- Limite resultados (head -200).
- Fast-glob/picomatch pra glob puro.

### Estudar — bash
- `node-pty` pra TUI/colors funcionar.
- Timeout (kill após N seg).
- Stream stdout/stderr separado.
- cwd persistente entre calls (shell de longa duração) OU stateless (cwd por call).
- Env vars sanitizadas (não vazar segredos do main process).
- Background jobs (`run_in_background`) com handle pra ler depois.

### Onde olhar
- `example/claude-code/tools/FileReadTool/`, `FileEditTool/`, `FileWriteTool/`, `BashTool/`, `GlobTool/`, `GrepTool/`.
- `electron/main/services/tools/definitions/` (teu — comparar e melhorar).

### Sei o suficiente quando
Edit em arquivo CRLF Windows + utf-16 + read-only não corrompe nem mente.

---

## 7. Permission / Approval System

### Conceito
Tools perigosas (write, bash, delete) precisam aprovação user antes de executar. UX define se editor é usável.

### Estudar
- Risk classification por tool (read-only / write / exec / network).
- Allow-list persistida: "sempre permitir bash `npm test`", "sempre permitir write em /home/me/proj/**".
- Pattern matching pra rules (glob, regex, prefix).
- Modos: `default` (perguntar), `acceptEdits` (auto-aprova edits), `auto` (tudo), `plan` (só leitura).
- UI: card com diff/comando + botões approve/deny/always.
- Timeout de approval (não trava sessão).
- Rejected tool → tool_result com erro pro modelo entender e adaptar.

### Onde olhar
- `src/components/chat/tool-approval-card.tsx` (teu).
- `example/claude-code/tools/shared/` permission helpers.

### Sei o suficiente quando
Defino regra "sempre permitir grep" e nunca mais sou perguntado sobre grep.

---

## 8. Conversation State & Persistence

### Conceito
Threads salvas em DB. Resume após restart. Branch/edit histórico.

### Estudar
- Schema (já tens Prisma): `Thread` → `Message[]` → `ToolCall[]` + `ToolResult`.
- Message types: `user`, `assistant_text`, `assistant_tool_use`, `tool_result`, `system`.
- Ordering rigoroso (Anthropic crash se tool_use sem tool_result).
- Edit user message → fork ou truncate downstream.
- Re-roll assistant → drop última msg, re-call.
- Search/filter threads.
- Export (markdown, JSON).
- Migration (schema evolui).

### Onde olhar
- `prisma/schema.prisma` (teu).
- `electron/main/ipc/threads.ts`, `messages.ts`.
- `example/claude-code/history.ts`.

### Sei o suficiente quando
Mato app no meio de stream, reabro, conv aparece consistente sem msg órfã.

---

## 9. Prompt Engineering pra Agente

### Conceito
System prompt define personalidade, capacidades, restrições. CLAUDE.md/AGENTS.md ingerido. Sub-prompts pra subagents/skills.

### Estudar
- **System prompt structure**: identidade → tools disponíveis → ambiente (cwd, OS, date) → regras → formato output.
- **CLAUDE.md / AGENTS.md**: read no startup, append ao system. Recursivo (subdir CLAUDE.md ao entrar).
- **Tool description = prompt**: descrever quando usar, edge cases, formato de output esperado.
- **Few-shot examples** dentro de tool description.
- **Output style**: terse vs verbose, markdown vs plain.
- **Refusal/safety**: quando recusar.
- **Skills**: arquivos markdown invocáveis que injetam instruções extras só quando relevantes.

### Onde olhar
- `example/claude-code/skills/` — formato.
- `example/claude-code/outputStyles/`.
- `example/claude-code/setup.ts` — montagem do system prompt.

### Sei o suficiente quando
Mudo 1 linha no system prompt e vejo comportamento mudar previsivelmente.

---

## 10. Subagents (Task Tool)

### Conceito
Tool que cria sub-conversa isolada. Sub-agente roda loop próprio, retorna só sumário. Economiza contexto do principal.

### Estudar
- Quando usar: tarefas longas/exploratórias (search codebase, research).
- Contexto isolado: sub-agente não vê histórico do pai.
- Tool subset: pode restringir tools disponíveis ao sub.
- Return value: string sumário ou structured.
- Parallel subagents (multiple Task calls em paralelo).
- Background subagents (handle pra checar status).

### Onde olhar
- `example/claude-code/tools/AgentTool/`, `TaskCreateTool/`, `TaskGetTool/`.
- `example/claude-code/tasks/`, `Task.ts`.

### Sei o suficiente quando
Dispatch 3 subagents em paralelo pra explorar 3 dirs e mergeio resultados.

---

## 11. Hooks System

### Conceito
Shell commands ou JS handlers disparados em eventos: `PreToolUse`, `PostToolUse`, `UserPromptSubmit`, `Stop`, `SessionStart`.

### Estudar
- Configurar via settings.json.
- Hook pode bloquear tool (exit non-zero).
- Hook pode injetar contexto (stdout vira system reminder).
- Use cases: lint após edit, log audit, format código, notify.

### Onde olhar
- `example/claude-code/hooks/`.

### Sei o suficiente quando
Configuro hook que roda `prettier` após cada edit_file.

---

## 12. Slash Commands & Skills

### Conceito
Comandos invocáveis pelo user (`/foo`) ou auto-trigger por keyword (skills).

### Estudar
- Markdown file com frontmatter (name, description, args).
- Body é prompt template (substitui `$ARGUMENTS`).
- Skills: descrição é o trigger — modelo decide invocar.
- Plugin system pra distribuir.

### Onde olhar
- `example/claude-code/skills/`, `commands/`.
- `example/claude-code/plugins/`.

---

## 13. Electron Architecture

### Conceito
Main process (Node, fs, network) ↔ Renderer (Chromium, UI). IPC entre eles.

### Estudar
- `contextBridge` + preload script — expor API segura ao renderer.
- `nodeIntegration: false`, `contextIsolation: true` SEMPRE.
- IPC channels: `ipcMain.handle` / `ipcRenderer.invoke` (request/response), `webContents.send` / `ipcRenderer.on` (push, pra streaming).
- Streaming via channel: emitir `chunk-{id}` events pro renderer durante stream.
- Process model: tools rodam SEMPRE no main, renderer só renderiza.
- Auto-update (electron-updater).
- Code signing (Mac notarization, Windows cert).
- Single instance lock.
- Deep links / protocol handlers.

### Onde olhar
- `electron/main/ipc/` (teu).
- Docs: https://www.electronjs.org/docs/latest/tutorial/process-model

### Sei o suficiente quando
Renderer não tem acesso a `require('fs')` mas consegue ler arquivo via IPC.

---

## 14. UI/UX de Chat com Tools

### Conceito
Render conversa com text streaming, tool cards expansíveis, diffs, code highlight.

### Estudar
- **Markdown render**: react-markdown + remark-gfm.
- **Syntax highlight**: shiki (server-side, mais rápido) ou prism/highlight.js.
- **Diff render**: `react-diff-viewer-continued` ou monaco diff editor.
- **Tool call card states**: pending → approved/denied → running → success/error. Collapse/expand.
- **Token meter**: input/output/cache hit por turno + total $.
- **Auto-scroll** com pause-on-user-scroll.
- **Keyboard shortcuts**: send (cmd+enter), cancel (esc), new chat.
- **Multi-thread sidebar**: lista, search, pin, delete.
- **Settings UI**: providers, models, permissions, themes.

### Onde olhar
- `src/components/chat/` (teu).
- `example/claude-code/components/`, `ink/`.

---

## 15. Codebase Intelligence (Avançado)

### Conceito
Ir além de grep — entender semantica do código.

### Estudar
- **LSP client**: spawn language server (gopls, tsserver, pyright), JSON-RPC, requests: definition, references, diagnostics, hover.
- **Tree-sitter**: parse incremental, query syntax tree (functions, classes, imports).
- **Embeddings + vector search**: chunk arquivos, embed (Voyage/OpenAI), busca semântica. Opcional.
- **Symbol index**: ctags/SCIP pra goto-def cross-language.

### Onde olhar
- `example/claude-code/tools/LSPTool/`.

---

## 16. Safety, Observability, Reliability

### Estudar
- **Rate limit handling**: ler `Retry-After`, exponential backoff, queue.
- **Error taxonomy**: network, auth, rate limit, model error, tool error, validation. UX diferente pra cada.
- **Logs estruturados**: cada tool call (input, output, duration, error) → JSONL audit log.
- **Telemetry opt-in** (PostHog, anonymous).
- **Crash reporting** (Sentry).
- **Secret detection** antes de mandar pro modelo (regex AWS keys, GitHub tokens).
- **Path sandbox**: nunca permitir tool sair do workspace sem flag explícita.
- **`.gitignore` respect** em reads/greps por default.

---

## 17. Build & Distribution

### Estudar
- electron-builder ou electron-forge.
- Code signing (Apple Developer ID, Windows Authenticode).
- Auto-update server (electron-updater + S3/GitHub releases).
- ASAR packaging.
- Native deps rebuild (better-sqlite3, node-pty) — `electron-rebuild`.
- CI/CD multi-OS (GitHub Actions matrix).

---

## Ordem Recomendada de Estudo

1. **Loop + Streaming + Tool calling** (1, 2, 3) — núcleo, sem isso nada funciona.
2. **Filesystem tools production-grade** (6) — teu gap declarado, prioridade alta.
3. **Permission system** (7) — sem isso é inseguro.
4. **Persistence + State** (8) — sem isso não é editor diário.
5. **Provider abstraction** (5) + **Context mgmt** (4).
6. **Prompt engineering + CLAUDE.md** (9).
7. **Electron polish** (13) + **UI** (14).
8. **Subagents + Skills + Hooks** (10, 11, 12).
9. **LSP/tree-sitter** (15).
10. **Distribution** (17) — só quando tudo acima funcionar.

---

## Recursos Externos

- Anthropic API docs: https://docs.anthropic.com/en/api/messages
- OpenAI tool use: https://platform.openai.com/docs/guides/function-calling
- Tool use best practices: https://docs.anthropic.com/en/docs/build-with-claude/tool-use
- Prompt caching: https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching
- Electron security: https://www.electronjs.org/docs/latest/tutorial/security
- ripgrep: https://github.com/BurntSushi/ripgrep
- node-pty: https://github.com/microsoft/node-pty
- Tree-sitter: https://tree-sitter.github.io/tree-sitter/

---

## Exercícios Práticos (faça antes de copiar dos exemplos)

1. **Mini-loop**: CLI Node que conversa com Anthropic, 1 tool (`get_time`). 100 linhas.
2. **Add streaming**: mesma CLI, render text incremental.
3. **Add cancel**: Ctrl+C cancela mid-stream sem corromper estado.
4. **Add file tools**: read/write/edit com edge cases (CRLF, utf-16).
5. **Swap provider**: mesmo loop funcionando em OpenAI sem mudar tools.
6. **Add persistence**: SQLite, resume conv após restart.
7. **Add permission**: prompt yes/no antes de write/bash.
8. **Migrar pra Electron**: UI React, IPC streaming.
9. **Add subagent**: Task tool que dispara sub-loop isolado.
10. **Add CLAUDE.md ingest**: read recursivo, inject system.

Cada exercício = 1 commit. No fim tens duck-codex v0.
