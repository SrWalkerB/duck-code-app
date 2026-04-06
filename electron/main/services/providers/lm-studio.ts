import type {
  ProviderCatalogEntry,
  ProviderRuntime,
  SendMessageRequest,
  SendMessageResult,
  StreamChunk,
  ApiKeyStatus,
} from "./types.js";
import { PROVIDER_CATALOG } from "../../../../src/shared/provider-catalog.js";
import { getLmStudioBaseUrl } from "./provider-config.js";

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

interface ChatCompletionDelta {
  content?: string | null;
  reasoning_content?: string | null;
  role?: string;
}

export class LmStudioProvider implements ProviderRuntime {
  readonly supportsNativeTools = false;
  private catalog: ProviderCatalogEntry = BASE_CATALOG;

  getCatalogEntry(): ProviderCatalogEntry {
    return this.catalog;
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

  async getApiKeyStatus(): Promise<ApiKeyStatus> {
    return { configured: true, last4: null };
  }

  async setApiKey(apiKey: string): Promise<void> {
    void apiKey;
  }

  async removeApiKey(): Promise<void> {}

  async testApiKey(_apiKey?: string): Promise<string> {
    const modelValues = await this.fetchModelValues();
    if (modelValues.length === 0) {
      return "Conexao com LM Studio OK, mas nenhum modelo LLM disponivel no endpoint /api/v1/models.";
    }
    return `Conexao com LM Studio OK (${modelValues.length} modelo(s) disponivel(is)).`;
  }

  async sendMessageStream(
    request: SendMessageRequest,
    onChunk: (chunk: StreamChunk) => void,
    signal?: AbortSignal
  ): Promise<SendMessageResult> {
    const startedAt = Date.now();
    const baseUrl = getLmStudioBaseUrl();

    // Build messages array from history + current message
    const messages: { role: string; content: string }[] = [];
    for (const msg of request.history) {
      messages.push({ role: msg.role, content: msg.content });
    }
    messages.push({ role: "user", content: request.message });

    const res = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: request.model,
        messages,
        stream: true,
      }),
      signal,
    });

    if (!res.ok) {
      throw new Error(`LM Studio API erro: ${await res.text()}`);
    }

    let fullText = "";
    let thinkingText = "";
    let thinkingEmitted = false;
    let responseId: string | null = null;
    const reader = res.body?.getReader();
    if (!reader) {
      throw new Error("Resposta de stream invalida do LM Studio.");
    }

    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (!data || data === "[DONE]") continue;

        let event: Record<string, unknown>;
        try {
          event = JSON.parse(data) as Record<string, unknown>;
        } catch {
          continue;
        }

        if (typeof event.id === "string") {
          responseId = event.id;
        }

        const choices = event.choices as Array<Record<string, unknown>> | undefined;
        if (!choices || choices.length === 0) continue;

        const delta = choices[0].delta as ChatCompletionDelta | undefined;
        if (!delta) continue;

        // Reasoning/thinking content (separate field from actual response)
        if (delta.reasoning_content) {
          thinkingText += delta.reasoning_content;
        }

        // When actual content starts, emit accumulated thinking first
        if (delta.content) {
          if (thinkingText && !thinkingEmitted) {
            thinkingEmitted = true;
            onChunk({
              type: "activity",
              activity: { kind: "thinking", summary: thinkingText.trim() },
            });
          }
          fullText += delta.content;
          onChunk({ type: "delta", text: delta.content });
        }
      }
    }

    // Emit accumulated thinking if not emitted yet (e.g. thinking-only response)
    if (thinkingText.trim() && !thinkingEmitted) {
      onChunk({
        type: "activity",
        activity: { kind: "thinking", summary: thinkingText.trim() },
      });
    }

    onChunk({ type: "done" });

    return {
      text: fullText,
      sessionId: responseId,
      costUsd: 0,
      durationMs: Date.now() - startedAt,
    };
  }

  private async fetchModelValues(): Promise<string[]> {
    const baseUrl = getLmStudioBaseUrl();
    const res = await fetch(`${baseUrl}/api/v1/models`);
    if (!res.ok) {
      throw new Error(`Falha ao consultar modelos no LM Studio: ${await res.text()}`);
    }

    const json = (await res.json()) as LmStudioModelsResponse;
    const fromNative = this.extractFromNativeModels(json.models || []);
    if (fromNative.length > 0) {
      return fromNative;
    }

    // OpenAI-like response fallback: { data: [...] }
    const fromCompat = (json.data || [])
      .map((item) => item.id || item.name || item.key || item.display_name || "")
      .filter((value): value is string => Boolean(value));
    if (fromCompat.length > 0) {
      return [...new Set(fromCompat)];
    }

    // Last-resort fallback for unexpected shapes.
    return this.extractFromUnknown(json);
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
      .filter((value): value is string => Boolean(value));

    return [...new Set(values)];
  }

  private extractFromUnknown(input: unknown): string[] {
    const queue: unknown[] = [input];
    const found = new Set<string>();

    while (queue.length > 0) {
      const node = queue.shift();
      if (!node || typeof node !== "object") continue;

      if (Array.isArray(node)) {
        for (const item of node) queue.push(item);
        continue;
      }

      const obj = node as Record<string, unknown>;
      const candidates = [
        obj.key,
        obj.id,
        obj.name,
        obj.selected_variant,
        obj.display_name,
      ];
      for (const candidate of candidates) {
        if (typeof candidate === "string" && candidate.trim()) {
          found.add(candidate.trim());
        }
      }

      for (const value of Object.values(obj)) {
        if (value && typeof value === "object") queue.push(value);
      }
    }

    return [...found];
  }
}
