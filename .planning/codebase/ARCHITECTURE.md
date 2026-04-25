# Architecture

**Analysis Date:** 2026-04-25

## Pattern Overview

**Overall:** Electron three-process architecture (Main / Preload / Renderer) with a layered service-oriented main process and a Zustand-driven, event-streaming React renderer.

**Key Characteristics:**
- Strict process isolation: renderer never talks to Node APIs directly — every cross-process call goes through `electronAPI.invoke` (request/response) or `electronAPI.on` (push events) defined in `electron/preload/index.ts`.
- Main process is organized into IPC handlers (`electron/main/ipc/`) that delegate to services (`electron/main/services/`) — handlers are thin orchestration shells; business logic lives in services.
- Provider abstraction: all LLM backends conform to `ProviderRuntime` (`electron/main/services/providers/types.ts`) so the message pipeline stays provider-agnostic.
- Tool system inspired by OpenClaude/OpenCode: every tool implements `ToolDef` with Zod input validation, permission checks, and concurrency-safety flags. Read-only tools run in parallel; write tools run serially.
- Streaming-first chat: assistant responses are pushed to the renderer through per-thread IPC channels (`chat:stream:<threadId>`, `chat:activity:<threadId>`, `chat:complete:<threadId>`, `chat:error:<threadId>`, `chat:done:<threadId>`, `chat:tool-approval:<threadId>`) so multiple threads can stream in parallel.
- SQLite + Prisma for persistence, with raw `CREATE TABLE IF NOT EXISTS` bootstrapping in `electron/main/services/prisma.ts` (no migrations folder is shipped).

## Layers

**Renderer (UI):**
- Purpose: Presentational React layer, user input, optimistic state, IPC consumer.
- Location: `src/`
- Contains: React components (`src/components/`), Zustand stores (`src/stores/`), hooks (`src/hooks/`), API helpers (`src/lib/`), shared catalog (`src/shared/`).
- Depends on: `window.electronAPI` (typed in `src/lib/electron-api.ts`).
- Used by: User. Mounts via `src/main.tsx` → `src/App.tsx`.

**Preload Bridge:**
- Purpose: Whitelisted IPC surface exposed to the renderer through `contextBridge`.
- Location: `electron/preload/index.ts`
- Contains: Two functions only — `invoke(channel, ...args)` and `on(channel, callback)` returning an unsubscribe function.
- Depends on: `electron.ipcRenderer`.
- Used by: Renderer via `window.electronAPI`.

**IPC Handlers (Main):**
- Purpose: Translate IPC channels into service calls; emit streaming events back to the renderer's `BrowserWindow`.
- Location: `electron/main/ipc/`
- Contains: `projects.ts`, `threads.ts`, `messages.ts`, `providers.ts`, `dialog.ts`, `shell.ts`, `files.ts`, `git.ts`, plus the registration aggregator `index.ts`.
- Depends on: services in `electron/main/services/`, `prisma`, `electron.ipcMain`.
- Used by: Preload (through IPC channel names).

**Service Layer:**
- Purpose: Domain logic — providers, tools, persistence, thread auto-titling.
- Location: `electron/main/services/`
- Contains:
  - `prisma.ts` — Prisma client + `ensureDatabase()` raw schema bootstrap.
  - `providers/` — provider runtime contract + implementations (`lm-studio.ts`, `ollama.ts`, `openai-compatible.ts` base class, `factory.ts` registry, `provider-config.ts` URL persistence, `types.ts`).
  - `tools/` — tool registry (`definitions/`), execution pipeline (`tool-execution.ts`), concurrency orchestrator (`tool-orchestration.ts`), OpenAI-native loop (`tool-executor-openai.ts`), system prompt builder (`tool-definitions.ts`), per-run state (`file-state.ts`, `tool-context.ts`), Zod ↔ OpenAI schema bridge (`zod-to-openai-tools.ts`), logger (`tool-logger.ts`), shared tool contract (`tool.ts`), Zod helpers (`schema/`).
  - `threads/auto-title.ts` — generates a thread title from the first user message.
- Depends on: Prisma, fetch, node:fs/promises, node-pty (via shell IPC).
- Used by: IPC handlers.

