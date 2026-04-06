# Duck Code - Electron Rewrite Design Spec

## Context

The existing duck-codex app was built with Tauri (Rust backend) but became too complex to scale due to limited Rust expertise. The decision is to rewrite the entire backend using Electron + Node.js while preserving the frontend design (shadcn/ui, React, Zustand). The existing `backend/providers/` TypeScript code can be reused almost directly.

**Goal:** A Codex-like AI coding assistant desktop app where users create projects (linked to directories), have chat threads per project, and interact with OpenAI/Anthropic APIs via streaming.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│ Electron Main Process (Node.js)                         │
│  ├── IPC Handlers (projects, threads, messages, etc.)   │
│  ├── Provider Services (Claude, OpenAI - streaming)     │
│  ├── Credentials (AES-256-GCM encryption)               │
│  └── Prisma Client → SQLite                             │
├─────────────────────────────────────────────────────────┤
│ Preload (contextBridge)                                 │
│  └── electronAPI: { invoke, on, off }                   │
├─────────────────────────────────────────────────────────┤
│ Renderer (React + Vite)                                 │
│  ├── Components (sidebar, chat, settings, status-bar)   │
│  ├── Zustand Stores (app-store, settings-store)         │
│  ├── Hooks (use-chat)                                   │
│  └── shadcn/ui + Tailwind CSS 4 (oklch theme)           │
└─────────────────────────────────────────────────────────┘
```

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Desktop | Electron + electron-vite |
| Frontend | React 19, TypeScript, Vite |
| UI | shadcn/ui (new-york), Tailwind CSS 4, Radix UI, Lucide icons |
| State | Zustand 5 |
| Database | Prisma + SQLite |
| AI Providers | Anthropic Messages API, OpenAI Responses API (streaming) |
| Credentials | AES-256-GCM via node:crypto (existing code) |

---

## Database Schema (Prisma)

```prisma
model Project {
  id        String   @id @default(uuid())
  name      String
  path      String
  color     String   @default("#3b82f6")
  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")
  threads   Thread[]
  @@map("projects")
}

model Thread {
  id        String   @id @default(uuid())
  projectId String   @map("project_id")
  title     String
  provider  String   @default("openai")
  model     String   @default("gpt-5.1-codex-mini")
  effort    String   @default("medium")
  sessionId String?  @map("session_id")
  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")
  project   Project  @relation(fields: [projectId], references: [id], onDelete: Cascade)
  messages  Message[]
  @@map("threads")
}

model Message {
  id        String   @id @default(uuid())
  threadId  String   @map("thread_id")
  role      String
  content   String
  metadata  String?
  createdAt DateTime @default(now()) @map("created_at")
  thread    Thread   @relation(fields: [threadId], references: [id], onDelete: Cascade)
  @@map("messages")
}
```

API keys are stored using the existing `credentials.ts` module (AES-256-GCM encrypted in a separate SQLite file via `node:sqlite`), reused from `backend/providers/credentials.ts`.

---

## IPC Channels

### Request/Response (ipcMain.handle)

| Channel | Args | Returns |
|---------|------|---------|
| `project:list` | — | `Project[]` |
| `project:create` | `{ name, path, color }` | `Project` |
| `project:update` | `{ id, name?, color? }` | `Project` |
| `project:delete` | `{ id }` | `void` |
| `project:pick-folder` | — | `string \| null` |
| `thread:list` | `{ projectId }` | `Thread[]` |
| `thread:create` | `{ projectId, title, provider, model, effort }` | `Thread` |
| `thread:update` | `{ id, title?, provider?, model?, effort? }` | `Thread` |
| `thread:delete` | `{ id }` | `void` |
| `message:list` | `{ threadId }` | `Message[]` |
| `message:send` | `{ threadId, content, runId }` | `Message` (user msg) |
| `message:stop` | `{ threadId }` | `void` |
| `provider:catalog` | — | `ProviderCatalogEntry[]` |
| `provider:api-key-status` | `{ provider }` | `{ configured, last4 }` |
| `provider:set-api-key` | `{ provider, apiKey }` | `void` |
| `provider:remove-api-key` | `{ provider }` | `void` |
| `provider:test-api-key` | `{ provider, apiKey? }` | `string` |

### Push Channels (main → renderer via webContents.send)

| Channel | Payload |
|---------|---------|
| `chat:stream:{threadId}` | `{ runId, text }` — incremental delta |
| `chat:complete:{threadId}` | `{ runId, text, sessionId, costUsd, durationMs }` |
| `chat:error:{threadId}` | `{ runId, message }` |
| `chat:done:{threadId}` | `{ runId }` |

---

## Streaming Architecture

```
[OpenAI/Anthropic API] — SSE stream
       ↓
[Main Process: provider.sendMessageStream()]
       ↓ onChunk callback
[IPC handler: webContents.send(`chat:stream:${threadId}`)]
       ↓
[Preload: contextBridge exposes ipcRenderer.on]
       ↓
[Renderer: useChat() hook → appStore.addStreamContent()]
       ↓
