export interface Project {
  id: string;
  name: string;
  path: string;
  color: string;
  created_at: number;
  updated_at: number;
}

export interface Thread {
  id: string;
  project_id: string;
  title: string;
  model: string;
  reasoning: string;
  session_id: string | null;
  created_at: number;
  updated_at: number;
}

export interface Message {
  id: string;
  thread_id: string;
  role: "user" | "assistant";
  content: string;
  metadata: string | null;
  created_at: number;
}

// Claude Code CLI stream event types
export interface StreamEventText {
  type: "assistant";
  message: { type: "text"; text: string };
}

export interface StreamEventToolUse {
  type: "assistant";
  message: { type: "tool_use"; name: string; input: Record<string, unknown> };
}

export interface StreamEventResult {
  type: "result";
  session_id: string;
  cost_usd: number;
}

export type StreamEvent = StreamEventText | StreamEventToolUse | StreamEventResult;

// Interactive event types from Claude CLI stream
export interface ToolUseEvent {
  tool_use_id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResultEvent {
  tool_use_id: string;
  content: string;
}

export interface ToolActivity {
  tool_use_id: string;
  name: string;
  input: Record<string, unknown>;
  result?: string;
  status: "running" | "done" | "error";
}
