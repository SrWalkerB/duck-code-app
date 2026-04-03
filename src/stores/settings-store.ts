import { create } from "zustand";

interface SettingsState {
  theme: "dark" | "light";
  defaultModel: string;
  defaultEffort: string;
  defaultContext: string;
  defaultPermissionMode: string;
  showCost: boolean;

  setTheme: (theme: "dark" | "light") => void;
  setDefaultModel: (model: string) => void;
  setDefaultEffort: (effort: string) => void;
  setDefaultContext: (context: string) => void;
  setDefaultPermissionMode: (mode: string) => void;
  setShowCost: (show: boolean) => void;
  toggleTheme: () => void;
}

function loadSettings(): Partial<SettingsState> {
  try {
    const raw = localStorage.getItem("duck-codex-settings");
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return {};
}

function saveSettings(state: SettingsState) {
  try {
    localStorage.setItem("duck-codex-settings", JSON.stringify({
      theme: state.theme,
      defaultModel: state.defaultModel,
      defaultEffort: state.defaultEffort,
      defaultContext: state.defaultContext,
      defaultPermissionMode: state.defaultPermissionMode,
      showCost: state.showCost,
    }));
  } catch { /* ignore */ }
}

function applyTheme(theme: "dark" | "light") {
  const html = document.documentElement;
  if (theme === "dark") {
    html.classList.add("dark");
  } else {
    html.classList.remove("dark");
  }
}

const saved = loadSettings();

export const useSettingsStore = create<SettingsState>((set, get) => {
  // Apply saved theme on load
  const initialTheme = saved.theme || "dark";
  applyTheme(initialTheme);

  return {
    theme: initialTheme,
    defaultModel: saved.defaultModel || "claude-sonnet-4-6",
    defaultEffort: saved.defaultEffort || "medium",
    defaultContext: saved.defaultContext || "",
    defaultPermissionMode: saved.defaultPermissionMode || "acceptEdits",
    showCost: saved.showCost ?? false,

    setTheme: (theme) => {
      applyTheme(theme);
      set({ theme });
      saveSettings({ ...get(), theme });
    },

    setDefaultModel: (defaultModel) => {
      set({ defaultModel });
      saveSettings({ ...get(), defaultModel });
    },

    setDefaultEffort: (defaultEffort) => {
      set({ defaultEffort });
      saveSettings({ ...get(), defaultEffort });
    },

    setDefaultContext: (defaultContext) => {
      set({ defaultContext });
      saveSettings({ ...get(), defaultContext });
    },

    setDefaultPermissionMode: (defaultPermissionMode) => {
      set({ defaultPermissionMode });
      saveSettings({ ...get(), defaultPermissionMode });
    },

    setShowCost: (showCost) => {
      set({ showCost });
      saveSettings({ ...get(), showCost });
    },

    toggleTheme: () => {
      const newTheme = get().theme === "dark" ? "light" : "dark";
      applyTheme(newTheme);
      set({ theme: newTheme });
      saveSettings({ ...get(), theme: newTheme });
    },
  };
});
