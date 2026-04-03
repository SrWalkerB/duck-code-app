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
}

export abstract class CliProviderBase implements ProviderRuntime {
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

  async setApiKey(_apiKey: string): Promise<void> {}
  async removeApiKey(): Promise<void> {}

  async testApiKey(_apiKey?: string): Promise<string> {
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

    return new Promise((resolve, reject) => {
      const proc = spawn(this.config.command, args, {
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env },
        ...(request.projectPath && { cwd: request.projectPath }),
      });

      if (signal) {
        if (signal.aborted) {
          proc.kill();
          reject(new Error("Aborted"));
          return;
        }
        signal.addEventListener("abort", () => proc.kill(), { once: true });
      }

      proc.stdin.write(this.buildStdinInput(request));
      proc.stdin.end();

      let stderrOutput = "";
      proc.stderr.on("data", (chunk: Buffer) => {
        stderrOutput += chunk.toString();
      });

      proc.on("error", (err) => {
        onChunk({ type: "error", error: err.message });
        reject(new Error(`${this.config.command} erro: ${err.message}`));
      });

      const resultPromise = this.handleStdout(proc, onChunk);

      proc.on("close", (code) => {
        if (code !== 0 && code !== null) {
          const errMsg =
            stderrOutput.trim() ||
            `${this.config.command} saiu com codigo ${code}`;
          onChunk({ type: "error", error: errMsg });
          reject(new Error(errMsg));
          return;
        }

        resultPromise.then((result) => {
          onChunk({ type: "done" });
          resolve({
            text: result.text,
            sessionId: result.sessionId,
            costUsd: 0,
            durationMs: Date.now() - startedAt,
          });
        });
      });
    });
  }
}
