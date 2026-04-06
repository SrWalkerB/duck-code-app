import type { ChildProcess } from "node:child_process";
import type { SendMessageRequest, StreamChunk } from "./types.js";
import { CliProviderBase, type StdoutParseResult } from "./cli-base.js";

export class ClaudeCodeCliProvider extends CliProviderBase {
  constructor() {
    super({
      id: "claude-code",
      command: "claude",
      installHint: "Instale com: npm install -g @anthropic-ai/claude-code",
    });
  }

  protected buildArgs(request: SendMessageRequest): string[] {
    const args = [
      "--print",
      "--output-format",
      "stream-json",
      "--model",
      request.model,
      "--verbose",
    ];

    if (request.sessionId) {
      args.push("--resume", request.sessionId);
    }

    switch (request.approvalMode) {
      case "full-auto":
        args.push("--dangerously-skip-permissions");
        break;
      case "auto-edit":
        args.push("--allowedTools", "Edit,Write,Read,Glob,Grep,LS,Bash");
        break;
      case "suggest":
        // Allow read-only tools so AI can explore the codebase.
        // Write/Edit tools are excluded — user must switch to auto-edit or full-auto for writes.
        args.push("--allowedTools", "Read,Glob,Grep,LS");
        break;
    }

    return args;
  }

  private summarizeToolInput(
    toolName: string,
    input: Record<string, unknown> | undefined
  ): string {
    if (!input) return `Usando ${toolName}...`;
    const t = toolName.toLowerCase();

    // File operations — show the path
    if (t === "read" || t === "write" || t === "edit" || t === "glob" || t === "grep") {
      const target =
        (input.file_path as string) ||
        (input.path as string) ||
        (input.pattern as string) ||
        "";
      if (target) {
        // Show just filename or last path segment for readability
        const short = target.split("/").slice(-2).join("/");
        return short;
      }
    }

    // Bash/shell commands
    if (t === "bash" || t === "shell" || t === "terminal" || t === "exec") {
      const cmd = (input.command as string) || (input.cmd as string) || "";
      return cmd.slice(0, 200) || `Executando comando...`;
    }

    // LS
    if (t === "ls" || t === "list") {
      const dir = (input.path as string) || (input.directory as string) || ".";
      return dir;
    }

    // Generic fallback — try to find a meaningful field
    const firstValue = Object.values(input).find(
      (v) => typeof v === "string" && v.length > 0
    ) as string | undefined;
    return firstValue ? firstValue.slice(0, 150) : `Usando ${toolName}...`;
  }

