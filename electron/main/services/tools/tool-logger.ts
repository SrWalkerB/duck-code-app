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

type Row = { thread_id: string; run_id: string; type: string; content: string; timestamp: string };

async function addEntry(
  threadId: string,
  runId: string,
  type: ToolLogEntry["type"],
  content: string
): Promise<void> {
  const id = randomUUID();
  const timestamp = Date.now().toString();
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
