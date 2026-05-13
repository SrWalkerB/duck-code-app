/**
 * Tool Executor — OpenAI-native tool calling loop
 *
 * Uses structured `tools` parameter and `delta.tool_calls` from the
 * OpenAI-compatible API. The provider streams content+tool_calls, this layer
 * orchestrates the model↔tool round-trips until the model produces a final
 * text answer or exhausts the iteration budget.
 */

import type {
  ProviderRuntime,
  SendMessageRequest,
  SendMessageResult,
  StreamChunk,
  ProviderHistoryMessage,
} from "../providers/types.js";
import { buildSystemPrompt } from "./tool-definitions.js";
import { buildOpenAIToolSchemas } from "./zod-to-openai-tools.js";
import { runTools } from "./tool-orchestration.js";
import type { ParsedToolCall, ApprovalRequest } from "./tool-execution.js";
import type { ToolUseContext } from "./tool.js";
import * as logger from "./tool-logger.js";
import { MAX_TOOL_ITERATIONS, readKeyFiles, generateFileTree } from "./tool-context.js";
import { clearFileState } from "./file-state.js";
import { clearTodos } from "./definitions/todo-write.js";
import { clearReadDedup } from "./definitions/read-file.js";

export interface ToolExecutorOptions {
  provider: ProviderRuntime;
  request: SendMessageRequest;
  threadId: string;
  runId: string;
  onChunk: (chunk: StreamChunk) => void;
  onApprovalNeeded: (req: ApprovalRequest) => Promise<boolean>;
  signal?: AbortSignal;
}

// ---------------------------------------------------------------------------
// Lightweight language detection for per-turn reinforcement.
// ---------------------------------------------------------------------------

export function detectLanguage(text: string): "pt" | "en" | "es" | "unknown" {
  if (!text) return "unknown";
  const lower = text.toLowerCase();
  // Portuguese markers (diacritics + common short words)
  if (/[ãõáâéêíóôúç]/.test(lower)) return "pt";
  if (/\b(você|gostaria|jogo|melhorar|fazer|quero|preciso|favor|criar|mudar|arquivo|projeto|estilo|deixe|coloque|por que)\b/.test(lower)) return "pt";
  if (/\b(tienes|gracias|por favor|cómo|qué|hola|necesito|quiero)\b/.test(lower)) return "es";
  if (/\b(the|please|would|could|create|change|file|project|style|make)\b/.test(lower)) return "en";
  return "unknown";
}

const LANGUAGE_NAME: Record<"pt" | "en" | "es", string> = {
  pt: "Portuguese (pt-BR)",
  en: "English",
  es: "Spanish",
};

// ---------------------------------------------------------------------------
// Per-thread approval memory — survives across turns within one conversation.
// ---------------------------------------------------------------------------
const threadApprovals = new Map<string, Set<string>>();

function getThreadApprovals(threadId: string): Set<string> {
  let set = threadApprovals.get(threadId);
  if (!set) {
    set = new Set<string>();
    threadApprovals.set(threadId, set);
  }
  return set;
}

