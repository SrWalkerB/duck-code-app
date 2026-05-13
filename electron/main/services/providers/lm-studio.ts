/**
 * LM Studio Provider
 *
 * Extends OpenAICompatibleProvider — inherits streaming, tool calling, and
 * message building. Only provides LM Studio-specific configuration:
 * base URL, auth, and model listing.
 */

import type {
  ProviderCatalogEntry,
} from "./types.js";
import { PROVIDER_CATALOG } from "../../../../src/shared/provider-catalog.js";
import { getLmStudioBaseUrl } from "./provider-config.js";
import { OpenAICompatibleProvider } from "./openai-compatible.js";

interface LmStudioModel {
  id?: string;
  name?: string;
  key?: string;
  display_name?: string;
  selected_variant?: string;
  variants?: string[];
  type?: string;
  loaded_instances?: Array<{ id?: string }>;
}

interface LmStudioModelsResponse {
  data?: LmStudioModel[];
  models?: LmStudioModel[];
}

const BASE_CATALOG = PROVIDER_CATALOG.find(
  (p) => p.id === "lm-studio"
) as ProviderCatalogEntry;

export class LmStudioProvider extends OpenAICompatibleProvider {
  protected catalog: ProviderCatalogEntry = BASE_CATALOG;

  getBaseUrl(): string {
    return getLmStudioBaseUrl();
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
      return "Conexao com LM Studio OK, mas nenhum modelo LLM disponivel no endpoint /api/v1/models.";
    }
    return `Conexao com LM Studio OK (${modelValues.length} modelo(s) disponivel(is)).`;
  }

  async fetchModelValues(): Promise<string[]> {
    const baseUrl = this.getBaseUrl();
    const res = await fetch(`${baseUrl}/api/v1/models`);
    if (!res.ok) {
      throw new Error(`Falha ao consultar modelos no LM Studio: ${await res.text()}`);
    }

    const json = (await res.json()) as LmStudioModelsResponse;
    const nativeModels = Array.isArray(json.models) ? json.models : [];
    const fromNative = this.extractFromNativeModels(nativeModels);
    if (fromNative.length > 0) {
      return fromNative;
    }

    // OpenAI-like response fallback: { data: [...] }
    const fromCompat = (Array.isArray(json.data) ? json.data : [])
      .filter((item) => {
        const t = (item.type || "").toLowerCase();
        return t !== "embedding" && t !== "embeddings";
      })
      .map((item) => item.id || item.key || item.name || item.display_name || "")
      .map((value) => value.trim())
      .filter((value): value is string => Boolean(value));
    if (fromCompat.length > 0) {
      return [...new Set(fromCompat)];
    }

    return [];
  }

  private extractFromNativeModels(models: LmStudioModel[]): string[] {
    if (!Array.isArray(models) || models.length === 0) return [];

    const values = models
      .filter((item) => (item.type || "llm") !== "embedding")
      .map(
        (item) =>
          item.key ||
          item.selected_variant ||
          item.id ||
          item.name ||
          item.display_name ||
          item.variants?.[0] ||
          ""
      )
      .map((value) => value.trim())
      .filter((value): value is string => Boolean(value));

    return [...new Set(values)];
  }
}
