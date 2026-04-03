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
        args.push("--allowedTools", "Edit,Write,Read,Glob,Grep");
        break;
      // "suggest" — no extra tools, just text responses
    }

    return args;
  }

  protected handleStdout(
    proc: ChildProcess,
    onChunk: (chunk: StreamChunk) => void
  ): Promise<StdoutParseResult> {
    return new Promise((resolve) => {
      let fullText = "";
      let sessionId: string | null = null;
      let lineBuffer = "";

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
            continue;
          }

          // Content delta — stream text to UI
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
              }
            }
          }

          // Result event — final text + session_id
          if (event.type === "result") {
            if (typeof event.session_id === "string") {
              sessionId = event.session_id;
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
            }
          }
        }
        resolve({ text: fullText, sessionId });
      });
    });
  }
}
