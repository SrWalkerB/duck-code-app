import { useEffect, useCallback } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { useAppStore } from "@/stores/app-store";

interface CompletePayload {
  text: string;
  session_id: string | null;
  cost_usd: number;
  duration_ms: number;
}

export function useChat() {
  const {
    activeThreadId,
    isStreaming,
    streamingContent,
    streamingToolUse,
    streamingError,
    streamingTools,
    setStreamingToolUse,
    setIsStreaming,
    setStreamingError,
    clearStream,
    fetchMessages,
    addOptimisticMessage,
  } = useAppStore();

  useEffect(() => {
    if (!activeThreadId) return;

    const unlisteners: UnlistenFn[] = [];

    let thinkingStart: number | null = null;
    let thinkingTimer: ReturnType<typeof setInterval> | null = null;

    const setup = async () => {
      // Listen to streaming events
      const unStream = await listen<string>(
        `chat:stream:${activeThreadId}`,
        (event) => {
          try {
            const data = JSON.parse(event.payload);

            if (data.type === "assistant" && data.message) {
              const msg = data.message;

              if (msg.type === "message" && Array.isArray(msg.content)) {
                for (const block of msg.content) {
                  if (block.type === "text" && block.text) {
                    // Stop thinking timer
                    if (thinkingTimer) { clearInterval(thinkingTimer); thinkingTimer = null; }
                    // Set full text (Claude sends cumulative content)
                    useAppStore.setState({ streamingContent: block.text });
                    setStreamingToolUse(null);
                  } else if (block.type === "tool_use") {
                    if (thinkingTimer) { clearInterval(thinkingTimer); thinkingTimer = null; }
                    setStreamingToolUse(formatToolUse(block));
                  } else if (block.type === "thinking") {
                    // Start counting thinking time
                    if (!thinkingStart) {
                      thinkingStart = Date.now();
                      setStreamingToolUse("Pensando...");
                      thinkingTimer = setInterval(() => {
                        const secs = Math.round((Date.now() - thinkingStart!) / 1000);
                        setStreamingToolUse(`Pensando... ${secs}s`);
                      }, 1000);
                    }
                  }
                }
              }
            }
          } catch {
            // Non-JSON or unparseable, ignore
          }
        }
      );
      unlisteners.push(unStream);

      // Listen to complete event — save assistant message to DB with metadata
      const unComplete = await listen<CompletePayload>(
        `chat:complete:${activeThreadId}`,
        async (event) => {
          const { text, session_id, cost_usd, duration_ms } = event.payload;
          console.log("[chat:complete] text:", text.length, "chars, cost: $" + cost_usd.toFixed(4), "duration:", duration_ms + "ms");

          if (text.trim()) {
            try {
              const metadata = JSON.stringify({ cost_usd, duration_ms });
              await invoke("save_assistant_message", {
                threadId: activeThreadId,
                content: text,
                sessionId: session_id,
                metadata,
              });
            } catch (err) {
              console.error("Erro ao salvar resposta:", err);
            }
          }
        }
      );
      unlisteners.push(unComplete);

      // Listen to error events
      const unError = await listen<string>(
        `chat:error:${activeThreadId}`,
        (event) => {
          console.error("[chat:error]", event.payload);
          setStreamingError(event.payload);
        }
      );
      unlisteners.push(unError);

      // Listen to tool use events
      const unToolUse = await listen<{ tool_use_id: string; name: string; input: Record<string, unknown> }>(
        `chat:tool_use:${activeThreadId}`,
        (event) => {
          useAppStore.getState().addToolUse(event.payload);
        }
      );
      unlisteners.push(unToolUse);

      // Listen to tool result events
      const unToolResult = await listen<{ tool_use_id: string; content: string }>(
        `chat:tool_result:${activeThreadId}`,
        (event) => {
          useAppStore.getState().updateToolResult(event.payload);
        }
      );
      unlisteners.push(unToolResult);

      // Listen to done event — fetch persisted messages, clear stream
      const unDone = await listen(`chat:done:${activeThreadId}`, async () => {
        console.log("[chat:done] fetching messages");
        await fetchMessages(activeThreadId);
        setIsStreaming(false);
        clearStream();
      });
      unlisteners.push(unDone);
    };

    setup();

    return () => {
      if (thinkingTimer) clearInterval(thinkingTimer);
      unlisteners.forEach((fn) => fn());
    };
  }, [
    activeThreadId,
    setStreamingToolUse,
    setIsStreaming,
    setStreamingError,
    fetchMessages,
    clearStream,
  ]);

  const sendMessage = useCallback(
    async (content: string) => {
      if (!activeThreadId || !content.trim()) return;

      addOptimisticMessage({
        id: `temp-${Date.now()}`,
        thread_id: activeThreadId,
        role: "user",
        content: content.trim(),
        metadata: null,
        created_at: Date.now(),
      });

      clearStream();
      setIsStreaming(true);

      try {
        const permissionMode = useAppStore.getState().permissionMode;
        await invoke("send_message", {
          threadId: activeThreadId,
          content: content.trim(),
          permissionMode,
        });
      } catch (err) {
        console.error("Erro ao enviar mensagem:", err);
        setStreamingError(String(err));
        setIsStreaming(false);
      }
    },
    [activeThreadId, addOptimisticMessage, clearStream, setIsStreaming, setStreamingError]
  );

  const stopGeneration = useCallback(async () => {
    if (!activeThreadId) return;
    try {
      await invoke("stop_generation", { threadId: activeThreadId });
    } catch (err) {
      console.error("Erro ao parar geracao:", err);
    }
  }, [activeThreadId]);

  return {
    sendMessage,
    stopGeneration,
    isStreaming,
    streamingContent,
    streamingToolUse,
    streamingError,
    streamingTools,
  };
}

function formatToolUse(block: { name?: string; input?: Record<string, unknown> }): string {
  const toolName = block.name || "Tool";
  const input = block.input || {};
  if (toolName === "Read" && input.file_path) return `Lendo ${basename(String(input.file_path))}`;
  if (toolName === "Edit" && input.file_path) return `Editando ${basename(String(input.file_path))}`;
  if (toolName === "Write" && input.file_path) return `Escrevendo ${basename(String(input.file_path))}`;
  if (toolName === "Bash") return "Executando comando";
  if (toolName === "Grep") return "Buscando no codigo";
  if (toolName === "Glob") return "Buscando arquivos";
  return toolName;
}

function basename(path: string): string {
  return path.split("/").pop() || path;
}
