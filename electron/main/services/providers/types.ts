export type ApiProviderId =
  | "claude"
  | "openai"
  | "codex"
  | "claude-code"
  | "lm-studio";

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

export interface ProviderHistoryMessage {
  role: "user" | "assistant";
  content: string;
}

export type ApprovalMode = "suggest" | "auto-edit" | "full-auto";

export interface SendMessageRequest {
  model: string;
  effort: string;
  approvalMode: ApprovalMode;
  sessionId: string | null;
  message: string;
  history: ProviderHistoryMessage[];
  projectPath?: string;
}

export interface SendMessageResult {
  text: string;
  sessionId: string | null;
  costUsd: number;
  durationMs: number;
}

export interface StreamChunk {
  type: "delta" | "done" | "error" | "activity";
  text?: string;
  error?: string;
  activity?: {
    kind: "tool_call" | "tool_result" | "info" | "thinking";
    tool?: string;
    summary: string;
  };
}

export interface ProviderRuntime {
  /** Whether this provider handles tool use internally (CLI providers). */
  readonly supportsNativeTools: boolean;
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