**Persistence:**
- Purpose: Local SQLite database stored under `app.getPath("userData")/duck-codex.db`.
- Location: `prisma/schema.prisma` (model definitions); `electron/main/services/prisma.ts` (client + bootstrap).
- Contains: `Project`, `Thread`, `Message`, `BenchmarkRun`, `BenchmarkResult` models, plus a runtime-only `tool_logs` table created by raw SQL.
- Depends on: `@prisma/client` with `datasourceUrl` injected at runtime.
- Used by: All IPC handlers via the singleton `prisma` export.

## Data Flow

**Chat send → stream → tool loop:**

1. User submits text in `src/components/chat/chat-input.tsx`.
2. `src/hooks/use-chat.ts::sendMessage` adds an optimistic user message to the store, generates a `runId`, calls `useAppStore.startStream`, then invokes `electronAPI.invoke("message:send", { threadId, content, runId })`.
3. `electron/main/ipc/messages.ts::message:send` writes the user message via Prisma and fires `streamResponse(...)` (fire-and-forget). The handler returns the persisted user message immediately so the renderer can render it.
4. `streamResponse` in `electron/main/ipc/messages.ts` loads the thread + history via Prisma, resolves the provider with `getProvider(thread.provider)` (`electron/main/services/providers/factory.ts`), creates an `AbortController`, and registers it in `activeStreams`. If the first user message matches the default-title pattern, it kicks off `generateAndApplyThreadTitle` in parallel.
5. Branch on `approvalMode`:
   - `"no-tools"` → call `provider.sendMessageStream(...)` directly with a synthesized system prompt (`detectLanguage` chooses pt/en/es).
   - Otherwise → `runWithOpenAITools(...)` in `electron/main/services/tools/tool-executor-openai.ts` runs an iterative tool loop (max `MAX_TOOL_ITERATIONS = 20` from `tool-context.ts`).
6. Tool loop iteration:
   - Build `SendMessageRequest` with system prompt (`buildSystemPrompt` in `tool-definitions.ts`) and tool schemas (`buildOpenAIToolSchemas` in `zod-to-openai-tools.ts`).
   - `OpenAICompatibleProvider.sendMessageStream` (`providers/openai-compatible.ts`) POSTs `/v1/chat/completions` with `stream: true`, parses SSE deltas, sanitizes Harmony control tokens (`<|channel|>`, `<|message|>`, `<|end|>`, `<|return|>`), accumulates `delta.tool_calls`, and emits `StreamChunk` deltas + `thinking` activity to `onChunk`.
   - If the model returned `tool_calls`, parse JSON args, push to `runTools` (`tool-orchestration.ts`) which partitions concurrency-safe (read-only) tools into `Promise.all`, runs write tools serially.
   - Each call goes through `runToolUse` in `tool-execution.ts`: alias-normalize args → Zod validate → `validateInput` → `checkPermissions` (which may emit `chat:tool-approval:<threadId>` and await user via `pendingApprovals` in `messages.ts`) → `tool.call(input, ctx)` → log + emit `tool_call`/`tool_result` activity.
   - Append assistant message (with `tool_calls`) and one `role: "tool"` message per result back into `loopHistory`. Loop guards: identical `read_file` call twice ≡ loop; any other tool repeated `LOOP_THRESHOLD = 3` times ≡ loop. On detection, push a `STOP` synthetic tool result and force a final text-only completion.
7. Each `StreamChunk` is forwarded to `mainWindow.webContents.send("chat:stream:<threadId>", { runId, text })` or `chat:activity:<threadId>`. The renderer listener (`src/hooks/use-chat.ts::useStreamListeners`) appends to `useAppStore.activeStreams[threadId]`.
8. On completion, `messages.ts` runs `git diff --numstat` against `resolveThreadWorkdir(...)`, persists the assistant message with metadata (`runId`, `provider`, `model`, `costUsd`, `durationMs`, `lineAdditions`, `lineDeletions`, `thinking`, `activities`), updates `thread.sessionId` if config still matches, and emits `chat:complete:<threadId>` followed by `chat:done:<threadId>` in the `finally` block.
9. The renderer's `chat:complete` handler triggers `fetchMessages(threadId)`; `chat:done` clears the per-thread stream and dequeues any queued message (auto-send pattern).

