/**
 * OpenAI-Compatible Provider — Abstract base class
 *
 * Handles streaming SSE communication with any OpenAI-compatible API
 * (LM Studio, Ollama, etc.) including native tool calling support.
 *
 * Subclasses only need to implement:
 * - getBaseUrl()      → API endpoint
 * - getAuthHeaders()  → authentication headers
 * - fetchModelValues() → model listing
 */

import type {
  ProviderCatalogEntry,
  ProviderRuntime,
  SendMessageRequest,
  SendMessageResult,
  StreamChunk,
  ApiKeyStatus,
  ToolMode,
  OpenAIToolCall,
} from "./types.js";

// ---------------------------------------------------------------------------
// SSE delta types from the OpenAI-compatible API
// ---------------------------------------------------------------------------

interface ChatCompletionDelta {
  content?: string | null;
  reasoning_content?: string | null;
  role?: string;
  tool_calls?: DeltaToolCall[];
}

interface DeltaToolCall {
  index: number;
  id?: string;
  type?: string;
  function?: {
    name?: string;
    arguments?: string;
  };
}

// ---------------------------------------------------------------------------
// Tool call accumulator — builds complete tool calls from streaming chunks
// ---------------------------------------------------------------------------

interface ToolCallAccumulator {
  id: string;
  name: string;
  arguments: string;
}

// ---------------------------------------------------------------------------
// Abstract base class
// ---------------------------------------------------------------------------

export abstract class OpenAICompatibleProvider implements ProviderRuntime {
  readonly toolMode: ToolMode = "openai";

  protected abstract catalog: ProviderCatalogEntry;

  /** Base URL for the API (e.g., "http://localhost:1234") */
  abstract getBaseUrl(): string;

  /** Auth headers (e.g., { Authorization: "Bearer ..." }) */
  abstract getAuthHeaders(): Record<string, string>;

  /** Fetch available model IDs from the API */
  abstract fetchModelValues(): Promise<string[]>;

  getCatalogEntry(): ProviderCatalogEntry {
    return this.catalog;
  }

  // Default stubs — subclasses override as needed
  async getApiKeyStatus(): Promise<ApiKeyStatus> {
    return { configured: true, last4: null };
  }

  async setApiKey(_apiKey: string): Promise<void> {}
  async removeApiKey(): Promise<void> {}

  async testApiKey(_apiKey?: string): Promise<string> {
    const modelValues = await this.fetchModelValues();
    if (modelValues.length === 0) {
      return `Conexao OK, mas nenhum modelo disponivel.`;
    }
    return `Conexao OK (${modelValues.length} modelo(s) disponivel(is)).`;
  }

  // ---------------------------------------------------------------------------
  // Streaming — handles content, reasoning, and tool_calls
  // ---------------------------------------------------------------------------

