import { useEffect, useCallback, useRef } from "react";
import { electronAPI } from "@/lib/electron-api";
import { useAppStore } from "@/stores/app-store";
import type {
  ProviderId,
  ChatStreamPayload,
  ChatCompletePayload,
  ChatErrorPayload,
  ChatActivityPayload,
  ChatDonePayload,
  ChatToolApprovalPayload,
} from "@/lib/types";

interface StreamConfigSnapshot {
  provider?: ProviderId;
  model?: string;
}

/**
 * Manages IPC listeners for ALL actively streaming threads,
 * allowing parallel streaming across threads.
 */
function useStreamListeners() {
  const activeStreams = useAppStore((s) => s.activeStreams);
  const {
    addStreamContent,
    addStreamActivity,
    setStreamError,
    endStream,
    fetchMessages,
    setThreadToolApproval,
  } = useAppStore();

  const sendMessageRef = useRef<((threadId: string, content: string, config?: StreamConfigSnapshot) => Promise<void>) | null>(null);

  // Track which thread IDs we have listeners for
  const listenersRef = useRef<Map<string, () => void>>(new Map());

  useEffect(() => {
    const streamingThreadIds = new Set(Object.keys(activeStreams));

    // Remove listeners for threads that stopped streaming
    for (const [threadId, cleanup] of listenersRef.current) {
      if (!streamingThreadIds.has(threadId)) {
        cleanup();
        listenersRef.current.delete(threadId);
      }
    }

    // Add listeners for newly streaming threads
    for (const threadId of streamingThreadIds) {
      if (listenersRef.current.has(threadId)) continue;

      const unsubStream = electronAPI.on(
        `chat:stream:${threadId}`,
        (...args: unknown[]) => {
          const payload = args[0] as ChatStreamPayload;
          const currentStream = useAppStore.getState().activeStreams[threadId];
          if (!currentStream || payload.runId !== currentStream.runId) return;
          addStreamContent(threadId, payload.text);
        }
      );

      const unsubActivity = electronAPI.on(
        `chat:activity:${threadId}`,
        (...args: unknown[]) => {
          const payload = args[0] as ChatActivityPayload;
          const currentStream = useAppStore.getState().activeStreams[threadId];
          if (!currentStream || payload.runId !== currentStream.runId) return;
          addStreamActivity(threadId, payload.activity);
        }
      );

      const unsubComplete = electronAPI.on(
        `chat:complete:${threadId}`,
        (...args: unknown[]) => {
          const payload = args[0] as ChatCompletePayload;
          const currentStream = useAppStore.getState().activeStreams[threadId];
          if (!currentStream || payload.runId !== currentStream.runId) return;
          console.log("[chat:complete]", threadId, payload.text.length, "chars,", payload.durationMs, "ms");
          fetchMessages(threadId);
          endStream(threadId);
        }
      );

      const unsubError = electronAPI.on(
        `chat:error:${threadId}`,
        (...args: unknown[]) => {
          const payload = args[0] as ChatErrorPayload;
          const currentStream = useAppStore.getState().activeStreams[threadId];
          if (!currentStream || payload.runId !== currentStream.runId) return;
          console.error("[chat:error]", threadId, payload.message);
          setStreamError(threadId, payload.message);
        }
      );

      const unsubToolApproval = electronAPI.on(
        `chat:tool-approval:${threadId}`,
        (...args: unknown[]) => {
          const payload = args[0] as ChatToolApprovalPayload;
          const currentStream = useAppStore.getState().activeStreams[threadId];
          if (!currentStream || payload.runId !== currentStream.runId) return;
          setThreadToolApproval(threadId, {
            runId: payload.runId,
            tool: payload.tool,
            args: payload.args,
            description: payload.description,
          });
        }
      );

      const unsubDone = electronAPI.on(
        `chat:done:${threadId}`,
        (...args: unknown[]) => {
          const payload = args[0] as ChatDonePayload;
          console.log("[chat:done] threadId:", threadId, "runId:", payload.runId);
          const currentStream = useAppStore.getState().activeStreams[threadId];
          if (!currentStream || payload.runId !== currentStream.runId) return;

          const hadError = currentStream.error;
          if (!hadError) {
            // Auto-send queued message for this thread
            const next = useAppStore.getState().dequeueMessage();
            if (next && next.threadId === threadId) {
              setTimeout(async () => {
                try {
                  await electronAPI.invoke("thread:update", {
                    id: next.threadId,
                    provider: next.provider,
                    model: next.model,
                    effort: next.effort,
                    approvalMode: next.approvalMode,
                  });
                } catch (err) {
                  console.error("Erro ao sincronizar thread para mensagem enfileirada:", err);
                }
                sendMessageRef.current?.(next.threadId, next.content, {
                  provider: next.provider,
                  model: next.model,
                });
              }, 50);
            }
          }

          endStream(threadId);
        }
      );

      const cleanup = () => {
        unsubStream();
        unsubActivity();
        unsubComplete();
        unsubError();
        unsubToolApproval();
        unsubDone();
      };

      listenersRef.current.set(threadId, cleanup);
    }

    const listeners = listenersRef.current;

    // Cleanup all on unmount
    return () => {
      for (const [, cleanup] of listeners) {
        cleanup();
      }
      listeners.clear();
    };
  }, [activeStreams, addStreamContent, addStreamActivity, setStreamError, endStream, fetchMessages, setThreadToolApproval]);

  return sendMessageRef;
}

