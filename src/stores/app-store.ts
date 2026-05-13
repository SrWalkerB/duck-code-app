import { create } from "zustand";
import { electronAPI } from "@/lib/electron-api";
import type {
  Project,
  Thread,
  Message,
  ProviderCatalogEntry,
} from "@/lib/types";
import { FALLBACK_PROVIDER_CATALOG } from "@/lib/providers";
import type { ApprovalMode, ProviderId } from "@/lib/types";

export interface ToolApprovalRequest {
  runId: string;
  tool: string;
  args: Record<string, unknown>;
  description: string;
}

export interface QueuedMessage {
  content: string;
  threadId: string;
  provider: ProviderId;
  model: string;
  effort: string;
  approvalMode: ApprovalMode;
}

export interface ThreadStreamState {
  runId: string;
  provider?: ProviderId;
  model?: string;
  content: string;
  error: string | null;
  activities: { kind: string; tool?: string; summary: string; data?: unknown }[];
  startedAt: number;
  pendingToolApproval: ToolApprovalRequest | null;
}

interface AppState {
  projects: Project[];
  threads: Record<string, Thread[]>;
  messages: Record<string, Message[]>;
  providerCatalog: ProviderCatalogEntry[];

  activeProjectId: string | null;
  activeThreadId: string | null;
  activeView: "chat" | "settings";

  /** Per-thread streaming state — multiple threads can stream in parallel */
  activeStreams: Record<string, ThreadStreamState>;
  filePanelOpen: boolean;
  sidebarOpen: boolean;
  terminalPanelOpen: boolean;
  terminalProjectPath: string | null;
  messageQueue: QueuedMessage[];

  fetchProjects: () => Promise<void>;
  fetchProviderCatalog: () => Promise<void>;
  fetchThreads: (projectId: string) => Promise<void>;
  fetchMessages: (threadId: string) => Promise<void>;
  setActiveProject: (projectId: string | null) => void;
  setActiveThread: (threadId: string | null) => void;
  setActiveView: (view: "chat" | "settings") => void;

  // Per-thread streaming actions
  startStream: (
    threadId: string,
    runId: string,
    config?: { provider?: ProviderId; model?: string }
  ) => void;
  addStreamContent: (threadId: string, text: string) => void;
  addStreamActivity: (threadId: string, activity: { kind: string; tool?: string; summary: string; data?: unknown }) => void;
  setStreamError: (threadId: string, error: string) => void;
  endStream: (threadId: string) => void;
  setThreadToolApproval: (threadId: string, approval: ToolApprovalRequest | null) => void;
  respondToolApproval: (threadId: string, approved: boolean) => Promise<void>;

  addOptimisticMessage: (message: Message) => void;
  setFilePanelOpen: (open: boolean) => void;
  setSidebarOpen: (open: boolean) => void;
  openTerminalPanel: (projectPath: string) => void;
  setTerminalPanelOpen: (open: boolean) => void;
  enqueueMessage: (message: QueuedMessage) => void;
  dequeueMessage: () => QueuedMessage | undefined;
  removeQueuedMessage: (index: number) => void;
  clearQueue: () => void;
}

