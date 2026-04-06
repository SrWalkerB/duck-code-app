// Single source of truth for the provider catalog.
// Imported by both the renderer (via @/shared/provider-catalog)
// and the electron main process (via relative path).

export interface SharedProviderModel {
  label: string;
  value: string;
}

export interface SharedProviderCatalogEntry {
  id: "claude" | "openai" | "codex" | "claude-code" | "lm-studio";
  label: string;
  default_model: string;
  models: SharedProviderModel[];
  capabilities: {
    supports_effort: boolean;
    requires_api_key: boolean;
  };
}

export const PROVIDER_CATALOG: SharedProviderCatalogEntry[] = [
  {
    id: "claude",
    label: "Claude API",
    default_model: "claude-sonnet-4-6",
    models: [
      { label: "Opus 4.6", value: "claude-opus-4-6" },
      { label: "Sonnet 4.6", value: "claude-sonnet-4-6" },
      { label: "Haiku 4.5", value: "claude-haiku-4-5-20251001" },
    ],
    capabilities: {
      supports_effort: false,
      requires_api_key: true,
    },
  },
  {
    id: "openai",
    label: "OpenAI API",
    default_model: "gpt-5.4",
    models: [
      { label: "GPT-5.4", value: "gpt-5.4" },
      { label: "GPT-5.4 Mini", value: "gpt-5.4-mini" },
      { label: "GPT-5.3 Codex", value: "gpt-5.3-codex" },
      { label: "GPT-5.2 Codex", value: "gpt-5.2-codex" },
      { label: "GPT-5.2", value: "gpt-5.2" },
      { label: "GPT-5.1 Codex Max", value: "gpt-5.1-codex-max" },
      { label: "GPT-5.1 Mini", value: "gpt-5.1-mini" },
    ],
    capabilities: {
      supports_effort: true,
      requires_api_key: true,
    },
  },
  {
    id: "codex",
    label: "Codex CLI",
    default_model: "gpt-5.4",
    models: [
      { label: "GPT-5.4", value: "gpt-5.4" },
      { label: "GPT-5.4 Mini", value: "gpt-5.4-mini" },
      { label: "GPT-5.3 Codex", value: "gpt-5.3-codex" },
      { label: "GPT-5.2 Codex", value: "gpt-5.2-codex" },
      { label: "GPT-5.2", value: "gpt-5.2" },
      { label: "GPT-5.1 Codex Max", value: "gpt-5.1-codex-max" },
      { label: "GPT-5.1 Mini", value: "gpt-5.1-mini" },
    ],
    capabilities: {
      supports_effort: false,
      requires_api_key: false,
    },
  },
  {
    id: "claude-code",
    label: "Claude Code CLI",
    default_model: "claude-sonnet-4-6",
    models: [
      { label: "Opus 4.6", value: "claude-opus-4-6" },
      { label: "Sonnet 4.6", value: "claude-sonnet-4-6" },
      { label: "Haiku 4.5", value: "claude-haiku-4-5-20251001" },
    ],
    capabilities: {
      supports_effort: false,
      requires_api_key: false,
    },
  },
  {
    id: "lm-studio",
    label: "LM Studio (Local)",
    default_model: "local-model",
    models: [{ label: "Modelo local", value: "local-model" }],
    capabilities: {
      supports_effort: false,
      requires_api_key: false,
    },
  },
];
