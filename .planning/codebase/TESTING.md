# Testing Patterns

**Analysis Date:** 2026-04-25

## Status: No Automated Test Suite

**There is no committed automated test suite for duck-codex.**

Verification:
- No test runner is declared in `package.json` (`dependencies` and `devDependencies` contain no `vitest`, `jest`, `mocha`, `ava`, `playwright`, `@testing-library/*`, or similar).
- No `vitest.config.*`, `jest.config.*`, `playwright.config.*`, or equivalent configuration files exist at the project root.
- No `*.test.ts`, `*.test.tsx`, `*.spec.ts`, or `*.spec.tsx` files exist under `src/` or `electron/`.
- The only test files in the repository live under `example/openclaude/` (a vendored reference implementation imported as study material — not part of the duck-codex build). These are NOT executed by any project script.
- `package.json` exposes no `test` or `test:*` script. Available scripts are: `dev`, `build`, `preview`, `lint`, `postinstall`, `rebuild`, `db:studio`.

This is documented intentionally in `AGENTS.md`:
> "No dedicated automated test suite is committed yet."

## Required Pre-PR Validation

Per `AGENTS.md`, the minimum validation before opening a pull request is:

```bash
npm run lint          # ESLint across .ts/.tsx
npm run build         # electron-vite production build (main + preload + renderer)
npm run dev           # Manual smoke test of affected flows
```

Manual smoke test surface area to cover:
- Project CRUD (create/select/delete) via `src/components/sidebar/`.
- Thread selection and creation via `src/components/sidebar/sidebar.tsx`.
- Message streaming via `src/hooks/use-chat.ts` and `electron/main/ipc/messages.ts`.
- Provider switching (lm-studio, ollama) via `src/components/chat/chat-area.tsx` dropdown.
- Settings screen flows in `src/components/settings/settings-screen.tsx`.
- Tool approval flow in `src/components/chat/tool-approval-card.tsx` when `approvalMode === "suggest"`.

## Test Framework

**Runner:** Not configured.
**Assertion Library:** Not configured.
**Run Commands:** None.

## Test File Organization

Not applicable — no tests exist in the production tree.

## Reference: example/openclaude

The `example/openclaude/` directory contains a vendored copy of the OpenClaude project (referenced by `electron/main/services/tools/tool.ts` as inspiration). It uses Vitest and Bun test conventions:

- Tests are co-located beside source: `src/foo.ts` ↔ `src/foo.test.ts`.
- Some tests live in `src/__tests__/` directories.
- Naming: `<module>.test.ts` / `<module>.test.tsx`.

These patterns are NOT enforced in duck-codex but provide a precedent if a test suite is introduced.

## Mocking

Not applicable — no mocking framework is installed.

When tests are added, mocking will need to cover:
- Electron IPC (`electronAPI.invoke`, `electronAPI.on`) — currently exposed via `src/lib/electron-api.ts`.
- Prisma client (`electron/main/services/prisma.ts`) — needs a test database or `@prisma/client` mock.
- HTTP/SSE streams to provider endpoints (`electron/main/services/providers/openai-compatible.ts`, `ollama.ts`, `lm-studio.ts`).
- Filesystem operations in tool implementations (`electron/main/services/tools/definitions/*.ts`).
- `node-pty` terminal sessions used by `electron/main/ipc/shell.ts`.

## Fixtures and Factories

Not applicable.

If introduced, candidate fixture locations following the existing kebab-case convention:
- `electron/main/services/__fixtures__/` for backend fixtures.
- `src/__fixtures__/` for renderer fixtures.

## Coverage

**Requirements:** None enforced.
**View Coverage:** Not available.

## Test Types

**Unit Tests:** None.
**Integration Tests:** None.
**E2E Tests:** None. Electron-specific E2E tooling (Playwright + Electron, Spectron successor) is not configured.

## Common Patterns

Not applicable.

## Recommended Future Setup

If a test suite is introduced for duck-codex (consistent with the existing TS/ESM stack):

| Concern | Suggested Tool | Rationale |
|---------|----------------|-----------|
| Renderer unit/integration | Vitest + `@testing-library/react` | Vitest aligns with the existing Vite tooling (`electron-vite`, `vite@6`). |
| Electron main unit | Vitest (Node environment) | Same runner; `tsconfig.node.json` already isolates main-process code. |
| E2E | Playwright with Electron support | First-class Electron launch API. |
| Coverage | Vitest built-in (`v8` provider) | No additional config needed. |

A `test` script in `package.json` and a `vitest.config.ts` mirroring the `tsconfig.app.json` / `tsconfig.node.json` split would be the minimal entry point.

## Risk Areas Without Tests

Per the user's stated goal in memory (`duck-codex` must be a daily-driver editor with production-robust `read_file`/`edit_file`), the absence of tests is highest-impact in:

- `electron/main/services/tools/definitions/read-file.ts` — dedup keying, mtime staleness, path blocking, size limits.
- `electron/main/services/tools/definitions/edit-file.ts` — staleness detection vs. `recordFileRead`.
- `electron/main/services/tools/definitions/write-file.ts` — atomic write semantics.
- `electron/main/services/tools/tool.ts` — `resolveSafe` path-traversal guard.
- `electron/main/services/tools/tool-execution.ts` — permission pipeline (`validateInput → checkPermissions → call`).
- `electron/main/services/providers/openai-compatible.ts` and `ollama.ts` — SSE stream parsing and tool-call accumulation.

These are the first candidates for unit-test coverage when a test suite is introduced.

---

*Testing analysis: 2026-04-25*
