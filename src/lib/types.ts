export interface Project {
  id: string;
  name: string;
  path: string;
  color: string;
  createdAt: string;
  updatedAt: string;
}

export interface Thread {
  id: string;
  projectId: string;
  title: string;
  provider: ProviderId;
  model: string;
  effort: string;
  sessionId: string | null;
  createdAt: string;
  updatedAt: string;
}

export type ProviderId = "claude" | "openai" | "codex";

export interface ProviderModel {
  label: string;
  value: string;
}

export interface ProviderCapabilities {
  supports_effort: boolean;
  requires_api_key: boolean;
}

export interface ProviderCatalogEntry {
  id: ProviderId;
  label: string;
  default_model: string;
  models: ProviderModel[];
  capabilities: ProviderCapabilities;
}

export interface Message {
  id: string;
  threadId: string;
  role: "user" | "assistant";
  content: string;
  metadata: string | null;
  createdAt: string;
}

export interface ChatStreamPayload {
  runId: string;
  text: string;
}

export interface ChatCompletePayload {
  runId: string;
  text: string;
  sessionId: string | null;
  costUsd: number;
  durationMs: number;
}

export interface ChatErrorPayload {
  runId: string;
  message: string;
}

export interface ChatDonePayload {
  runId: string;
}
