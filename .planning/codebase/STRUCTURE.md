# Codebase Structure

**Analysis Date:** 2026-04-25

## Directory Layout

```
duck-codex/
├── electron/
│   ├── main/
│   │   ├── index.ts                    # Electron main entry — creates BrowserWindow, registers IPC
│   │   ├── ipc/                        # IPC channel handlers (one file per domain)
│   │   │   ├── index.ts                # registerAllHandlers aggregator
│   │   │   ├── projects.ts             # project:list/create/update/delete
│   │   │   ├── threads.ts              # thread:list/create/update/delete
│   │   │   ├── messages.ts             # message:send/stop/list, streaming pipeline
│   │   │   ├── providers.ts            # provider:catalog/get-config/set-config/list-models
│   │   │   ├── dialog.ts               # native dialog wrappers
│   │   │   ├── shell.ts                # node-pty terminal sessions
│   │   │   ├── files.ts                # files:list/read/watch/unwatch
│   │   │   └── git.ts                  # git diff/status helpers
│   │   └── services/                   # Domain logic, decoupled from IPC
│   │       ├── prisma.ts               # Prisma client singleton + ensureDatabase()
│   │       ├── providers/              # LLM provider adapters
│   │       │   ├── factory.ts          # Provider registry (lm-studio, ollama)
│   │       │   ├── types.ts            # ProviderRuntime contract, DTOs
│   │       │   ├── openai-compatible.ts # Abstract base for OpenAI-format APIs
│   │       │   ├── lm-studio.ts        # LM Studio implementation
│   │       │   ├── ollama.ts           # Ollama implementation
│   │       │   └── provider-config.ts  # Persistent baseUrl storage
│   │       ├── threads/
│   │       │   └── auto-title.ts       # First-message thread title generator
│   │       └── tools/                  # Tool-calling subsystem
│   │           ├── tool.ts             # ToolDef contract + buildTool factory + resolveSafe
│   │           ├── tool-context.ts     # Project-context helpers (file tree, key files)
│   │           ├── tool-execution.ts   # runToolUse pipeline (validate→permit→call→log)
│   │           ├── tool-orchestration.ts # Concurrent vs serial tool batching
│   │           ├── tool-executor-openai.ts # OpenAI-native tool loop driver
│   │           ├── tool-definitions.ts # System prompt builder
│   │           ├── tool-logger.ts      # Persists tool_logs rows
│   │           ├── file-state.ts       # Per-run dedup of touched files
│   │           ├── zod-to-openai-tools.ts # Zod schema → OpenAI function schema
│   │           ├── definitions/        # One file per tool (read_file, edit_file, ...)
│   │           └── schema/             # Zod helpers (coerce, format-zod-error)
│   └── preload/
│       └── index.ts                    # contextBridge — exposes window.electronAPI
├── src/                                # Renderer (React 19)
│   ├── main.tsx                        # ReactDOM.createRoot entry
│   ├── App.tsx                         # Top-level layout, view switching
│   ├── index.css                       # Tailwind v4 entry
│   ├── components/
│   │   ├── chat/                       # Chat view (input, bubbles, approvals)
│   │   ├── sidebar/                    # Project + thread navigation
│   │   ├── settings/                   # Settings screen
│   │   ├── file-panel/                 # File tree side panel
│   │   ├── terminal/                   # xterm.js terminal panel
│   │   ├── ui/                         # Radix-based primitives (button, dialog, ...)
│   │   └── status-bar.tsx
│   ├── stores/                         # Zustand stores
│   │   ├── app-store.ts                # Projects, threads, messages, streams
│   │   └── settings-store.ts           # User settings
│   ├── hooks/
│   │   └── use-chat.ts                 # IPC stream subscription + sendMessage
│   ├── lib/                            # Renderer-side helpers
│   │   ├── electron-api.ts             # window.electronAPI typed accessor
│   │   ├── types.ts                    # Shared DTOs mirrored from main
│   │   ├── providers.ts                # Fallback provider catalog
│   │   ├── elapsed-time.ts             # Time formatting
│   │   ├── relative-time.ts
│   │   └── utils.ts                    # cn() classname helper
│   ├── shared/
│   │   └── provider-catalog.ts         # Shared between main + renderer
│   └── assets/
├── prisma/
│   └── schema.prisma                   # Project, Thread, Message, BenchmarkRun/Result
├── public/                             # Static assets
├── docs/                               # Project notes
├── example/                            # Reference codebases (claude-code, openclaude)
├── electron.vite.config.ts             # electron-vite config (main/preload/renderer)
├── tsconfig.json                       # Root TS config
├── tsconfig.app.json                   # Renderer TS config
├── tsconfig.node.json                  # Main/preload TS config
├── package.json                        # Scripts: dev, build, db:studio, postinstall
├── pnpm-lock.yaml
└── index.html                          # Vite renderer HTML entry
```

## Directory Purposes

**`electron/main/`:**
- Purpose: Node.js side of Electron — full filesystem, network, child-process access.
- Contains: Main entry, IPC handlers, services.
- Key files: `index.ts`, `ipc/index.ts`, `services/prisma.ts`.

