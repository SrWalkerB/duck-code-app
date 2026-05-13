// Single source of truth for the provider catalog.
// Imported by both the renderer (via @/shared/provider-catalog)
// and the electron main process (via relative path).

export interface SharedProviderModel {
  label: string;
  value: string;
}

export interface SharedProviderCatalogEntry {
  id: "lm-studio" | "ollama";
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
    id: "lm-studio",
    label: "LM Studio (Local)",
    default_model: "local-model",
    models: [{ label: "Modelo local", value: "local-model" }],
    capabilities: {
      supports_effort: false,
      requires_api_key: false,
    },
  },
  {
    id: "ollama",
    label: "Ollama (Local)",
    default_model: "local-model",
    models: [{ label: "Modelo local", value: "local-model" }],
    capabilities: {
      supports_effort: false,
      requires_api_key: false,
    },
  },
];