export const useAppStore = create<AppState>((set, get) => ({
  projects: [],
  threads: {},
  messages: {},
  providerCatalog: FALLBACK_PROVIDER_CATALOG,
  activeProjectId: null,
  activeThreadId: null,
  activeView: "chat",
  activeStreams: {},
  filePanelOpen: false,
  sidebarOpen: true,
  terminalPanelOpen: false,
  terminalProjectPath: null,
  messageQueue: [],

  fetchProjects: async () => {
    try {
      const projects = (await electronAPI.invoke("project:list")) as Project[];
      set({ projects });
    } catch (err) {
      console.error("Erro ao buscar projetos:", err);
    }
  },

  fetchProviderCatalog: async () => {
    try {
      const catalog = (await electronAPI.invoke(
        "provider:catalog"
      )) as ProviderCatalogEntry[];
      if (Array.isArray(catalog) && catalog.length > 0) {
        set({ providerCatalog: catalog });
      }
    } catch (err) {
      console.error("Erro ao buscar catalogo:", err);
    }
  },

  fetchThreads: async (projectId: string) => {
    try {
      const threadsList = (await electronAPI.invoke("thread:list", {
        projectId,
      })) as Thread[];
      set((state) => ({
        threads: { ...state.threads, [projectId]: threadsList },
      }));
    } catch (err) {
      console.error("Erro ao buscar threads:", err);
    }
  },

  fetchMessages: async (threadId: string) => {
    try {
      const messagesList = (await electronAPI.invoke("message:list", {
        threadId,
      })) as Message[];
      set((state) => ({
        messages: { ...state.messages, [threadId]: messagesList },
      }));
    } catch (err) {
      console.error("Erro ao buscar mensagens:", err);
    }
  },

  setActiveProject: (projectId) => {
    const currentProjectId = get().activeProjectId;
    const didProjectChange = projectId !== currentProjectId;

    if (didProjectChange) {
      get().clearQueue();
      set({ activeProjectId: projectId, activeThreadId: null });
    } else {
      set({ activeProjectId: projectId });
    }

    if (projectId) {
      get().fetchThreads(projectId);
    }
  },

  setActiveThread: (threadId) => {
    get().clearQueue();
    set({ activeThreadId: threadId });
    if (threadId) {
      get().fetchMessages(threadId);
    }
  },

  setActiveView: (view) => set({ activeView: view }),

  startStream: (threadId, runId, config) => {
    set((state) => ({
      activeStreams: {
        ...state.activeStreams,
        [threadId]: {
          runId,
          provider: config?.provider,
          model: config?.model,
          content: "",
          error: null,
          activities: [],
          startedAt: Date.now(),
          pendingToolApproval: null,
        },
      },
    }));
  },

  addStreamContent: (threadId, text) => {
    set((state) => {
      const stream = state.activeStreams[threadId];
      if (!stream) return state;
      return {
        activeStreams: {
          ...state.activeStreams,
          [threadId]: { ...stream, content: stream.content + text },
        },
      };
    });
  },

  addStreamActivity: (threadId, activity) => {
    set((state) => {
      const stream = state.activeStreams[threadId];
      if (!stream) return state;
      return {
        activeStreams: {
          ...state.activeStreams,
          [threadId]: { ...stream, activities: [...stream.activities, activity] },
        },
      };
    });
  },

  setStreamError: (threadId, error) => {
    set((state) => {
      const stream = state.activeStreams[threadId];
      if (!stream) return state;
      return {
        activeStreams: {
          ...state.activeStreams,
          [threadId]: { ...stream, error },
        },
      };
    });
  },

  endStream: (threadId) => {
    set((state) => {
      const rest = { ...state.activeStreams };
      delete rest[threadId];
      return { activeStreams: rest };
    });
  },

  setThreadToolApproval: (threadId, approval) => {
    set((state) => {
      const stream = state.activeStreams[threadId];
      if (!stream) return state;
      return {
        activeStreams: {
          ...state.activeStreams,
          [threadId]: { ...stream, pendingToolApproval: approval },
        },
      };
    });
  },

  respondToolApproval: async (threadId, approved) => {
    const stream = get().activeStreams[threadId];
    if (!stream?.pendingToolApproval) return;
    await electronAPI.invoke("message:tool-approval-response", {
      threadId,
      runId: stream.pendingToolApproval.runId,
      approved,
    });
    get().setThreadToolApproval(threadId, null);
  },

  addOptimisticMessage: (message) => {
    set((state) => ({
      messages: {
        ...state.messages,
        [message.threadId]: [
          ...(state.messages[message.threadId] || []),
          message,
        ],
      },
    }));
  },

  setFilePanelOpen: (open) => set({ filePanelOpen: open }),
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
  openTerminalPanel: (projectPath) =>
    set({ terminalPanelOpen: true, terminalProjectPath: projectPath }),
  setTerminalPanelOpen: (open) =>
    set((state) => ({
      terminalPanelOpen: open,
      terminalProjectPath: open ? state.terminalProjectPath : null,
    })),

  enqueueMessage: (message) => {
    set({ messageQueue: [message] });
  },
  dequeueMessage: () => {
    const queue = get().messageQueue;
    if (queue.length === 0) return undefined;
    const [first, ...rest] = queue;
    set({ messageQueue: rest });
    return first;
  },
  removeQueuedMessage: (index) => {
    set((state) => ({
      messageQueue: state.messageQueue.filter((_, i) => i !== index),
    }));
  },
  clearQueue: () => set({ messageQueue: [] }),
}));

electronAPI.on("thread:renamed", (...args: unknown[]) => {
  const payload = args[0] as { projectId?: string } | undefined;
  if (!payload?.projectId) return;
  useAppStore.getState().fetchThreads(payload.projectId);
});
