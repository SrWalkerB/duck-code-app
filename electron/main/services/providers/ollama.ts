/**
 * Ollama Provider
 *
 * Extends OpenAICompatibleProvider — inherits streaming, tool calling, and
 * message building. Only provides Ollama-specific configuration:
 * base URL, auth, and model listing via /api/tags.
 */

import type { ProviderCatalogEntry } from "./types.js";
import { PROVIDER_CATALOG } from "../../../../src/shared/provider-catalog.js";
import { getOllamaBaseUrl } from "./provider-config.js";
import { OpenAICompatibleProvider } from "./openai-compatible.js";

interface OllamaTagsResponse {
  models?: Array<{ name?: string; model?: string }>;
}

const BASE_CATALOG = PROVIDER_CATALOG.find(
  (p) => p.id === "ollama"
) as ProviderCatalogEntry;

export class OllamaProvider extends OpenAICompatibleProvider {
  protected catalog: ProviderCatalogEntry = BASE_CATALOG;

  getBaseUrl(): string {
    return getOllamaBaseUrl();
  }

  getAuthHeaders(): Record<string, string> {
    return {};
  }

  async refreshCatalogModels(): Promise<void> {
    const modelValues = await this.fetchModelValues();
    if (modelValues.length === 0) {
      return;
    }

    const models = modelValues.map((value) => ({ label: value, value }));
    this.catalog = {
      ...BASE_CATALOG,
      default_model: models[0]?.value || BASE_CATALOG.default_model,
      models,
    };
  }

  async testApiKey(_apiKey?: string): Promise<string> {
    const modelValues = await this.fetchModelValues();
    if (modelValues.length === 0) {
      return "Conexao com Ollama OK, mas nenhum modelo disponivel. Use 'ollama pull <modelo>' para baixar.";
    }
    return `Conexao com Ollama OK (${modelValues.length} modelo(s) disponivel(is)).`;
  }

  async fetchModelValues(): Promise<string[]> {
    const baseUrl = this.getBaseUrl();
    const res = await fetch(`${baseUrl}/api/tags`);
    if (!res.ok) {
      throw new Error(
        `Falha ao consultar modelos no Ollama: ${await res.text()}`
      );
    }

    const json = (await res.json()) as OllamaTagsResponse;
    return (json.models || [])
      .map((m) => m.name || m.model || "")
      .filter((v): v is string => Boolean(v));
  }
}