[React re-renders StreamingBubble]
```

- Each active stream has an `AbortController` stored in a `Map<threadId, AbortController>`
- `message:stop` calls `controller.abort()` to cancel the fetch
- On completion, assistant message is saved via Prisma and `chat:complete` is sent
- On error, `chat:error` is sent with the error message

### Anthropic Streaming

Uses `fetch` with `stream: true` header. Parses SSE events, extracts `content_block_delta` with `text_delta` type.

### OpenAI Streaming

Uses `fetch` with `stream: true` on `/v1/responses`. Parses SSE events for `response.output_text.delta`.

---

## Provider System

Reuses existing `backend/providers/` code with minimal changes:

- `ClaudeProvider` — Anthropic Messages API (`/v1/messages`)
- `OpenAiProvider` — OpenAI Responses API (`/v1/responses`)
- `credentials.ts` — AES-256-GCM encryption using machine-specific key derivation

**Changes from existing code:**
1. Remove `RuntimeContext` parameter — use `app.getPath("userData")` directly
2. Add `sendMessageStream()` method for streaming support
3. Add `AbortSignal` support for cancellation

**Provider catalog (hardcoded):**
- Claude: Opus 4.1, Sonnet 4, Haiku 3.5
- OpenAI: GPT-5.1 Codex Mini, GPT-5 Codex, GPT-5.1 Codex

**Effort levels:** Low, Medium, High (only shown when provider supports it)

---

## UI Layout (preserved from existing)

```
┌──────────────┬──────────────────────────────┐
│              │  Thread Title — Project Name  │
│   SIDEBAR    ├──────────────────────────────┤
│  (280px)     │                              │
│              │     Messages (max-w-3xl)     │
│  [+] Thread  │     ┌──────────────────┐     │
│              │     │ User msg (right)  │     │
│  ▾ Project A │     └──────────────────┘     │
│    Thread 1  │  ┌──────────────────────┐    │
│    Thread 2  │  │ Assistant msg (left) │    │
│  ▾ Project B │  │ with markdown        │    │
│    Thread 3  │  └──────────────────────┘    │
│              │                              │
│              ├──────────────────────────────┤
│  ⚙ Settings  │ [Provider▾][Model▾][Effort▾] │
│  🌙 Theme    │ [         textarea         →]│
├──────────────┴──────────────────────────────┤
│ Status Bar                                   │
└──────────────────────────────────────────────┘
```

### Key UI Components

- **Sidebar:** Collapsible project tree, context menus (rename/delete/color), new thread button, settings dialog, theme toggle
- **Chat Area:** Message bubbles with markdown (react-markdown + remark-gfm), streaming indicator with elapsed timer
- **Chat Input:** Auto-resize textarea, inline dropdowns for provider/model/effort, send/stop button
- **Settings Dialog:** API key management per provider (configure, test, remove)
- **Status Bar:** Provider info

### Theme

- Dark/light mode via `.dark` CSS class
- oklch color variables (same as existing `index.css`)
- Custom scrollbar styling
- shadcn/ui new-york style with `--radius: 0.625rem`

---

## Project Structure

```
duck-codex/
├── electron/
│   ├── main/
│   │   ├── index.ts                  # BrowserWindow, register IPC
│   │   ├── ipc/
│   │   │   ├── index.ts              # registerAllHandlers()
│   │   │   ├── projects.ts
│   │   │   ├── threads.ts
│   │   │   ├── messages.ts           # + streaming dispatch
│   │   │   ├── providers.ts          # API key management
│   │   │   └── dialog.ts             # pick-folder
│   │   └── services/
│   │       ├── prisma.ts             # PrismaClient singleton
│   │       └── providers/
│   │           ├── types.ts
│   │           ├── factory.ts
│   │           ├── claude.ts
│   │           ├── openai.ts
│   │           └── credentials.ts    # AES-256-GCM (from existing)
│   └── preload/
│       └── index.ts                  # contextBridge: invoke + on
├── src/                              # Renderer (React)
│   ├── main.tsx
│   ├── App.tsx
│   ├── index.css                     # oklch theme (from existing)
│   ├── components/
│   │   ├── chat/
│   │   │   ├── chat-area.tsx
│   │   │   ├── chat-input.tsx
│   │   │   └── message-bubble.tsx
│   │   ├── sidebar/
│   │   │   ├── sidebar.tsx
│   │   │   ├── new-project-dialog.tsx
│   │   │   └── settings-dialog.tsx
│   │   ├── ui/                       # shadcn components
│   │   └── status-bar.tsx
│   ├── stores/
│   │   ├── app-store.ts
│   │   └── settings-store.ts
│   ├── hooks/
│   │   └── use-chat.ts
│   └── lib/
│       ├── types.ts
│       ├── providers.ts
│       ├── electron-api.ts           # Typed wrapper for window.electronAPI
│       └── utils.ts
├── prisma/
│   └── schema.prisma
├── package.json
├── electron.vite.config.ts
├── tsconfig.json
├── tsconfig.node.json
└── components.json                   # shadcn config
```

---

## What Changes vs. Existing Code

| Area | Existing (Tauri) | New (Electron) |
|------|-----------------|----------------|
| Backend | Rust (src-tauri/) | Node.js (electron/main/) |
| IPC | `invoke()` / `listen()` from @tauri-apps/api | `window.electronAPI.invoke()` / `.on()` via contextBridge |
| Database | Raw SQLite in Rust | Prisma + SQLite |
| Providers | `backend/providers/*.ts` (already TS) | Same code moved to `electron/main/services/providers/` |
| Credentials | `backend/providers/credentials.ts` (node:crypto + node:sqlite) | Same code, unchanged |
| Streaming | Tauri events from Rust | webContents.send from Node.js |
| File dialog | @tauri-apps/plugin-dialog | electron dialog.showOpenDialog |
| Build | tauri build | electron-builder |

**Frontend (src/) stays ~90% the same.** Only IPC call sites change.

---

## Verification Plan

1. `npm run dev` starts Electron with hot reload
2. Create a project → verify it appears in sidebar and persists after restart
3. Create a thread → verify provider/model/effort dropdowns work
4. Configure API key in settings → verify test connection works
5. Send a message → verify streaming response renders in real-time
6. Stop generation mid-stream → verify it cancels
7. Switch between dark/light theme → verify oklch colors apply
8. Rename/delete project/thread via context menu → verify persistence
9. Test with both OpenAI and Anthropic providers
