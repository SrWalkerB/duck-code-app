export interface Project {
  id: string;
  name: string;
  path: string;
  color: string;
  createdAt: string;
  updatedAt: string;
}

export type ApprovalMode = "no-tools" | "suggest" | "auto-edit" | "full-auto";

export interface Thread {
  id: string;
  projectId: string;
  title: string;
  provider: ProviderId;
  model: string;
  effort: string;
  approvalMode: ApprovalMode;
  sessionId: string | null;
  lineAdditions?: number | null;
  lineDeletions?: number | null;
  createdAt: string;
  updatedAt: string;
}

export type ProviderId = "lm-studio" | "ollama";

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

export interface AskUserOption {
  label: string;
  description?: string;
}
export interface AskUserQuestion {
  question: string;
  header?: string;
  options: AskUserOption[];
  multiSelect?: boolean;
}
export interface AskUserPayload {
  questions: AskUserQuestion[];
}

export interface ChatActivityPayload {
  runId: string;
  activity: {
    kind: "tool_call" | "tool_result" | "info" | "ask_user";
    tool?: string;
    summary: string;
    data?: unknown;
  };
}

export interface ChatDonePayload {
  runId: string;
}

export interface ChatToolApprovalPayload {
  runId: string;
  tool: string;
  args: Record<string, unknown>;
  description: string;
}

