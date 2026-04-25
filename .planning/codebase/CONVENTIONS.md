# Coding Conventions

**Analysis Date:** 2026-04-25

## Naming Patterns

**Files:**
- React components: `kebab-case.tsx` filenames containing `PascalCase` exports (e.g., `chat-area.tsx` exports `ChatArea`, `message-bubble.tsx` exports `MessageBubble`). See `src/components/chat/chat-area.tsx`.
- Hooks: `use-*.ts` filenames with `useX` exports (e.g., `src/hooks/use-chat.ts`).
- Stores: `kebab-case.ts` with a `useXStore` export (e.g., `src/stores/app-store.ts` → `useAppStore`).
- Utility/library modules: `kebab-case.ts` (e.g., `src/lib/electron-api.ts`, `src/lib/elapsed-time.ts`, `src/lib/relative-time.ts`).
- Electron services: `kebab-case.ts` grouped by domain (e.g., `electron/main/services/tools/tool-execution.ts`, `electron/main/services/providers/openai-compatible.ts`).
- Tool definitions: `kebab-case.ts` matching the tool name (e.g., `electron/main/services/tools/definitions/read-file.ts` for the `read_file` tool).

**Functions:**
- `camelCase` for all functions and methods (e.g., `resolveSafe`, `findToolByName`, `describeToolCall` in `electron/main/services/tools/tool-execution.ts`).
- React components and factories use `PascalCase` (e.g., `ChatArea`, `MessageBubble`, `ReadFileTool`).
- Predicate helpers use `is*`/`has*` prefixes (e.g., `isBlockedPath` in `electron/main/services/tools/definitions/read-file.ts`).

**Variables:**
- `camelCase` for locals and module-level mutable state (e.g., `activeStreams`, `pendingApprovals` in `electron/main/ipc/messages.ts`).
- `SCREAMING_SNAKE_CASE` for constants and tuning knobs (e.g., `MAX_READ_CHARS`, `MAX_FILE_SIZE`, `BLOCKED_PATHS`, `LOG_PREVIEW_LIMIT`, `MODEL_LABELS`).

**Types:**
- `PascalCase` for interfaces and type aliases (e.g., `ToolDef`, `ToolUseContext`, `ToolResult`, `PermissionDecision`, `ApprovalMode`, `ProviderHistoryMessage`).
- Discriminated unions use a string literal `behavior`/`kind`/`type` field (see `PermissionDecision` and `ActivityChunk` in `electron/main/services/tools/tool.ts`).

**IPC Channels:**
- Pattern `resource:action` (e.g., `project:list`, `thread:list`, `message:list`, `message:tool-approval-response`, `provider:catalog`).
- Streaming push channels keyed by entity id: `chat:stream:{threadId}`, `chat:complete:{threadId}`, `chat:error:{threadId}`, `chat:done:{threadId}` (declared in `AGENTS.md` and used in `electron/main/ipc/messages.ts`).

## Code Style

**Formatting:**
- No Prettier or Biome configuration is committed. Style is enforced by convention plus ESLint.
- Observed conventions in `src/` and `electron/`:
  - 2-space indentation.
  - Double-quoted strings (e.g., `import { create } from "zustand";` in `src/stores/app-store.ts`).
  - Trailing semicolons.
  - Trailing commas in multi-line object/array literals.

**Linting:**
- Tool: ESLint 9 (flat config) at `eslint.config.js`.
- Extends:
  - `@eslint/js` recommended.
  - `typescript-eslint` recommended.
  - `eslint-plugin-react-hooks` flat recommended.
  - `eslint-plugin-react-refresh` Vite preset.
- Globals: `globals.browser`, ECMAScript 2020.
- Run with `npm run lint` (`package.json` scripts → `eslint .`). `dist` is globally ignored.

**TypeScript:**
- Project references at `tsconfig.json` split into `tsconfig.app.json` (renderer/`src`) and `tsconfig.node.json` (Electron main/preload + Vite config).
- Strictness flags enabled in both: `strict`, `noUnusedLocals`, `noUnusedParameters`, `erasableSyntaxOnly`, `noFallthroughCasesInSwitch`. App config additionally sets `noUncheckedSideEffectImports`.
- Module mode: `module: ESNext`, `moduleResolution: bundler`, `verbatimModuleSyntax: true`, `allowImportingTsExtensions: true`, `noEmit: true`.
- Target: `ES2023`. Renderer JSX: `react-jsx`.
- Path alias: `@/*` → `./src/*` (renderer only, declared in `tsconfig.app.json`).
- `verbatimModuleSyntax` requires explicit `import type` for type-only imports — observed throughout (e.g., `import type { Project, Thread, Message } from "@/lib/types"` in `src/stores/app-store.ts`; `import type { BrowserWindow } from "electron"` in `electron/main/ipc/messages.ts`).

## Import Organization

**Order (observed in renderer files such as `src/components/chat/chat-area.tsx` and `src/stores/app-store.ts`):**
1. External packages (`react`, `zustand`, `zod`, `lucide-react`, `react-markdown`).
2. `@/` alias imports (stores, hooks, lib, components).
3. Sibling/relative imports (`./message-bubble`, `./chat-input`).
4. Type-only imports (`import type { ... }`) typically grouped with their source module.

**Order (observed in Electron main files such as `electron/main/ipc/messages.ts`):**
1. Electron and Node built-ins (`electron`, `node:child_process`, `node:fs`, `node:path`).
2. Internal services using explicit `.js` extension (required by `allowImportingTsExtensions` + ESM resolution), e.g., `import { prisma } from "../services/prisma.js";`.
3. Type-only imports.

