/**
 * Tool System — Core Types & Factory
 *
 * Inspired by OpenClaude's Tool.ts and OpenCode's tool/tool.ts.
 * Every tool implements ToolDef; buildTool() provides safe defaults (fail-closed).
 */
import { z } from "zod";

// Re-export ApprovalMode from providers
export type ApprovalMode = "no-tools" | "suggest" | "auto-edit" | "full-auto";

// ---------------------------------------------------------------------------
// Activity events emitted to the UI
// ---------------------------------------------------------------------------
export interface ActivityChunk {
  kind: "tool_call" | "tool_result" | "info" | "ask_user";
  tool?: string;
  summary: string;
  /** Structured payload (e.g., ask_user questions) for richer UI rendering. */
  data?: unknown;
}

// ---------------------------------------------------------------------------
// Context passed to every tool execution
// ---------------------------------------------------------------------------
export interface ToolUseContext {
  /** Absolute path to the project root directory */
  projectPath: string;
  /** Current thread ID */
  threadId: string;
  /** Current run ID within the thread */
  runId: string;
  /** User-selected permission level */
  approvalMode: ApprovalMode;
  /** Abort signal for cancellation */
  signal?: AbortSignal;
  /** Emit activity events to the renderer UI */
  onActivity: (activity: ActivityChunk) => void;
}

// ---------------------------------------------------------------------------
// Standardized tool result
// ---------------------------------------------------------------------------
export interface ToolResult {
  success: boolean;
  output: string;
  /** Optional metadata (e.g., lines read, bytes written, match count) */
  metadata?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Permission decisions
// ---------------------------------------------------------------------------
export type PermissionDecision =
  | { behavior: "allow" }
  | { behavior: "ask"; description: string }
  | { behavior: "deny"; reason: string };

// ---------------------------------------------------------------------------
// Validation result
// ---------------------------------------------------------------------------
export type ValidationResult =
  | { valid: true }
  | { valid: false; error: string };

// ---------------------------------------------------------------------------
// Tool interface — the contract every tool implements
// ---------------------------------------------------------------------------
export interface ToolDef<TInput = unknown> {
  /** Unique tool identifier (e.g., "read_file", "write_file") */
  name: string;

  /** Description passed to the LLM in the system prompt */
  description: string;

  /** Zod schema for runtime input validation */
  inputSchema: z.ZodType<TInput>;

  /** Whether this tool only reads (doesn't modify filesystem) */
  isReadOnly: boolean;

  /** Whether this tool can safely run in parallel with others */
  isConcurrencySafe: boolean;

  /** Check if user approval is needed based on input and context */
  checkPermissions(input: TInput, ctx: ToolUseContext): PermissionDecision;

  /** Custom input validation beyond schema (e.g., mutual exclusivity of fields) */
  validateInput(input: TInput, ctx: ToolUseContext): ValidationResult;

  /** Execute the tool */
  call(input: TInput, ctx: ToolUseContext): Promise<ToolResult>;
}

// ---------------------------------------------------------------------------
// buildTool() — Factory with fail-closed defaults
//
// Pattern from OpenClaude: if you don't specify a field, the default is the
// safest option (assume writes, assume not concurrency-safe, ask for approval).
// ---------------------------------------------------------------------------

type BuildToolInput<TInput> = Partial<ToolDef<TInput>> &
  Pick<ToolDef<TInput>, "name" | "description" | "inputSchema" | "call">;

export function buildTool<TInput>(partial: BuildToolInput<TInput>): ToolDef<TInput> {
  const isReadOnly = partial.isReadOnly ?? false;

  return {
    // Defaults: assume the tool writes and is NOT safe for parallelism
    isReadOnly,
    isConcurrencySafe: partial.isConcurrencySafe ?? false,

    // Default permission: read-only → auto-allow, write → depends on approvalMode
    checkPermissions: (_input: TInput, ctx: ToolUseContext): PermissionDecision => {
      if (isReadOnly) return { behavior: "allow" };
      if (ctx.approvalMode === "full-auto") return { behavior: "allow" };
      if (ctx.approvalMode === "auto-edit") return { behavior: "allow" };
      // suggest mode → ask for approval
      return { behavior: "ask", description: `Execute ${partial.name}` };
    },

    // Default validation: use Zod schema
    validateInput: (input: TInput): ValidationResult => {
      const result = partial.inputSchema.safeParse(input);
      if (result.success) return { valid: true };
      return { valid: false, error: result.error.message };
    },

    // Spread user-provided overrides last (they win over defaults)
    ...partial,
  };
}

// ---------------------------------------------------------------------------
// Path safety — shared by all file-operating tools
// ---------------------------------------------------------------------------
import { resolve } from "node:path";

export function resolveSafe(projectPath: string, relativePath: string): string {
  const resolved = resolve(projectPath, relativePath);
  // Ensure the resolved path is within the project directory
  if (!resolved.startsWith(projectPath)) {
    throw new Error(`Path traversal blocked: ${relativePath}`);
  }
  return resolved;
}
