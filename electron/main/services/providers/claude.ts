import * as credentials from "./credentials.js";
import type {
  ProviderCatalogEntry,
  ProviderRuntime,
  SendMessageRequest,
  SendMessageResult,
  StreamChunk,
  ApiKeyStatus,
} from "./types.js";
import { PROVIDER_CATALOG } from "../../../../src/shared/provider-catalog.js";

const CATALOG = PROVIDER_CATALOG.find((p) => p.id === "claude") as ProviderCatalogEntry;

export class ClaudeProvider implements ProviderRuntime {
  readonly supportsNativeTools = false;

  getCatalogEntry(): ProviderCatalogEntry {
    return CATALOG;
  }

  async getApiKeyStatus(): Promise<ApiKeyStatus> {
    return credentials.getApiKeyStatus("claude");
  }

  async setApiKey(apiKey: string): Promise<void> {
    credentials.saveApiKey("claude", apiKey);
  }

  async removeApiKey(): Promise<void> {
    credentials.removeApiKey("claude");
  }

  async testApiKey(apiKey?: string): Promise<string> {
    const key = apiKey?.trim() || credentials.loadApiKey("claude");
    const res = await fetch("https://api.anthropic.com/v1/models", {
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
    });
    if (!res.ok) {
      throw new Error(`Falha ao validar API key: ${await res.text()}`);
    }
    return "Conexao com Anthropic API OK";
  }

  async sendMessageStream(
    request: SendMessageRequest,
    onChunk: (chunk: StreamChunk) => void,
    signal?: AbortSignal
  ): Promise<SendMessageResult> {
    const apiKey = credentials.loadApiKey("claude");
    const startedAt = Date.now();

    const messages = request.history
      .filter((m) => m.content.trim().length > 0)
      .map((m) => ({ role: m.role, content: m.content }));

    // Add current message
    messages.push({ role: "user" as const, content: request.message });

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: request.model,
        max_tokens: 8192,
        stream: true,
        system:
          "Be concise. If implementation details are missing, ask direct clarifying questions before assuming.",
        messages,
      }),
      signal,
    });

    if (!res.ok) {
      throw new Error(`Anthropic API erro: ${await res.text()}`);
    }

    let fullText = "";
    let messageId: string | null = null;

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const data = line.slice(6).trim();
        if (data === "[DONE]") continue;

        try {
          const event = JSON.parse(data);

          if (event.type === "message_start" && event.message?.id) {
            messageId = event.message.id;
          }

          if (
            event.type === "content_block_delta" &&
            event.delta?.type === "text_delta" &&
            event.delta.text
          ) {
            fullText += event.delta.text;
            onChunk({ type: "delta", text: event.delta.text });
          }
        } catch {
          // skip malformed events
        }
      }
    }

    onChunk({ type: "done" });

    return {
      text: fullText,
      sessionId: messageId,
      costUsd: 0,
      durationMs: Date.now() - startedAt,
    };
  }
}
