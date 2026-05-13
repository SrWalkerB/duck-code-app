import { useEffect, useRef, useState, useCallback } from "react";
import { electronAPI } from "@/lib/electron-api";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAppStore } from "@/stores/app-store";
import { useChat } from "@/hooks/use-chat";
import { MessageBubble, StreamingBubble } from "./message-bubble";
import { ChatInput } from "./chat-input";
import { MessageQueue } from "./message-queue";
import { ToolApprovalCard } from "./tool-approval-card";
import { ThreadLogsPanel } from "./thread-logs-panel";
import type { ApprovalMode, ProviderId, Thread } from "@/lib/types";
import { useSettingsStore } from "@/stores/settings-store";
import type { CodeEditorId } from "@/stores/settings-store";
import {
  Sparkles,
  FolderOpen,
  Globe,
  Terminal,
  PanelLeft,
  GitBranch,
  ChevronDown,
  ScrollText,
  Code2,
} from "lucide-react";
import { getProviderEntry } from "@/lib/providers";
import { cn } from "@/lib/utils";

function getAssistantMessageModel(metadata: string | null, fallback?: string): string | undefined {
  if (!metadata) return fallback;
  try {
    const parsed = JSON.parse(metadata) as { model?: unknown };
    if (typeof parsed.model === "string" && parsed.model.trim()) {
      return parsed.model;
    }
  } catch {
    // Ignore invalid metadata payloads.
  }
  return fallback;
}