  async sendMessageStream(
    request: SendMessageRequest,
    onChunk: (chunk: StreamChunk) => void,
    signal?: AbortSignal
  ): Promise<SendMessageResult> {
    const startedAt = Date.now();
    const baseUrl = this.getBaseUrl();

    // Build messages array preserving all roles (user, assistant, tool)
    const messages = this.buildMessages(request);

    // Build request body
    const body: Record<string, unknown> = {
      model: request.model,
      messages,
      stream: true,
    };

    // Include tool schemas if provided
    if (request.tools && request.tools.length > 0) {
      body.tools = request.tools;
    }

    // Diagnostic: log payload size — gpt-oss-20b on LM Studio default 4k ctx
    // emits "?" tokens when prompt exceeds context. Helps spot overflow fast.
    {
      const promptChars = messages.reduce(
        (n, m) => n + (typeof m.content === "string" ? m.content.length : JSON.stringify(m.content ?? "").length),
        0
      );
      const toolChars = body.tools ? JSON.stringify(body.tools).length : 0;
      console.log(
        `[provider] model=${request.model} messages=${messages.length} promptChars=${promptChars} toolChars=${toolChars} approxTokens=${Math.round((promptChars + toolChars) / 4)}`
      );
    }

    const res = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...this.getAuthHeaders(),
      },
      body: JSON.stringify(body),
      signal,
    });

    if (!res.ok) {
      throw new Error(`API erro: ${await res.text()}`);
    }

    let fullText = "";
    let thinkingText = "";
    let thinkingEmitted = false;
    let responseId: string | null = null;
    let harmonyBuffer = "";
    let harmonyMode = false;          // detected by first delta starting with "<|"
    let firstContentSeen = false;
    let bufferedContent = "";          // when in harmonyMode, buffer until end

    // gpt-oss / harmony-format models leak control tokens such as
    //   <|channel|>commentary <|message|>...<|end|>
    //   <|channel|>commentary functions.write_file?<|channel|>commentary: bash}
    // into delta.content. Strip the tokens AND the harmony role keywords that
    // often follow them. Buffering preserves tokens split across SSE chunks.
    const HARMONY_TOKEN_RE =
      /<\|[^>|]*\|>\s*(?:commentary|analysis|final|assistant|user|system|tool|developer)?\b[ \t:]*/gi;
    const HARMONY_BARE_TOKEN_RE = /<\|[^>|]*\|>/g;
    const HARMONY_PARTIAL_RE = /<\|[^>|]*$/;
    const sanitizeHarmony = (chunk: string): string => {
      let buf = harmonyBuffer + chunk;
      buf = buf.replace(HARMONY_TOKEN_RE, "");
      buf = buf.replace(HARMONY_BARE_TOKEN_RE, "");
      const partial = buf.match(HARMONY_PARTIAL_RE);
      if (partial) {
        harmonyBuffer = partial[0];
        return buf.slice(0, -partial[0].length);
      }
      harmonyBuffer = "";
      return buf;
    };

    /** Final pass on the accumulated text: drops any straggling tokens. */
    const stripHarmonyFinal = (s: string): string => {
      return s
        .replace(HARMONY_TOKEN_RE, "")
        .replace(HARMONY_BARE_TOKEN_RE, "")
        .replace(/\bfunctions\.[a-z_]+\??/gi, "")
        .replace(/\b(?:commentary|analysis|final)\b\s*[:]?/gi, "")
        .replace(/\bbash\}/g, "")
        .replace(/^[\s,;:.}]+/, "")
        .trim();
    };

    // Tool call accumulator
    const toolCallMap = new Map<number, ToolCallAccumulator>();

    const reader = res.body?.getReader();
    if (!reader) {
      throw new Error("Resposta de stream invalida.");
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

        // --- Reasoning/thinking content ---
        if (delta.reasoning_content) {
          thinkingText += delta.reasoning_content;
        }

        // --- Regular content ---
        if (delta.content) {
          // Emit accumulated thinking first
          if (thinkingText && !thinkingEmitted) {
            thinkingEmitted = true;
            onChunk({
              type: "activity",
              activity: { kind: "thinking", summary: thinkingText.trim() },
            });
          }

          // Detect harmony format on the first non-empty content chunk:
          // gpt-oss models begin with "<|channel|>...". When detected, we hold
          // everything until the stream ends and emit a single sanitized blob
          // (streaming the raw deltas would leak control tokens to the UI).
          if (!firstContentSeen) {
            firstContentSeen = true;
            if (delta.content.trimStart().startsWith("<|")) {
              harmonyMode = true;
            }
          }

          if (harmonyMode) {
            bufferedContent += delta.content;
          } else {
            const cleaned = sanitizeHarmony(delta.content);
            if (cleaned) {
              fullText += cleaned;
              onChunk({ type: "delta", text: cleaned });
            }
          }
        }

        // --- Tool calls (streamed incrementally) ---
        if (delta.tool_calls) {
          for (const tc of delta.tool_calls) {
            const existing = toolCallMap.get(tc.index);
            if (existing) {
              // Append arguments chunk
              if (tc.function?.arguments) {
                existing.arguments += tc.function.arguments;
              }
            } else {
              // First chunk for this tool call
              toolCallMap.set(tc.index, {
                id: tc.id ?? `call_${tc.index}`,
                name: tc.function?.name ?? "",
                arguments: tc.function?.arguments ?? "",
              });
            }
          }
        }
      }
    }

    // Emit accumulated thinking if not emitted yet
    if (thinkingText.trim() && !thinkingEmitted) {
      onChunk({
        type: "activity",
        activity: { kind: "thinking", summary: thinkingText.trim() },
      });
    }

    // If we were in harmony-mode, sanitize the whole buffer and emit once.
    if (harmonyMode && bufferedContent) {
      console.log(`[harmony] raw buffered (${bufferedContent.length} chars):`, bufferedContent.slice(0, 800));
      // Harmony spec:
      //   <|start|>assistant<|channel|>analysis<|message|>...<|end|>
      //   <|start|>assistant<|channel|>final<|message|>...<|return|>
      // Pick the LAST `final` block (most recent answer). If no final, take the
      // last analysis/commentary message; failing that, strip aggressively.
      let candidate: string | null = null;
      const finalMatches = [
        ...bufferedContent.matchAll(
          /<\|channel\|>\s*final\s*<\|message\|>([\s\S]*?)(?=<\|end\|>|<\|return\|>|<\|start\|>|<\|channel\|>|$)/gi
        ),
      ];
      if (finalMatches.length > 0) {
        candidate = finalMatches[finalMatches.length - 1][1];
      } else {
        const allMessages = [
          ...bufferedContent.matchAll(
            /<\|message\|>([\s\S]*?)(?=<\|end\|>|<\|return\|>|<\|channel\|>|<\|start\|>|$)/gi
          ),
        ];
        if (allMessages.length > 0) {
          candidate = allMessages[allMessages.length - 1][1];
        }
      }
      if (!candidate) candidate = bufferedContent;

      const cleaned = stripHarmonyFinal(candidate);
      if (cleaned) {
        fullText = cleaned;
        onChunk({ type: "delta", text: cleaned });
      } else {
        console.warn(`[harmony] empty after sanitization — buffer was: ${bufferedContent.slice(0, 200)}`);
        const fallback = "[modelo retornou resposta vazia ou malformada — tente de novo]";
        fullText = fallback;
        onChunk({ type: "delta", text: fallback });
      }
    } else {
      // Flush any remaining harmony buffer + run final-pass strip on fullText
      if (harmonyBuffer) {
        const flushed = harmonyBuffer.replace(HARMONY_TOKEN_RE, "");
        if (flushed) {
          fullText += flushed;
          onChunk({ type: "delta", text: flushed });
        }
        harmonyBuffer = "";
      }
      const cleanedFull = stripHarmonyFinal(fullText);
      if (cleanedFull !== fullText) {
        fullText = cleanedFull;
      }
    }

    // Convert accumulated tool calls to structured format
    const toolCalls: OpenAIToolCall[] = [];
    for (const [, acc] of toolCallMap) {
      if (acc.name) {
        toolCalls.push({
          id: acc.id,
          type: "function",
          function: { name: acc.name, arguments: acc.arguments },
        });
      }
    }

    // Fallback: some models (e.g. gpt-oss-20b on LM Studio) emit only
    // reasoning_content with empty delta.content and no tool calls. The user
    // ends up with a blank assistant bubble. Surface the thinking text as the
    // visible answer so the conversation isn't dead.
    if (!fullText && toolCalls.length === 0 && thinkingText.trim()) {
      const fallback = thinkingText.trim();
      fullText = fallback;
      onChunk({ type: "delta", text: fallback });
    } else if (!fullText && toolCalls.length === 0) {
      const fallback = "[modelo retornou resposta vazia — tente novamente ou troque de modelo]";
      fullText = fallback;
      onChunk({ type: "delta", text: fallback });
    }

    return {
      text: fullText,
      sessionId: responseId,
      costUsd: 0,
      durationMs: Date.now() - startedAt,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    };
  }

  // ---------------------------------------------------------------------------
  // Build messages array — preserves user, assistant (with tool_calls), and tool roles
  // ---------------------------------------------------------------------------

  private buildMessages(
    request: SendMessageRequest
  ): Array<Record<string, unknown>> {
    const messages: Array<Record<string, unknown>> = [];

    if (request.systemPrompt) {
      messages.push({ role: "system", content: request.systemPrompt });
    }

    for (const msg of request.history) {
      if (msg.role === "tool") {
        messages.push({
          role: "tool",
          content: msg.content,
          tool_call_id: msg.tool_call_id,
        });
      } else if (msg.role === "assistant" && msg.tool_calls && msg.tool_calls.length > 0) {
        messages.push({
          role: "assistant",
          content: msg.content || null,
          tool_calls: msg.tool_calls,
        });
      } else {
        messages.push({ role: msg.role, content: msg.content });
      }
    }

    // Only append user message if non-empty (on tool loop iterations 2+, it's empty
    // because the model continues naturally after role:"tool" results)
    if (request.message) {
      messages.push({ role: "user", content: request.message });
    }

    return messages;
  }
}