**`electron/main/ipc/`:**
- Purpose: Adapt IPC channels to service calls. Each file groups channels by domain.
- Contains: One file per domain (`projects`, `threads`, `messages`, `providers`, `dialog`, `shell`, `files`, `git`).
- Key files: `messages.ts` (heaviest — owns streaming + tool-approval bridge), `index.ts` (aggregates registrations).

**`electron/main/services/providers/`:**
- Purpose: Provider adapters conforming to `ProviderRuntime`.
- Contains: Concrete providers, abstract base class, runtime types, base-URL persistence.
- Key files: `types.ts` (contract), `openai-compatible.ts` (heavy lifting — SSE, tool calls, Harmony sanitization), `factory.ts` (registry).

**`electron/main/services/tools/`:**
- Purpose: Tool-calling engine — schemas, execution, orchestration, prompt building.
- Contains: Tool registry under `definitions/`, execution pipeline files at the root.
- Key files: `tool.ts` (contract + `buildTool`), `tool-execution.ts` (per-call pipeline), `tool-orchestration.ts` (concurrent/serial), `tool-executor-openai.ts` (loop driver), `definitions/index.ts` (`TOOL_REGISTRY`).

**`electron/preload/`:**
- Purpose: Tiny bridge — only `invoke` and `on`. No business logic.

**`src/components/`:**
- Purpose: React UI organized by feature, plus a primitives folder.
- Contains: Feature folders (`chat`, `sidebar`, `settings`, `file-panel`, `terminal`) and a `ui/` folder of Radix-wrapped primitives.

**`src/stores/`:**
- Purpose: Zustand global state. Keep stores feature-scoped; avoid one mega-store.

**`src/hooks/`:**
- Purpose: Reusable hooks. Currently single-purpose (`use-chat.ts` for IPC stream wiring).

**`src/lib/`:**
- Purpose: Renderer-only utilities and typed wrappers around `window.electronAPI`.

**`src/shared/`:**
- Purpose: Pure data/types imported by BOTH renderer and main process. Currently `provider-catalog.ts` only.
- Note: Cross-process imports rely on relative paths (e.g. `../../../../src/shared/provider-catalog.js` from `electron/main/services/providers/lm-studio.ts`) because the `@/` alias is renderer-only.

**`prisma/`:**
- Purpose: Prisma schema. The actual SQLite file lives in `app.getPath("userData")` at runtime, not in this directory.

**`example/`:**
- Purpose: Reference implementations (`claude-code`, `openclaude`). Not built or deployed; used for ideation. Do not import from here.

**`docs/`:**
- Purpose: Architecture notes and TODO lists.

## Key File Locations

**Entry Points:**
- `electron/main/index.ts` — Electron main entry.
- `electron/preload/index.ts` — Preload bridge.
- `src/main.tsx` — Renderer bootstrap.
- `src/App.tsx` — Root React component.

**Configuration:**
- `electron.vite.config.ts` — Build config for all three Electron processes.
- `tsconfig.json`, `tsconfig.app.json`, `tsconfig.node.json` — TypeScript projects.
- `package.json` — Scripts and dependencies.
- `prisma/schema.prisma` — Data models.

**Core Logic:**
- `electron/main/ipc/messages.ts` — Streaming pipeline + tool-approval bridge.
- `electron/main/services/providers/openai-compatible.ts` — SSE parsing + tool-call accumulation + Harmony sanitization.
- `electron/main/services/tools/tool-executor-openai.ts` — Iterative tool loop with loop detection.
- `electron/main/services/tools/tool-execution.ts` — Per-call validate-permit-execute pipeline.
- `electron/main/services/tools/tool-orchestration.ts` — Concurrent/serial partitioning.
- `electron/main/services/tools/tool.ts` — `ToolDef` contract + `buildTool` factory.
- `electron/main/services/tools/definitions/index.ts` — `TOOL_REGISTRY` (single source of truth).
- `electron/main/services/prisma.ts` — Prisma singleton + raw schema bootstrap.
- `src/stores/app-store.ts` — Global renderer state including `activeStreams`.
- `src/hooks/use-chat.ts` — IPC subscription + optimistic `sendMessage`.
- `src/lib/electron-api.ts` — Typed `window.electronAPI` accessor.

**Testing:**
- None. No `*.test.*`, `*.spec.*`, or test config files exist in the project. The `example/` directory contains tests but is not part of the build.

## Naming Conventions

**Files:**
- `kebab-case.ts` for source files, including React components: `chat-area.tsx`, `tool-approval-card.tsx`, `new-project-dialog.tsx`, `tool-execution.ts`.
- React components are `.tsx`; pure logic and IPC handlers are `.ts`.
- Test files: not present.

**Directories:**
- `kebab-case` and lowercase: `electron/main`, `services/providers`, `components/chat`, `tools/definitions`.

