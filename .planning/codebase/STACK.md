# Technology Stack

**Analysis Date:** 2026-04-25

## Languages

**Primary:**
- TypeScript ~5.9.3 — Used across all three Electron processes (main, preload, renderer) and the React UI. Strict mode enabled in `tsconfig.app.json` and `tsconfig.node.json`.
- TSX (React) — UI components under `src/components/`, mounted via `src/main.tsx` / `src/App.tsx`.

**Secondary:**
- JavaScript (ESM) — `eslint.config.js`, build output in `out/main/index.js`, `out/preload/index.mjs`.
- Prisma schema DSL — `prisma/schema.prisma` (SQLite datasource).
- SQL (raw) — `electron/main/services/prisma.ts` uses `prisma.$executeRawUnsafe` to bootstrap tables.

## Runtime

**Environment:**
- Node.js (host runtime confirmed: v24.x; project does not pin via `.nvmrc`).
- Electron ^36.4.0 — desktop shell. Main entry compiled to `out/main/index.js`, declared in `package.json`'s `main` field.
- Chromium renderer (bundled with Electron 36) — runs the React 19 UI loaded from `out/renderer/index.html`.
- TypeScript target `ES2023`, `module: ESNext`, `moduleResolution: bundler` (see `tsconfig.app.json`, `tsconfig.node.json`).
- Project uses ESM (`"type": "module"` in `package.json`).

**Package Manager:**
- pnpm (preferred — `pnpm-lock.yaml` is committed; `package.json` declares `pnpm.onlyBuiltDependencies` to allow native rebuilds for `electron`, `prisma`, `@prisma/client`, `node-pty`).
- npm also supported (`package-lock.json` present; `Makefile` invokes `npm install`, `npm run dev`, etc.).
- Lockfiles: `pnpm-lock.yaml` and `package-lock.json` both present at project root.

## Frameworks

**Core:**
- Electron ^36.4.0 — desktop application shell (`electron/main/index.ts`, `electron/preload/index.ts`).
- electron-vite ^3.1.0 — orchestrates separate builds for `main`, `preload`, `renderer` per `electron.vite.config.ts`.
- React ^19.2.4 + react-dom ^19.2.4 — renderer UI under `src/`.
- Vite ^6.3.5 with `@vitejs/plugin-react` ^4.5.2 — bundler used inside electron-vite.
- Tailwind CSS ^4.2.2 via `@tailwindcss/vite` ^4.2.2 — styling pipeline registered in `electron.vite.config.ts` renderer config.
- Prisma ^6.9.0 + `@prisma/client` ^6.9.0 — ORM. Generator and SQLite datasource in `prisma/schema.prisma`.

**Testing:**
- Not detected. No `jest.config.*`, `vitest.config.*`, or `*.test.*` / `*.spec.*` files exist in the repo. Verification of `read_file` / `edit_file` robustness (a stated user goal) currently relies on manual usage and the `BenchmarkRun` / `BenchmarkResult` Prisma models in `prisma/schema.prisma`.

**Build/Dev:**
- electron-vite ^3.1.0 — `pnpm dev` (`electron-vite dev`), `pnpm build` (`electron-vite build`), `pnpm preview`.
- `@electron/rebuild` ^4.0.3 — rebuilds native modules (`node-pty`) post-install via `postinstall` script.
- ESLint ^9.39.4 with `typescript-eslint` ^8.57.0, `eslint-plugin-react-hooks` ^7.0.1, `eslint-plugin-react-refresh` ^0.5.2 — config in `eslint.config.js` (flat config, ignores `dist`).
- `Makefile` provides developer-friendly aliases: `make dev`, `make build`, `make lint`, `make rebuild`, `make db-generate`, `make db-push`, `make db-studio`, `make check`.

## Key Dependencies

**Critical:**
- `@prisma/client` ^6.9.0 — DB access. SQLite file lives at `<userData>/duck-codex.db`, created on app start by `ensureDatabase()` in `electron/main/services/prisma.ts`.
- `prisma` ^6.9.0 (dev) — schema generation (`prisma generate` runs in `postinstall`).
- `node-pty` ^1.1.0 — interactive terminal sessions in `electron/main/ipc/shell.ts` (`pty.spawn`). Native module — requires `electron-rebuild`.
- `zod` ^4.3.6 — runtime validation for tool arguments (used under `electron/main/services/tools/schema/`, e.g. `format-zod-error.ts`, `coerce.ts`).
- `zustand` ^5.0.12 — client-side state stores under `src/stores/`.
- `react-markdown` ^10.1.0 + `remark-gfm` ^4.0.1 — render assistant Markdown messages in chat bubbles.
- `@xterm/xterm` ^6.0.0 + `@xterm/addon-fit` ^0.11.0 — terminal UI bound to `node-pty` sessions.
- `radix-ui` ^1.4.3 — headless UI primitives.
- `lucide-react` ^1.7.0 — icon set (configured in `components.json`).
- `class-variance-authority` ^0.7.1, `clsx` ^2.1.1, `tailwind-merge` ^3.5.0 — Tailwind class composition (shadcn/ui style under `src/components/ui/`).
- `minimatch` ^10.2.5 — glob matching used in tool definitions (`electron/main/services/tools/definitions/glob.ts`, `grep.ts`).

