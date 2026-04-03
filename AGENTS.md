# Repository Guidelines

## Project Structure & Module Organization
- `src/`: React + TypeScript frontend (renderer process).
- `src/components/`: UI and feature components (`chat/`, `sidebar/`, `ui/`).
- `src/hooks/`: integration hooks (notably `use-chat.ts` for streaming).
- `src/stores/`: Zustand state stores (`app-store.ts`, `settings-store.ts`).
- `src/lib/`: shared types, utilities, provider catalog, and Electron API wrapper.
- `electron/main/`: Electron main process (Node.js).
  - `ipc/`: IPC handlers for projects, threads, messages, providers, and dialogs.
  - `services/`: Prisma client and provider services (Claude, OpenAI with streaming).
  - `services/providers/`: AI provider implementations with AES-256-GCM encrypted credentials.
- `electron/preload/`: Preload script exposing `electronAPI` via `contextBridge`.
- `prisma/`: Prisma schema for SQLite (projects, threads, messages).
- `docs/superpowers/specs/`: product/design notes.

## Build, Test, and Development Commands
- `npm run dev`: starts Electron app with Vite HMR for development.
- `npm run build`: production build (main + preload + renderer).
- `npm run lint`: runs ESLint across TS/TSX.
- `npx prisma db push`: sync database schema (development).
- `npx prisma generate`: regenerate Prisma client after schema changes.

Use project root as working directory for all commands.

## Tech Stack
- **Desktop:** Electron + electron-vite
- **Frontend:** React 19, TypeScript, Vite, Tailwind CSS 4 (oklch theme)
- **UI:** shadcn/ui (new-york style), Radix UI, Lucide icons
- **State:** Zustand 5
- **Database:** Prisma + SQLite
- **AI Providers:** Anthropic Messages API, OpenAI Responses API (both with SSE streaming)
- **Credentials:** AES-256-GCM encryption via node:crypto

## Coding Style & Naming Conventions
- Language: TypeScript/TSX throughout (frontend and backend).
- Follow ESLint and TypeScript strictness from `tsconfig*`.
- Prefer 2-space indentation and existing file style.
- Naming:
  - React components: `PascalCase` files (e.g., `ChatArea`).
  - Hooks: `use-*` / `useX` (e.g., `use-chat.ts`).
  - Stores/util modules: `kebab-case` filenames.
  - IPC channels: `resource:action` pattern (e.g., `project:create`, `thread:update`).
- User-facing UI copy should stay in PT-BR.

## IPC Communication Pattern
- Renderer calls main process via `electronAPI.invoke("channel", args)`.
- Main process pushes to renderer via `webContents.send("channel", payload)`.
- Streaming uses push channels: `chat:stream:{threadId}`, `chat:complete:{threadId}`, `chat:error:{threadId}`, `chat:done:{threadId}`.

## Testing Guidelines
- No dedicated automated test suite is committed yet.
- Minimum validation before PR:
  - `npm run lint`
  - `npm run build`
  - Manual smoke test in `npm run dev` for affected flows (project CRUD, thread selection, streaming, provider switching, settings).

## Commit & Pull Request Guidelines
- Use clear imperative commits, optionally scoped:
  - `feat(chat): add effort level dropdown`
  - `fix(providers): handle streaming abort correctly`
- PRs should include concise problem/solution summary and verification steps.

## Architecture Notes
- Frontend/backend boundary is Electron IPC: renderer triggers IPC calls; main process owns DB and API interactions.
- Avoid embedding business logic in presentational components — use `stores/`, `hooks/`, or main process services.
- Provider abstraction: common `ProviderRuntime` interface for all AI providers.
- Database auto-creates tables on first startup via `ensureDatabase()`.
