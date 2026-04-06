import { spawn, type ChildProcess } from "node:child_process";
import type {
  ProviderCatalogEntry,
  ProviderRuntime,
  SendMessageRequest,
  SendMessageResult,
  StreamChunk,
  ApiKeyStatus,
  ApiProviderId,
} from "./types.js";
import { PROVIDER_CATALOG } from "../../../../src/shared/provider-catalog.js";

export interface CliProviderConfig {
  id: ApiProviderId;
  command: string;
  installHint: string;
}

export interface StdoutParseResult {
  text: string;
  sessionId: string | null;
  error?: string;
}

export abstract class CliProviderBase implements ProviderRuntime {
  readonly supportsNativeTools = true;
  protected readonly config: CliProviderConfig;
  protected readonly catalog: ProviderCatalogEntry;

  constructor(config: CliProviderConfig) {
    this.config = config;
    this.catalog = PROVIDER_CATALOG.find(
      (p) => p.id === config.id
    ) as ProviderCatalogEntry;
  }

  getCatalogEntry(): ProviderCatalogEntry {
    return this.catalog;
  }

  async getApiKeyStatus(): Promise<ApiKeyStatus> {
    return { configured: true, last4: null };
  }

  async setApiKey(apiKey: string): Promise<void> {
    void apiKey;
  }
  async removeApiKey(): Promise<void> {}

  async testApiKey(apiKey?: string): Promise<string> {
    void apiKey;
    return new Promise((resolve, reject) => {
      const proc = spawn(this.config.command, ["--version"], {
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      proc.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString();
      });
      proc.on("error", (err) => {
        reject(
          new Error(
            `${this.config.command} nao encontrado: ${err.message}. ${this.config.installHint}`
          )
        );
      });
      proc.on("close", (code) => {
        if (code === 0)
          resolve(`${this.config.command} disponivel: ${stdout.trim()}`);
        else
          reject(
            new Error(`${this.config.command} retornou codigo ${code}`)
          );
      });
    });
  }

  protected abstract buildArgs(request: SendMessageRequest): string[];

  protected abstract handleStdout(
    proc: ChildProcess,
    onChunk: (chunk: StreamChunk) => void
  ): Promise<StdoutParseResult>;

  protected buildStdinInput(request: SendMessageRequest): string {
    return request.message;
  }

  async sendMessageStream(
    request: SendMessageRequest,
    onChunk: (chunk: StreamChunk) => void,
    signal?: AbortSignal
  ): Promise<SendMessageResult> {
    const startedAt = Date.now();
    const args = this.buildArgs(request);
    const preview = (value: string, limit = 220) =>
      value.length > limit ? `${value.slice(0, limit)}...` : value;

    return new Promise((resolve, reject) => {
      console.log(
        `[provider:${this.config.id}] spawn command=${this.config.command} args=${JSON.stringify(args)} cwd=${request.projectPath || process.cwd()} model=${request.model} approval=${request.approvalMode} hasSession=${Boolean(request.sessionId)} historyMessages=${request.history.length}`
      );

      const proc = spawn(this.config.command, args, {
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env },
        ...(request.projectPath && { cwd: request.projectPath }),
      });

      if (signal) {
        if (signal.aborted) {
          console.log(
            `[provider:${this.config.id}] abort requested before start`
          );
          proc.kill();
          reject(new Error("Aborted"));
          return;
        }
        signal.addEventListener(
          "abort",
          () => {
            console.log(
              `[provider:${this.config.id}] abort signal received, killing pid=${proc.pid ?? "unknown"}`
            );
            proc.kill();
          },
          { once: true }
        );
      }

      const stdinInput = this.buildStdinInput(request);
      console.log(
        `[provider:${this.config.id}] stdin chars=${stdinInput.length} preview="${preview(stdinInput)}"`
      );
      proc.stdin.write(stdinInput);
      proc.stdin.end();

      let stderrOutput = "";
      let stderrChunks = 0;
      proc.stderr.on("data", (chunk: Buffer) => {
        const text = chunk.toString();
        stderrOutput += text;
        stderrChunks += 1;
        console.error(
          `[provider:${this.config.id}] stderr chunk=${stderrChunks} chars=${text.length} preview="${preview(text)}"`
        );
      });

      proc.on("error", (err) => {
        console.error(
          `[provider:${this.config.id}] process error pid=${proc.pid ?? "unknown"} message=${err.message}`
        );
        onChunk({ type: "error", error: err.message });
        reject(new Error(`${this.config.command} erro: ${err.message}`));
      });

      const resultPromise = this.handleStdout(proc, onChunk);

      proc.on("close", (code, signalName) => {
        console.log(
          `[provider:${this.config.id}] close pid=${proc.pid ?? "unknown"} code=${code} signal=${signalName ?? "none"} durationMs=${Date.now() - startedAt} stderrChars=${stderrOutput.length}`
        );

        if (code !== 0 && code !== null) {
          const errMsg =
            stderrOutput.trim() ||
            `${this.config.command} saiu com codigo ${code}`;
          onChunk({ type: "error", error: errMsg });
          reject(new Error(errMsg));
          return;
        }

        resultPromise
          .then((result) => {
            if (result.error) {
              console.error(
                `[provider:${this.config.id}] parser marked error="${preview(result.error)}"`
              );
              onChunk({ type: "error", error: result.error });
              reject(new Error(result.error));
              return;
            }

            console.log(
              `[provider:${this.config.id}] success textChars=${result.text.length} hasSession=${Boolean(result.sessionId)} durationMs=${Date.now() - startedAt}`
            );
            onChunk({ type: "done" });
            resolve({
              text: result.text,
              sessionId: result.sessionId,
              costUsd: 0,
              durationMs: Date.now() - startedAt,
            });
          })
          .catch((parseErr) => {
            const message =
              parseErr instanceof Error ? parseErr.message : String(parseErr);
            console.error(
              `[provider:${this.config.id}] parser failure: ${message}`
            );
            onChunk({ type: "error", error: message });
            reject(new Error(message));
          });
      });
    });
  }
}