**State Management:**
- Renderer owns ephemeral UI state in Zustand (`src/stores/app-store.ts`, `src/stores/settings-store.ts`).
- `activeStreams: Record<string, ThreadStreamState>` keyed by `threadId` enables parallel streaming.
- Server-side state lives entirely in SQLite; renderer re-fetches via `fetchProjects`, `fetchThreads`, `fetchMessages` on navigation events.
- Per-run tool state (read-dedup, file-state, todos) is held in module-level maps inside `electron/main/services/tools/` and reset at the start of each `runWithOpenAITools` invocation (`clearFileState`, `clearTodos`, `clearReadDedup`).
- Per-thread approval memory lives in `threadApprovals: Map<threadId, Set<"tool::path">>` inside `tool-executor-openai.ts` — once a user approves `edit_file` on a path, subsequent calls in the same thread skip the prompt.

## Key Abstractions

**`ProviderRuntime` (interface):**
- Purpose: Uniform contract every LLM backend implements.
- Examples: `electron/main/services/providers/types.ts` (interface), `electron/main/services/providers/openai-compatible.ts` (abstract base), `electron/main/services/providers/lm-studio.ts`, `electron/main/services/providers/ollama.ts`.
- Pattern: Strategy pattern + abstract base class. Subclasses only override `getBaseUrl`, `getAuthHeaders`, `fetchModelValues`, and `catalog`. The base class owns SSE parsing, Harmony sanitization, tool-call accumulation, and message building.

**`ToolDef<TInput>` (interface):**
- Purpose: Self-contained tool definition with Zod schema, permission policy, and execution.
- Examples: `electron/main/services/tools/tool.ts` (contract + `buildTool` factory), `electron/main/services/tools/definitions/read-file.ts`, `edit-file.ts`, `write-file.ts`, `bash.ts`, `grep.ts`, `glob.ts`, `list-files.ts`, `delete-file.ts`, `rename-file.ts`, `create-directory.ts`, `ask-user.ts`, `todo-write.ts`.
- Pattern: Registry pattern. `TOOL_REGISTRY` array in `definitions/index.ts` is the single source of truth — `buildOpenAIToolSchemas` and `findToolByName` both consume it. `buildTool()` enforces fail-closed defaults (assume writes, ask for approval).

**`SendMessageRequest` / `StreamChunk` / `SendMessageResult`:**
- Purpose: Wire-format DTOs between IPC layer ↔ provider ↔ tool executor.
- Examples: `electron/main/services/providers/types.ts`.
- Pattern: Discriminated union on `StreamChunk.type` (`"delta" | "done" | "error" | "activity"`) and on `activity.kind` (`"tool_call" | "tool_result" | "info" | "thinking" | "ask_user"`).

**`ToolUseContext`:**
- Purpose: Per-call execution context carrying `projectPath`, `threadId`, `runId`, `approvalMode`, `signal`, and an `onActivity` emitter.
- Examples: `electron/main/services/tools/tool.ts`.
- Pattern: Context object passed by reference into every tool — gives tools a way to surface activity without knowing about IPC.

**`ThreadStreamState`:**
- Purpose: Per-thread streaming buffer in the renderer (content, activities, error, pending approval).
- Examples: `src/stores/app-store.ts`.
- Pattern: Keyed-by-threadId object so multiple chats stream concurrently without cross-contamination.

## Entry Points

**Electron main process:**
- Location: `electron/main/index.ts`
- Triggers: `app.whenReady()` from `electron`.
- Responsibilities: Set app name, run `ensureDatabase()`, create `BrowserWindow` (1200×800, hidden-inset titlebar, preload `../preload/index.mjs`, `sandbox: false`), load Vite dev URL or built `index.html`, register all IPC handlers via `registerAllHandlers(mainWindow)`.

**Preload script:**
- Location: `electron/preload/index.ts`
- Triggers: Loaded by Electron before renderer scripts execute.
- Responsibilities: Expose `electronAPI` (`invoke`, `on`) on `window` via `contextBridge.exposeInMainWorld`.

**Renderer entry:**
- Location: `src/main.tsx` → `src/App.tsx`
- Triggers: `index.html` script tag.
- Responsibilities: Mount `<App />` in StrictMode; on first render `App` calls `fetchProjects()` and `fetchProviderCatalog()`. View-switching between chat layout and settings is driven by `useAppStore.activeView`.

