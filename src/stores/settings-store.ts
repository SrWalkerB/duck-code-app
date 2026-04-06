import { create } from "zustand";
import type { ApprovalMode, ProviderId } from "@/lib/types";
import { buildDefaultModelsMap, FALLBACK_PROVIDER_CATALOG } from "@/lib/providers";

export type CodeEditorId = "vscode" | "cursor" | "windsurf" | "zed";

interface SettingsState {
  theme: "dark" | "light";
  defaultProvider: ProviderId;
  defaultModels: Record<ProviderId, string>;
  defaultEffort: string;
  defaultApprovalMode: ApprovalMode;
  preferredCodeEditor: CodeEditorId;

  setTheme: (theme: "dark" | "light") => void;
  setDefaultProvider: (provider: ProviderId) => void;
  setDefaultModel: (provider: ProviderId, model: string) => void;
  setDefaultEffort: (effort: string) => void;
  setDefaultApprovalMode: (mode: ApprovalMode) => void;
  setPreferredCodeEditor: (editor: CodeEditorId) => void;
  toggleTheme: () => void;
}

function loadSettings(): Record<string, unknown> {
  try {
    const raw = localStorage.getItem("duck-codex-settings");
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") return parsed as Record<string, unknown>;
    }
  } catch {
    // ignore
  }
  return {};
}

function saveSettings(state: SettingsState) {
  try {
    localStorage.setItem(
      "duck-codex-settings",
      JSON.stringify({
        theme: state.theme,
        defaultProvider: state.defaultProvider,
        defaultModels: state.defaultModels,
        defaultEffort: state.defaultEffort,
        defaultApprovalMode: state.defaultApprovalMode,
        preferredCodeEditor: state.preferredCodeEditor,
      })
    );
  } catch {
    // ignore
  }
}

function applyTheme(theme: "dark" | "light") {
  if (theme === "dark") {
    document.documentElement.classList.add("dark");
  } else {
    document.documentElement.classList.remove("dark");
  }
}

function isProvider(value: unknown): value is ProviderId {
  return (
    value === "claude" ||
    value === "openai" ||
    value === "codex" ||
    value === "claude-code" ||
    value === "lm-studio"
  );
}

function isCodeEditor(value: unknown): value is CodeEditorId {
  return (
    value === "vscode" ||
    value === "cursor" ||
    value === "windsurf" ||
    value === "zed"
  );
}

const saved = loadSettings();
const fallbackModels = buildDefaultModelsMap(FALLBACK_PROVIDER_CATALOG);

const savedDefaultModels =
  saved.defaultModels && typeof saved.defaultModels === "object"
    ? (saved.defaultModels as Partial<Record<ProviderId, string>>)
    : {};

const initialDefaultModels: Record<ProviderId, string> = {
  claude: savedDefaultModels.claude || fallbackModels.claude,
  openai: savedDefaultModels.openai || fallbackModels.openai,
  codex: savedDefaultModels.codex || fallbackModels.codex,
  "claude-code": savedDefaultModels["claude-code"] || fallbackModels["claude-code"],
  "lm-studio": savedDefaultModels["lm-studio"] || fallbackModels["lm-studio"],
};

const savedProvider = saved.defaultProvider;
const initialDefaultProvider: ProviderId = isProvider(savedProvider)
  ? savedProvider
  : "openai";

export const useSettingsStore = create<SettingsState>((set, get) => {
  const initialTheme = saved.theme === "light" ? "light" : "dark";
  applyTheme(initialTheme);

  return {
    theme: initialTheme,
    defaultProvider: initialDefaultProvider,
    defaultModels: initialDefaultModels,
    defaultEffort:
      typeof saved.defaultEffort === "string" ? saved.defaultEffort : "medium",
    defaultApprovalMode:
      (saved.defaultApprovalMode as ApprovalMode) || "suggest",
    preferredCodeEditor: isCodeEditor(saved.preferredCodeEditor)
      ? saved.preferredCodeEditor
      : "vscode",

    setTheme: (theme) => {
      applyTheme(theme);
      set({ theme });
      saveSettings({ ...get(), theme });
    },

    setDefaultProvider: (defaultProvider) => {
      set({ defaultProvider });
      saveSettings({ ...get(), defaultProvider });
    },

    setDefaultModel: (provider, model) => {
      set((state) => ({
        defaultModels: { ...state.defaultModels, [provider]: model },
      }));
      saveSettings(get());
    },

    setDefaultEffort: (defaultEffort) => {
      set({ defaultEffort });
      saveSettings({ ...get(), defaultEffort });
    },

    setDefaultApprovalMode: (defaultApprovalMode) => {
      set({ defaultApprovalMode });
      saveSettings({ ...get(), defaultApprovalMode });
    },

    setPreferredCodeEditor: (preferredCodeEditor) => {
      set({ preferredCodeEditor });
      saveSettings({ ...get(), preferredCodeEditor });
    },

    toggleTheme: () => {
      const newTheme = get().theme === "dark" ? "light" : "dark";
      applyTheme(newTheme);
      set({ theme: newTheme });
      saveSettings({ ...get(), theme: newTheme });
    },
  };
});