export function ChatArea() {
  const {
    projects,
    threads,
    messages,
    activeProjectId,
    activeThreadId,
    activeStreams,
    providerCatalog,
    sidebarOpen,
    setSidebarOpen,
    terminalPanelOpen,
    terminalProjectPath,
    messageQueue,
    enqueueMessage,
    removeQueuedMessage,
    filePanelOpen,
    setFilePanelOpen,
    setTerminalPanelOpen,
    openTerminalPanel,
  } = useAppStore();

  const {
    sendMessage,
    stopGeneration,
    streamingContent,
    streamingError,
  } = useChat();

  const [provider, setProvider] = useState<ProviderId>("lm-studio");
  const [model, setModel] = useState("gpt-5.1-codex-mini");
  const [effort, setEffort] = useState("medium");
  const [approvalMode, setApprovalMode] = useState<ApprovalMode>("no-tools");
  const [apiKeyConfigured, setApiKeyConfigured] = useState<boolean | null>(null);
  const [streamClock, setStreamClock] = useState(() => Date.now());
  const [logsPanelOpen, setLogsPanelOpen] = useState(false);
  const [gitSwitching, setGitSwitching] = useState(false);
  const [gitCurrentBranch, setGitCurrentBranch] = useState<string | null>(null);
  const [gitBranches, setGitBranches] = useState<string[]>([]);
  const [gitIsRepo, setGitIsRepo] = useState(false);
  const [installedEditors, setInstalledEditors] = useState<
    Array<{ id: CodeEditorId; label: string }>
  >([]);
  const threadStream = activeThreadId ? activeStreams[activeThreadId] ?? null : null;
  const isStreamingThisThread = threadStream !== null;
  const streamingActivities = threadStream?.activities ?? [];
  const streamElapsedSeconds =
    isStreamingThisThread && threadStream
      ? Math.floor((streamClock - threadStream.startedAt) / 1000)
      : 0;

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollAreaRef = useRef<HTMLDivElement>(null);

  const activeProject = projects.find((p) => p.id === activeProjectId);
  const isTerminalActive =
    !!activeProject &&
    terminalPanelOpen &&
    terminalProjectPath === activeProject.path;
  const activeThreads = activeProjectId ? threads[activeProjectId] || [] : [];
  const activeThread = activeThreads.find((t: Thread) => t.id === activeThreadId);
  const activeMessages = activeThreadId ? messages[activeThreadId] || [] : [];
  const providerInfo = getProviderEntry(providerCatalog, provider);
  const providerOptions = providerCatalog.map((item) => ({
    label: item.label,
    value: item.id,
  }));
  const modelOptions = providerInfo.models;
  const preferredCodeEditor = useSettingsStore((s) => s.preferredCodeEditor);
  const setPreferredCodeEditor = useSettingsStore((s) => s.setPreferredCodeEditor);
  const hasInstalledEditor = installedEditors.length > 0;

  useEffect(() => {
    electronAPI
      .invoke("shell:list-installed-editors")
      .then((result) => {
        const list = Array.isArray(result)
          ? (result as Array<{ id: CodeEditorId; label: string }>)
          : [];
        setInstalledEditors(list);
      })
      .catch(() => setInstalledEditors([]));
  }, []);

  useEffect(() => {
    if (!installedEditors.length) return;
    const exists = installedEditors.some((item) => item.id === preferredCodeEditor);
    if (!exists) {
      setPreferredCodeEditor(installedEditors[0].id);
    }
  }, [installedEditors, preferredCodeEditor, setPreferredCodeEditor]);

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
    if (!isStreamingThisThread) return;
    const timer = window.setInterval(() => setStreamClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [isStreamingThisThread]);

  // Sync provider/model/effort from active thread
  useEffect(() => {
    if (activeThread) {
      setProvider((activeThread.provider as ProviderId) || "lm-studio");
      setModel(activeThread.model);
      setEffort(activeThread.effort || "medium");
      setApprovalMode((activeThread.approvalMode as ApprovalMode) || "no-tools");
    }
  }, [activeThread]);

  // Local providers (LM Studio / Ollama) don't require API keys.
  useEffect(() => {
    setApiKeyConfigured(true);
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
            sessionId: null,
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
            sessionId: null,
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

      sendMessage(content, { provider, model });
    },
    [activeThreadId, model, provider, effort, approvalMode, sendMessage, apiKeyConfigured]
  );

  const handleEnqueue = useCallback(
    (content: string) => {
      if (!activeThreadId) return;
      enqueueMessage({
        content,
        threadId: activeThreadId,
        provider,
        model,
        effort,
        approvalMode,
      });
    },
    [activeThreadId, enqueueMessage, provider, model, effort, approvalMode]
  );

  const handleSteer = useCallback(
    async (index: number) => {
      const msg = messageQueue[index];
      if (!msg) return;
      removeQueuedMessage(index);
      await stopGeneration();
      setTimeout(() => handleSend(msg.content), 100);
    },
    [messageQueue, removeQueuedMessage, stopGeneration, handleSend]
  );

  const handleRemoveQueued = useCallback(
    (index: number) => {
      removeQueuedMessage(index);
    },
    [removeQueuedMessage]
  );

  const refreshGitSummary = useCallback(async () => {
    if (!activeThreadId) {
      setGitIsRepo(false);
      setGitCurrentBranch(null);
      setGitBranches([]);
      return;
    }

    try {
      const summary = (await electronAPI.invoke("git:summary-for-thread", {
        threadId: activeThreadId,
      })) as {
        isRepo: boolean;
        currentBranch: string | null;
        branches: string[];
      };
      setGitIsRepo(Boolean(summary.isRepo));
      setGitCurrentBranch(summary.currentBranch);
      setGitBranches(Array.isArray(summary.branches) ? summary.branches : []);
    } catch (err) {
      console.error("Erro ao buscar dados de git da thread:", err);
      setGitIsRepo(false);
      setGitCurrentBranch(null);
      setGitBranches([]);
    }
  }, [activeThreadId]);

  useEffect(() => {
    refreshGitSummary();
  }, [refreshGitSummary]);

  const handleCheckoutBranch = useCallback(
    async (branch: string) => {
      if (!activeThreadId || gitSwitching) return;
      try {
        setGitSwitching(true);
        await electronAPI.invoke("git:checkout-branch-for-thread", {
          threadId: activeThreadId,
          branch,
        });
        await refreshGitSummary();
      } catch (err) {
        console.error("Erro ao trocar branch da thread:", err);
      } finally {
        setGitSwitching(false);
      }
    },
    [activeThreadId, gitSwitching, refreshGitSummary]
  );

  const handleOpenThreadInEditor = useCallback(
    async (editorOverride?: CodeEditorId) => {
      if (!activeProject || !activeThreadId || !hasInstalledEditor) return;
      const targetEditor = editorOverride ?? preferredCodeEditor;
      try {
        const summary = (await electronAPI.invoke("git:summary-for-thread", {
          threadId: activeThreadId,
        })) as { resolvedPath?: string | null };
        const resolvedPath = summary?.resolvedPath || activeProject.path;
        await electronAPI.invoke("shell:open-in-editor", {
          path: resolvedPath,
          editor: targetEditor,
        });
      } catch (err) {
        console.error("Erro ao abrir diretorio da thread no editor:", err);
      }
    },
    [activeProject, activeThreadId, preferredCodeEditor, hasInstalledEditor]
  );

  const handleEditorSelectChange = useCallback(
    async (value: string) => {
      const nextEditor = value as CodeEditorId;
      setPreferredCodeEditor(nextEditor);
      await handleOpenThreadInEditor(nextEditor);
    },
    [setPreferredCodeEditor, handleOpenThreadInEditor]
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
                {activeProject ? "Vamos construir" : "Duck Code"}
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
    <div className="flex flex-1 min-h-0">
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
          <div className="flex items-center gap-2">
            {hasInstalledEditor && (
              <>
                <HeaderButton
                  icon={<Code2 className="size-4" />}
                  tooltip="Abrir diretorio da thread no editor"
                  onClick={() => handleOpenThreadInEditor()}
                />
                <label className="sr-only" htmlFor="code-editor-select">
                  Editor de codigo
                </label>
                <select
                  id="code-editor-select"
                  value={preferredCodeEditor}
                  onChange={(e) => handleEditorSelectChange(e.target.value)}
                  className="h-7 rounded-md border border-border/50 bg-muted/50 px-2 text-xs text-foreground outline-none transition-colors hover:border-border focus:border-border"
                  title="Selecionar editor de codigo"
                >
                  {installedEditors.map((editor) => (
                    <option key={editor.id} value={editor.id}>
                      {editor.label}
                    </option>
                  ))}
                </select>
              </>
            )}
            <div className="h-4 w-px bg-border/60" />
            <HeaderButton
              icon={<FolderOpen className="size-4" />}
              tooltip={
                filePanelOpen
                  ? "Fechar explorador de arquivos"
                  : "Explorar arquivos do projeto"
              }
              active={filePanelOpen}
              onClick={() => {
                if (!filePanelOpen && logsPanelOpen) {
                  setLogsPanelOpen(false);
                }
                setFilePanelOpen(!filePanelOpen);
              }}
            />
            <HeaderButton
              icon={<Terminal className="size-4" />}
              tooltip={isTerminalActive ? "Fechar terminal" : "Terminal"}
              active={isTerminalActive}
              onClick={() => {
                if (isTerminalActive) {
                  setTerminalPanelOpen(false);
                } else {
                  openTerminalPanel(activeProject.path);
                }
              }}
            />
            <HeaderButton
              icon={<Globe className="size-4" />}
              tooltip="Preview no browser (indisponivel)"
              disabled
              onClick={() => {}}
            />
            <HeaderButton
              icon={<ScrollText className="size-4" />}
              tooltip="Logs da thread"
              active={logsPanelOpen}
              onClick={() => {
                const { filePanelOpen, setFilePanelOpen } = useAppStore.getState();
                if (!logsPanelOpen && filePanelOpen) {
                  setFilePanelOpen(false);
                }
                setLogsPanelOpen(!logsPanelOpen);
              }}
            />
          </div>
        )}
      </div>

      {/* Messages */}
      <ScrollArea ref={scrollAreaRef} className="flex-1 min-h-0">
        <div className="mx-auto max-w-3xl px-6 py-6">
          {activeMessages.length === 0 && !isStreamingThisThread && (
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
                model={
                  msg.role === "assistant"
                    ? getAssistantMessageModel(msg.metadata, activeThread?.model)
                    : undefined
                }
                onSendMessage={handleSend}
                isLastAssistant={isLastAssistant}
              />
            );
          })}

          {isStreamingThisThread && (
            <StreamingBubble
              content={streamingContent}
              elapsedSeconds={streamElapsedSeconds}
              provider={threadStream?.provider ?? provider}
              model={threadStream?.model ?? model}
              activities={streamingActivities}
              onAnswer={handleSend}
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

          <ToolApprovalCard />
          <div ref={messagesEndRef} />
        </div>
      </ScrollArea>

      {/* Message Queue */}
      <MessageQueue
        queue={messageQueue}
        onSteer={handleSteer}
        onRemove={handleRemoveQueued}
      />

      {/* Input */}
      <ChatInput
        onSend={handleSend}
        onEnqueue={handleEnqueue}
        onStop={stopGeneration}
        isStreaming={isStreamingThisThread}
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

      {activeThreadId && gitIsRepo && (
        <div className="border-t border-border/30 bg-background px-6 py-2">
          <div className="mx-auto flex max-w-3xl items-center">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="flex min-w-0 items-center gap-1.5 rounded-md px-2 py-0.5 text-[11px] text-muted-foreground/80 transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
                  disabled={gitSwitching}
                  title="Selecionar branch"
                >
                  <GitBranch className="size-3 shrink-0" />
                  <span className="truncate">{gitCurrentBranch || "sem branch"}</span>
                  <ChevronDown className="size-2.5 shrink-0" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-56">
                {gitBranches.length === 0 ? (
                  <DropdownMenuItem disabled>Sem branches locais</DropdownMenuItem>
                ) : (
                  gitBranches.map((branch) => (
                    <DropdownMenuItem
                      key={branch}
                      onClick={() => handleCheckoutBranch(branch)}
                      className={cn(
                        "flex items-center justify-between",
                        gitCurrentBranch === branch && "text-foreground"
                      )}
                    >
                      <span className="truncate">{branch}</span>
                      {gitCurrentBranch === branch && (
                        <span className="text-xs text-muted-foreground">atual</span>
                      )}
                    </DropdownMenuItem>
                  ))
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      )}
    </div>

    {logsPanelOpen && activeThreadId && (
      <ThreadLogsPanel
        threadId={activeThreadId}
        onClose={() => setLogsPanelOpen(false)}
      />
    )}
    </div>
  );
}

function HeaderButton({
  icon,
  tooltip,
  active = false,
  disabled = false,
  onClick,
}: {
  icon: React.ReactNode;
  tooltip: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={tooltip}
      onClick={onClick}
      disabled={disabled}
      className={`flex size-7 items-center justify-center rounded-md transition-colors ${
        active
          ? "bg-accent text-foreground ring-1 ring-border/60"
          : "text-muted-foreground/60 hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
      }`}
    >
      {icon}
    </button>
  );
}