**IPC channels (renderer → main):**
- `project:list | create | update | delete` — `electron/main/ipc/projects.ts`
- `thread:list | create | update | delete` — `electron/main/ipc/threads.ts`
- `message:list | send | stop | tool-approval-response`, `thread:logs` — `electron/main/ipc/messages.ts`
- `provider:catalog | get-config | set-config | list-models` — `electron/main/ipc/providers.ts`
- `dialog:*` — `electron/main/ipc/dialog.ts`
- `shell:*` (node-pty terminal) — `electron/main/ipc/shell.ts`
- `files:list | read | watch | unwatch` — `electron/main/ipc/files.ts`
- `git:*` — `electron/main/ipc/git.ts`

**IPC channels (main → renderer, per-thread streaming):**
- `chat:stream:<threadId>` — text deltas
- `chat:activity:<threadId>` — `tool_call`, `tool_result`, `thinking`, `info`, `ask_user`
- `chat:tool-approval:<threadId>` — request user approval
- `chat:complete:<threadId>` — final text + sessionId
- `chat:error:<threadId>` — provider/tool error
- `chat:done:<threadId>` — terminal event (always emitted in `finally`)
- `thread:renamed` — auto-title result
- `files:changed` — fs watcher event

## Error Handling

**Strategy:** Fail-soft at the protocol boundary, surface human-readable messages to the user, and log structured context to console.

**Patterns:**
- `streamResponse` in `electron/main/ipc/messages.ts` wraps the entire pipeline in try/catch/finally; aborts emit no error event, other failures emit `chat:error:<threadId>`. The `finally` block always emits `chat:done:<threadId>` and clears `activeStreams`.
- Tool errors are caught inside `runToolUse` (`tool-execution.ts`) and converted to `{ success: false, output: <message> }` so the model sees a `role: "tool"` message and can self-correct on the next iteration.
- JSON-arg parse failures inside `tool-executor-openai.ts` synthesize a structured error tool result with the raw preview and parser message (instead of throwing) — keeps the loop going.
- Zod validation errors are formatted by `electron/main/services/tools/schema/format-zod-error.ts`.
- `OpenAICompatibleProvider.sendMessageStream` throws on HTTP non-2xx; SSE parse errors per line are silently skipped (`continue`).
- Loop-detection inside the tool executor forces a final text-only model turn rather than failing.
- Path traversal guarded by `resolveSafe(projectPath, relativePath)` in `electron/main/services/tools/tool.ts`.
- Empty model output falls back to thinking text or a sentinel message (`"[modelo retornou resposta vazia ...]"`) so the UI never shows a blank bubble.

## Cross-Cutting Concerns

**Logging:**
- Console-based with bracket-prefixed scopes: `[message:send]`, `[stream]`, `[provider]`, `[openai-tools]`, `[harmony]`.
- Tool calls and results are persisted in the `tool_logs` SQLite table via `electron/main/services/tools/tool-logger.ts`; renderer fetches them via `thread:logs` and renders in `src/components/chat/thread-logs-panel.tsx`.

**Validation:**
- Zod schemas declared per tool (`electron/main/services/tools/definitions/*.ts`).
- Argument-alias normalization (`ARG_ALIASES` in `tool-execution.ts`) maps frequent local-model misspellings (`file_path` → `path`, `cmd` → `command`, etc.) before validation.

**Authentication:**
- No app-level auth. Provider-level API keys: not currently used (`lm-studio`, `ollama` are local). `OpenAICompatibleProvider.getApiKeyStatus` and friends are stubs ready to be overridden.

**Concurrency:**
- Tool concurrency partitioned by `isConcurrencySafe` flag (read-only ⇒ parallel, write ⇒ serial) inside `tool-orchestration.ts::runTools`.
- Multi-thread parallel streaming managed by `activeStreams` map in `electron/main/ipc/messages.ts` (one `AbortController` per `threadId`).
- Pending approvals keyed by `${threadId}:${runId}` in `pendingApprovals` map.

**Cancellation:**
- `AbortController` plumbed from IPC handler → provider `fetch` → tool execution. `message:stop` aborts the controller; checked in the loop, between serial tools, and in the `done`/`error` branches.

---

*Architecture analysis: 2026-04-25*
