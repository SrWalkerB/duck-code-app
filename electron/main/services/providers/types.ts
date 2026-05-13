export type ApiProviderId = "lm-studio" | "ollama";

// ---------------------------------------------------------------------------
// Tool mode — determines how tool calling is handled for each provider.
// Currently all supported providers use OpenAI-compatible structured tools.
// ---------------------------------------------------------------------------

export type ToolMode = "openai";

// ---------------------------------------------------------------------------
// OpenAI-compatible tool calling types
// ---------------------------------------------------------------------------

export interface OpenAIToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface OpenAIFunctionTool {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

// ---------------------------------------------------------------------------
// Provider models & capabilities
// ---------------------------------------------------------------------------

export interface ProviderModel {
  label: string;
  value: string;
}

export interface ProviderCapabilities {
  supports_effort: boolean;
  requires_api_key: boolean;
}

export interface ProviderCatalogEntry {
  id: ApiProviderId;
  label: string;
  default_model: string;
  models: ProviderModel[];
  capabilities: ProviderCapabilities;
}

export interface ApiKeyStatus {
  configured: boolean;
  last4: string | null;
}

// ---------------------------------------------------------------------------
// Messages — supports user, assistant (with optional tool_calls), and tool
// ---------------------------------------------------------------------------

export type ProviderHistoryMessage =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; tool_calls?: OpenAIToolCall[] }
  | { role: "tool"; content: string; tool_call_id: string };

// ---------------------------------------------------------------------------
// Request / Result
// ---------------------------------------------------------------------------

export type ApprovalMode = "no-tools" | "suggest" | "auto-edit" | "full-auto";

export interface SendMessageRequest {
  model: string;
  effort: string;
  approvalMode: ApprovalMode;
  sessionId: string | null;
  message: string;
  history: ProviderHistoryMessage[];
  projectPath?: string;
  /** OpenAI function tool schemas — passed to providers with toolMode "openai" */
  tools?: OpenAIFunctionTool[];
  /** Optional system prompt prepended as the first message. */
  systemPrompt?: string;
}

export interface SendMessageResult {
  text: string;
  sessionId: string | null;
  costUsd: number;
  durationMs: number;
  /** Structured tool calls returned by OpenAI-compatible providers */
  toolCalls?: OpenAIToolCall[];
}

export interface StreamChunk {
  type: "delta" | "done" | "error" | "activity";
  text?: string;
  error?: string;
  activity?: {
    kind: "tool_call" | "tool_result" | "info" | "thinking" | "ask_user";
    tool?: string;
    summary: string;
    /** Structured payload for kinds that need richer rendering (ask_user). */
    data?: unknown;
  };
}

// ---------------------------------------------------------------------------
// Provider runtime interface
// ---------------------------------------------------------------------------

export interface ProviderRuntime {
  /** How this provider handles tool use: "xml" | "openai" | "native-cli" */
  readonly toolMode: ToolMode;
  getCatalogEntry(): ProviderCatalogEntry;
  getApiKeyStatus(): Promise<ApiKeyStatus>;
  setApiKey(apiKey: string): Promise<void>;
  removeApiKey(): Promise<void>;
  testApiKey(apiKey?: string): Promise<string>;
  sendMessageStream(
    request: SendMessageRequest,
    onChunk: (chunk: StreamChunk) => void,
    signal?: AbortSignal
  ): Promise<SendMessageResult>;
}
