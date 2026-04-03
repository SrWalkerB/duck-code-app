import type { ChildProcess } from "node:child_process";
import type { SendMessageRequest, StreamChunk } from "./types.js";
import { CliProviderBase, type StdoutParseResult } from "./cli-base.js";

export class CodexCliProvider extends CliProviderBase {
  constructor() {
    super({
      id: "codex",
      command: "codex",
      installHint: "Instale com: npm install -g @openai/codex",
    });
  }

  protected buildArgs(request: SendMessageRequest): string[] {
    const args = ["exec", "--json", "-m", request.model];

    switch (request.approvalMode) {
      case "full-auto":
        args.push("--full-auto");
        break;
      case "auto-edit":
        args.push("--auto-edit");
        break;
      // "suggest" is the default — no extra flag
    }

    return args;
  }

  protected buildStdinInput(request: SendMessageRequest): string {
    if (!request.history.length) return request.message;

    const historyText = request.history
      .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
      .join("\n\n");

    return `${historyText}\n\nUser: ${request.message}`;
  }

  protected handleStdout(
    proc: ChildProcess,
    onChunk: (chunk: StreamChunk) => void
  ): Promise<StdoutParseResult> {
    return new Promise((resolve) => {
      let fullText = "";
      let threadId: string | null = null;
      let lineBuffer = "";

      proc.stdout!.on("data", (chunk: Buffer) => {
        lineBuffer += chunk.toString();
        const lines = lineBuffer.split("\n");
        lineBuffer = lines.pop() ?? "";

        for (const line of lines) {
          this.processLine(line, onChunk, (text) => {
            fullText += text;
          }, (id) => {
            threadId = id;
          });
        }
      });

      proc.stdout!.on("end", () => {
        if (lineBuffer.trim()) {
          this.processLine(lineBuffer, onChunk, (text) => {
            fullText += text;
          }, (id) => {
            threadId = id;
          });
        }
        resolve({ text: fullText, sessionId: threadId });
      });
    });
  }

  private processLine(
    line: string,
    onChunk: (chunk: StreamChunk) => void,
    appendText: (text: string) => void,
    setThreadId: (id: string) => void
  ): void {
    const trimmed = line.trim();
    if (!trimmed) return;

    let event: Record<string, unknown>;
    try {
      event = JSON.parse(trimmed);
    } catch {
      return;
    }

    const eventType = event.type as string;
    // Log everything for debugging
    if (eventType === "item.completed") {
      const item = event.item as Record<string, unknown> | undefined;
      console.log("[codex-cli] item.completed:", JSON.stringify(item, null, 0)?.slice(0, 500));
    } else {
      console.log("[codex-cli] event:", eventType);
    }

    if (eventType === "thread.started" && event.thread_id) {
      setThreadId(event.thread_id as string);
    }

    // Text deltas (streaming)
    if (eventType === "message.delta") {
      const delta = event.delta as string | undefined;
      if (delta) {
        appendText(delta);
        onChunk({ type: "delta", text: delta });
      }
    }

    // item.completed — the main event type
    if (eventType === "item.completed") {
      const item = event.item as Record<string, unknown> | undefined;
      if (!item) return;
      const itemType = item.type as string;

      // Agent text message
      if (itemType === "agent_message" && typeof item.text === "string") {
        appendText(item.text);
        onChunk({ type: "delta", text: item.text });
        return;
      }

      // Everything else is an activity — extract useful info
      const summary = this.extractActivitySummary(item);
      const toolName = (item.name || item.tool || itemType || "action") as string;
      const kind = (itemType.includes("result") || itemType.includes("output"))
        ? "tool_result"
        : "tool_call";

      onChunk({
        type: "activity",
        activity: { kind, tool: toolName, summary },
      });
    }

    // Other event types that indicate work
    if (eventType === "turn.started") {
      onChunk({
        type: "activity",
        activity: { kind: "info", summary: "Iniciando turno..." },
      });
    }
  }

  private extractActivitySummary(item: Record<string, unknown>): string {
    // Try every possible field to find something meaningful
    // Codex CLI uses various structures depending on the tool

    // Direct command field
    if (typeof item.command === "string") return item.command as string;

    // Arguments (string or object)
    const args = item.arguments || item.input || item.params;
    if (typeof args === "string") {
      try {
        const parsed = JSON.parse(args) as Record<string, unknown>;
        const formatted = this.formatArgs(parsed);
        if (formatted) return formatted;
      } catch {
        if (args.length > 0 && args.length < 120) return args;
      }
    }
    if (args && typeof args === "object" && !Array.isArray(args)) {
      const formatted = this.formatArgs(args as Record<string, unknown>);
      if (formatted) return formatted;
    }

    // Output/result preview
    const output = item.output ?? item.text ?? item.content ?? item.result;
    if (typeof output === "string" && output.length > 0) {
      return output.length > 120 ? `${output.slice(0, 120)}...` : output;
    }
    if (Array.isArray(output)) {
      const firstText = output.find((o: unknown) => typeof o === "object" && o !== null && "text" in (o as Record<string, unknown>));
      if (firstText && typeof (firstText as Record<string, unknown>).text === "string") {
        const t = (firstText as Record<string, unknown>).text as string;
        return t.length > 120 ? `${t.slice(0, 120)}...` : t;
      }
    }

    const name = (item.name || item.tool || item.type || "") as string;
    return name;
  }

  private formatArgs(args: Record<string, unknown>): string | null {
    // Try common field names in priority order
    for (const key of ["command", "cmd", "path", "file_path", "filename", "pattern", "query", "url", "content"]) {
      const val = args[key];
      if (typeof val === "string" && val.length > 0) {
        return val.length > 120 ? `${val.slice(0, 120)}...` : val;
      }
    }
    // Fallback: first string value
    for (const val of Object.values(args)) {
      if (typeof val === "string" && val.length > 0 && val.length < 120) return val;
    }
    return null;
  }
}