**Symbols (TypeScript):**
- `PascalCase` for types, interfaces, classes, React components: `ProviderRuntime`, `ToolDef`, `OpenAICompatibleProvider`, `ChatArea`, `LmStudioProvider`.
- `camelCase` for functions, variables, store properties: `sendMessageStream`, `runToolUse`, `activeStreams`, `useAppStore`.
- `SCREAMING_SNAKE_CASE` for module-level constants: `TOOL_REGISTRY`, `MAX_TOOL_ITERATIONS`, `KEY_FILES`, `IGNORE_DIRS`, `MAX_SYSTEM_PROMPT_CHARS`, `ARG_ALIASES`.
- IPC channel names: `domain:action` (`message:send`, `thread:create`, `provider:catalog`); per-thread streaming uses `chat:event:<threadId>` (e.g. `chat:stream:abc123`).
- Database columns: `snake_case` mapped via Prisma `@map` (e.g. `projectId` ↔ `project_id`).

**Imports:**
- Renderer code uses the `@/` alias (`@/components/...`, `@/stores/...`, `@/lib/...`) configured in `electron.vite.config.ts`.
- Main-process code uses relative paths with `.js` extensions (ESM with bundler compatibility): `import { prisma } from "../services/prisma.js";`.
- Cross-process shared code (e.g. `src/shared/provider-catalog`) is imported from main with deep relative paths.

## Where to Add New Code

**New IPC channel:**
- Pick the matching domain file in `electron/main/ipc/` (or create a new `<domain>.ts` and register it in `electron/main/ipc/index.ts`).
- Add the handler with `ipcMain.handle("<domain>:<action>", ...)`.
- Mirror the call from the renderer through `electronAPI.invoke("<domain>:<action>", args)`. Add types to `src/lib/types.ts` if shared.

**New tool:**
- Create `electron/main/services/tools/definitions/<my-tool>.ts` exporting a `ToolDef` built with `buildTool({...})`. Define a Zod schema, set `isReadOnly` and `isConcurrencySafe` correctly (defaults are fail-closed).
- Add it to `TOOL_REGISTRY` in `electron/main/services/tools/definitions/index.ts`.
- Optional: extend `ARG_ALIASES` in `electron/main/services/tools/tool-execution.ts` if local models tend to use alternate field names.
- Optional: add a usage example to `buildOpenAIToolExamplesSection` in `electron/main/services/tools/tool-definitions.ts`.

**New provider:**
- Create `electron/main/services/providers/<my-provider>.ts`. If the API is OpenAI-compatible, extend `OpenAICompatibleProvider` and override only `getBaseUrl`, `getAuthHeaders`, and `fetchModelValues`. Otherwise implement `ProviderRuntime` from scratch.
- Add the provider id to `ApiProviderId` in `electron/main/services/providers/types.ts`.
- Register the instance in the `providers` record inside `electron/main/services/providers/factory.ts`.
- Add a catalog entry in `src/shared/provider-catalog.ts`.
- Update `electron/main/ipc/providers.ts` if the provider has special config (base URL, API key handling).

**New React component:**
- If feature-specific: place under the appropriate `src/components/<feature>/` folder. Add a new feature folder if none fits.
- If a generic primitive: place under `src/components/ui/` and follow the Radix wrapper pattern used by the existing files.
- Import using `@/components/...`. Use `cn()` from `@/lib/utils` for class merging.

**New store / global state:**
- Add a new file under `src/stores/` (e.g. `editor-store.ts`) — keep stores feature-scoped rather than appending to `app-store.ts`.

**New Prisma model:**
- Add the model to `prisma/schema.prisma` and mirror the table in `electron/main/services/prisma.ts::ensureDatabase()` using raw SQL (the project does not use Prisma migrations).
- Run `pnpm postinstall` (or `prisma generate`) to regenerate the client.

**New IPC streaming event:**
- Send from main: `mainWindow.webContents.send("chat:<event>:<threadId>", payload)`.
- Subscribe in renderer: extend `useStreamListeners` in `src/hooks/use-chat.ts`.
- Always include `runId` in the payload so stale streams can be filtered out.

## Special Directories

**`out/`:**
- Purpose: electron-vite build output (`out/main`, `out/preload`, `out/renderer`).
- Generated: Yes (`pnpm build`).
- Committed: Currently tracked in git (visible in `git status`), but should typically be gitignored.

**`dist/`:**
- Purpose: Additional build artifacts.
- Generated: Yes.
- Committed: No (typical).

**`node_modules/`:**
- Purpose: pnpm-managed dependencies. `pnpm.onlyBuiltDependencies` allows native rebuilds for `electron`, `prisma`, `@prisma/client`, `node-pty`.
- Generated: Yes.
- Committed: No.

**`example/claude-code/`, `example/openclaude/`:**
- Purpose: Reference implementations consulted during design (mentioned in code comments as "Inspired by OpenClaude's …", "Inspired by OpenCode's …").
- Generated: No.
- Committed: Yes — but excluded from build inputs.

**`.planning/codebase/`:**
- Purpose: GSD codebase analysis documents (this directory).
- Generated: By the `/gsd-map-codebase` workflow.
- Committed: Yes.

**`.superpowers/`, `.claude/`:**
- Purpose: Tooling and skill metadata for the Claude/Superpowers workflow.
- Generated: Mixed.

---

*Structure analysis: 2026-04-25*