/** Clear approvals for a thread (call when thread is deleted or reset). */
export function clearThreadApprovals(threadId: string): void {
  threadApprovals.delete(threadId);
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export async function runWithOpenAITools(options: ToolExecutorOptions): Promise<SendMessageResult> {
  const { provider, request, threadId, runId, onChunk, onApprovalNeeded, signal } = options;
  const projectPath = request.projectPath;

  if (!projectPath) {
    return provider.sendMessageStream(request, onChunk, signal);
  }

  // Clear per-run state from any previous run
  clearFileState();
  clearTodos();
  clearReadDedup();

  // --- 1. Gather project context ---
  const [fileTree, keyFileContents] = await Promise.all([
    generateFileTree(projectPath),
    readKeyFiles(projectPath),
  ]);

  // --- 2. Build system prompt (without Tool Format / Tool Reference sections) ---
  const systemPrompt = buildSystemPrompt({
    projectPath,
    fileTree,
    modelId: request.model,
    keyFileContents,
    mode: "openai",
  });

  // --- 3. Build OpenAI tool schemas from the registry ---
  const tools = buildOpenAIToolSchemas();

  // --- 4. Build initial history with system prompt ---
  const systemMessages: ProviderHistoryMessage[] = [
    { role: "user", content: systemPrompt },
    { role: "assistant", content: "Understood. I have access to file system tools and will use them when needed." },
  ];

  // Conversation history grows with each tool iteration
  const loopHistory: ProviderHistoryMessage[] = [
    ...systemMessages,
    ...request.history,
  ];

  // --- 5. Tool loop ---
  let iterations = 0;
  let lastResult: SendMessageResult | null = null;

  console.log(`[openai-tools] approvalMode="${request.approvalMode}" threadId=${threadId}`);

  // Approval persists per thread, scoped by (tool, path). Approving edit_file
  // on src/foo.ts does NOT auto-approve edit_file on src/bar.ts. Tools without
  // a path argument (bash, glob, grep, list_files, ask_user, todo_write,
  // create_directory) fall back to "*" — approval covers all calls of that
  // tool in the thread, matching the previous coarse behaviour for them.
  const approvedTools = getThreadApprovals(threadId);
  const approvalKey = (req: ApprovalRequest): string => {
    const path =
      (typeof req.args?.path === "string" && req.args.path) ||
      (typeof req.args?.file_path === "string" && (req.args.file_path as string)) ||
      "*";
    return `${req.tool}::${path}`;
  };
  const smartApproval = async (req: ApprovalRequest): Promise<boolean> => {
    const key = approvalKey(req);
    if (approvedTools.has(key)) return true;
    const approved = await onApprovalNeeded(req);
    if (approved) approvedTools.add(key);
    return approved;
  };

  // Loop detection: track signature of recent tool calls; if same signature
  // appears 3+ times in a row, force a stop message back to the model.
  const recentSignatures: string[] = [];
  const LOOP_THRESHOLD = 3;
  const signatureOf = (call: ParsedToolCall): string =>
    `${call.name}::${JSON.stringify(call.args ?? {})}`;

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

  // Detect language from the latest user message (request.message + history tail)
  // and inject a per-turn reminder so small models don't drift to English.
  const lastUserText = (() => {
    if (request.message) return request.message;
    for (let i = request.history.length - 1; i >= 0; i--) {
      const m = request.history[i];
      if (m.role === "user" && typeof m.content === "string") return m.content;
    }
    return "";
  })();
  const detectedLang = detectLanguage(lastUserText);
  if (detectedLang !== "unknown") {
    loopHistory.push({
      role: "user",
      content: `[system reminder] The user is writing in ${LANGUAGE_NAME[detectedLang]}. Your reply text and any ask_user labels MUST be in ${LANGUAGE_NAME[detectedLang]}. Do NOT switch language.`,
    });
    loopHistory.push({
      role: "assistant",
      content: detectedLang === "pt" ? "Entendido. Vou responder em português." : detectedLang === "es" ? "Entendido. Responderé en español." : "Understood. I will reply in English.",
    });
  }

  while (iterations < MAX_TOOL_ITERATIONS) {
    iterations++;

    if (signal?.aborted) break;

    // Build the request for this iteration
    // On iteration 1, the user's original message is sent
    // On iteration 2+, after role:"tool" results the model continues naturally
    // without needing an explicit user prompt
    const currentMessage = iterations === 1
      ? request.message
      : "";

    const augmentedRequest: SendMessageRequest = {
      ...request,
      history: loopHistory,
      message: currentMessage,
      tools,
    };

    // --- Stream LLM response ---
    let result: SendMessageResult;
    try {
      result = await provider.sendMessageStream(
        augmentedRequest,
        (chunk: StreamChunk) => {
          // Pass through all chunks to the UI (content is already clean, no XML parsing needed)
          if (chunk.type !== "done") {
            onChunk(chunk);
          }
        },
        signal,
      );
    } catch (err) {
      throw err;
    }

    lastResult = result;

    // --- Check for tool calls ---
    if (!result.toolCalls || result.toolCalls.length === 0) {
      break; // No tools requested — we're done
    }

    // --- Convert OpenAI tool calls to ParsedToolCall format ---
    // If JSON.parse fails we synthesize a ToolResult with a structured error so
    // the model sees concrete feedback on the next turn (instead of a silent no-op).
    const parsedToolCalls: ParsedToolCall[] = [];
    const parseFailures: Record<number, string> = {};
    for (let i = 0; i < result.toolCalls.length; i++) {
      const tc = result.toolCalls[i];
      const rawArgs = tc.function.arguments ?? "";
      try {
        const args = JSON.parse(rawArgs) as Record<string, unknown>;
        parsedToolCalls.push({ name: tc.function.name, args });
      } catch (err) {
        const preview = rawArgs.length > 200 ? `${rawArgs.slice(0, 200)}...` : rawArgs;
        parseFailures[i] = `Tool arguments were not valid JSON. Parser said: ${
          err instanceof Error ? err.message : String(err)
        }. Received: ${preview || "(empty string)"}. Send a single JSON object matching the tool schema and retry.`;
        // Push a placeholder so indexing stays aligned with result.toolCalls
        parsedToolCalls.push({ name: tc.function.name, args: { __parseError: true } });
      }
    }

    // --- Execute valid calls; bypass execution for parse-failures ---
    const toolResults: Awaited<ReturnType<typeof runTools>> = [];
    for (let i = 0; i < parsedToolCalls.length; i++) {
      if (parseFailures[i]) {
        toolResults.push({
          toolCall: parsedToolCalls[i],
          result: { success: false, output: parseFailures[i] },
        });
        ctx.onActivity({
          kind: "tool_result",
          tool: parsedToolCalls[i].name,
          summary: `Parse error: ${parseFailures[i].slice(0, 120)}`,
        });
      } else {
        const [execResult] = await runTools([parsedToolCalls[i]], ctx, smartApproval);
        toolResults.push(execResult);
      }
    }

    // --- Persist the user's original message only on iteration 1 ---
    // Iter 2+ should continue naturally after role:"tool" results. Pushing an
    // empty user message corrupts the message stream and the model loses track
    // of the original request (observed symptom: "no changes performed").
    if (iterations === 1 && currentMessage) {
      loopHistory.push({ role: "user", content: currentMessage });
    }

    // --- Append assistant message (with tool_calls) to history ---
    loopHistory.push({
      role: "assistant",
      content: result.text || "",
      tool_calls: result.toolCalls,
    });

    // --- Append tool results to history (one per tool call) ---
    for (let i = 0; i < toolResults.length; i++) {
      const tr = toolResults[i];
      const toolCallId = result.toolCalls[i]?.id ?? `call_${i}`;
      // Send tool output as plain string — the OpenAI format expects simple content,
      // not a JSON wrapper. This saves tokens and avoids model confusion.
      const resultContent = tr.result.success
        ? tr.result.output
        : `Error: ${tr.result.output}`;

      loopHistory.push({
        role: "tool",
        content: resultContent,
        tool_call_id: toolCallId,
      });
    }

    await logger.logReRequest(threadId, runId, `[OpenAI tools] ${toolResults.length} tool(s) executed`);

    // --- Loop detection: same tool+args called repeatedly ---
    // For read_file specifically, threshold is 2 (it should never be called
    // twice on the same path in one turn). Other tools use LOOP_THRESHOLD.
    for (const tc of parsedToolCalls) {
      recentSignatures.push(signatureOf(tc));
    }
    const windowSize = LOOP_THRESHOLD * 2;
    if (recentSignatures.length > windowSize) {
      recentSignatures.splice(0, recentSignatures.length - windowSize);
    }
    const tail = recentSignatures.slice(-LOOP_THRESHOLD);
    const isLooping =
      tail.length === LOOP_THRESHOLD && tail.every((s) => s === tail[0]);
    // Aggressive detection for read_file: 2 identical consecutive calls = loop
    const last2 = recentSignatures.slice(-2);
    const isReadLoop =
      last2.length === 2 &&
      last2[0] === last2[1] &&
      last2[0].startsWith("read_file::");
    if (isLooping || isReadLoop) {
      const [loopName] = tail[0].split("::");
      console.warn(`[openai-tools] Loop detected on ${loopName} — forcing stop.`);
      loopHistory.push({
        role: "tool",
        content:
          `STOP: You have called ${loopName} with the same arguments ${LOOP_THRESHOLD} times in a row. ` +
          `The result will not change. STOP calling tools. Answer the user directly with what you know from the previous tool results, ` +
          `or ask for clarification. Do NOT call any more tools in your next reply.`,
        tool_call_id: `loop_guard_${iterations}`,
      });
      // One more model turn to produce a text answer, then break
      const finalRequest: SendMessageRequest = {
        ...request,
        history: loopHistory,
        message: "",
        // Force text-only reply
        tools: [],
      };
      try {
        const finalResult = await provider.sendMessageStream(
          finalRequest,
          (chunk) => {
            if (chunk.type !== "done") onChunk(chunk);
          },
          signal,
        );
        lastResult = finalResult;
      } catch (err) {
        console.warn(`[openai-tools] final answer after loop failed:`, err);
      }
      break;
    }

    // --- Budget warning ---
    if (iterations >= MAX_TOOL_ITERATIONS - 2) {
      loopHistory.push({
        role: "user",
        content: `Note: You have used ${iterations} of ${MAX_TOOL_ITERATIONS} available tool iterations. Please wrap up your work.`,
      });
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
