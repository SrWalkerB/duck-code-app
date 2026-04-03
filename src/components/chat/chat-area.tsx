import { useEffect, useRef, useState, useCallback } from "react";
import { electronAPI } from "@/lib/electron-api";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useAppStore } from "@/stores/app-store";
import { useChat } from "@/hooks/use-chat";
import { MessageBubble, StreamingBubble } from "./message-bubble";
import { ChatInput } from "./chat-input";
import type { ApprovalMode, ProviderId, Thread } from "@/lib/types";
import { Sparkles, KeyRound, FolderOpen, Globe, Terminal, PanelRight, PanelLeft } from "lucide-react";
import { getProviderEntry } from "@/lib/providers";

export function ChatArea() {
  const {
    projects,
    threads,
    messages,
    activeProjectId,
    activeThreadId,
    streamingStartedAt,
    streamingThreadId,
    providerCatalog,
    sidebarOpen,
    setSidebarOpen,
    streamingActivities,
  } = useAppStore();

  const {
    sendMessage,
    stopGeneration,
    isStreaming,
    streamingContent,
    streamingError,
  } = useChat();

  const [provider, setProvider] = useState<ProviderId>("openai");
  const [model, setModel] = useState("gpt-5.1-codex-mini");
  const [effort, setEffort] = useState("medium");
  const [approvalMode, setApprovalMode] = useState<ApprovalMode>("suggest");
  const [apiKeyConfigured, setApiKeyConfigured] = useState<boolean | null>(null);
  const [streamClock, setStreamClock] = useState(() => Date.now());
  const isStreamingThisThread = isStreaming && streamingThreadId === activeThreadId;
  const streamElapsedSeconds =
    isStreamingThisThread && streamingStartedAt
      ? Math.floor((streamClock - streamingStartedAt) / 1000)
      : 0;

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollAreaRef = useRef<HTMLDivElement>(null);

  const activeProject = projects.find((p) => p.id === activeProjectId);
  const activeThreads = activeProjectId ? threads[activeProjectId] || [] : [];
  const activeThread = activeThreads.find((t: Thread) => t.id === activeThreadId);
  const activeMessages = activeThreadId ? messages[activeThreadId] || [] : [];
  const providerInfo = getProviderEntry(providerCatalog, provider);
  const providerOptions = providerCatalog.map((item) => ({
    label: item.label,
    value: item.id,
  }));
  const modelOptions = providerInfo.models;

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

  useEffect(() => {
    scrollToBottom("smooth");
  }, [activeMessages.length, streamingContent, scrollToBottom]);

  useEffect(() => {
    if (!isStreamingThisThread || !streamingStartedAt) return;
    const timer = window.setInterval(() => setStreamClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [isStreamingThisThread, streamingStartedAt]);

  // Sync provider/model/effort from active thread
  useEffect(() => {
    if (activeThread) {
      setProvider(activeThread.provider || "openai");
      setModel(activeThread.model);
      setEffort(activeThread.effort || "medium");
      setApprovalMode((activeThread.approvalMode as ApprovalMode) || "suggest");
    }
  }, [activeThread]);

  // Check API key status when provider changes
  useEffect(() => {
    setApiKeyConfigured(null);
    electronAPI
      .invoke("provider:api-key-status", { provider })
      .then((status) => {
        const s = status as { configured: boolean };
        setApiKeyConfigured(s.configured);
      })
      .catch(() => setApiKeyConfigured(false));
  }, [provider]);

  const handleProviderChange = useCallback(
    async (newProvider: ProviderId) => {
      setProvider(newProvider);
      const info = getProviderEntry(providerCatalog, newProvider);
      const nextModel = info.default_model;
      setModel(nextModel);

      if (activeThreadId) {
        try {
          await electronAPI.invoke("thread:update", {
            id: activeThreadId,
            provider: newProvider,
            model: nextModel,
            effort,
          });
        } catch (err) {
          console.error("Erro ao atualizar provider:", err);
        }
      }
    },
    [activeThreadId, providerCatalog, effort]
  );

  const handleModelChange = useCallback(
    async (newModel: string) => {
      setModel(newModel);
      if (activeThreadId) {
        try {
          await electronAPI.invoke("thread:update", {
            id: activeThreadId,
            model: newModel,
          });
        } catch (err) {
          console.error("Erro ao atualizar modelo:", err);
        }
      }
    },
    [activeThreadId]
  );

  const handleEffortChange = useCallback(
    async (newEffort: string) => {
      if (!providerInfo.capabilities.supports_effort) return;
      setEffort(newEffort);
      if (activeThreadId) {
        try {
          await electronAPI.invoke("thread:update", {
            id: activeThreadId,
            effort: newEffort,
          });
        } catch (err) {
          console.error("Erro ao atualizar effort:", err);
        }
      }
    },
    [activeThreadId, providerInfo.capabilities.supports_effort]
  );

  const handleApprovalModeChange = useCallback(
    async (newMode: ApprovalMode) => {
      setApprovalMode(newMode);
      if (activeThreadId) {
        try {
          await electronAPI.invoke("thread:update", {
            id: activeThreadId,
            approvalMode: newMode,
          });
        } catch (err) {
          console.error("Erro ao atualizar approval mode:", err);
        }
      }
    },
    [activeThreadId]
  );

  const handleSend = useCallback(
    async (content: string) => {
      if (!activeThreadId || apiKeyConfigured === false) return;

      // Sync thread config before sending
      try {
        await electronAPI.invoke("thread:update", {
          id: activeThreadId,
          provider,
          model,
          effort,
          approvalMode,
        });
      } catch (err) {
        console.error("Erro ao sincronizar thread:", err);
      }

      sendMessage(content);
    },
    [activeThreadId, model, provider, effort, approvalMode, sendMessage, apiKeyConfigured]
  );

  // Empty state
  if (!activeThreadId) {
    return (
      <div className="flex flex-1 flex-col bg-background">
        {!sidebarOpen && (
          <div className="px-4 pt-3">
            <HeaderButton
              icon={<PanelLeft className="size-4" />}
              tooltip="Mostrar sidebar"
              onClick={() => setSidebarOpen(true)}
            />
          </div>
        )}
        <div className="flex flex-1 flex-col items-center justify-center">
          <div className="flex flex-col items-center gap-4 text-center">
            <div className="flex size-16 items-center justify-center rounded-2xl bg-white/5">
              <Sparkles className="size-8 text-muted-foreground/50" />
            </div>
            <div>
              <h2 className="text-xl font-medium text-foreground">
                {activeProject ? "Vamos construir" : "Duck Codex"}
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
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col bg-background min-h-0">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border/30 px-6 py-2.5">
        <div className="flex items-center gap-2 min-w-0">
          {!sidebarOpen && (
            <HeaderButton
              icon={<PanelLeft className="size-4" />}
              tooltip="Mostrar sidebar"
              onClick={() => setSidebarOpen(true)}
            />
          )}
          <h1 className="truncate text-sm font-medium text-foreground">
            {activeThread?.title || "Conversa"}
          </h1>
          {activeProject && (
            <span className="truncate text-xs text-muted-foreground/50">
              {activeProject.name}
            </span>
          )}
        </div>

        {activeProject && (
          <div className="flex items-center gap-1">
            <HeaderButton
              icon={<FolderOpen className="size-4" />}
              tooltip="Arquivos do projeto"
              onClick={() => {
                useAppStore.getState().setFilePanelOpen(!useAppStore.getState().filePanelOpen);
              }}
            />
            <HeaderButton
              icon={<Terminal className="size-4" />}
              tooltip="Terminal"
              onClick={() => {
                electronAPI.invoke("shell:open-terminal", { path: activeProject.path });
              }}
            />
            <HeaderButton
              icon={<Globe className="size-4" />}
              tooltip="Preview no browser"
              onClick={() => {
                electronAPI.invoke("shell:open-url", { url: "http://localhost:3000" });
              }}
            />
          </div>
        )}
      </div>

      {/* Messages */}
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
              !isStreamingThisThread &&
              idx === activeMessages.length - 1;
            return (
              <MessageBubble
                key={msg.id}
                message={msg}
                provider={activeThread?.provider as ProviderId | undefined}
                model={activeThread?.model}
                onSendMessage={handleSend}
                isLastAssistant={isLastAssistant}
              />
            );
          })}

          {isStreamingThisThread && (
            <StreamingBubble
              content={streamingContent}
              elapsedSeconds={streamElapsedSeconds}
              provider={provider}
              model={model}
              activities={streamingActivities}
            />
          )}

          {streamingError && (
            <div className="mx-4 my-3 flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3">
              <div className="flex-1">
                <p className="text-sm font-medium text-destructive">Erro</p>
                <p className="mt-1 text-xs text-destructive/80">
                  {streamingError}
                </p>
              </div>
              <button
                type="button"
                className="shrink-0 rounded-md bg-destructive/20 px-3 py-1 text-xs text-destructive hover:bg-destructive/30 transition-colors"
                onClick={() => {
                  const lastUserMsg = activeMessages
                    .filter((m) => m.role === "user")
                    .pop();
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

      {/* API key warning */}
      {apiKeyConfigured === false && (
        <div className="mx-auto max-w-3xl w-full px-6">
          <div className="flex items-center gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-2.5 mb-2">
            <KeyRound className="size-4 text-amber-500 shrink-0" />
            <p className="text-xs text-amber-600 dark:text-amber-400">
              API key do <strong>{providerInfo.label}</strong> nao configurada. Va em <strong>Settings &gt; API Keys</strong> para cadastrar.
            </p>
          </div>
        </div>
      )}

      {/* Input */}
      <ChatInput
        onSend={handleSend}
        onStop={stopGeneration}
        isStreaming={isStreaming}
        disabled={!activeThreadId || apiKeyConfigured === false}
        provider={provider}
        providers={providerOptions}
        models={modelOptions}
        supportsEffort={providerInfo.capabilities.supports_effort}
        model={model}
        effort={effort}
        onProviderChange={handleProviderChange}
        onModelChange={handleModelChange}
        onEffortChange={handleEffortChange}
        approvalMode={approvalMode}
        onApprovalModeChange={handleApprovalModeChange}
      />
    </div>
  );
}

function HeaderButton({
  icon,
  tooltip,
  onClick,
}: {
  icon: React.ReactNode;
  tooltip: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={tooltip}
      onClick={onClick}
      className="flex size-7 items-center justify-center rounded-md text-muted-foreground/60 transition-colors hover:bg-accent hover:text-foreground"
    >
      {icon}
    </button>
  );
}