**Path Aliases:**
- Renderer: `@/*` resolves to `src/*`. Used for `@/lib/...`, `@/stores/...`, `@/hooks/...`, `@/components/...`.
- Electron main process does not use path aliases — relative imports only, with mandatory `.js` extensions.

## Error Handling

**Patterns:**
- IPC handlers wrap external calls in `try/catch` and surface errors as Portuguese console messages plus a no-op state update (e.g., `fetchProjects`, `fetchThreads`, `fetchMessages` in `src/stores/app-store.ts` log `"Erro ao buscar ..."`).
- Tool calls return a structured `ToolResult` `{ success: boolean; output: string; metadata? }` rather than throwing. See `electron/main/services/tools/tool.ts` and `electron/main/services/tools/definitions/read-file.ts` for the return-shape pattern (e.g., `return { success: false, output: "File not found: ..." }`).
- Validation uses `zod.safeParse` inside `buildTool().validateInput`, returning `{ valid: false, error }` on failure (`electron/main/services/tools/tool.ts`).
- Path-traversal protection throws a real `Error` to abort caller (`resolveSafe` in `electron/main/services/tools/tool.ts`).
- Error formatting helper `formatError(err: unknown)` in `electron/main/ipc/messages.ts` narrows `unknown` to a `string` via `instanceof Error` check; this is the canonical pattern for `unknown` exceptions.
- JSON parsing of metadata uses `try/catch` with silent fallback (`getAssistantMessageModel` in `src/components/chat/chat-area.tsx`).

**Fail-closed defaults:**
- `buildTool()` defaults `isReadOnly = false`, `isConcurrencySafe = false`, and asks for approval on writes when `approvalMode === "suggest"` (`electron/main/services/tools/tool.ts`).

## Logging

**Framework:**
- No structured logger. Uses `console.error` / `console.log` directly.
- Tool-specific logging via `electron/main/services/tools/tool-logger.ts` (`logRequest`, `logResponse`, `getLogs`).

**Patterns:**
- IPC fetch failures log Portuguese messages: `console.error("Erro ao buscar projetos:", err)` (`src/stores/app-store.ts`).
- Long log payloads truncated via `previewText(value, limit = LOG_PREVIEW_LIMIT)` in `electron/main/ipc/messages.ts` (default 240 chars).

## Comments

**When to Comment:**
- Section headers using `// ---` rule lines to demarcate logical regions in long files (see `electron/main/services/tools/tool.ts`, `electron/main/services/providers/types.ts`).
- JSDoc `/** ... */` for exported types, factory helpers, and tool fields (`ToolDef`, `ToolUseContext`, individual fields like `projectPath`, `runId`).
- Inline `//` comments explain non-obvious invariants (e.g., dedup-key reasoning in `electron/main/services/tools/definitions/read-file.ts` lines 71-88).

**JSDoc/TSDoc:**
- Used on exported APIs and tool descriptions. The `description` field on a tool is consumed by the LLM system prompt (see `ReadFileTool.description` in `electron/main/services/tools/definitions/read-file.ts`).

## Function Design

**Size:**
- Tool handlers (`call`) keep all I/O, validation, and formatting in a single async function (~80 lines for `ReadFileTool.call`).
- React components extract domain helpers above the component (e.g., `getModelLabel`, `getAssistantMessageModel`).

**Parameters:**
- Tools take `(input, ctx)` where `input` is Zod-typed and `ctx: ToolUseContext` carries cross-cutting state (`projectPath`, `threadId`, `runId`, `approvalMode`, `signal`, `onActivity`).
- IPC handlers use `(_, args: { ... })` for `ipcMain.handle` callbacks (the underscore-prefixed `_` denotes the unused `IpcMainInvokeEvent`). See `electron/main/ipc/messages.ts`.
- Zustand actions are arrow functions on the store object using `(set, get)` from `create`.

**Return Values:**
- Tool calls return `Promise<ToolResult>` — success/failure encoded in the result, never thrown across the IPC boundary.
- React components return JSX; named exports preferred (`export function ChatArea()`). Default exports are avoided in feature code.

## Module Design

**Exports:**
- Named exports throughout (`export function`, `export const`, `export interface`).
- Stores expose a single hook (`export const useAppStore = create<AppState>(...)`).
- Tool factories return a frozen object via `buildTool({ ... })` and export it (`export const ReadFileTool = buildTool({ ... })`).

**Barrel Files:**
- Tool definitions are aggregated in `electron/main/services/tools/definitions/index.ts` (registry + `findToolByName`).
- No barrel files in `src/components/` — each component imports from its own file.

## Schema & Validation

- All tool inputs are validated with Zod (`zod` v4) at runtime via `buildTool().validateInput`.
- Coercion helpers `coerceString`, `coerceNumber` from `electron/main/services/tools/schema/coerce.ts` wrap Zod schemas to accept stringly-typed LLM arguments.
- Zod errors are formatted for the LLM via `formatZodError` in `electron/main/services/tools/schema/format-zod-error.ts`.

## React Conventions

- Functional components only; hooks for state. No class components observed.
- State management split between component-local `useState` (UI controls like `provider`, `model`, `effort`) and global Zustand stores (`useAppStore`, `useSettingsStore`) for cross-component data.
- IPC events are subscribed at module level for global side effects (see `electronAPI.on("thread:renamed", ...)` at the bottom of `src/stores/app-store.ts`).
- `cn(...)` utility from `src/lib/utils.ts` (clsx + tailwind-merge) used for conditional class composition.

## UI Copy

- User-facing strings are written in Portuguese (PT-BR) per `AGENTS.md`. Examples: `"Erro ao buscar projetos:"` in `src/stores/app-store.ts`. Code identifiers and comments are mostly English; some inline comments are PT-BR.

---

*Convention analysis: 2026-04-25*
