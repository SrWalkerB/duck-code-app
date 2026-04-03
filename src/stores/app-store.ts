import { create } from "zustand";
import { electronAPI } from "@/lib/electron-api";
import type {
  Project,
  Thread,
  Message,
  ProviderCatalogEntry,
} from "@/lib/types";
import { FALLBACK_PROVIDER_CATALOG } from "@/lib/providers";

interface AppState {
  projects: Project[];
  threads: Record<string, Thread[]>;
  messages: Record<string, Message[]>;
  providerCatalog: ProviderCatalogEntry[];

  activeProjectId: string | null;
  activeThreadId: string | null;
  activeView: "chat" | "settings";

  isStreaming: boolean;
  streamingStartedAt: number | null;
  streamingThreadId: string | null;
  activeRunId: string | null;
  streamingContent: string;
  streamingError: string | null;

  fetchProjects: () => Promise<void>;
  fetchProviderCatalog: () => Promise<void>;
  fetchThreads: (projectId: string) => Promise<void>;
  fetchMessages: (threadId: string) => Promise<void>;
  setActiveProject: (projectId: string | null) => void;
  setActiveThread: (threadId: string | null) => void;
  setActiveView: (view: "chat" | "settings") => void;
  addStreamContent: (text: string) => void;
  setStreamingThreadId: (threadId: string | null) => void;
  setActiveRunId: (runId: string | null) => void;
  setIsStreaming: (streaming: boolean) => void;
  setStreamingError: (error: string | null) => void;
  clearStream: () => void;
  addOptimisticMessage: (message: Message) => void;
}

export const useAppStore = create<AppState>((set, get) => ({
  projects: [],
  threads: {},
  messages: {},
  providerCatalog: FALLBACK_PROVIDER_CATALOG,
  activeProjectId: null,
  activeThreadId: null,
  activeView: "chat",
  isStreaming: false,
  streamingStartedAt: null,
  streamingThreadId: null,
  activeRunId: null,
  streamingContent: "",
  streamingError: null,

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
    set({ activeProjectId: projectId });
    if (projectId) {
      get().fetchThreads(projectId);
    }
  },

  setActiveThread: (threadId) => {
    set({ activeThreadId: threadId });
    if (threadId) {
      get().fetchMessages(threadId);
    }
  },

  setActiveView: (view) => set({ activeView: view }),

  addStreamContent: (text) => {
    set((state) => ({
      streamingContent: state.streamingContent + text,
    }));
  },

  setStreamingThreadId: (threadId) => set({ streamingThreadId: threadId }),
  setActiveRunId: (runId) => set({ activeRunId: runId }),

  setIsStreaming: (streaming) => {
    set((state) => ({
      isStreaming: streaming,
      streamingStartedAt: streaming
        ? state.streamingStartedAt ?? Date.now()
        : null,
    }));
  },

  setStreamingError: (error) => set({ streamingError: error }),

  clearStream: () => {
    set({
      activeRunId: null,
      streamingThreadId: null,
      streamingContent: "",
      streamingError: null,
    });
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
}));