**Infrastructure:**
- `@electron/rebuild` ^4.0.3 (dev) — rebuild `node-pty` against Electron's Node ABI.
- `@types/node` ^24.12.0, `@types/react` ^19.2.14, `@types/react-dom` ^19.2.3, `@types/minimatch` ^5.1.2 — type packages.
- `globals` ^17.4.0 — ESLint global definitions.

## Configuration

**Environment:**
- No `.env` file present in repo.
- `DATABASE_URL` is set programmatically at runtime in `electron/main/services/prisma.ts`:
  - `dbPath = join(app.getPath("userData"), "duck-codex.db")`
  - `process.env.DATABASE_URL = "file:" + dbPath`
- `prisma/schema.prisma` declares `url = env("DATABASE_URL")` so `prisma generate` and `prisma db push` (e.g. `make db-push`) require the env var to be set in the dev shell when running outside Electron.
- A local SQLite file `prisma/dev.db` exists for development tooling (Prisma Studio).

**Provider configuration:**
- Stored at `<userData>/provider-config.json` by `electron/main/services/providers/provider-config.ts`. Tracks `lmStudioBaseUrl` (default `http://127.0.0.1:1234`) and `ollamaBaseUrl` (default `http://localhost:11434`).
- No API keys are persisted; the only currently wired providers are local (LM Studio, Ollama). The `ProviderRuntime` interface in `electron/main/services/providers/types.ts` still exposes `getApiKeyStatus`/`setApiKey`/`removeApiKey` for future remote providers (claude-code, codex, openai mentioned in product context).

**Build:**
- `electron.vite.config.ts` — three-target config: `main` (entry `electron/main/index.ts`), `preload` (entry `electron/preload/index.ts`), `renderer` (entry `index.html`, root `.`, alias `@` → `src`).
- `tsconfig.json` — root references `tsconfig.app.json` (renderer/`src`) and `tsconfig.node.json` (electron/main + vite config).
- `tsconfig.app.json` — `jsx: react-jsx`, path alias `@/*` → `./src/*`, `verbatimModuleSyntax`, `erasableSyntaxOnly`, strict.
- `tsconfig.node.json` — Node 2023 lib, includes `electron/**/*.ts` and `electron.vite.config.ts`.
- `components.json` — shadcn/ui config (style `new-york`, base color `neutral`, alias `@/components`, `@/lib/utils`, `@/components/ui`, `@/lib`, `@/hooks`, icon library `lucide`).
- `eslint.config.js` — flat config. Ignores `dist`. Browser globals only (no Node globals layered for `electron/`, which can mask Node-API misuse there).

## Platform Requirements

**Development:**
- Node.js capable of running Electron 36 / Vite 6 (Node 18+ recommended; tested host on 24.12).
- pnpm or npm.
- C/C++ toolchain to rebuild `node-pty` (`electron-rebuild -w node-pty` triggered by `postinstall` and exposed via `make rebuild`).
- Local LLM tooling for the dev loop:
  - LM Studio reachable on `http://127.0.0.1:1234` (REST endpoints `/api/v1/models`, `/v1/chat/completions`).
  - Ollama reachable on `http://localhost:11434` (`/api/tags`, `/v1/chat/completions`).

**Production:**
- Cross-platform desktop app (macOS, Linux, Windows). Platform branches in `electron/main/ipc/shell.ts` (`process.platform === "darwin" | "linux" | "win32"`) cover terminal launch, editor launch (VS Code, Cursor, Windsurf, Zed), and shell selection.
- macOS-specific UI: `titleBarStyle: "hiddenInset"` and `trafficLightPosition` in `electron/main/index.ts`.
- No packaging/distribution config (`electron-builder`, `electron-forge`) detected — `pnpm build` only emits the `out/` bundle.

---

*Stack analysis: 2026-04-25*
