import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import type { Project, Thread, Message, ToolUseEvent, ToolResultEvent, ToolActivity } from "@/lib/types";
import { useSettingsStore } from "@/stores/settings-store";

interface AppState {
  // Data
  projects: Project[];
  threads: Record<string, Thread[]>; // keyed by projectId
  messages: Record<string, Message[]>; // keyed by threadId

  // Active selection
  activeProjectId: string | null;
  activeThreadId: string | null;

  // Streaming
  isStreaming: boolean;
  streamingContent: string;
  streamingToolUse: string | null;
  streamingError: string | null;

  // View
  activeView: 'chat' | 'skills';
  setActiveView: (view: 'chat' | 'skills') => void;

  // Panels
  activePanel: 'files' | 'git' | null;
  terminalOpen: boolean;
  setActivePanel: (panel: 'files' | 'git' | null) => void;
  toggleTerminal: () => void;

  // Permission mode (per-thread, stored in status bar for now)
  permissionMode: string;
  setPermissionMode: (mode: string) => void;


  // Tool activities during streaming
  streamingTools: ToolActivity[];
  addToolUse: (event: ToolUseEvent) => void;
  updateToolResult: (event: ToolResultEvent) => void;

  // Actions
  fetchProjects: () => Promise<void>;
  fetchThreads: (projectId: string) => Promise<void>;
  fetchMessages: (threadId: string) => Promise<void>;
  setActiveProject: (projectId: string | null) => void;
  setActiveThread: (threadId: string | null) => void;
  addStreamContent: (text: string) => void;
  setStreamingToolUse: (tool: string | null) => void;
  setIsStreaming: (streaming: boolean) => void;
  setStreamingError: (error: string | null) => void;
  clearStream: () => void;
  addOptimisticMessage: (message: Message) => void;
}

export const useAppStore = create<AppState>((set, get) => ({
  projects: [],
  threads: {},
  messages: {},
  activeProjectId: null,
  activeThreadId: null,
  isStreaming: false,
  streamingContent: "",
  streamingToolUse: null,
  streamingError: null,
  activeView: 'chat',
  streamingTools: [],
  activePanel: null,
  terminalOpen: false,
  permissionMode: useSettingsStore.getState().defaultPermissionMode,

  fetchProjects: async () => {
    try {
      const projects = await invoke<Project[]>("list_projects");
      set({ projects });
    } catch (err) {
      console.error("Erro ao buscar projetos:", err);
    }
  },

  fetchThreads: async (projectId: string) => {
    try {
      const threadsList = await invoke<Thread[]>("list_threads", { projectId });
      set((state) => ({
        threads: { ...state.threads, [projectId]: threadsList },
      }));
    } catch (err) {
      console.error("Erro ao buscar threads:", err);
    }
  },

  fetchMessages: async (threadId: string) => {
    try {
      const messagesList = await invoke<Message[]>("list_messages", { threadId });
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

  addStreamContent: (text) => {
    set((state) => ({
      streamingContent: state.streamingContent + text,
    }));
  },

  setStreamingToolUse: (tool) => {
    set({ streamingToolUse: tool });
  },

  setIsStreaming: (streaming) => {
    set({ isStreaming: streaming });
  },

  setStreamingError: (error) => {
    set({ streamingError: error });
  },

  setActiveView: (view) => set({ activeView: view }),

  setActivePanel: (panel) =>
    set((state) => ({
      activePanel: state.activePanel === panel ? null : panel,
    })),
  toggleTerminal: () => set((state) => ({ terminalOpen: !state.terminalOpen })),
  setPermissionMode: (mode) => set({ permissionMode: mode }),

  clearStream: () => {
    set({ streamingContent: "", streamingToolUse: null, streamingError: null, streamingTools: [] });
  },

  addToolUse: (event) => {
    set((state) => {
      // Skip if already exists (CLI sends cumulative events)
      if (state.streamingTools.some((t) => t.tool_use_id === event.tool_use_id)) {
        return state;
      }
      return {
        streamingTools: [
          ...state.streamingTools,
          {
            tool_use_id: event.tool_use_id,
            name: event.name,
            input: event.input,
            status: "running",
          },
        ],
      };
    });
  },

  updateToolResult: (event) => {
    set((state) => ({
      streamingTools: state.streamingTools.map((t) =>
        t.tool_use_id === event.tool_use_id
          ? { ...t, result: event.content, status: "done" as const }
          : t
      ),
    }));
  },

  addOptimisticMessage: (message) => {
    set((state) => ({
      messages: {
        ...state.messages,
        [message.thread_id]: [
          ...(state.messages[message.thread_id] || []),
          message,
        ],
      },
    }));
  },
}));
