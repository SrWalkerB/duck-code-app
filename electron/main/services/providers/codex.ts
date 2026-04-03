import { spawn } from "node:child_process";
import type {
  ProviderCatalogEntry,
  ProviderRuntime,
  SendMessageRequest,
  SendMessageResult,
  StreamChunk,
  ApiKeyStatus,
} from "./types.js";
import { PROVIDER_CATALOG } from "../../../../src/shared/provider-catalog.js";

const CATALOG = PROVIDER_CATALOG.find((p) => p.id === "codex") as ProviderCatalogEntry;

export class CodexCliProvider implements ProviderRuntime {
  getCatalogEntry(): ProviderCatalogEntry {
    return CATALOG;
  }

  async getApiKeyStatus(): Promise<ApiKeyStatus> {
    return { configured: true, last4: null };
  }

  async setApiKey(_apiKey: string): Promise<void> {
    // no-op — CLI manages its own auth
  }

  async removeApiKey(): Promise<void> {
    // no-op
  }

  async testApiKey(_apiKey?: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const proc = spawn("codex", ["--version"], {
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      proc.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString();
      });
      proc.on("error", (err) => {
        reject(
          new Error(
            `Codex CLI nao encontrado: ${err.message}. Instale com: npm install -g @openai/codex`
          )
        );
      });
      proc.on("close", (code) => {
        if (code === 0) resolve(`Codex CLI disponivel: ${stdout.trim()}`);
        else reject(new Error(`Codex CLI retornou codigo ${code}`));
      });
    });
  }

  async sendMessageStream(
    request: SendMessageRequest,
    onChunk: (chunk: StreamChunk) => void,
    signal?: AbortSignal
  ): Promise<SendMessageResult> {
    const startedAt = Date.now();

    const args = [
      "exec",
      "--json",
      "-m",
      request.model,
      "--dangerously-bypass-approvals-and-sandbox",
    ];

    return new Promise((resolve, reject) => {
      const proc = spawn("codex", args, {
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env },
      });

      if (signal) {
        if (signal.aborted) {
          proc.kill();
          reject(new Error("Aborted"));
          return;
        }
        signal.addEventListener("abort", () => proc.kill(), { once: true });
      }

      proc.stdin.write(request.message);
      proc.stdin.end();

      let fullText = "";
      let threadId: string | null = null;
      let stderrOutput = "";
      let lineBuffer = "";

      proc.stdout.on("data", (chunk: Buffer) => {
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

          console.log("[codex-cli] event:", event.type);

          if (event.type === "thread.started" && event.thread_id) {
            threadId = event.thread_id as string;
          }

          if (event.type === "item.completed") {
            const item = event.item as Record<string, unknown> | undefined;
            if (
              item?.type === "agent_message" &&
              typeof item.text === "string"
            ) {
              fullText += item.text;
              onChunk({ type: "delta", text: item.text });
            }
          }

          if (event.type === "message.delta") {
            const delta = event.delta as string | undefined;
            if (delta) {
              fullText += delta;
              onChunk({ type: "delta", text: delta });
            }
          }
        }
      });

      proc.stderr.on("data", (chunk: Buffer) => {
        stderrOutput += chunk.toString();
      });

      proc.on("error", (err) => {
        onChunk({ type: "error", error: err.message });
        reject(new Error(`Codex CLI erro: ${err.message}`));
      });

      proc.on("close", (code) => {
        // Process remaining buffer
        if (lineBuffer.trim()) {
          try {
            const event = JSON.parse(lineBuffer.trim()) as Record<
              string,
              unknown
            >;
            if (event.type === "item.completed") {
              const item = event.item as Record<string, unknown> | undefined;
              if (
                item?.type === "agent_message" &&
                typeof item.text === "string"
              ) {
                fullText += item.text;
                onChunk({ type: "delta", text: item.text });
              }
            }
          } catch {
            // ignore
          }
        }

        if (code !== 0 && code !== null) {
          const errMsg =
            stderrOutput.trim() || `Codex CLI saiu com codigo ${code}`;
          onChunk({ type: "error", error: errMsg });
          reject(new Error(errMsg));
          return;
        }

        onChunk({ type: "done" });
        resolve({
          text: fullText,
          sessionId: threadId,
          costUsd: 0,
          durationMs: Date.now() - startedAt,
        });
      });
    });
  }
}
