import { app, ipcMain, BrowserWindow, dialog, shell } from "electron";
import { join } from "path";
import { PrismaClient } from "@prisma/client";
import { randomBytes, createCipheriv, createDecipheriv, scryptSync } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, mkdirSync, watch } from "node:fs";
import { join as join$1, relative } from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { readdir } from "node:fs/promises";
import __cjs_mod__ from "node:module";
const __filename = import.meta.filename;
const __dirname = import.meta.dirname;
const require2 = __cjs_mod__.createRequire(import.meta.url);
const dbPath = join(app.getPath("userData"), "duck-codex.db");
const dbUrl = `file:${dbPath}`;
process.env.DATABASE_URL = dbUrl;
const prisma = new PrismaClient({
  datasourceUrl: dbUrl
});
async function ensureDatabase() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      path TEXT NOT NULL,
      color TEXT NOT NULL DEFAULT '#3b82f6',
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS threads (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      title TEXT NOT NULL,
      provider TEXT NOT NULL DEFAULT 'openai',
      model TEXT NOT NULL DEFAULT 'gpt-5.1-codex-mini',
      effort TEXT NOT NULL DEFAULT 'medium',
      session_id TEXT,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    )
  `);
  try {
    await prisma.$executeRawUnsafe(
      `ALTER TABLE threads ADD COLUMN approval_mode TEXT NOT NULL DEFAULT 'suggest'`
    );
  } catch {
  }
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      metadata TEXT,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (thread_id) REFERENCES threads(id) ON DELETE CASCADE
    )
  `);
}
function registerProjectHandlers() {
  ipcMain.handle("project:list", async () => {
    return prisma.project.findMany({
      orderBy: { updatedAt: "desc" }
    });
  });
  ipcMain.handle(
    "project:create",
    async (_, args) => {
      return prisma.project.create({
        data: {
          name: args.name,
          path: args.path,
          color: args.color ?? "#3b82f6"
        }
      });
    }
  );
  ipcMain.handle(
    "project:update",
    async (_, args) => {
      return prisma.project.update({
        where: { id: args.id },
        data: {
          ...args.name !== void 0 && { name: args.name },
          ...args.color !== void 0 && { color: args.color }
        }
      });
    }
  );
  ipcMain.handle("project:delete", async (_, args) => {
    await prisma.project.delete({ where: { id: args.id } });
  });
}
function registerThreadHandlers() {
  ipcMain.handle(
    "thread:list",
    async (_, args) => {
      return prisma.thread.findMany({
        where: { projectId: args.projectId },
        orderBy: { updatedAt: "desc" }
      });
    }
  );
  ipcMain.handle(
    "thread:create",
    async (_, args) => {
      return prisma.thread.create({
        data: {
          projectId: args.projectId,
          title: args.title,
          provider: args.provider ?? "openai",
          model: args.model ?? "gpt-5.1-codex-mini",
          effort: args.effort ?? "medium",
          approvalMode: args.approvalMode ?? "suggest"
        }
      });
    }
  );
  ipcMain.handle(
    "thread:update",
    async (_, args) => {
      return prisma.thread.update({
        where: { id: args.id },
        data: {
          ...args.title !== void 0 && { title: args.title },
          ...args.provider !== void 0 && { provider: args.provider },
          ...args.model !== void 0 && { model: args.model },
          ...args.effort !== void 0 && { effort: args.effort },
          ...args.approvalMode !== void 0 && { approvalMode: args.approvalMode },
          ...args.sessionId !== void 0 && { sessionId: args.sessionId }
        }
      });
    }
  );
  ipcMain.handle("thread:delete", async (_, args) => {
    await prisma.thread.delete({ where: { id: args.id } });
  });
}
const CREDENTIALS_FILE = "provider-credentials.json";
function getFilePath() {
  const dir = app.getPath("userData");
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return join$1(dir, CREDENTIALS_FILE);
}
function readStore() {
  const filePath = getFilePath();
  if (!existsSync(filePath)) return {};
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    return {};
  }
}
function writeStore(store) {
  writeFileSync(getFilePath(), JSON.stringify(store, null, 2), "utf8");
}
function getEncryptionKey() {
  const seed = [
    "duck-codex-provider-credentials",
    os.hostname(),
    os.homedir(),
    os.userInfo().username
  ].join(":");
  return scryptSync(seed, "duck-codex-aes-gcm", 32);
}
function encrypt(plainText) {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getEncryptionKey(), nonce);
  const ciphertext = Buffer.concat([
    cipher.update(plainText, "utf8"),
    cipher.final()
  ]);
  const authTag = cipher.getAuthTag();
  return {
    ciphertext: ciphertext.toString("base64"),
    nonce: nonce.toString("base64"),
    authTag: authTag.toString("base64")
  };
}
function decrypt(ciphertext, nonce, authTag) {
  const decipher = createDecipheriv(
    "aes-256-gcm",
    getEncryptionKey(),
    Buffer.from(nonce, "base64")
  );
  decipher.setAuthTag(Buffer.from(authTag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, "base64")),
    decipher.final()
  ]).toString("utf8").trim();
}
function loadApiKey(provider) {
  const store = readStore();
  const entry = store[provider];
  if (!entry) {
    throw new Error(`${provider.toUpperCase()} API key nao configurada`);
  }
  const decrypted = decrypt(entry.ciphertext, entry.nonce, entry.authTag);
  if (!decrypted) {
    throw new Error(`${provider.toUpperCase()} API key nao configurada`);
  }
  return decrypted;
}
function saveApiKey(provider, apiKey) {
  const trimmed = apiKey.trim();
  if (!trimmed) throw new Error("API key vazia");
  const encrypted = encrypt(trimmed);
  const store = readStore();
  store[provider] = {
    ciphertext: encrypted.ciphertext,
    nonce: encrypted.nonce,
    authTag: encrypted.authTag,
    updatedAt: Date.now()
  };
  writeStore(store);
}
function removeApiKey(provider) {
  const store = readStore();
  delete store[provider];
  writeStore(store);
}
function getApiKeyStatus(provider) {
  try {
    const key = loadApiKey(provider);
    return {
      configured: key.length > 0,
      last4: key.length >= 4 ? key.slice(-4) : null
    };
  } catch {
    return { configured: false, last4: null };
  }
}
const PROVIDER_CATALOG = [
  {
    id: "claude",
    label: "Claude API",
    default_model: "claude-sonnet-4-6",
    models: [
      { label: "Opus 4.6", value: "claude-opus-4-6" },
      { label: "Sonnet 4.6", value: "claude-sonnet-4-6" },
      { label: "Haiku 4.5", value: "claude-haiku-4-5-20251001" }
    ],
    capabilities: {
      supports_effort: false,
      requires_api_key: true
    }
  },
  {
    id: "openai",
    label: "OpenAI API",
    default_model: "gpt-5.4",
    models: [
      { label: "GPT-5.4", value: "gpt-5.4" },
      { label: "GPT-5.4 Mini", value: "gpt-5.4-mini" },
      { label: "GPT-5.3 Codex", value: "gpt-5.3-codex" },
      { label: "GPT-5.2 Codex", value: "gpt-5.2-codex" },
      { label: "GPT-5.2", value: "gpt-5.2" },
      { label: "GPT-5.1 Codex Max", value: "gpt-5.1-codex-max" },
      { label: "GPT-5.1 Mini", value: "gpt-5.1-mini" }
    ],
    capabilities: {
      supports_effort: true,
      requires_api_key: true
    }
  },
  {
    id: "codex",
    label: "Codex CLI",
    default_model: "gpt-5.4",
    models: [
      { label: "GPT-5.4", value: "gpt-5.4" },
      { label: "GPT-5.4 Mini", value: "gpt-5.4-mini" },
      { label: "GPT-5.3 Codex", value: "gpt-5.3-codex" },
      { label: "GPT-5.2 Codex", value: "gpt-5.2-codex" },
      { label: "GPT-5.2", value: "gpt-5.2" },
      { label: "GPT-5.1 Codex Max", value: "gpt-5.1-codex-max" },
      { label: "GPT-5.1 Mini", value: "gpt-5.1-mini" }
    ],
    capabilities: {
      supports_effort: false,
      requires_api_key: false
    }
  },
  {
    id: "claude-code",
    label: "Claude Code CLI",
    default_model: "claude-sonnet-4-6",
    models: [
      { label: "Opus 4.6", value: "claude-opus-4-6" },
      { label: "Sonnet 4.6", value: "claude-sonnet-4-6" },
      { label: "Haiku 4.5", value: "claude-haiku-4-5-20251001" }
    ],
    capabilities: {
      supports_effort: false,
      requires_api_key: false
    }
  }
];
const CATALOG$1 = PROVIDER_CATALOG.find((p) => p.id === "claude");
class ClaudeProvider {
  getCatalogEntry() {
    return CATALOG$1;
  }
  async getApiKeyStatus() {
    return getApiKeyStatus("claude");
  }
  async setApiKey(apiKey) {
    saveApiKey("claude", apiKey);
  }
  async removeApiKey() {
    removeApiKey("claude");
  }
  async testApiKey(apiKey) {
    const key = apiKey?.trim() || loadApiKey("claude");
    const res = await fetch("https://api.anthropic.com/v1/models", {
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01"
      }
    });
    if (!res.ok) {
      throw new Error(`Falha ao validar API key: ${await res.text()}`);
    }
    return "Conexao com Anthropic API OK";
  }
  async sendMessageStream(request, onChunk, signal) {
    const apiKey = loadApiKey("claude");
    const startedAt = Date.now();
    const messages = request.history.filter((m) => m.content.trim().length > 0).map((m) => ({ role: m.role, content: m.content }));
    messages.push({ role: "user", content: request.message });
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: request.model,
        max_tokens: 8192,
        stream: true,
        system: "Be concise. If implementation details are missing, ask direct clarifying questions before assuming.",
        messages
      }),
      signal
    });
    if (!res.ok) {
      throw new Error(`Anthropic API erro: ${await res.text()}`);
    }
    let fullText = "";
    let messageId = null;
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const data = line.slice(6).trim();
        if (data === "[DONE]") continue;
        try {
          const event = JSON.parse(data);
          if (event.type === "message_start" && event.message?.id) {
            messageId = event.message.id;
          }
          if (event.type === "content_block_delta" && event.delta?.type === "text_delta" && event.delta.text) {
            fullText += event.delta.text;
            onChunk({ type: "delta", text: event.delta.text });
          }
        } catch {
        }
      }
    }
    onChunk({ type: "done" });
    return {
      text: fullText,
      sessionId: messageId,
      costUsd: 0,
      durationMs: Date.now() - startedAt
    };
  }
}
const CATALOG = PROVIDER_CATALOG.find((p) => p.id === "openai");
function mapEffort(effort) {
  switch (effort) {
    case "low":
      return "low";
    case "high":
      return "high";
    default:
      return "medium";
  }
}
class OpenAiProvider {
  getCatalogEntry() {
    return CATALOG;
  }
  async getApiKeyStatus() {
    return getApiKeyStatus("openai");
  }
  async setApiKey(apiKey) {
    saveApiKey("openai", apiKey);
  }
  async removeApiKey() {
    removeApiKey("openai");
  }
  async testApiKey(apiKey) {
    const key = apiKey?.trim() || loadApiKey("openai");
    const res = await fetch("https://api.openai.com/v1/models", {
      headers: { Authorization: `Bearer ${key}` }
    });
    if (!res.ok) {
      throw new Error(`Falha ao validar API key: ${await res.text()}`);
    }
    return "Conexao com OpenAI API OK";
  }
  async sendMessageStream(request, onChunk, signal) {
    const apiKey = loadApiKey("openai");
    const startedAt = Date.now();
    const payload = {
      model: request.model,
      input: request.message,
      stream: true,
      store: true,
      reasoning: { effort: mapEffort(request.effort) },
      instructions: "Be concise. If implementation details are missing, ask direct clarifying questions before assuming."
    };
    if (request.sessionId) {
      payload.previous_response_id = request.sessionId;
    }
    const res = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload),
      signal
    });
    if (!res.ok) {
      throw new Error(`OpenAI API erro: ${await res.text()}`);
    }
    let fullText = "";
    let responseId = null;
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const data = line.slice(6).trim();
        if (data === "[DONE]") continue;
        let event;
        try {
          event = JSON.parse(data);
        } catch {
          continue;
        }
        console.log("[openai-sse] type:", event.type);
        if (event.type === "response.created" && event.response?.id) {
          responseId = event.response.id;
        }
        if (event.type === "error") {
          const err = event.error;
          const errMsg = err?.message || event.message || JSON.stringify(event);
          throw new Error(`OpenAI API: ${errMsg}`);
        }
        if (event.type === "response.failed") {
          const resp = event.response;
          const details = resp?.status_details;
          const innerErr = details?.error;
          const errMsg = innerErr?.message || resp?.status || "unknown failure";
          throw new Error(`OpenAI API: ${errMsg}`);
        }
        if (event.type === "response.output_text.delta" && event.delta) {
          fullText += event.delta;
          onChunk({ type: "delta", text: event.delta });
        }
        if (event.type === "response.completed" && event.response?.output) {
          const output = event.response.output;
          const outputText = output.filter((item) => item.type === "message").flatMap((item) => item.content ?? []).filter((c) => c.type === "output_text" && c.text).map((c) => c.text).join("");
          if (outputText && !fullText) {
            fullText = outputText;
            onChunk({ type: "delta", text: outputText });
          }
        }
      }
    }
    onChunk({ type: "done" });
    return {
      text: fullText,
      sessionId: responseId,
      costUsd: 0,
      durationMs: Date.now() - startedAt
    };
  }
}
class CliProviderBase {
  config;
  catalog;
  constructor(config) {
    this.config = config;
    this.catalog = PROVIDER_CATALOG.find(
      (p) => p.id === config.id
    );
  }
  getCatalogEntry() {
    return this.catalog;
  }
  async getApiKeyStatus() {
    return { configured: true, last4: null };
  }
  async setApiKey(_apiKey) {
  }
  async removeApiKey() {
  }
  async testApiKey(_apiKey) {
    return new Promise((resolve, reject) => {
      const proc = spawn(this.config.command, ["--version"], {
        stdio: ["ignore", "pipe", "pipe"]
      });
      let stdout = "";
      proc.stdout.on("data", (chunk) => {
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
  buildStdinInput(request) {
    return request.message;
  }
  async sendMessageStream(request, onChunk, signal) {
    const startedAt = Date.now();
    const args = this.buildArgs(request);
    return new Promise((resolve, reject) => {
      const proc = spawn(this.config.command, args, {
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env },
        ...request.projectPath && { cwd: request.projectPath }
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
      proc.stderr.on("data", (chunk) => {
        stderrOutput += chunk.toString();
      });
      proc.on("error", (err) => {
        onChunk({ type: "error", error: err.message });
        reject(new Error(`${this.config.command} erro: ${err.message}`));
      });
      const resultPromise = this.handleStdout(proc, onChunk);
      proc.on("close", (code) => {
        if (code !== 0 && code !== null) {
          const errMsg = stderrOutput.trim() || `${this.config.command} saiu com codigo ${code}`;
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
            durationMs: Date.now() - startedAt
          });
        });
      });
    });
  }
}
class CodexCliProvider extends CliProviderBase {
  constructor() {
    super({
      id: "codex",
      command: "codex",
      installHint: "Instale com: npm install -g @openai/codex"
    });
  }
  buildArgs(request) {
    const args = ["exec", "--json", "-m", request.model];
    switch (request.approvalMode) {
      case "full-auto":
        args.push("--full-auto");
        break;
      case "auto-edit":
        args.push("--auto-edit");
        break;
    }
    return args;
  }
  buildStdinInput(request) {
    if (!request.history.length) return request.message;
    const historyText = request.history.map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`).join("\n\n");
    return `${historyText}

User: ${request.message}`;
  }
  handleStdout(proc, onChunk) {
    return new Promise((resolve) => {
      let fullText = "";
      let threadId = null;
      let lineBuffer = "";
      proc.stdout.on("data", (chunk) => {
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
      proc.stdout.on("end", () => {
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
  processLine(line, onChunk, appendText, setThreadId) {
    const trimmed = line.trim();
    if (!trimmed) return;
    let event;
    try {
      event = JSON.parse(trimmed);
    } catch {
      return;
    }
    const eventType = event.type;
    if (eventType === "item.completed") {
      const item = event.item;
      console.log("[codex-cli] item.completed type:", item?.type, "keys:", item ? Object.keys(item).join(",") : "null");
    } else {
      console.log("[codex-cli] event:", eventType);
    }
    if (eventType === "thread.started" && event.thread_id) {
      setThreadId(event.thread_id);
    }
    if (eventType === "message.delta") {
      const delta = event.delta;
      if (delta) {
        appendText(delta);
        onChunk({ type: "delta", text: delta });
      }
    }
    if (eventType === "item.completed") {
      const item = event.item;
      if (!item) return;
      const itemType = item.type;
      if (itemType === "agent_message" && typeof item.text === "string") {
        appendText(item.text);
        onChunk({ type: "delta", text: item.text });
        return;
      }
      const summary = this.extractActivitySummary(item);
      const toolName = item.name || item.tool || itemType || "action";
      const kind = itemType.includes("result") || itemType.includes("output") ? "tool_result" : "tool_call";
      onChunk({
        type: "activity",
        activity: { kind, tool: toolName, summary }
      });
    }
    if (eventType === "turn.started") {
      onChunk({
        type: "activity",
        activity: { kind: "info", summary: "Iniciando turno..." }
      });
    }
  }
  extractActivitySummary(item) {
    const name = item.name || item.tool || item.type || "";
    const args = item.arguments || item.input;
    if (typeof args === "string") {
      try {
        const parsed = JSON.parse(args);
        return this.formatArgs(name, parsed);
      } catch {
        return args.length > 80 ? `${name}: ${args.slice(0, 80)}...` : `${name}: ${args}`;
      }
    }
    if (args && typeof args === "object") {
      return this.formatArgs(name, args);
    }
    const output = item.output || item.text || item.content || "";
    if (output && typeof output === "string") {
      return output.length > 100 ? `${output.slice(0, 100)}...` : output;
    }
    return name;
  }
  formatArgs(tool, args) {
    if (args.command) return `${args.command}`;
    if (args.path) return `${tool}: ${args.path}`;
    if (args.file_path) return `${tool}: ${args.file_path}`;
    if (args.pattern) return `${tool}: ${args.pattern}`;
    if (args.query) return `${tool}: ${args.query}`;
    const keys = Object.keys(args);
    if (keys.length > 0) {
      const first = args[keys[0]];
      if (typeof first === "string" && first.length < 80) return `${tool}: ${first}`;
    }
    return tool;
  }
}
class ClaudeCodeCliProvider extends CliProviderBase {
  constructor() {
    super({
      id: "claude-code",
      command: "claude",
      installHint: "Instale com: npm install -g @anthropic-ai/claude-code"
    });
  }
  buildArgs(request) {
    const args = [
      "--print",
      "--output-format",
      "stream-json",
      "--model",
      request.model,
      "--verbose"
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
    }
    return args;
  }
  handleStdout(proc, onChunk) {
    return new Promise((resolve) => {
      let fullText = "";
      let sessionId = null;
      let lineBuffer = "";
      proc.stdout.on("data", (chunk) => {
        lineBuffer += chunk.toString();
        const lines = lineBuffer.split("\n");
        lineBuffer = lines.pop() ?? "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          let event;
          try {
            event = JSON.parse(trimmed);
          } catch {
            continue;
          }
          if (event.type === "assistant" || event.type === "content_block_delta") {
            const msg = event.message;
            if (msg?.content) {
              const blocks = msg.content;
              for (const block of blocks) {
                if (block.type === "text" && typeof block.text === "string") {
                  const newText = block.text.slice(fullText.length);
                  if (newText) {
                    fullText = block.text;
                    onChunk({ type: "delta", text: newText });
                  }
                }
              }
            }
          }
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
      proc.stdout.on("end", () => {
        if (lineBuffer.trim()) {
          try {
            const event = JSON.parse(lineBuffer.trim());
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
const providers = {
  claude: new ClaudeProvider(),
  openai: new OpenAiProvider(),
  codex: new CodexCliProvider(),
  "claude-code": new ClaudeCodeCliProvider()
};
function getProvider(id) {
  const provider = providers[id];
  if (!provider) {
    throw new Error(`Provider desconhecido: ${id}`);
  }
  return provider;
}
function getAllProviders() {
  return Object.values(providers);
}
const activeStreams = /* @__PURE__ */ new Map();
function registerMessageHandlers(mainWindow2) {
  ipcMain.handle(
    "message:list",
    async (_, args) => {
      return prisma.message.findMany({
        where: { threadId: args.threadId },
        orderBy: { createdAt: "asc" }
      });
    }
  );
  ipcMain.handle(
    "message:send",
    async (_, args) => {
      const userMsg = await prisma.message.create({
        data: {
          threadId: args.threadId,
          role: "user",
          content: args.content
        }
      });
      streamResponse(mainWindow2, args.threadId, args.content, args.runId).catch(
        (err) => {
          console.error("Stream error:", err);
          mainWindow2.webContents.send(`chat:error:${args.threadId}`, {
            runId: args.runId,
            message: String(err)
          });
          mainWindow2.webContents.send(`chat:done:${args.threadId}`, {
            runId: args.runId
          });
        }
      );
      return userMsg;
    }
  );
  ipcMain.handle("message:stop", async (_, args) => {
    const controller = activeStreams.get(args.threadId);
    if (controller) {
      controller.abort();
      activeStreams.delete(args.threadId);
    }
  });
}
async function streamResponse(mainWindow2, threadId, _content, runId) {
  const thread = await prisma.thread.findUniqueOrThrow({
    where: { id: threadId },
    include: { project: true }
  });
  const messages = await prisma.message.findMany({
    where: { threadId },
    orderBy: { createdAt: "asc" }
  });
  const history = messages.map((m) => ({
    role: m.role,
    content: m.content
  }));
  const provider = getProvider(thread.provider);
  const abortController = new AbortController();
  activeStreams.set(threadId, abortController);
  const startedAt = Date.now();
  try {
    console.log(`[stream] Starting stream for thread=${threadId} provider=${thread.provider} model=${thread.model}`);
    const result = await provider.sendMessageStream(
      {
        model: thread.model,
        effort: thread.effort,
        approvalMode: thread.approvalMode || "suggest",
        sessionId: thread.sessionId,
        message: _content,
        history: history.slice(0, -1),
        // exclude the just-added user message (it's in `message`)
        projectPath: thread.project?.path
      },
      (chunk) => {
        if (chunk.type === "delta" && chunk.text) {
          mainWindow2.webContents.send(`chat:stream:${threadId}`, {
            runId,
            text: chunk.text
          });
        }
        if (chunk.type === "activity" && chunk.activity) {
          mainWindow2.webContents.send(`chat:activity:${threadId}`, {
            runId,
            activity: chunk.activity
          });
        }
      },
      abortController.signal
    );
    console.log(`[stream] Complete: ${result.text.length} chars, ${result.durationMs}ms`);
    await prisma.message.create({
      data: {
        threadId,
        role: "assistant",
        content: result.text,
        metadata: JSON.stringify({
          runId,
          provider: thread.provider,
          costUsd: result.costUsd,
          durationMs: result.durationMs
        })
      }
    });
    if (result.sessionId) {
      await prisma.thread.update({
        where: { id: threadId },
        data: { sessionId: result.sessionId }
      });
    }
    mainWindow2.webContents.send(`chat:complete:${threadId}`, {
      runId,
      text: result.text,
      sessionId: result.sessionId,
      costUsd: result.costUsd,
      durationMs: Date.now() - startedAt
    });
  } catch (err) {
    if (err.name === "AbortError") {
      console.log("[stream] Aborted by user");
    } else {
      console.error("[stream] Error:", err);
      mainWindow2.webContents.send(`chat:error:${threadId}`, {
        runId,
        message: String(err instanceof Error ? err.message : err)
      });
    }
  } finally {
    activeStreams.delete(threadId);
    mainWindow2.webContents.send(`chat:done:${threadId}`, { runId });
  }
}
function registerDialogHandlers() {
  ipcMain.handle("project:pick-folder", async () => {
    console.log("[pick-folder] handler called");
    try {
      const windows = BrowserWindow.getAllWindows();
      console.log("[pick-folder] windows count:", windows.length);
      const result = windows.length > 0 ? await dialog.showOpenDialog(windows[0], {
        properties: ["openDirectory"],
        title: "Selecionar diretorio do projeto"
      }) : await dialog.showOpenDialog({
        properties: ["openDirectory"],
        title: "Selecionar diretorio do projeto"
      });
      console.log("[pick-folder] result:", result);
      if (result.canceled || result.filePaths.length === 0) {
        return null;
      }
      return result.filePaths[0];
    } catch (err) {
      console.error("[pick-folder] error:", err);
      return null;
    }
  });
}
function registerProviderHandlers() {
  ipcMain.handle("provider:catalog", () => {
    return getAllProviders().map((p) => p.getCatalogEntry());
  });
  ipcMain.handle(
    "provider:api-key-status",
    async (_, args) => {
      const provider = getProvider(args.provider);
      return provider.getApiKeyStatus();
    }
  );
  ipcMain.handle(
    "provider:set-api-key",
    async (_, args) => {
      const provider = getProvider(args.provider);
      await provider.setApiKey(args.apiKey);
    }
  );
  ipcMain.handle(
    "provider:remove-api-key",
    async (_, args) => {
      const provider = getProvider(args.provider);
      await provider.removeApiKey();
    }
  );
  ipcMain.handle(
    "provider:test-api-key",
    async (_, args) => {
      const provider = getProvider(args.provider);
      return provider.testApiKey(args.apiKey);
    }
  );
}
function registerShellHandlers() {
  ipcMain.handle("shell:open-path", async (_, args) => {
    await shell.openPath(args.path);
  });
  ipcMain.handle("shell:open-url", async (_, args) => {
    await shell.openExternal(args.url);
  });
  ipcMain.handle("shell:open-terminal", async (_, args) => {
    const platform = process.platform;
    if (platform === "linux") {
      for (const term of ["x-terminal-emulator", "gnome-terminal", "konsole", "xterm"]) {
        try {
          spawn(term, [], { cwd: args.path, detached: true, stdio: "ignore" }).unref();
          return;
        } catch {
          continue;
        }
      }
    } else if (platform === "darwin") {
      spawn("open", ["-a", "Terminal", args.path], { detached: true, stdio: "ignore" }).unref();
    } else if (platform === "win32") {
      spawn("cmd.exe", ["/c", "start", "cmd.exe"], { cwd: args.path, detached: true, stdio: "ignore" }).unref();
    }
  });
}
const IGNORE = /* @__PURE__ */ new Set([
  "node_modules",
  ".git",
  ".next",
  "dist",
  "out",
  ".cache",
  ".turbo",
  "__pycache__",
  ".venv",
  "target"
]);
async function listDirectory(dirPath, rootPath, depth = 0) {
  if (depth > 5) return [];
  try {
    const entries = await readdir(dirPath, { withFileTypes: true });
    const result = [];
    const sorted = entries.filter((e) => !e.name.startsWith(".") || e.name === ".env").filter((e) => !IGNORE.has(e.name)).sort((a, b) => {
      if (a.isDirectory() && !b.isDirectory()) return -1;
      if (!a.isDirectory() && b.isDirectory()) return 1;
      return a.name.localeCompare(b.name);
    });
    for (const entry of sorted) {
      const fullPath = join$1(dirPath, entry.name);
      const relPath = relative(rootPath, fullPath);
      const isDir = entry.isDirectory();
      const node = {
        name: entry.name,
        path: fullPath,
        relativePath: relPath,
        isDirectory: isDir
      };
      if (isDir) {
        node.children = await listDirectory(fullPath, rootPath, depth + 1);
      }
      result.push(node);
    }
    return result;
  } catch {
    return [];
  }
}
const activeWatchers = /* @__PURE__ */ new Map();
function registerFileHandlers(mainWindow2) {
  ipcMain.handle("files:list", async (_, args) => {
    return listDirectory(args.path, args.path);
  });
  ipcMain.handle("files:read", async (_, args) => {
    const { readFile } = await import("node:fs/promises");
    try {
      const content = await readFile(args.path, "utf-8");
      return { content, error: null };
    } catch (err) {
      return { content: null, error: String(err) };
    }
  });
  ipcMain.handle("files:watch", async (_, args) => {
    const existing = activeWatchers.get(args.path);
    if (existing) {
      existing.close();
      activeWatchers.delete(args.path);
    }
    try {
      const watcher = watch(args.path, { recursive: true }, (eventType, filename) => {
        if (!filename) return;
        const parts = filename.split("/");
        if (parts.some((p) => IGNORE.has(p) || p.startsWith("."))) return;
        mainWindow2.webContents.send("files:changed", {
          eventType,
          filename,
          rootPath: args.path
        });
      });
      activeWatchers.set(args.path, watcher);
      return { watching: true };
    } catch {
      return { watching: false };
    }
  });
  ipcMain.handle("files:unwatch", async (_, args) => {
    const watcher = activeWatchers.get(args.path);
    if (watcher) {
      watcher.close();
      activeWatchers.delete(args.path);
    }
  });
}
function registerAllHandlers(mainWindow2) {
  registerProjectHandlers();
  registerThreadHandlers();
  registerMessageHandlers(mainWindow2);
  registerDialogHandlers();
  registerProviderHandlers();
  registerShellHandlers();
  registerFileHandlers(mainWindow2);
}
let mainWindow = null;
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    show: false,
    title: "Duck Codex",
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 12, y: 12 },
    webPreferences: {
      preload: join(__dirname, "../preload/index.mjs"),
      sandbox: false
    }
  });
  mainWindow.on("ready-to-show", () => {
    mainWindow?.show();
  });
  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url);
    return { action: "deny" };
  });
  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
  }
  registerAllHandlers(mainWindow);
}
app.whenReady().then(async () => {
  await ensureDatabase();
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
function getMainWindow() {
  return mainWindow;
}
export {
  getMainWindow
};
