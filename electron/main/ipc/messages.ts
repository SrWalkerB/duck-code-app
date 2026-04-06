import { ipcMain, type BrowserWindow } from "electron";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { prisma } from "../services/prisma.js";
import { getProvider } from "../services/providers/factory.js";
import type { ApiProviderId, ApprovalMode, ProviderHistoryMessage } from "../services/providers/types.js";
import { runWithTools, type ApprovalRequest } from "../services/tools/tool-executor.js";
import { getLogs, logRequest, logResponse } from "../services/tools/tool-logger.js";

const activeStreams = new Map<string, AbortController>();
const pendingApprovals = new Map<string, (approved: boolean) => void>();
const LOG_PREVIEW_LIMIT = 240;

function previewText(value: string, limit = LOG_PREVIEW_LIMIT): string {
  return value.length > limit ? `${value.slice(0, limit)}...` : value;
}

function formatError(err: unknown): string {
  if (err instanceof Error) {
    return err.stack || `${err.name}: ${err.message}`;
  }
  return String(err);
}

function parseDiffStat(summary: string): { additions: number; deletions: number } | null {
  const match = summary.match(/\+(\d+)\s+-\s*(\d+)/);
  if (!match) {
    return null;
  }

  const additions = Number.parseInt(match[1], 10);
  const deletions = Number.parseInt(match[2], 10);
  if (Number.isNaN(additions) || Number.isNaN(deletions)) {
    return null;
  }

  return { additions, deletions };
}

function runGitNumstat(cwd: string): Promise<{ additions: number; deletions: number } | null> {
  return new Promise((resolve) => {
    execFile("git", ["diff", "--numstat"], { cwd }, (error, stdout) => {
      if (error) {
        resolve(null);
        return;
      }

      const rows = String(stdout || "")
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);

      let additions = 0;
      let deletions = 0;
      for (const row of rows) {
        const [a, d] = row.split("\t");
        const addNum = Number.parseInt(a, 10);
        const delNum = Number.parseInt(d, 10);
        if (!Number.isNaN(addNum)) additions += addNum;
        if (!Number.isNaN(delNum)) deletions += delNum;
      }

      resolve({ additions, deletions });
    });
  });
}

