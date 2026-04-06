/**
 * Tool Execution Layer
 *
 * Handles individual tool call execution with the pipeline:
 * findToolByName → validateInput → checkPermissions → call → log
 *
 * Inspired by OpenClaude's toolExecution.ts
 */

import { findToolByName } from "./definitions/index.js";
import type { ToolUseContext, ToolResult } from "./tool.js";
import * as logger from "./tool-logger.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ParsedToolCall {
  name: string;
  args: Record<string, unknown>;
}

export interface ApprovalRequest {
  tool: string;
  args: Record<string, unknown>;
  description: string;
}

// ---------------------------------------------------------------------------
// Tool call description (for UI activity events)
// ---------------------------------------------------------------------------

function describeToolCall(name: string, args: Record<string, unknown>): string {
  switch (name) {
    case "write_file":
      return `Create file: ${args.path}`;
    case "edit_file":
      return `Edit file: ${args.path}`;
    case "read_file":
      return `Read file: ${args.path}`;
    case "delete_file":
      return `Delete file: ${args.path}`;
    case "list_files":
      return `List files: ${args.path || "."}`;
    case "grep":
      return `Search for "${args.pattern}" in ${args.path || "."}`;
    case "glob":
      return `Glob: ${args.pattern}`;
    case "rename_file":
      return `Rename: ${args.old_path} → ${args.new_path}`;
    case "create_directory":
      return `Create directory: ${args.path}`;
    case "bash":
      return `Run: ${args.description || args.command}`;
    default:
      return `${name}: ${JSON.stringify(args)}`;
  }
}

// ---------------------------------------------------------------------------
// Argument normalization — maps common alternative field names from local models
//
// Local models (LM Studio / Gemma, Llama, etc.) often use different parameter
// names than what's specified in the system prompt. This layer normalizes them
// before Zod validation so the tool call doesn't fail unnecessarily.
// ---------------------------------------------------------------------------

const ARG_ALIASES: Record<string, Record<string, string>> = {
  write_file: {
    body: "content",
    text: "content",
    file_content: "content",
    data: "content",
    file_path: "path",
    filename: "path",
    file_name: "path",
    filepath: "path",
  },
  edit_file: {
    file_path: "path",
    filename: "path",
    filepath: "path",
    old_text: "old_content",
    new_text: "new_content",
    original: "old_content",
    replacement: "new_content",
    search: "old_content",
    replace: "new_content",
  },
  read_file: {
    file_path: "path",
    filename: "path",
    filepath: "path",
  },
  delete_file: {
    file_path: "path",
    filename: "path",
    filepath: "path",
  },
  rename_file: {
    source: "old_path",
    destination: "new_path",
    from: "old_path",
    to: "new_path",
    src: "old_path",
    dest: "new_path",
  },
  grep: {
    query: "pattern",
    search: "pattern",
    regex: "pattern",
    directory: "path",
    dir: "path",
    glob: "include",
    filter: "include",
  },
  bash: {
    cmd: "command",
    shell: "command",
    run: "command",
    desc: "description",
  },
  glob: {
    directory: "path",
    dir: "path",
  },
  create_directory: {
    dir: "path",
    directory: "path",
    folder: "path",
  },
  list_files: {
    dir: "path",
    directory: "path",
  },
};

function normalizeArgs(
  toolName: string,
  args: Record<string, unknown>,
): Record<string, unknown> {
  const aliases = ARG_ALIASES[toolName];
  if (!aliases) return args;

  const normalized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    const canonical = aliases[key];
    if (canonical && !(canonical in args) && !(canonical in normalized)) {
      // Map aliased key to canonical name (only if canonical isn't already present)
      normalized[canonical] = value;
    } else {
      normalized[key] = value;
    }
  }
  return normalized;
}

// ---------------------------------------------------------------------------
// runToolUse — Execute a single tool call through the full pipeline
// ---------------------------------------------------------------------------

export async function runToolUse(
  toolCall: ParsedToolCall,
  ctx: ToolUseContext,
  onApprovalNeeded: (req: ApprovalRequest) => Promise<boolean>,
): Promise<ToolResult> {
  // 1. Find the tool in the registry
  const tool = findToolByName(toolCall.name);
  if (!tool) {
    const error = `Unknown tool: ${toolCall.name}. Available tools: ${
      // Lazy import to avoid circular deps
      (await import("./definitions/index.js")).TOOL_REGISTRY.map(t => t.name).join(", ")
    }`;
    return { success: false, output: error };
  }

  // 1.5. Normalize args (map common aliases from local models)
  const normalizedArgs = normalizeArgs(toolCall.name, toolCall.args);

  // 2. Validate input with Zod schema
  const parseResult = tool.inputSchema.safeParse(normalizedArgs);
  if (!parseResult.success) {
    const error = `Invalid input for ${tool.name}: ${parseResult.error.message}`;
    await logger.logToolResult(ctx.threadId, ctx.runId, tool.name, { success: false, output: error });
    ctx.onActivity({ kind: "tool_result", tool: tool.name, summary: `Validation error: ${error.slice(0, 100)}` });
    return { success: false, output: error };
  }
  const validatedInput = parseResult.data;

  // 3. Custom validation (e.g., mutual exclusivity of fields)
  const validation = tool.validateInput(validatedInput, ctx);
  if (!validation.valid) {
    await logger.logToolResult(ctx.threadId, ctx.runId, tool.name, { success: false, output: validation.error });
    ctx.onActivity({ kind: "tool_result", tool: tool.name, summary: `Validation error: ${validation.error.slice(0, 100)}` });
    return { success: false, output: validation.error };
  }

  // 4. Check permissions
  const permission = tool.checkPermissions(validatedInput, ctx);

  if (permission.behavior === "deny") {
    const output = `Permission denied: ${permission.reason}`;
    await logger.logToolResult(ctx.threadId, ctx.runId, tool.name, { success: false, output });
    ctx.onActivity({ kind: "tool_result", tool: tool.name, summary: "Permission denied" });
    return { success: false, output };
  }

  if (permission.behavior === "ask") {
    const description = describeToolCall(tool.name, toolCall.args);
    const approved = await onApprovalNeeded({
      tool: tool.name,
      args: toolCall.args,
      description,
    });

    if (!approved) {
      const output = "Operation rejected by user.";
      await logger.logToolResult(ctx.threadId, ctx.runId, tool.name, { success: false, output });
      ctx.onActivity({ kind: "tool_result", tool: tool.name, summary: "Rejected by user" });
      return { success: false, output };
    }
  }

  // 5. Log the tool call and emit activity
  const description = describeToolCall(tool.name, toolCall.args);
  await logger.logToolCall(ctx.threadId, ctx.runId, tool.name, toolCall.args);
  ctx.onActivity({ kind: "tool_call", tool: tool.name, summary: description });

  // 6. Execute the tool
  try {
    const result = await tool.call(validatedInput, ctx);
    await logger.logToolResult(ctx.threadId, ctx.runId, tool.name, result);

    ctx.onActivity({
      kind: "tool_result",
      tool: tool.name,
      summary: result.success ? description : `Failed: ${result.output.slice(0, 100)}`,
    });

    return result;
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    const result = { success: false, output: error };
    await logger.logToolResult(ctx.threadId, ctx.runId, tool.name, result);
    ctx.onActivity({ kind: "tool_result", tool: tool.name, summary: `Error: ${error.slice(0, 100)}` });
    return result;
  }
}
