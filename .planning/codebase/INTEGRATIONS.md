# External Integrations

**Analysis Date:** 2026-04-25

## APIs & External Services

**Local LLM providers (currently wired):**
- LM Studio — local OpenAI-compatible chat completions backend.
  - SDK/Client: bare `fetch` against `${baseUrl}/v1/chat/completions` (SSE streaming) and `${baseUrl}/api/v1/models`.
  - Implementation: `electron/main/services/providers/lm-studio.ts` (extends `OpenAICompatibleProvider`).
  - Streaming logic shared with all OpenAI-compatible backends in `electron/main/services/providers/openai-compatible.ts`. Includes harmony-format token sanitation for `gpt-oss-*` models (regexes `HARMONY_TOKEN_RE`, `HARMONY_BARE_TOKEN_RE`, `HARMONY_PARTIAL_RE`).
  - Auth: none (`getAuthHeaders()` returns `{}`).
  - Default base URL: `http://127.0.0.1:1234` (`provider-config.ts` → `DEFAULT_LM_STUDIO_BASE_URL`).
  - Configurable at runtime via `provider-config.json` (see Environment Configuration below).

- Ollama — local OpenAI-compatible chat completions backend.
  - SDK/Client: bare `fetch` against `${baseUrl}/v1/chat/completions` (SSE) and `${baseUrl}/api/tags` for model listing.
  - Implementation: `electron/main/services/providers/ollama.ts` (extends `OpenAICompatibleProvider`).
  - Auth: none.
  - Default base URL: `http://localhost:11434` (`provider-config.ts` → `DEFAULT_OLLAMA_BASE_URL`).

**Provider catalog (single source of truth):**
- `src/shared/provider-catalog.ts` — declares `PROVIDER_CATALOG` consumed by both renderer and main process (imported from main via relative path `../../../../src/shared/provider-catalog.js`).
- Currently exposes `lm-studio` and `ollama` only. The product context names additional providers (`claude-code`, `codex`, `openai`) — these are NOT registered in `electron/main/services/providers/factory.ts`, where the only entries are `LmStudioProvider` and `OllamaProvider`. Remote providers must still be implemented; the `ProviderRuntime` interface in `electron/main/services/providers/types.ts` already declares `getApiKeyStatus` / `setApiKey` / `removeApiKey` / `testApiKey` to accommodate them.

**External binaries invoked via child processes:**
- `git` — `electron/main/ipc/git.ts` shells out via `node:child_process` `execFile` for `rev-parse`, `branch`, `for-each-ref`, `checkout`. Operates on a project's path or a thread-resolved workdir.
- Editor launchers — `electron/main/ipc/shell.ts` detects and launches VS Code (`code`, `code-insiders`), Cursor (`cursor`), Windsurf (`windsurf`), Zed (`zed`). Detection uses `which` / `where` and on macOS `/Applications/*.app` checks.
- Terminal emulators — `electron/main/ipc/shell.ts` opens external terminals (`x-terminal-emulator`, `gnome-terminal`, `konsole`, `xterm` on Linux; `Terminal.app` on macOS; `cmd.exe` on Windows).
- Shell sessions — `node-pty` (`pty.spawn`) launches `$SHELL`/`/bin/zsh`/`/bin/bash`/`/bin/sh` (or `cmd.exe` on Windows) for the in-app xterm UI.

## Data Storage

**Databases:**
- SQLite (single-file, embedded) — primary application store.
  - Connection: `file:<userData>/duck-codex.db`. `DATABASE_URL` is set programmatically in `electron/main/services/prisma.ts` before instantiating `PrismaClient`.
  - Client: Prisma 6.9.0 (`@prisma/client`).
  - Schema: `prisma/schema.prisma` defines `Project`, `Thread`, `Message`, `BenchmarkRun`, `BenchmarkResult`.
  - Bootstrap: `ensureDatabase()` in `electron/main/services/prisma.ts` runs `CREATE TABLE IF NOT EXISTS …` for every model plus `tool_logs` (which is `DROP TABLE IF EXISTS` + recreated each launch — destructive across restarts) and ad-hoc `ALTER TABLE threads ADD COLUMN approval_mode` migration.
  - Dev DB also at `prisma/dev.db` for `pnpm db:studio` / `make db-studio` / `make db-push`.

**File Storage:**
- Local filesystem only. Tool implementations under `electron/main/services/tools/definitions/` (`read-file.ts`, `write-file.ts`, `edit-file.ts`, `list-files.ts`, `create-directory.ts`, `delete-file.ts`, `rename-file.ts`, `glob.ts`, `grep.ts`) operate directly on the project workdir.
- File-state tracking (e.g., "unchanged since last read" guard) in `electron/main/services/tools/file-state.ts`.

**Caching:**
- None (no Redis, no in-process cache library detected). The only persisted runtime state outside SQLite is `<userData>/provider-config.json`.

