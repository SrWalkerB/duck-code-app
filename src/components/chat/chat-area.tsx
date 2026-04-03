import { useEffect, useRef, useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useAppStore } from "@/stores/app-store";
import { useChat } from "@/hooks/use-chat";
import { MessageBubble, StreamingBubble } from "./message-bubble";
import { ChatInput } from "./chat-input";
import type { Thread } from "@/lib/types";
import { Sparkles, FolderTree, TerminalSquare, GitBranch } from "lucide-react";
import { cn } from "@/lib/utils";
import { FileExplorer } from "@/components/panels/file-explorer";
import { GitPanel } from "@/components/panels/git-panel";
import { TerminalPanel } from "@/components/panels/terminal-panel";

export function ChatArea() {
  const {
    projects,
    threads,
    messages,
    activeProjectId,
    activeThreadId,
    activePanel,
    terminalOpen,
    setActivePanel,
    toggleTerminal,
  } = useAppStore();

  const {
    sendMessage,
    stopGeneration,
    isStreaming,
    streamingContent,
    streamingToolUse,
    streamingError,
    streamingTools,
  } = useChat();

  const [model, setModel] = useState("claude-sonnet-4-6-20250514");
  const [context, setContext] = useState("");
  const [reasoning, setReasoning] = useState("medium");

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollAreaRef = useRef<HTMLDivElement>(null);

  const activeProject = projects.find((p) => p.id === activeProjectId);
  const activeThreads = activeProjectId ? threads[activeProjectId] || [] : [];
  const activeThread = activeThreads.find((t: Thread) => t.id === activeThreadId);
  const activeMessages = activeThreadId ? messages[activeThreadId] || [] : [];

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "auto") => {
    const viewport = scrollAreaRef.current?.querySelector(
      '[data-slot="scroll-area-viewport"]'
    ) as HTMLDivElement | null;
    if (viewport) {
      viewport.scrollTo({ top: viewport.scrollHeight, behavior });
      return;
    }
    messagesEndRef.current?.scrollIntoView({ behavior });
  }, []);

  // Scroll to bottom on thread enter/re-enter.
  useEffect(() => {
    if (!activeThreadId) return;

    scrollToBottom("auto");
    const raf = requestAnimationFrame(() => scrollToBottom("auto"));
    const timer = window.setTimeout(() => scrollToBottom("auto"), 120);

    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(timer);
    };
  }, [activeThreadId, scrollToBottom]);

  // Keep the viewport pinned while new content streams in.
  useEffect(() => {
    scrollToBottom("smooth");
  }, [activeMessages.length, streamingContent, scrollToBottom]);

  // Sync model/reasoning from active thread
  useEffect(() => {
    if (activeThread) {
      setModel(activeThread.model);
      setReasoning(activeThread.reasoning);
      // Check if model ends with [1m]
      if (activeThread.model.endsWith("[1m]")) {
        setModel(activeThread.model.replace("[1m]", ""));
        setContext("[1m]");
      } else {
        setContext("");
      }
    }
  }, [activeThread]);

  // Update thread model/reasoning when changed
  const handleModelChange = useCallback(
    async (newModel: string) => {
      setModel(newModel);
      if (activeThreadId) {
        const fullModel = newModel + context;
        try {
          await invoke("update_thread", { id: activeThreadId, model: fullModel });
        } catch (err) {
          console.error("Erro ao atualizar modelo:", err);
        }
      }
    },
    [activeThreadId, context]
  );

  const handleContextChange = useCallback(
    async (newContext: string) => {
      setContext(newContext);
      if (activeThreadId) {
        const fullModel = model + newContext;
        try {
          await invoke("update_thread", { id: activeThreadId, model: fullModel });
        } catch (err) {
          console.error("Erro ao atualizar contexto:", err);
        }
      }
    },
    [activeThreadId, model]
  );

  const handleReasoningChange = useCallback(
    async (newReasoning: string) => {
      setReasoning(newReasoning);
      if (activeThreadId) {
        try {
          await invoke("update_thread", { id: activeThreadId, reasoning: newReasoning });
        } catch (err) {
          console.error("Erro ao atualizar reasoning:", err);
        }
      }
    },
    [activeThreadId]
  );

  const handleSend = useCallback(
    (content: string) => {
      sendMessage(content);
    },
    [sendMessage]
  );

  // Empty state
  if (!activeThreadId) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4 text-center">
          <div className="flex size-16 items-center justify-center rounded-2xl bg-white/5">
            <Sparkles className="size-8 text-muted-foreground/50" />
          </div>
          <div>
            <h2 className="text-xl font-medium text-foreground">
              {activeProject ? `Vamos construir` : "Duck Codex"}
            </h2>
            {activeProject && (
              <p className="mt-1 text-sm text-muted-foreground">
                {activeProject.name}
              </p>
            )}
            {!activeProject && (
              <p className="mt-1 text-sm text-muted-foreground">
                Selecione ou crie uma conversa para comecar.
              </p>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col bg-background min-h-0">
      {/* Header — Codex style: title + project name + panel toggles */}
      <div className="flex items-center justify-between border-b border-border/30 px-6 py-2.5">
        <div className="flex items-center gap-2 min-w-0">
          <h1 className="truncate text-sm font-medium text-foreground">
            {activeThread?.title || "Conversa"}
          </h1>
          {activeProject && (
            <span className="truncate text-xs text-muted-foreground/50">
              {activeProject.name}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={() => setActivePanel("files")}
            className={cn(
              "rounded-md p-1.5 transition-colors",
              activePanel === "files"
                ? "bg-white/10 text-foreground"
                : "text-muted-foreground/50 hover:text-foreground/70 hover:bg-white/5"
            )}
            title="Explorador de arquivos"
          >
            <FolderTree className="size-4" />
          </button>
          <button
            type="button"
            onClick={toggleTerminal}
            className={cn(
              "rounded-md p-1.5 transition-colors",
              terminalOpen
                ? "bg-white/10 text-foreground"
                : "text-muted-foreground/50 hover:text-foreground/70 hover:bg-white/5"
            )}
            title="Terminal"
          >
            <TerminalSquare className="size-4" />
          </button>
          <button
            type="button"
            onClick={() => setActivePanel("git")}
            className={cn(
              "rounded-md p-1.5 transition-colors",
              activePanel === "git"
                ? "bg-white/10 text-foreground"
                : "text-muted-foreground/50 hover:text-foreground/70 hover:bg-white/5"
            )}
            title="Git"
          >
            <GitBranch className="size-4" />
          </button>
        </div>
      </div>

      {/* Main content: chat + side panel */}
      <div className="flex flex-1 min-h-0">
        {/* Chat column */}
        <div className="flex flex-1 flex-col min-h-0 min-w-0">
          {/* Messages + terminal vertical split */}
          <div className="flex flex-1 flex-col min-h-0">
            <ScrollArea ref={scrollAreaRef} className="flex-1 min-h-0">
              <div className="mx-auto max-w-3xl px-6 py-6">
                {activeMessages.length === 0 && !isStreaming && (
                  <div className="flex flex-col items-center justify-center py-20 text-center">
                    <Sparkles className="size-10 text-muted-foreground/30 mb-3" />
                    <p className="text-sm text-muted-foreground/50">
                      Envie uma mensagem para comecar.
                    </p>
                  </div>
                )}

                {activeMessages.map((msg, idx) => {
                  const isLastAssistant =
                    msg.role === "assistant" &&
                    !isStreaming &&
                    idx === activeMessages.length - 1;
                  return (
                    <MessageBubble
                      key={msg.id}
                      message={msg}
                      model={activeThread?.model}
                      onSendMessage={handleSend}
                      isLastAssistant={isLastAssistant}
                    />
                  );
                })}

                {isStreaming && (
                  <StreamingBubble
                    content={streamingContent}
                    toolUse={streamingToolUse}
                    toolActivities={streamingTools}
                    model={activeThread?.model}
                    onAnswerQuestion={handleSend}
                  />
                )}

                {streamingError && (
                  <div className="mx-4 my-3 flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3">
                    <div className="flex-1">
                      <p className="text-sm font-medium text-destructive">Erro</p>
                      <p className="mt-1 text-xs text-destructive/80">{streamingError}</p>
                    </div>
                    <button
                      type="button"
                      className="shrink-0 rounded-md bg-destructive/20 px-3 py-1 text-xs text-destructive hover:bg-destructive/30 transition-colors"
                      onClick={() => {
                        const lastUserMsg = activeMessages.filter(m => m.role === 'user').pop();
                        if (lastUserMsg) handleSend(lastUserMsg.content);
                      }}
                    >
                      Tentar novamente
                    </button>
                  </div>
                )}

                <div ref={messagesEndRef} />
              </div>
            </ScrollArea>

            {/* Terminal panel */}
            {terminalOpen && (
              <div className="h-48 border-t border-border/30 shrink-0">
                <TerminalPanel />
              </div>
            )}
          </div>

          {/* Input */}
          <ChatInput
            onSend={handleSend}
            onStop={stopGeneration}
            isStreaming={isStreaming}
            disabled={!activeThreadId}
            model={model}
            context={context}
            reasoning={reasoning}
            onModelChange={handleModelChange}
            onContextChange={handleContextChange}
            onReasoningChange={handleReasoningChange}
          />
        </div>

        {/* Side panel */}
        {activePanel && (
          <div className="w-72 border-l border-border/30 flex flex-col min-h-0 shrink-0">
            {activePanel === "files" && (
              <FileExplorer projectPath={activeProject?.path || ""} />
            )}
            {activePanel === "git" && (
              <GitPanel projectPath={activeProject?.path || ""} />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