export function useChat() {
  const activeThreadId = useAppStore((s) => s.activeThreadId);
  const activeStreams = useAppStore((s) => s.activeStreams);
  const { startStream, addOptimisticMessage, setStreamError, endStream } = useAppStore();

  const sendMessageRef = useStreamListeners();

  // Derive streaming state for the currently active thread
  const threadStream = activeThreadId ? activeStreams[activeThreadId] ?? null : null;
  const isStreaming = threadStream !== null;
  const streamingContent = threadStream?.content ?? "";
  const streamingError = threadStream?.error ?? null;

  const sendMessage = useCallback(
    async (content: string, config?: StreamConfigSnapshot) => {
      if (!activeThreadId || !content.trim()) return;

      addOptimisticMessage({
        id: `temp-${Date.now()}`,
        threadId: activeThreadId,
        role: "user",
        content: content.trim(),
        metadata: null,
        createdAt: new Date().toISOString(),
      });

      const runId = crypto.randomUUID();
      console.log("[sendMessage] threadId:", activeThreadId, "runId:", runId);
      startStream(activeThreadId, runId, config);

      try {
        await electronAPI.invoke("message:send", {
          threadId: activeThreadId,
          content: content.trim(),
          runId,
        });
      } catch (err) {
        console.error("Erro ao enviar mensagem:", err);
        setStreamError(activeThreadId, String(err));
        endStream(activeThreadId);
      }
    },
    [activeThreadId, addOptimisticMessage, startStream, setStreamError, endStream]
  );

  // Thread-specific sendMessage for queued messages
  const sendMessageForThread = useCallback(
    async (threadId: string, content: string, config?: StreamConfigSnapshot) => {
      if (!threadId || !content.trim()) return;

      addOptimisticMessage({
        id: `temp-${Date.now()}`,
        threadId,
        role: "user",
        content: content.trim(),
        metadata: null,
        createdAt: new Date().toISOString(),
      });

      const runId = crypto.randomUUID();
      startStream(threadId, runId, config);

      try {
        await electronAPI.invoke("message:send", {
          threadId,
          content: content.trim(),
          runId,
        });
      } catch (err) {
        console.error("Erro ao enviar mensagem:", err);
        setStreamError(threadId, String(err));
        endStream(threadId);
      }
    },
    [addOptimisticMessage, startStream, setStreamError, endStream]
  );

  useEffect(() => {
    sendMessageRef.current = sendMessageForThread;
  }, [sendMessageForThread, sendMessageRef]);

  const stopGeneration = useCallback(async () => {
    if (!activeThreadId) return;
    try {
      await electronAPI.invoke("message:stop", { threadId: activeThreadId });
    } catch (err) {
      console.error("Erro ao parar geracao:", err);
    }
  }, [activeThreadId]);

  return {
    sendMessage,
    stopGeneration,
    isStreaming,
    streamingContent,
    streamingError,
  };
}