## Authentication & Identity

**Auth Provider:**
- None — desktop app, single local user.
- Per-provider API key plumbing exists in `electron/main/services/providers/types.ts` (`ApiKeyStatus`, `setApiKey`, `removeApiKey`, `testApiKey`), but the two implemented providers (LM Studio, Ollama) do not require keys (`requires_api_key: false` in `src/shared/provider-catalog.ts`; `getAuthHeaders()` returns `{}`).
- No secret storage backend (no use of `keytar`, `safeStorage`, OS keychain, etc.).

## Monitoring & Observability

**Error Tracking:**
- None. No Sentry, Bugsnag, or similar SDK. Errors are surfaced to the renderer via thrown exceptions across IPC boundaries.

**Logs:**
- `console.log` / `console.warn` only. Notable instrumentation in `electron/main/services/providers/openai-compatible.ts`:
  - Prompt-size diagnostic: `[provider] model=… messages=… promptChars=… toolChars=… approxTokens=…`.
  - Harmony-format diagnostics: `[harmony] raw buffered (…)`, `[harmony] empty after sanitization …`.
- Tool execution logging persisted to the `tool_logs` SQLite table (created in `ensureDatabase()` at `electron/main/services/prisma.ts`); writes happen through `electron/main/services/tools/tool-logger.ts`.
- Benchmark results persisted to `benchmark_runs` / `benchmark_results` (`prisma/schema.prisma`) — used to compare provider/model performance.

## CI/CD & Deployment

**Hosting:**
- Distributed as a desktop application. No `electron-builder` / `electron-forge` config detected — current `pnpm build` only emits the `out/` directory (`out/main/index.js`, `out/renderer/index.html`, etc.).

**CI Pipeline:**
- None detected. No `.github/workflows/`, `.gitlab-ci.yml`, `circleci`, or `drone` config in repo.

## Environment Configuration

**Required env vars:**
- `DATABASE_URL` — required for any out-of-app Prisma command (e.g. `prisma generate`, `prisma db push`, Prisma Studio). Inside the running Electron app it is set automatically by `electron/main/services/prisma.ts` to `file:<userData>/duck-codex.db`.
- `ELECTRON_RENDERER_URL` — used in dev only (`electron/main/index.ts`). When set, main loads the renderer from the dev server URL; otherwise it loads `out/renderer/index.html`.
- `SHELL` — read in `electron/main/ipc/shell.ts` to choose the PTY shell (falls back to `/bin/zsh`, `/bin/bash`, `/bin/sh`).

**Secrets location:**
- No secrets directory. Provider API keys are not yet implemented for remote providers; when added they would flow through `ProviderRuntime.setApiKey` (currently a no-op for both LM Studio and Ollama).
- `provider-config.json` at `app.getPath("userData")` — non-secret runtime config (base URLs).

## Webhooks & Callbacks

**Incoming:**
- None. The app does not host an HTTP server; all inbound traffic is the user invoking the UI.

**Outgoing:**
- HTTP requests to local LLM endpoints only:
  - `POST {lmStudioBaseUrl}/v1/chat/completions` — streaming chat (SSE).
  - `GET  {lmStudioBaseUrl}/api/v1/models` — model listing.
  - `POST {ollamaBaseUrl}/v1/chat/completions` — streaming chat (SSE).
  - `GET  {ollamaBaseUrl}/api/tags` — model listing.
- Plus `BrowserWindow.webContents.setWindowOpenHandler` in `electron/main/index.ts` delegates external URL opens to the system browser via `shell.openExternal`.

## IPC Surface (Electron internal "integrations")

The renderer talks to the main process exclusively through `contextBridge.exposeInMainWorld("electronAPI", …)` defined in `electron/preload/index.ts`. Handlers are registered in `electron/main/ipc/index.ts` and split by concern:

- `electron/main/ipc/projects.ts` — CRUD on `Project` rows.
- `electron/main/ipc/threads.ts` — CRUD on `Thread` rows; auto-title via `electron/main/services/threads/auto-title.ts`.
- `electron/main/ipc/messages.ts` — message send/stream pipeline; bridges into provider runtimes and tool execution.
- `electron/main/ipc/dialog.ts` — native `showOpenDialog` / `showSaveDialog`.
- `electron/main/ipc/providers.ts` — read/write provider config (base URLs), test connectivity, refresh model lists.
- `electron/main/ipc/shell.ts` — `shell:open-path`, `shell:open-url`, `shell:open-in-editor`, `shell:list-installed-editors`, `shell:open-terminal`, `terminal:create|resize|write|kill` (PTY).
- `electron/main/ipc/files.ts` — filesystem helpers used by the renderer (outside the LLM tool surface).
- `electron/main/ipc/git.ts` — `git:summary`, `git:summary-for-thread`, `git:checkout-branch`, `git:checkout-branch-for-thread`.

---

*Integration audit: 2026-04-25*
