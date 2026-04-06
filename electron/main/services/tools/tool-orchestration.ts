/**
 * Tool Orchestration Layer
 *
 * Partitions tool calls into concurrent (read-only) and serial (write) batches.
 * Read-only tools run in parallel via Promise.all() for performance.
 * Write tools run one-at-a-time to prevent conflicts.
 *
 * Inspired by OpenClaude's toolOrchestration.ts
 */

import { findToolByName } from "./definitions/index.js";
import { runToolUse, type ParsedToolCall, type ApprovalRequest } from "./tool-execution.js";
import type { ToolUseContext, ToolResult } from "./tool.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ToolCallWithResult {
  toolCall: ParsedToolCall;
  result: ToolResult;
}

// ---------------------------------------------------------------------------
// Partition tool calls by concurrency safety
// ---------------------------------------------------------------------------

function partitionToolCalls(toolCalls: ParsedToolCall[]): {
  concurrent: ParsedToolCall[];
  serial: ParsedToolCall[];
} {
  const concurrent: ParsedToolCall[] = [];
  const serial: ParsedToolCall[] = [];

  for (const tc of toolCalls) {
    const tool = findToolByName(tc.name);
    if (tool?.isConcurrencySafe) {
      concurrent.push(tc);
    } else {
      serial.push(tc);
    }
  }

  return { concurrent, serial };
}

// ---------------------------------------------------------------------------
// runTools — Execute a batch of tool calls with proper concurrency
// ---------------------------------------------------------------------------

export async function runTools(
  toolCalls: ParsedToolCall[],
  ctx: ToolUseContext,
  onApprovalNeeded: (req: ApprovalRequest) => Promise<boolean>,
): Promise<ToolCallWithResult[]> {
  if (toolCalls.length === 0) return [];

  const { concurrent, serial } = partitionToolCalls(toolCalls);
  const results: ToolCallWithResult[] = [];

  // 1. Execute concurrency-safe tools (read-only) in parallel
  if (concurrent.length > 0) {
    const concurrentResults = await Promise.all(
      concurrent.map(async (tc) => ({
        toolCall: tc,
        result: await runToolUse(tc, ctx, onApprovalNeeded),
      })),
    );
    results.push(...concurrentResults);
  }

  // 2. Execute serial tools (write/destructive) one by one
  for (const tc of serial) {
    // Check abort signal between serial operations
    if (ctx.signal?.aborted) {
      results.push({
        toolCall: tc,
        result: { success: false, output: "Operation cancelled." },
      });
      continue;
    }

    const result = await runToolUse(tc, ctx, onApprovalNeeded);
    results.push({ toolCall: tc, result });
  }

  return results;
}
