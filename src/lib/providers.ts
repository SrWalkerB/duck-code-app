import type { ProviderCatalogEntry, ProviderId } from "@/lib/types";
import { PROVIDER_CATALOG } from "@/shared/provider-catalog";

export const FALLBACK_PROVIDER_CATALOG: ProviderCatalogEntry[] =
  PROVIDER_CATALOG as ProviderCatalogEntry[];

export function getProviderEntry(
  catalog: ProviderCatalogEntry[],
  provider: ProviderId | string
): ProviderCatalogEntry {
  return (
    catalog.find((entry) => entry.id === provider) ?? FALLBACK_PROVIDER_CATALOG[0]
  );
}

export function getProviderDefaultModel(
  catalog: ProviderCatalogEntry[],
  provider: ProviderId
): string {
  return getProviderEntry(catalog, provider).default_model;
}

export function buildDefaultModelsMap(
  catalog: ProviderCatalogEntry[]
): Record<ProviderId, string> {
  return {
    claude: getProviderDefaultModel(catalog, "claude"),
    openai: getProviderDefaultModel(catalog, "openai"),
    codex: getProviderDefaultModel(catalog, "codex"),
    "claude-code": getProviderDefaultModel(catalog, "claude-code"),
    "lm-studio": getProviderDefaultModel(catalog, "lm-studio"),
  };
}