function resolveThreadWorkdir(
  projectPath: string | undefined,
  threadTitle: string
): string | null {
  if (!projectPath) return null;

  const trimmed = threadTitle.trim();
  if (trimmed) {
    const candidate = join(projectPath, trimmed);
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return projectPath;
}

export function registerMessageHandlers(mainWindow: BrowserWindow): void {
  ipcMain.handle(
    "message:list",
    async (_, args: { threadId: string }) => {
      return prisma.message.findMany({
        where: { threadId: args.threadId },
        orderBy: { createdAt: "asc" },
      });
    }
  );

  ipcMain.handle(
    "message:send",
    async (_, args: { threadId: string; content: string; runId: string }) => {
      console.log(
        `[message:send] thread=${args.threadId} runId=${args.runId} contentChars=${args.content.length}`
      );
      const userMsg = await prisma.message.create({
        data: {
          threadId: args.threadId,
          role: "user",
          content: args.content,
        },
      });

      // Fire-and-forget the streaming call
      streamResponse(mainWindow, args.threadId, args.content, args.runId).catch(
        (err) => {
          console.error(
            `[message:send] streamResponse failed thread=${args.threadId} runId=${args.runId}: ${formatError(err)}`
          );
          mainWindow.webContents.send(`chat:error:${args.threadId}`, {
            runId: args.runId,
            message: String(err),
          });
          mainWindow.webContents.send(`chat:done:${args.threadId}`, {
            runId: args.runId,
          });
        }
      );

      return userMsg;
    }
  );

  ipcMain.handle("message:stop", async (_, args: { threadId: string }) => {
    const controller = activeStreams.get(args.threadId);
    if (controller) {
      console.log(`[message:stop] aborting stream thread=${args.threadId}`);
      controller.abort();
      activeStreams.delete(args.threadId);
    } else {
      console.log(`[message:stop] no active stream for thread=${args.threadId}`);
    }
  });

  ipcMain.handle(
    "message:tool-approval-response",
    async (_, args: { threadId: string; runId: string; approved: boolean }) => {
      const key = `${args.threadId}:${args.runId}`;
      const resolve = pendingApprovals.get(key);
      if (resolve) {
        resolve(args.approved);
        pendingApprovals.delete(key);
      }
    }
  );

  ipcMain.handle("thread:logs", async (_, args: { threadId: string }) => {
    return getLogs(args.threadId);
  });
}

async function streamResponse(
  mainWindow: BrowserWindow,
  threadId: string,
  _content: string,
  runId: string
): Promise<void> {
  const thread = await prisma.thread.findUniqueOrThrow({
    where: { id: threadId },
    include: { project: true },
  });

  const messages = await prisma.message.findMany({
    where: { threadId },
    orderBy: { createdAt: "asc" },
  });

  const history: ProviderHistoryMessage[] = messages.map((m) => ({
    role: m.role as "user" | "assistant",
    content: m.content,
  }));

  const provider = getProvider(thread.provider as ApiProviderId);
  const abortController = new AbortController();
  activeStreams.set(threadId, abortController);

  const startedAt = Date.now();
  let chunkCount = 0;
  let deltaChars = 0;
  let activityCount = 0;
  let thinkingContent: string | null = null;
  let latestDiffStat: { additions: number; deletions: number } | null = null;
  const collectedActivities: { kind: string; tool?: string; summary: string }[] = [];

  try {
    console.log(
      `[stream] Starting stream for thread=${threadId} runId=${runId} provider=${thread.provider} model=${thread.model} approval=${thread.approvalMode || "suggest"} hasSession=${Boolean(thread.sessionId)} historyMessages=${history.length} projectPath=${thread.project?.path || "none"} nativeTools=${provider.supportsNativeTools}`
    );

    const sendRequest: import("../services/providers/types.js").SendMessageRequest = {
      model: thread.model,
      effort: thread.effort,
      approvalMode: (thread.approvalMode || "suggest") as ApprovalMode,
      sessionId: thread.sessionId,
      message: _content,
      history: history.slice(0, -1),
      projectPath: thread.project?.path,
    };

    const handleChunk = (chunk: import("../services/providers/types.js").StreamChunk) => {
      if (chunk.type === "delta" && chunk.text) {
        chunkCount += 1;
        deltaChars += chunk.text.length;
        if (chunkCount <= 3 || chunkCount % 25 === 0) {
          console.log(
            `[stream] delta thread=${threadId} runId=${runId} chunk=${chunkCount} chars=${chunk.text.length} totalChars=${deltaChars} preview="${previewText(chunk.text)}"`
          );
        }
        mainWindow.webContents.send(`chat:stream:${threadId}`, {
          runId,
          text: chunk.text,
        });
      }
      if (chunk.type === "activity" && chunk.activity) {
        activityCount += 1;
        if (chunk.activity.kind === "thinking") {
          thinkingContent = chunk.activity.summary;
        } else {
          collectedActivities.push(chunk.activity);
        }
        const parsedDiffStat = parseDiffStat(chunk.activity.summary);
        if (parsedDiffStat) {
          latestDiffStat = parsedDiffStat;
        }
        console.log(
          `[stream] activity thread=${threadId} runId=${runId} count=${activityCount} kind=${chunk.activity.kind} tool=${chunk.activity.tool || "n/a"} summary="${previewText(chunk.activity.summary)}"`
        );
        mainWindow.webContents.send(`chat:activity:${threadId}`, {
          runId,
          activity: chunk.activity,
        });
      }
      if (chunk.type === "error" && chunk.error) {
        console.error(
          `[stream] provider-error thread=${threadId} runId=${runId} message="${previewText(chunk.error)}"`
        );
      }
    };

    const handleApproval = (req: ApprovalRequest): Promise<boolean> => {
      return new Promise((resolve) => {
        const key = `${threadId}:${runId}`;
        pendingApprovals.set(key, resolve);
        mainWindow.webContents.send(`chat:tool-approval:${threadId}`, {
          runId,
          tool: req.tool,
          args: req.args,
          description: req.description,
        });
      });
    };

    await logRequest(threadId, runId, _content);

    let result: import("../services/providers/types.js").SendMessageResult;

    if (provider.supportsNativeTools) {
      // CLI providers handle tools natively
      result = await provider.sendMessageStream(sendRequest, handleChunk, abortController.signal);
    } else {
      // API providers use the ToolExecutor middleware
      result = await runWithTools({
        provider,
        request: sendRequest,
        threadId,
        runId,
        onChunk: handleChunk,
        onApprovalNeeded: handleApproval,
        signal: abortController.signal,
      });
    }

    await logResponse(threadId, runId, result.text);

    console.log(
      `[stream] Complete thread=${threadId} runId=${runId} resultChars=${result.text.length} resultDurationMs=${result.durationMs} totalElapsedMs=${Date.now() - startedAt} chunks=${chunkCount} deltaChars=${deltaChars} activities=${activityCount} hasSession=${Boolean(result.sessionId)}`
    );

    const workdir = resolveThreadWorkdir(thread.project?.path, thread.title);
    const gitDiffStat =
      latestDiffStat ?? (workdir ? await runGitNumstat(workdir) : null);
    const lineAdditions = gitDiffStat?.additions ?? null;
    const lineDeletions = gitDiffStat?.deletions ?? null;

    // Save assistant message
    await prisma.message.create({
      data: {
        threadId,
        role: "assistant",
        content: result.text,
        metadata: JSON.stringify({
          runId,
          provider: thread.provider,
          costUsd: result.costUsd,
          durationMs: result.durationMs,
          lineAdditions,
          lineDeletions,
          ...(thinkingContent ? { thinking: thinkingContent } : {}),
          ...(collectedActivities.length > 0 ? { activities: collectedActivities } : {}),
        }),
      },
    });

    // Update session ID if provider returned one and thread config
    // still matches the config used at stream start.
    if (result.sessionId) {
      const latestThread = await prisma.thread.findUnique({
        where: { id: threadId },
        select: { provider: true, model: true },
      });
      const sameConfig =
        latestThread?.provider === thread.provider &&
        latestThread?.model === thread.model;

      if (sameConfig) {
        await prisma.thread.update({
          where: { id: threadId },
          data: { sessionId: result.sessionId },
        });
        console.log(
          `[stream] session updated thread=${threadId} runId=${runId} sessionId=${result.sessionId}`
        );
      } else {
        console.log(
          `[stream] session update skipped thread=${threadId} runId=${runId} reason=config-changed`
        );
      }
    }

    mainWindow.webContents.send(`chat:complete:${threadId}`, {
      runId,
      text: result.text,
      sessionId: result.sessionId,
      costUsd: result.costUsd,
      durationMs: Date.now() - startedAt,
    });
    console.log(
      `[stream] emitted chat:complete thread=${threadId} runId=${runId} chars=${result.text.length}`
    );
  } catch (err) {
    if ((err as Error).name === "AbortError") {
      console.log(
        `[stream] Aborted by user thread=${threadId} runId=${runId} elapsedMs=${Date.now() - startedAt}`
      );
    } else {
      console.error(
        `[stream] Error thread=${threadId} runId=${runId}: ${formatError(err)}`
      );
      mainWindow.webContents.send(`chat:error:${threadId}`, {
        runId,
        message: String(err instanceof Error ? err.message : err),
      });
      console.log(`[stream] emitted chat:error thread=${threadId} runId=${runId}`);
    }
  } finally {
    activeStreams.delete(threadId);
    mainWindow.webContents.send(`chat:done:${threadId}`, { runId });
    console.log(
      `[stream] emitted chat:done thread=${threadId} runId=${runId} elapsedMs=${Date.now() - startedAt} activeStreams=${activeStreams.size}`
    );
  }
}
