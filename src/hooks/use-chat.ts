import { useEffect, useCallback } from "react";
import { electronAPI } from "@/lib/electron-api";
import { useAppStore } from "@/stores/app-store";
import type {
  ChatStreamPayload,
  ChatCompletePayload,
  ChatErrorPayload,
  ChatDonePayload,
} from "@/lib/types";

export function useChat() {
  const {
    activeThreadId,
    isStreaming,
    streamingThreadId,
    streamingContent,
    streamingError,
    setStreamingThreadId,
    setActiveRunId,
    setIsStreaming,
    setStreamingError,
    clearStream,
    fetchMessages,
    addOptimisticMessage,
    addStreamContent,
  } = useAppStore();

  useEffect(() => {
    const listenerThreadId = streamingThreadId ?? activeThreadId;
    if (!listenerThreadId) return;

    const unsubStream = electronAPI.on(
      `chat:stream:${listenerThreadId}`,
      (...args: unknown[]) => {
        const payload = args[0] as ChatStreamPayload;
        if (payload.runId !== useAppStore.getState().activeRunId) return;
        console.log("[chat:stream] delta:", payload.text.slice(0, 50));
        addStreamContent(payload.text);
      }
    );

    const unsubComplete = electronAPI.on(
      `chat:complete:${listenerThreadId}`,
      (...args: unknown[]) => {
        const payload = args[0] as ChatCompletePayload;
        if (payload.runId !== useAppStore.getState().activeRunId) return;
        console.log("[chat:complete]", payload.text.length, "chars,", payload.durationMs, "ms");
        fetchMessages(listenerThreadId);
      }
    );

    const unsubError = electronAPI.on(
      `chat:error:${listenerThreadId}`,
      (...args: unknown[]) => {
        const payload = args[0] as ChatErrorPayload;
        console.error("[chat:error]", payload.message);
        if (payload.runId !== useAppStore.getState().activeRunId) return;
        setStreamingError(payload.message);
      }
    );

    const unsubDone = electronAPI.on(
      `chat:done:${listenerThreadId}`,
      (...args: unknown[]) => {
        const payload = args[0] as ChatDonePayload;
        console.log("[chat:done] runId:", payload.runId);
        if (payload.runId !== useAppStore.getState().activeRunId) return;
        const hadError = useAppStore.getState().streamingError;
        setIsStreaming(false);
        if (!hadError) {
          clearStream();
        } else {
          useAppStore.setState({
            activeRunId: null,
            streamingThreadId: null,
            streamingContent: "",
          });
        }
      }
    );

    return () => {
      unsubStream();
      unsubComplete();
      unsubError();
      unsubDone();
    };
  }, [
    activeThreadId,
    streamingThreadId,
    setActiveRunId,
    setIsStreaming,
    setStreamingError,
    fetchMessages,
    clearStream,
    addStreamContent,
  ]);

  const sendMessage = useCallback(
    async (content: string) => {
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
      clearStream();
      setStreamingThreadId(activeThreadId);
      setActiveRunId(runId);
      setIsStreaming(true);

      try {
        await electronAPI.invoke("message:send", {
          threadId: activeThreadId,
          content: content.trim(),
          runId,
        });
      } catch (err) {
        console.error("Erro ao enviar mensagem:", err);
        setStreamingError(String(err));
        setIsStreaming(false);
        setStreamingThreadId(null);
        setActiveRunId(null);
      }
    },
    [
      activeThreadId,
      addOptimisticMessage,
      clearStream,
      setStreamingThreadId,
      setActiveRunId,
      setIsStreaming,
      setStreamingError,
    ]
  );

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
