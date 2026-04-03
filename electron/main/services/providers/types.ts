export type ApiProviderId = "claude" | "openai" | "codex";

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

export interface SendMessageRequest {
  model: string;
  effort: string;
  sessionId: string | null;
  message: string;
  history: ProviderHistoryMessage[];
}

export interface SendMessageResult {
  text: string;
  sessionId: string | null;
  costUsd: number;
  durationMs: number;
}

export interface StreamChunk {
  type: "delta" | "done" | "error";
  text?: string;
  error?: string;
}

export interface ProviderRuntime {
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
