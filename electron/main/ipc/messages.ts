import { ipcMain, type BrowserWindow } from "electron";
import { prisma } from "../services/prisma.js";
import { getProvider } from "../services/providers/factory.js";
import type { ApiProviderId, ProviderHistoryMessage } from "../services/providers/types.js";

const activeStreams = new Map<string, AbortController>();

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
          console.error("Stream error:", err);
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
      controller.abort();
      activeStreams.delete(args.threadId);
    }
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

  try {
    console.log(`[stream] Starting stream for thread=${threadId} provider=${thread.provider} model=${thread.model}`);

    const result = await provider.sendMessageStream(
      {
        model: thread.model,
        effort: thread.effort,
        sessionId: thread.sessionId,
        message: _content,
        history: history.slice(0, -1), // exclude the just-added user message (it's in `message`)
      },
      (chunk) => {
        if (chunk.type === "delta" && chunk.text) {
          mainWindow.webContents.send(`chat:stream:${threadId}`, {
            runId,
            text: chunk.text,
          });
        }
      },
      abortController.signal
    );

    console.log(`[stream] Complete: ${result.text.length} chars, ${result.durationMs}ms`);

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
        }),
      },
    });

    // Update session ID if provider returned one
    if (result.sessionId) {
      await prisma.thread.update({
        where: { id: threadId },
        data: { sessionId: result.sessionId },
      });
    }

    mainWindow.webContents.send(`chat:complete:${threadId}`, {
      runId,
      text: result.text,
      sessionId: result.sessionId,
      costUsd: result.costUsd,
      durationMs: Date.now() - startedAt,
    });
  } catch (err) {
    if ((err as Error).name === "AbortError") {
      console.log("[stream] Aborted by user");
    } else {
      console.error("[stream] Error:", err);
      mainWindow.webContents.send(`chat:error:${threadId}`, {
        runId,
        message: String(err instanceof Error ? err.message : err),
      });
    }
  } finally {
    activeStreams.delete(threadId);
    mainWindow.webContents.send(`chat:done:${threadId}`, { runId });
  }
}