  protected handleStdout(
    proc: ChildProcess,
    onChunk: (chunk: StreamChunk) => void
  ): Promise<StdoutParseResult> {
    return new Promise((resolve) => {
      const preview = (value: string, limit = 220) =>
        value.length > limit ? `${value.slice(0, limit)}...` : value;
      let fullText = "";
      let sessionId: string | null = null;
      let runError: string | null = null;
      let lineBuffer = "";
      let eventCount = 0;
      let parseErrorCount = 0;

      proc.stdout!.on("data", (chunk: Buffer) => {
        lineBuffer += chunk.toString();
        const lines = lineBuffer.split("\n");
        lineBuffer = lines.pop() ?? "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;

          let event: Record<string, unknown>;
          try {
            event = JSON.parse(trimmed);
          } catch {
            parseErrorCount += 1;
            if (parseErrorCount <= 3) {
              console.warn(
                `[provider:claude-code] non-json stdout line ignored chars=${trimmed.length} preview="${preview(trimmed)}"`
              );
            }
            continue;
          }
          eventCount += 1;
          if (eventCount <= 5 || eventCount % 50 === 0) {
            console.log(
              `[provider:claude-code] stdout event=${String(event.type)} index=${eventCount}`
            );
          }

          // Content delta — stream text and tool_use activities to UI
          if (event.type === "assistant" || event.type === "content_block_delta") {
            const msg = event.message as Record<string, unknown> | undefined;
            if (msg?.content) {
              const blocks = msg.content as Array<Record<string, unknown>>;
              for (const block of blocks) {
                if (block.type === "text" && typeof block.text === "string") {
                  const newText = block.text.slice(fullText.length);
                  if (newText) {
                    fullText = block.text as string;
                    onChunk({ type: "delta", text: newText });
                  }
                }
                // Emit tool_use blocks as activity so UI shows what the AI is doing
                if (block.type === "tool_use") {
                  const toolName = (block.name as string) || "unknown";
                  const input = block.input as Record<string, unknown> | undefined;
                  const summary = this.summarizeToolInput(toolName, input);
                  onChunk({
                    type: "activity",
                    activity: {
                      kind: "tool_call",
                      tool: toolName,
                      summary,
                    },
                  });
                }
                // Emit tool_result blocks as activity
                if (block.type === "tool_result") {
                  const toolName = (block.tool_use_id as string) || "";
                  const content = typeof block.content === "string"
                    ? block.content
                    : JSON.stringify(block.content ?? "").slice(0, 200);
                  onChunk({
                    type: "activity",
                    activity: {
                      kind: "tool_result",
                      tool: toolName,
                      summary: content.slice(0, 300),
                    },
                  });
                }
              }
            }
          }

          // Content block start — captures individual tool_use blocks streamed incrementally
          if (event.type === "content_block_start") {
            const contentBlock = event.content_block as Record<string, unknown> | undefined;
            if (contentBlock?.type === "tool_use") {
              const toolName = (contentBlock.name as string) || "unknown";
              onChunk({
                type: "activity",
                activity: {
                  kind: "tool_call",
                  tool: toolName,
                  summary: `Usando ${toolName}...`,
                },
              });
            }
          }

          // Tool result events at top level
          if (event.type === "tool_result" || event.type === "tool_use") {
            const toolName = (event.name as string) || (event.tool as string) || "unknown";
            const input = event.input as Record<string, unknown> | undefined;
            const isResult = event.type === "tool_result";
            const summary = isResult
              ? typeof event.content === "string"
                ? event.content.slice(0, 300)
                : "Concluído"
              : this.summarizeToolInput(toolName, input);
            onChunk({
              type: "activity",
              activity: {
                kind: isResult ? "tool_result" : "tool_call",
                tool: toolName,
                summary,
              },
            });
          }

          // Result event — final text + session_id
          if (event.type === "result") {
            if (typeof event.session_id === "string") {
              sessionId = event.session_id;
            }
            if (typeof event.sessionId === "string") {
              sessionId = event.sessionId;
            }
            if (event.is_error === true && typeof event.result === "string") {
              runError = event.result;
              console.error(
                `[provider:claude-code] result marked is_error=true message="${preview(event.result)}"`
              );
            }
            if (typeof event.result === "string" && !fullText) {
              fullText = event.result;
              onChunk({ type: "delta", text: event.result });
            }
          }
        }
      });

      proc.stdout!.on("end", () => {
        // Process remaining buffer
        if (lineBuffer.trim()) {
          try {
            const event = JSON.parse(lineBuffer.trim()) as Record<string, unknown>;
            if (event.type === "result") {
              if (typeof event.session_id === "string") {
                sessionId = event.session_id;
              }
              if (typeof event.sessionId === "string") {
                sessionId = event.sessionId;
              }
              if (event.is_error === true && typeof event.result === "string") {
                runError = event.result;
                console.error(
                  `[provider:claude-code] trailing result is_error=true message="${preview(event.result)}"`
                );
              }
              if (typeof event.result === "string" && !fullText) {
                fullText = event.result;
                onChunk({ type: "delta", text: event.result });
              }
            }
          } catch {
            // If it's plain text, treat as content
            if (!fullText) {
              fullText = lineBuffer;
              onChunk({ type: "delta", text: lineBuffer });
              console.warn(
                `[provider:claude-code] trailing stdout treated as plain text chars=${lineBuffer.length} preview="${preview(lineBuffer)}"`
              );
            }
          }
        }
        console.log(
          `[provider:claude-code] stdout end events=${eventCount} parseErrors=${parseErrorCount} fullTextChars=${fullText.length} hasSession=${Boolean(sessionId)} hasRunError=${Boolean(runError)}`
        );
        resolve({ text: fullText, sessionId, error: runError ?? undefined });
      });
    });
  }
}
