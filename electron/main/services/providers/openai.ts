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

const CATALOG = PROVIDER_CATALOG.find((p) => p.id === "openai") as ProviderCatalogEntry;

function mapEffort(effort: string): string {
  switch (effort) {
    case "low":
      return "low";
    case "high":
      return "high";
    default:
      return "medium";
  }
}

export class OpenAiProvider implements ProviderRuntime {
  getCatalogEntry(): ProviderCatalogEntry {
    return CATALOG;
  }

  async getApiKeyStatus(): Promise<ApiKeyStatus> {
    return credentials.getApiKeyStatus("openai");
  }

  async setApiKey(apiKey: string): Promise<void> {
    credentials.saveApiKey("openai", apiKey);
  }

  async removeApiKey(): Promise<void> {
    credentials.removeApiKey("openai");
  }

  async testApiKey(apiKey?: string): Promise<string> {
    const key = apiKey?.trim() || credentials.loadApiKey("openai");
    const res = await fetch("https://api.openai.com/v1/models", {
      headers: { Authorization: `Bearer ${key}` },
    });
    if (!res.ok) {
      throw new Error(`Falha ao validar API key: ${await res.text()}`);
    }
    return "Conexao com OpenAI API OK";
  }

  async sendMessageStream(
    request: SendMessageRequest,
    onChunk: (chunk: StreamChunk) => void,
    signal?: AbortSignal
  ): Promise<SendMessageResult> {
    const apiKey = credentials.loadApiKey("openai");
    const startedAt = Date.now();

    const payload: Record<string, unknown> = {
      model: request.model,
      input: request.message,
      stream: true,
      store: true,
      reasoning: { effort: mapEffort(request.effort) },
      instructions:
        "Be concise. If implementation details are missing, ask direct clarifying questions before assuming.",
    };

    if (request.sessionId) {
      payload.previous_response_id = request.sessionId;
    }

    const res = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal,
    });

    if (!res.ok) {
      throw new Error(`OpenAI API erro: ${await res.text()}`);
    }

    let fullText = "";
    let responseId: string | null = null;

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

        let event: Record<string, unknown>;
        try {
          event = JSON.parse(data);
        } catch {
          continue; // skip malformed JSON
        }

        console.log("[openai-sse] type:", event.type);

        if (event.type === "response.created" && (event.response as Record<string, unknown>)?.id) {
          responseId = (event.response as Record<string, unknown>).id as string;
        }

        // Surface API errors — throw outside try/catch so they propagate
        if (event.type === "error") {
          const err = event.error as Record<string, unknown> | undefined;
          const errMsg = err?.message || event.message || JSON.stringify(event);
          throw new Error(`OpenAI API: ${errMsg}`);
        }

        if (event.type === "response.failed") {
          const resp = event.response as Record<string, unknown> | undefined;
          const details = resp?.status_details as Record<string, unknown> | undefined;
          const innerErr = details?.error as Record<string, unknown> | undefined;
          const errMsg = innerErr?.message || resp?.status || "unknown failure";
          throw new Error(`OpenAI API: ${errMsg}`);
        }

        // Handle text deltas from the Responses API
        if (event.type === "response.output_text.delta" && event.delta) {
          fullText += event.delta;
          onChunk({ type: "delta", text: event.delta as string });
        }

        // Fallback: extract text from response.completed
        if (event.type === "response.completed" && (event.response as Record<string, unknown>)?.output) {
          const output = (event.response as Record<string, unknown>).output as Record<string, unknown>[];
          const outputText = output
            .filter((item) => item.type === "message")
            .flatMap((item) => (item.content as Record<string, unknown>[]) ?? [])
            .filter((c) => c.type === "output_text" && c.text)
            .map((c) => c.text as string)
            .join("");
          if (outputText && !fullText) {
            fullText = outputText;
            onChunk({ type: "delta", text: outputText });
          }
        }
      }
    }

    onChunk({ type: "done" });

    return {
      text: fullText,
      sessionId: responseId,
      costUsd: 0,
      durationMs: Date.now() - startedAt,
    };
  }
}
