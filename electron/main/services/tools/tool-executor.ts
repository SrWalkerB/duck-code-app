/**
 * Tool Executor — Main orchestration loop between LLM and tools
 *
 * Flow:
 * 1. Read key project files for context
 * 2. Generate file tree
 * 3. Build quality-focused system prompt
 * 4. Loop: call LLM → parse tool_calls → orchestrate execution → feed results back
 *
 * Inspired by OpenClaude's QueryEngine and OpenCode's session/llm.ts
 */

import type {
  ProviderRuntime,
  SendMessageRequest,
  SendMessageResult,
  StreamChunk,
} from "../providers/types.js";
import { buildSystemPrompt } from "./tool-definitions.js";
import { ToolCallParser, extractToolCallsFromText, stripToolCallBlocks } from "./tool-parser.js";
import { runTools } from "./tool-orchestration.js";
import type { ApprovalRequest } from "./tool-execution.js";
import type { ToolUseContext } from "./tool.js";
import * as logger from "./tool-logger.js";
import { readFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_TOOL_ITERATIONS = 20;

const KEY_FILES = [
  "package.json",
  "tsconfig.json",
  "pyproject.toml",
  "Cargo.toml",
  "go.mod",
  "requirements.txt",
  "composer.json",
  "Gemfile",
];

const MAX_KEY_FILE_CHARS = 4000;

const IGNORE_DIRS = new Set([
  "node_modules", ".git", ".next", "dist", "out", ".cache",
  "__pycache__", ".venv", "target", ".DS_Store", "build",
]);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ToolExecutorOptions {
  provider: ProviderRuntime;
  request: SendMessageRequest;
  threadId: string;
  runId: string;
  onChunk: (chunk: StreamChunk) => void;
  onApprovalNeeded: (req: ApprovalRequest) => Promise<boolean>;
  signal?: AbortSignal;
}

// Re-export for consumers
export type { ApprovalRequest } from "./tool-execution.js";

// ---------------------------------------------------------------------------
// Conversation accumulator — tracks full tool loop history
// ---------------------------------------------------------------------------

interface ToolTurn {
  assistantText: string;
  toolResults: string; // serialized tool results
}

function buildConversationHistory(
  baseHistory: { role: "user" | "assistant"; content: string }[],
  systemMessages: { role: "user" | "assistant"; content: string }[],
  turns: ToolTurn[],
): { role: "user" | "assistant"; content: string }[] {
  const history = [...systemMessages, ...baseHistory];

  for (const turn of turns) {
    if (turn.assistantText) {
      history.push({ role: "assistant", content: turn.assistantText });
    }
    if (turn.toolResults) {
      history.push({ role: "user", content: turn.toolResults });
    }
  }

  return history;
}

// ---------------------------------------------------------------------------
// Project context — auto-read key files
// ---------------------------------------------------------------------------

async function readKeyFiles(projectPath: string): Promise<Record<string, string>> {
  const contents: Record<string, string> = {};
  let totalChars = 0;

  for (const filename of KEY_FILES) {
    if (totalChars >= MAX_KEY_FILE_CHARS) break;

    try {
      const filePath = join(projectPath, filename);
      const content = await readFile(filePath, "utf-8");
      // Take first 50 lines to keep it concise
      const lines = content.split("\n").slice(0, 50);
      const truncated = lines.join("\n");

      if (totalChars + truncated.length <= MAX_KEY_FILE_CHARS) {
        contents[filename] = truncated;
        totalChars += truncated.length;
      }
    } catch {
      // File doesn't exist — skip
    }
  }

  return contents;
}

// ---------------------------------------------------------------------------
// File tree generation
// ---------------------------------------------------------------------------

async function generateFileTree(projectPath: string, maxDepth = 3): Promise<string> {
  const lines: string[] = [];

  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > maxDepth || lines.length > 200) return;
    try {
      const entries = await readdir(dir, { withFileTypes: true });
      const sorted = entries
        .filter((e) => !e.name.startsWith(".") && !IGNORE_DIRS.has(e.name))
        .sort((a, b) => {
          if (a.isDirectory() && !b.isDirectory()) return -1;
          if (!a.isDirectory() && b.isDirectory()) return 1;
          return a.name.localeCompare(b.name);
        });

      for (const entry of sorted) {
        const rel = relative(projectPath, join(dir, entry.name));
        const prefix = "  ".repeat(depth);
        if (entry.isDirectory()) {
          lines.push(`${prefix}${rel}/`);
          await walk(join(dir, entry.name), depth + 1);
        } else {
          lines.push(`${prefix}${rel}`);
        }
      }
    } catch {
      // Permission errors — skip
    }
  }

  await walk(projectPath, 0);
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export async function runWithTools(options: ToolExecutorOptions): Promise<SendMessageResult> {
  const { provider, request, threadId, runId, onChunk, onApprovalNeeded, signal } = options;
  const projectPath = request.projectPath;

  if (!projectPath) {
    // No project path — run without tools
    return provider.sendMessageStream(request, onChunk, signal);
  }

  // --- 1. Gather project context ---
  const [fileTree, keyFileContents] = await Promise.all([
    generateFileTree(projectPath),
    readKeyFiles(projectPath),
  ]);

  // --- 2. Build system prompt ---
  const systemPrompt = buildSystemPrompt({
    projectPath,
    fileTree,
    modelId: request.model,
    keyFileContents,
  });

  // System prompt injected as first messages in history
  const systemMessages: { role: "user" | "assistant"; content: string }[] = [
    { role: "user", content: systemPrompt },
    { role: "assistant", content: "Understood. I have access to file system tools and will use them when needed." },
  ];

  // --- 3. Tool loop ---
  const turns: ToolTurn[] = [];
  let iterations = 0;
  let lastResult: SendMessageResult | null = null;

  // Build the ToolUseContext
  const ctx: ToolUseContext = {
    projectPath,
    threadId,
    runId,
    approvalMode: request.approvalMode,
    signal,
    onActivity: (activity) => {
      onChunk({
        type: "activity",
        activity: { kind: activity.kind, tool: activity.tool, summary: activity.summary },
      });
    },
  };

  while (iterations < MAX_TOOL_ITERATIONS) {
    iterations++;

    // Check abort
    if (signal?.aborted) break;

    // Build message for this iteration
    const currentMessage = iterations === 1
      ? request.message
      : turns[turns.length - 1]?.toolResults ?? request.message;

    const history = buildConversationHistory(
      request.history,
      systemMessages,
      iterations === 1 ? [] : turns.slice(0, -1), // exclude the last turn (it becomes the message)
    );

    const augmentedRequest: SendMessageRequest = {
      ...request,
      history: iterations === 1
        ? [...systemMessages, ...request.history]
        : history,
      message: currentMessage,
    };

    // --- Stream LLM response ---
    const parser = new ToolCallParser();
    let responseText = "";

    const result = await provider.sendMessageStream(
      augmentedRequest,
      (chunk) => {
        if (chunk.type === "delta" && chunk.text) {
          responseText += chunk.text;

          // Parse for tool calls, emit non-tool text to UI
          const parsed = parser.feed(chunk.text);
          for (const p of parsed) {
            if (p.textToEmit) {
              onChunk({ type: "delta", text: p.textToEmit });
            }
          }
        } else if (chunk.type !== "done") {
          onChunk(chunk);
        }
      },
      signal,
    );

    // Flush remaining buffered text
    const remaining = parser.flush();
    if (remaining) {
      const clean = stripToolCallBlocks(remaining);
      if (clean) onChunk({ type: "delta", text: clean });
    }

    lastResult = result;

    // --- Extract tool calls ---
    // Re-parse full response for complete tool call extraction
    const fullParser = new ToolCallParser();
    const fullResults = fullParser.feed(responseText);
    const flushed = fullParser.flush();
    if (flushed) fullResults.push(...fullParser.feed(flushed));

    const pendingFromFull = fullParser.getPendingToolCall();
    let parsedToolCalls = fullResults
      .filter((r) => r.toolCall !== null)
      .map((r) => r.toolCall!);

    if (pendingFromFull) parsedToolCalls.push(pendingFromFull);

    // Regex fallback if streaming parser found nothing
    if (parsedToolCalls.length === 0) {
      parsedToolCalls = extractToolCallsFromText(responseText);
    }

    // --- No tool calls? We're done ---
    if (parsedToolCalls.length === 0) {
      break;
    }

    // --- Execute tool calls via orchestration layer ---
    const toolResults = await runTools(parsedToolCalls, ctx, onApprovalNeeded);

    // --- Build tool results message ---
    const resultsMessage = toolResults
      .map((tr) => `<tool_result>\n${JSON.stringify({ name: tr.toolCall.name, success: tr.result.success, output: tr.result.output })}\n</tool_result>`)
      .join("\n");

    const wasRejected = toolResults.some((tr) => !tr.result.success && tr.result.output === "Operation rejected by user.");

    const feedbackMessage = wasRejected
      ? `${resultsMessage}\nSome operations were rejected by the user. Please adjust accordingly.`
      : resultsMessage;

    // Store the turn
    const cleanText = stripToolCallBlocks(responseText);
    turns.push({
      assistantText: cleanText,
      toolResults: feedbackMessage,
    });

    await logger.logReRequest(threadId, runId, feedbackMessage);

    // --- Budget warning ---
    if (iterations >= MAX_TOOL_ITERATIONS - 2) {
      const warning = `\nNote: You have used ${iterations} of ${MAX_TOOL_ITERATIONS} available tool iterations. Please wrap up your work.`;
      turns[turns.length - 1].toolResults += warning;
    }
  }

  onChunk({ type: "done" });

  return {
    text: lastResult?.text ?? "",
    sessionId: lastResult?.sessionId ?? null,
    costUsd: lastResult?.costUsd ?? 0,
    durationMs: lastResult?.durationMs ?? 0,
  };
}
