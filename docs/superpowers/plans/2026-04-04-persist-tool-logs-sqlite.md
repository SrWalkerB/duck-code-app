# Persist Tool Logs in SQLite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persistir os logs de ferramentas no SQLite ao invés de memória, excluindo automaticamente quando a thread for deletada.

**Architecture:** Adicionar tabela `tool_logs` com FK `thread_id ON DELETE CASCADE`. Reescrever `tool-logger.ts` para gravar/ler via Prisma raw SQL (mesmo padrão de `ensureDatabase`). O handler IPC `thread:logs` já chama `getLogs` — não precisa mudar.

**Tech Stack:** Electron, Prisma, SQLite, TypeScript

---

### Task 1: Criar tabela `tool_logs` no banco

**Files:**
- Modify: `electron/main/services/prisma.ts`

- [ ] **Step 1: Adicionar `CREATE TABLE IF NOT EXISTS tool_logs` em `ensureDatabase`**

Em `electron/main/services/prisma.ts`, adicionar após o bloco de criação da tabela `messages`:

```ts
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS tool_logs (
      id        TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      run_id    TEXT NOT NULL,
      type      TEXT NOT NULL,
      content   TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      FOREIGN KEY (thread_id) REFERENCES threads(id) ON DELETE CASCADE
    )
  `);

  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS idx_tool_logs_thread_id ON tool_logs(thread_id)
  `);
```

- [ ] **Step 2: Commit**

```bash
git add electron/main/services/prisma.ts
git commit -m "feat: add tool_logs table with cascade delete"
```

---

### Task 2: Reescrever `tool-logger.ts` para persistir no SQLite

**Files:**
- Modify: `electron/main/services/tools/tool-logger.ts`

- [ ] **Step 1: Substituir implementação completa do arquivo**

Substituir o conteúdo de `electron/main/services/tools/tool-logger.ts` por:

```ts
import { randomUUID } from "node:crypto";
import { prisma } from "../prisma.js";

export interface ToolLogEntry {
  timestamp: number;
  type: "system_prompt" | "request" | "response" | "tool_call" | "tool_result" | "re_request";
  content: string;
}

export interface ThreadLogs {
  threadId: string;
  runId: string;
  entries: ToolLogEntry[];
}

type Row = { thread_id: string; run_id: string; type: string; content: string; timestamp: bigint | number };

async function addEntry(
  threadId: string,
  runId: string,
  type: ToolLogEntry["type"],
  content: string
): Promise<void> {
  const id = randomUUID();
  const timestamp = Date.now();
  await prisma.$executeRawUnsafe(
    `INSERT INTO tool_logs (id, thread_id, run_id, type, content, timestamp) VALUES (?, ?, ?, ?, ?, ?)`,
    id,
    threadId,
    runId,
    type,
    content,
    timestamp
  );
}

export async function logSystemPrompt(threadId: string, runId: string, prompt: string): Promise<void> {
  await addEntry(threadId, runId, "system_prompt", prompt);
}

export async function logRequest(threadId: string, runId: string, message: string): Promise<void> {
  await addEntry(threadId, runId, "request", message);
}

export async function logResponse(threadId: string, runId: string, response: string): Promise<void> {
  await addEntry(threadId, runId, "response", response);
}

export async function logToolCall(threadId: string, runId: string, name: string, args: Record<string, unknown>): Promise<void> {
  await addEntry(threadId, runId, "tool_call", JSON.stringify({ name, args }));
}

export async function logToolResult(threadId: string, runId: string, name: string, result: { success: boolean; output: string }): Promise<void> {
  await addEntry(threadId, runId, "tool_result", JSON.stringify({ name, ...result }));
}

export async function logReRequest(threadId: string, runId: string, message: string): Promise<void> {
  await addEntry(threadId, runId, "re_request", message);
}

export async function getLogs(threadId: string): Promise<ThreadLogs[]> {
  const rows = await prisma.$queryRawUnsafe<Row[]>(
    `SELECT thread_id, run_id, type, content, timestamp FROM tool_logs WHERE thread_id = ? ORDER BY timestamp ASC`,
    threadId
  );

  const runMap = new Map<string, ThreadLogs>();
  for (const row of rows) {
    let log = runMap.get(row.run_id);
    if (!log) {
      log = { threadId: row.thread_id, runId: row.run_id, entries: [] };
      runMap.set(row.run_id, log);
    }
    log.entries.push({
      timestamp: Number(row.timestamp),
      type: row.type as ToolLogEntry["type"],
      content: row.content,
    });
  }

  return Array.from(runMap.values());
}

export async function clearLogs(threadId: string): Promise<void> {
  await prisma.$executeRawUnsafe(`DELETE FROM tool_logs WHERE thread_id = ?`, threadId);
}
```

- [ ] **Step 2: Commit**

```bash
git add electron/main/services/tools/tool-logger.ts
git commit -m "feat: persist tool logs in SQLite"
```

---

### Task 3: Atualizar todos os call sites para aguardar as funções async

**Files:**
- Modify: `electron/main/services/providers/claude.ts`
- Modify: `electron/main/services/providers/openai.ts`
- Modify: `electron/main/services/providers/claude-code.ts`
- Modify: `electron/main/services/providers/lm-studio.ts`
- Modify: `electron/main/services/tools/tool-executor.ts`

- [ ] **Step 1: Identificar todos os call sites das funções de log**

```bash
grep -rn "logSystemPrompt\|logRequest\|logResponse\|logToolCall\|logToolResult\|logReRequest\|clearLogs" electron/main/services/
```

- [ ] **Step 2: Adicionar `await` em todos os call sites encontrados**

Para cada chamada encontrada, garantir que está precedida de `await`. Exemplo:

Antes:
```ts
logRequest(threadId, runId, content);
```

Depois:
```ts
await logRequest(threadId, runId, content);
```

- [ ] **Step 3: Garantir que as funções chamadoras são `async` (adicionar se necessário)**

Se uma função que chama `logRequest` não for `async`, adicionar `async` na sua declaração.

- [ ] **Step 4: Commit**

```bash
git add electron/main/services/providers/ electron/main/services/tools/tool-executor.ts
git commit -m "fix: await async tool log calls"
```

---

### Task 4: Verificar que o app compila e funciona

- [ ] **Step 1: Buildar o projeto**

```bash
npm run build
```

Esperado: sem erros de TypeScript.

- [ ] **Step 2: Verificar que o app inicia**

```bash
npm run dev
```

Esperado: app abre, logs aparecem no painel de logs após uma conversa, e persistem ao reabrir o app.
