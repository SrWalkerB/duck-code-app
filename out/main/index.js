import { app, ipcMain, BrowserWindow, dialog, shell, webContents } from "electron";
import { join } from "path";
import { PrismaClient } from "@prisma/client";
import { execFile, spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, mkdirSync, watch } from "node:fs";
import { join as join$1, resolve, relative } from "node:path";
import { randomBytes, createCipheriv, createDecipheriv, scryptSync, randomUUID } from "node:crypto";
import os, { homedir } from "node:os";
import { z } from "zod";
import { readFile, mkdir, writeFile, unlink, readdir, stat, rename } from "node:fs/promises";
import { minimatch } from "minimatch";
import * as pty from "node-pty";
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
  await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS tool_logs`);
  await prisma.$executeRawUnsafe(`
    CREATE TABLE tool_logs (
      id        TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      run_id    TEXT NOT NULL,
      type      TEXT NOT NULL,
      content   TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      FOREIGN KEY (thread_id) REFERENCES threads(id) ON DELETE CASCADE
    )
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS idx_tool_logs_thread_id ON tool_logs(thread_id)
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
async function resolveUniqueThreadTitle(projectId, title) {
  const baseTitle = title.trim();
  if (!baseTitle) {
    return "Nova thread";
  }
  const existingThreads = await prisma.thread.findMany({
    where: { projectId },
    select: { title: true }
  });
  const exactMatch = existingThreads.some(
    (thread) => thread.title.trim() === baseTitle
  );
  if (!exactMatch) {
    return baseTitle;
  }
  const suffixPattern = new RegExp(
    `^${baseTitle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s+(\\d+)$`
  );
  const highestSuffix = existingThreads.reduce((max, thread) => {
    const normalizedTitle = thread.title.trim();
    if (normalizedTitle === baseTitle) {
      return Math.max(max, 1);
    }
    const match = normalizedTitle.match(suffixPattern);
    if (!match) {
      return max;
    }
    const current = Number.parseInt(match[1], 10);
    if (Number.isNaN(current)) {
      return max;
    }
    return Math.max(max, current);
  }, 1);
  return `${baseTitle} ${highestSuffix + 1}`;
}
function runGitNumstat$1(cwd) {
  return new Promise((resolve2) => {
    execFile("git", ["diff", "--numstat"], { cwd }, (error, stdout) => {
      if (error) {
        resolve2(null);
        return;
      }
      const rows = String(stdout || "").split("\n").map((line) => line.trim()).filter(Boolean);
      let additions = 0;
      let deletions = 0;
      for (const row of rows) {
        const [a, d] = row.split("	");
        const addNum = Number.parseInt(a, 10);
        const delNum = Number.parseInt(d, 10);
        if (!Number.isNaN(addNum)) additions += addNum;
        if (!Number.isNaN(delNum)) deletions += delNum;
      }
      resolve2({ additions, deletions });
    });
  });
}
function resolveThreadWorkdir$2(projectPath, threadTitle) {
  if (!projectPath) return null;
  const trimmed = threadTitle.trim();
  if (trimmed) {
    const candidate = join$1(projectPath, trimmed);
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return projectPath;
}
function registerThreadHandlers() {
  ipcMain.handle(
    "thread:list",
    async (_, args) => {
      const projectThreads = await prisma.thread.findMany({
        where: { projectId: args.projectId },
        include: { project: { select: { path: true } } },
        orderBy: { updatedAt: "desc" }
      });
      const gitDiffByPath = /* @__PURE__ */ new Map();
      const enrichedThreads = await Promise.all(
        projectThreads.map(async (thread) => {
          const latestAssistantMessage = await prisma.message.findFirst({
            where: {
              threadId: thread.id,
              role: "assistant"
            },
            orderBy: { createdAt: "desc" },
            select: { metadata: true }
          });
          let lineAdditions = null;
          let lineDeletions = null;
          if (latestAssistantMessage?.metadata) {
            try {
              const metadata = JSON.parse(latestAssistantMessage.metadata);
              if (typeof metadata.lineAdditions === "number") {
                lineAdditions = metadata.lineAdditions;
              }
              if (typeof metadata.lineDeletions === "number") {
                lineDeletions = metadata.lineDeletions;
              }
            } catch {
            }
          }
          const workdir = resolveThreadWorkdir$2(thread.project?.path, thread.title);
          if ((lineAdditions === null || lineDeletions === null) && workdir) {
            if (!gitDiffByPath.has(workdir)) {
              gitDiffByPath.set(workdir, await runGitNumstat$1(workdir));
            }
            const diffStat = gitDiffByPath.get(workdir) ?? null;
            if (lineAdditions === null && diffStat) {
              lineAdditions = diffStat.additions;
            }
            if (lineDeletions === null && diffStat) {
              lineDeletions = diffStat.deletions;
            }
          }
          const threadData = { ...thread };
          delete threadData.project;
          return { ...threadData, lineAdditions, lineDeletions };
        })
      );
      return enrichedThreads;
    }
  );
  ipcMain.handle(
    "thread:create",
    async (_, args) => {
      const threadTitle = await resolveUniqueThreadTitle(args.projectId, args.title);
      return prisma.thread.create({
        data: {
          projectId: args.projectId,
          title: threadTitle,
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
function getFilePath$1() {
  const dir = app.getPath("userData");
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return join$1(dir, CREDENTIALS_FILE);
}
function readStore$1() {
  const filePath = getFilePath$1();
  if (!existsSync(filePath)) return {};
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    return {};
  }
}
function writeStore$1(store) {
  writeFileSync(getFilePath$1(), JSON.stringify(store, null, 2), "utf8");
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
  const store = readStore$1();
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
  const store = readStore$1();
  store[provider] = {
    ciphertext: encrypted.ciphertext,
    nonce: encrypted.nonce,
    authTag: encrypted.authTag,
    updatedAt: Date.now()
  };
  writeStore$1(store);
}
function removeApiKey(provider) {
  const store = readStore$1();
  delete store[provider];
  writeStore$1(store);
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
  },
  {
    id: "lm-studio",
    label: "LM Studio (Local)",
    default_model: "local-model",
    models: [{ label: "Modelo local", value: "local-model" }],
    capabilities: {
      supports_effort: false,
      requires_api_key: false
    }
  }
];
const CATALOG$1 = PROVIDER_CATALOG.find((p) => p.id === "claude");
class ClaudeProvider {
  supportsNativeTools = false;
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
  supportsNativeTools = false;
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
  supportsNativeTools = true;
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
  async setApiKey(apiKey) {
  }
  async removeApiKey() {
  }
  async testApiKey(apiKey) {
    return new Promise((resolve2, reject) => {
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
          resolve2(`${this.config.command} disponivel: ${stdout.trim()}`);
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
    const preview = (value, limit = 220) => value.length > limit ? `${value.slice(0, limit)}...` : value;
    return new Promise((resolve2, reject) => {
      console.log(
        `[provider:${this.config.id}] spawn command=${this.config.command} args=${JSON.stringify(args)} cwd=${request.projectPath || process.cwd()} model=${request.model} approval=${request.approvalMode} hasSession=${Boolean(request.sessionId)} historyMessages=${request.history.length}`
      );
      const proc = spawn(this.config.command, args, {
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env },
        ...request.projectPath && { cwd: request.projectPath }
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
      proc.stderr.on("data", (chunk) => {
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
          const errMsg = stderrOutput.trim() || `${this.config.command} saiu com codigo ${code}`;
          onChunk({ type: "error", error: errMsg });
          reject(new Error(errMsg));
          return;
        }
        resultPromise.then((result) => {
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
          resolve2({
            text: result.text,
            sessionId: result.sessionId,
            costUsd: 0,
            durationMs: Date.now() - startedAt
          });
        }).catch((parseErr) => {
          const message = parseErr instanceof Error ? parseErr.message : String(parseErr);
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
    return new Promise((resolve2) => {
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
        resolve2({ text: fullText, sessionId: threadId });
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
      console.log("[codex-cli] item.completed:", JSON.stringify(item, null, 0)?.slice(0, 500));
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
    if (typeof item.command === "string") return item.command;
    const args = item.arguments || item.input || item.params;
    if (typeof args === "string") {
      try {
        const parsed = JSON.parse(args);
        const formatted = this.formatArgs(parsed);
        if (formatted) return formatted;
      } catch {
        if (args.length > 0 && args.length < 120) return args;
      }
    }
    if (args && typeof args === "object" && !Array.isArray(args)) {
      const formatted = this.formatArgs(args);
      if (formatted) return formatted;
    }
    const output = item.output ?? item.text ?? item.content ?? item.result;
    if (typeof output === "string" && output.length > 0) {
      return output.length > 120 ? `${output.slice(0, 120)}...` : output;
    }
    if (Array.isArray(output)) {
      const firstText = output.find((o) => typeof o === "object" && o !== null && "text" in o);
      if (firstText && typeof firstText.text === "string") {
        const t = firstText.text;
        return t.length > 120 ? `${t.slice(0, 120)}...` : t;
      }
    }
    const name = item.name || item.tool || item.type || "";
    return name;
  }
  formatArgs(args) {
    for (const key of ["command", "cmd", "path", "file_path", "filename", "pattern", "query", "url", "content"]) {
      const val = args[key];
      if (typeof val === "string" && val.length > 0) {
        return val.length > 120 ? `${val.slice(0, 120)}...` : val;
      }
    }
    for (const val of Object.values(args)) {
      if (typeof val === "string" && val.length > 0 && val.length < 120) return val;
    }
    return null;
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
        args.push("--allowedTools", "Edit,Write,Read,Glob,Grep,LS,Bash");
        break;
      case "suggest":
        args.push("--allowedTools", "Read,Glob,Grep,LS");
        break;
    }
    return args;
  }
  summarizeToolInput(toolName, input) {
    if (!input) return `Usando ${toolName}...`;
    const t = toolName.toLowerCase();
    if (t === "read" || t === "write" || t === "edit" || t === "glob" || t === "grep") {
      const target = input.file_path || input.path || input.pattern || "";
      if (target) {
        const short = target.split("/").slice(-2).join("/");
        return short;
      }
    }
    if (t === "bash" || t === "shell" || t === "terminal" || t === "exec") {
      const cmd = input.command || input.cmd || "";
      return cmd.slice(0, 200) || `Executando comando...`;
    }
    if (t === "ls" || t === "list") {
      const dir = input.path || input.directory || ".";
      return dir;
    }
    const firstValue = Object.values(input).find(
      (v) => typeof v === "string" && v.length > 0
    );
    return firstValue ? firstValue.slice(0, 150) : `Usando ${toolName}...`;
  }
  handleStdout(proc, onChunk) {
    return new Promise((resolve2) => {
      const preview = (value, limit = 220) => value.length > limit ? `${value.slice(0, limit)}...` : value;
      let fullText = "";
      let sessionId = null;
      let runError = null;
      let lineBuffer = "";
      let eventCount = 0;
      let parseErrorCount = 0;
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
                if (block.type === "tool_use") {
                  const toolName = block.name || "unknown";
                  const input = block.input;
                  const summary = this.summarizeToolInput(toolName, input);
                  onChunk({
                    type: "activity",
                    activity: {
                      kind: "tool_call",
                      tool: toolName,
                      summary
                    }
                  });
                }
                if (block.type === "tool_result") {
                  const toolName = block.tool_use_id || "";
                  const content = typeof block.content === "string" ? block.content : JSON.stringify(block.content ?? "").slice(0, 200);
                  onChunk({
                    type: "activity",
                    activity: {
                      kind: "tool_result",
                      tool: toolName,
                      summary: content.slice(0, 300)
                    }
                  });
                }
              }
            }
          }
          if (event.type === "content_block_start") {
            const contentBlock = event.content_block;
            if (contentBlock?.type === "tool_use") {
              const toolName = contentBlock.name || "unknown";
              onChunk({
                type: "activity",
                activity: {
                  kind: "tool_call",
                  tool: toolName,
                  summary: `Usando ${toolName}...`
                }
              });
            }
          }
          if (event.type === "tool_result" || event.type === "tool_use") {
            const toolName = event.name || event.tool || "unknown";
            const input = event.input;
            const isResult = event.type === "tool_result";
            const summary = isResult ? typeof event.content === "string" ? event.content.slice(0, 300) : "Concluído" : this.summarizeToolInput(toolName, input);
            onChunk({
              type: "activity",
              activity: {
                kind: isResult ? "tool_result" : "tool_call",
                tool: toolName,
                summary
              }
            });
          }
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
      proc.stdout.on("end", () => {
        if (lineBuffer.trim()) {
          try {
            const event = JSON.parse(lineBuffer.trim());
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
        resolve2({ text: fullText, sessionId, error: runError ?? void 0 });
      });
    });
  }
}
const PROVIDER_CONFIG_FILE = "provider-config.json";
const DEFAULT_LM_STUDIO_BASE_URL = "http://127.0.0.1:1234";
function getFilePath() {
  const dir = app.getPath("userData");
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return join$1(dir, PROVIDER_CONFIG_FILE);
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
function normalizeBaseUrl(url) {
  const trimmed = url.trim();
  if (!trimmed) return DEFAULT_LM_STUDIO_BASE_URL;
  return trimmed.replace(/\/+$/, "");
}
function getLmStudioBaseUrl() {
  const store = readStore();
  return normalizeBaseUrl(store.lmStudioBaseUrl || DEFAULT_LM_STUDIO_BASE_URL);
}
function setLmStudioBaseUrl(url) {
  const normalized = normalizeBaseUrl(url);
  const store = readStore();
  store.lmStudioBaseUrl = normalized;
  writeStore(store);
  return normalized;
}
const BASE_CATALOG = PROVIDER_CATALOG.find(
  (p) => p.id === "lm-studio"
);
class LmStudioProvider {
  supportsNativeTools = false;
  catalog = BASE_CATALOG;
  getCatalogEntry() {
    return this.catalog;
  }
  async refreshCatalogModels() {
    const modelValues = await this.fetchModelValues();
    if (modelValues.length === 0) {
      return;
    }
    const models = modelValues.map((value) => ({ label: value, value }));
    this.catalog = {
      ...BASE_CATALOG,
      default_model: models[0]?.value || BASE_CATALOG.default_model,
      models
    };
  }
  async getApiKeyStatus() {
    return { configured: true, last4: null };
  }
  async setApiKey(apiKey) {
  }
  async removeApiKey() {
  }
  async testApiKey(_apiKey) {
    const modelValues = await this.fetchModelValues();
    if (modelValues.length === 0) {
      return "Conexao com LM Studio OK, mas nenhum modelo LLM disponivel no endpoint /api/v1/models.";
    }
    return `Conexao com LM Studio OK (${modelValues.length} modelo(s) disponivel(is)).`;
  }
  async sendMessageStream(request, onChunk, signal) {
    const startedAt = Date.now();
    const baseUrl = getLmStudioBaseUrl();
    const messages = [];
    for (const msg of request.history) {
      messages.push({ role: msg.role, content: msg.content });
    }
    messages.push({ role: "user", content: request.message });
    const res = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: request.model,
        messages,
        stream: true
      }),
      signal
    });
    if (!res.ok) {
      throw new Error(`LM Studio API erro: ${await res.text()}`);
    }
    let fullText = "";
    let thinkingText = "";
    let thinkingEmitted = false;
    let responseId = null;
    const reader = res.body?.getReader();
    if (!reader) {
      throw new Error("Resposta de stream invalida do LM Studio.");
    }
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (!data || data === "[DONE]") continue;
        let event;
        try {
          event = JSON.parse(data);
        } catch {
          continue;
        }
        if (typeof event.id === "string") {
          responseId = event.id;
        }
        const choices = event.choices;
        if (!choices || choices.length === 0) continue;
        const delta = choices[0].delta;
        if (!delta) continue;
        if (delta.reasoning_content) {
          thinkingText += delta.reasoning_content;
        }
        if (delta.content) {
          if (thinkingText && !thinkingEmitted) {
            thinkingEmitted = true;
            onChunk({
              type: "activity",
              activity: { kind: "thinking", summary: thinkingText.trim() }
            });
          }
          fullText += delta.content;
          onChunk({ type: "delta", text: delta.content });
        }
      }
    }
    if (thinkingText.trim() && !thinkingEmitted) {
      onChunk({
        type: "activity",
        activity: { kind: "thinking", summary: thinkingText.trim() }
      });
    }
    onChunk({ type: "done" });
    return {
      text: fullText,
      sessionId: responseId,
      costUsd: 0,
      durationMs: Date.now() - startedAt
    };
  }
  async fetchModelValues() {
    const baseUrl = getLmStudioBaseUrl();
    const res = await fetch(`${baseUrl}/api/v1/models`);
    if (!res.ok) {
      throw new Error(`Falha ao consultar modelos no LM Studio: ${await res.text()}`);
    }
    const json = await res.json();
    const fromNative = this.extractFromNativeModels(json.models || []);
    if (fromNative.length > 0) {
      return fromNative;
    }
    const fromCompat = (json.data || []).map((item) => item.id || item.name || item.key || item.display_name || "").filter((value) => Boolean(value));
    if (fromCompat.length > 0) {
      return [...new Set(fromCompat)];
    }
    return this.extractFromUnknown(json);
  }
  extractFromNativeModels(models) {
    if (!Array.isArray(models) || models.length === 0) return [];
    const values = models.filter((item) => (item.type || "llm") !== "embedding").map(
      (item) => item.key || item.selected_variant || item.id || item.name || item.display_name || item.variants?.[0] || ""
    ).filter((value) => Boolean(value));
    return [...new Set(values)];
  }
  extractFromUnknown(input) {
    const queue = [input];
    const found = /* @__PURE__ */ new Set();
    while (queue.length > 0) {
      const node = queue.shift();
      if (!node || typeof node !== "object") continue;
      if (Array.isArray(node)) {
        for (const item of node) queue.push(item);
        continue;
      }
      const obj = node;
      const candidates = [
        obj.key,
        obj.id,
        obj.name,
        obj.selected_variant,
        obj.display_name
      ];
      for (const candidate of candidates) {
        if (typeof candidate === "string" && candidate.trim()) {
          found.add(candidate.trim());
        }
      }
      for (const value of Object.values(obj)) {
        if (value && typeof value === "object") queue.push(value);
      }
    }
    return [...found];
  }
}
const providers = {
  claude: new ClaudeProvider(),
  openai: new OpenAiProvider(),
  codex: new CodexCliProvider(),
  "claude-code": new ClaudeCodeCliProvider(),
  "lm-studio": new LmStudioProvider()
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
function buildTool(partial) {
  const isReadOnly = partial.isReadOnly ?? false;
  return {
    // Defaults: assume the tool writes and is NOT safe for parallelism
    isReadOnly,
    isConcurrencySafe: partial.isConcurrencySafe ?? false,
    // Default permission: read-only → auto-allow, write → depends on approvalMode
    checkPermissions: (_input, ctx) => {
      if (isReadOnly) return { behavior: "allow" };
      if (ctx.approvalMode === "full-auto") return { behavior: "allow" };
      if (ctx.approvalMode === "auto-edit") return { behavior: "allow" };
      return { behavior: "ask", description: `Execute ${partial.name}` };
    },
    // Default validation: use Zod schema
    validateInput: (input) => {
      const result = partial.inputSchema.safeParse(input);
      if (result.success) return { valid: true };
      return { valid: false, error: result.error.message };
    },
    // Spread user-provided overrides last (they win over defaults)
    ...partial
  };
}
function resolveSafe(projectPath, relativePath) {
  const resolved = resolve(projectPath, relativePath);
  if (!resolved.startsWith(projectPath)) {
    throw new Error(`Path traversal blocked: ${relativePath}`);
  }
  return resolved;
}
const MAX_READ_CHARS = 5e4;
const ReadFileTool = buildTool({
  name: "read_file",
  description: `Read file contents with line numbers (cat -n format).
- Returns content with line numbers starting at 1
- Use offset and limit for targeted reads of large files
- You MUST read a file before editing it`,
  inputSchema: z.object({
    path: z.string().min(1).describe("File path relative to the project root"),
    offset: z.number().int().positive().optional().describe("Line number to start reading from (1-based)"),
    limit: z.number().int().positive().optional().describe("Maximum number of lines to return")
  }),
  isReadOnly: true,
  isConcurrencySafe: true,
  call: async (input, ctx) => {
    const resolved = resolveSafe(ctx.projectPath, input.path);
    const raw = await readFile(resolved, "utf-8");
    const allLines = raw.split("\n");
    const totalLines = allLines.length;
    const startLine = (input.offset ?? 1) - 1;
    const maxLines = input.limit ?? totalLines;
    const selectedLines = allLines.slice(startLine, startLine + maxLines);
    const formatted = selectedLines.map((line, i) => {
      const lineNum = startLine + i + 1;
      return `${String(lineNum).padStart(6)}	${line}`;
    }).join("\n");
    if (formatted.length > MAX_READ_CHARS) {
      const truncated = formatted.slice(0, MAX_READ_CHARS);
      const lastNewline = truncated.lastIndexOf("\n");
      return {
        success: true,
        output: `${truncated.slice(0, lastNewline)}
... (truncated, showing ${selectedLines.length} of ${totalLines} total lines)`,
        metadata: { totalLines, truncated: true }
      };
    }
    const rangeInfo = input.offset || input.limit ? ` (lines ${startLine + 1}-${startLine + selectedLines.length} of ${totalLines})` : "";
    return {
      success: true,
      output: formatted + rangeInfo,
      metadata: { totalLines, truncated: false }
    };
  }
});
const MAX_FILE_SIZE$1 = 1048576;
const WriteFileTool = buildTool({
  name: "write_file",
  description: `Create a new file or completely overwrite an existing one.
- Creates parent directories automatically if needed
- For existing files, prefer edit_file instead — it only changes what's needed
- Choose descriptive file names based on the content (e.g. snake-game.html, not index.html)
- NEVER create documentation files (*.md) or README files unless explicitly requested`,
  inputSchema: z.object({
    path: z.string().min(1).describe("File path relative to the project root"),
    content: z.string().describe("The content to write to the file")
  }),
  isReadOnly: false,
  isConcurrencySafe: false,
  validateInput: (input) => {
    if (input.content.length > MAX_FILE_SIZE$1) {
      return { valid: false, error: `File content exceeds ${MAX_FILE_SIZE$1} bytes limit` };
    }
    return { valid: true };
  },
  call: async (input, ctx) => {
    const resolved = resolveSafe(ctx.projectPath, input.path);
    const parentDir = resolve(resolved, "..");
    await mkdir(parentDir, { recursive: true });
    await writeFile(resolved, input.content, "utf-8");
    return {
      success: true,
      output: `File created: ${input.path} (${input.content.length} chars)`,
      metadata: { chars: input.content.length }
    };
  }
});
const MAX_FILE_SIZE = 1048576;
const EditFileTool = buildTool({
  name: "edit_file",
  description: `Perform exact string replacements in a file. Two modes available:

Mode 1 — String replace (recommended):
  Provide old_content and new_content. old_content must be unique in the file.
  The edit FAILS if old_content appears more than once — provide more surrounding
  context to make it unique, or use replace_all: true to change every occurrence.

Mode 2 — Line range replace:
  Provide start_line, end_line, and content to replace a range of lines.
  Use read_file first to see line numbers.

IMPORTANT: You MUST read the file with read_file before editing it.`,
  inputSchema: z.object({
    path: z.string().min(1).describe("File path relative to the project root"),
    // Mode 1: string replace
    old_content: z.string().optional().describe("Exact text to find and replace"),
    new_content: z.string().optional().describe("Replacement text"),
    replace_all: z.boolean().optional().describe("Replace all occurrences (default false)"),
    // Mode 2: line range
    start_line: z.number().int().positive().optional().describe("Start line number (1-based) for line-range replacement"),
    end_line: z.number().int().positive().optional().describe("End line number (inclusive) for line-range replacement"),
    content: z.string().optional().describe("New content to replace the line range with")
  }),
  isReadOnly: false,
  isConcurrencySafe: false,
  validateInput: (input) => {
    const hasStringMode = input.old_content !== void 0;
    const hasLineMode = input.start_line !== void 0 && input.end_line !== void 0;
    if (!hasStringMode && !hasLineMode) {
      return {
        valid: false,
        error: "Provide either (old_content + new_content) for string replace, or (start_line + end_line + content) for line-range replace."
      };
    }
    if (hasStringMode && input.new_content === void 0) {
      return { valid: false, error: "new_content is required when using old_content." };
    }
    if (hasLineMode && input.content === void 0) {
      return { valid: false, error: "content is required when using start_line/end_line." };
    }
    if (hasLineMode && input.start_line > input.end_line) {
      return { valid: false, error: "start_line must be <= end_line." };
    }
    return { valid: true };
  },
  call: async (input, ctx) => {
    const resolved = resolveSafe(ctx.projectPath, input.path);
    const current = await readFile(resolved, "utf-8");
    let updated;
    if (input.old_content !== void 0) {
      const oldContent = input.old_content;
      const newContent = input.new_content;
      if (!current.includes(oldContent)) {
        return {
          success: false,
          output: "old_content not found in file. Make sure you use the exact text including whitespace and indentation. Use read_file first to see the current content."
        };
      }
      if (input.replace_all) {
        updated = current.split(oldContent).join(newContent);
      } else {
        const firstIdx = current.indexOf(oldContent);
        const secondIdx = current.indexOf(oldContent, firstIdx + 1);
        if (secondIdx !== -1) {
          return {
            success: false,
            output: "old_content appears more than once in the file. Provide more surrounding context to make it unique, or set replace_all: true."
          };
        }
        updated = current.replace(oldContent, newContent);
      }
    } else {
      const lines = current.split("\n");
      const startIdx = input.start_line - 1;
      const endIdx = input.end_line;
      if (startIdx >= lines.length) {
        return {
          success: false,
          output: `start_line ${input.start_line} is beyond end of file (${lines.length} lines).`
        };
      }
      const newLines = input.content.split("\n");
      lines.splice(startIdx, endIdx - startIdx, ...newLines);
      updated = lines.join("\n");
    }
    if (updated.length > MAX_FILE_SIZE) {
      return { success: false, output: `Resulting file exceeds ${MAX_FILE_SIZE} bytes limit.` };
    }
    await writeFile(resolved, updated, "utf-8");
    return {
      success: true,
      output: `File edited: ${input.path}`
    };
  }
});
const DeleteFileTool = buildTool({
  name: "delete_file",
  description: "Delete a file from the project.",
  inputSchema: z.object({
    path: z.string().min(1).describe("File path relative to the project root")
  }),
  isReadOnly: false,
  isConcurrencySafe: false,
  // Always ask for approval except in full-auto mode (destructive operation)
  checkPermissions: (input, ctx) => {
    if (ctx.approvalMode === "full-auto") return { behavior: "allow" };
    return { behavior: "ask", description: `Delete file: ${input.path}` };
  },
  call: async (input, ctx) => {
    const resolved = resolveSafe(ctx.projectPath, input.path);
    await unlink(resolved);
    return { success: true, output: `File deleted: ${input.path}` };
  }
});
const MAX_RESULTS$1 = 100;
const IGNORE_DIRS$2 = /* @__PURE__ */ new Set([
  "node_modules",
  ".git",
  ".next",
  "dist",
  "out",
  ".cache",
  "__pycache__",
  ".venv",
  "target",
  ".DS_Store",
  "build"
]);
async function collectFiles(dir, projectPath, depth, entries) {
  if (depth > 8 || entries.length > MAX_RESULTS$1 * 2) return;
  try {
    const dirEntries = await readdir(dir, { withFileTypes: true });
    for (const entry of dirEntries) {
      if (entry.name.startsWith(".") && IGNORE_DIRS$2.has(entry.name)) continue;
      if (IGNORE_DIRS$2.has(entry.name)) continue;
      const fullPath = join$1(dir, entry.name);
      const relPath = relative(projectPath, fullPath);
      if (entry.isDirectory()) {
        await collectFiles(fullPath, projectPath, depth + 1, entries);
      } else {
        try {
          const fileStat = await stat(fullPath);
          entries.push({ relativePath: relPath, mtime: fileStat.mtimeMs });
        } catch {
          entries.push({ relativePath: relPath, mtime: 0 });
        }
      }
    }
  } catch {
  }
}
const GlobTool = buildTool({
  name: "glob",
  description: `Find files matching a glob pattern (e.g. '**/*.ts', 'src/**/*.css').
Returns matching file paths sorted by modification time (most recently modified first).`,
  inputSchema: z.object({
    pattern: z.string().min(1).describe("Glob pattern to match files against"),
    path: z.string().optional().describe("Directory to search in (defaults to project root)")
  }),
  isReadOnly: true,
  isConcurrencySafe: true,
  call: async (input, ctx) => {
    const searchDir = input.path ? resolveSafe(ctx.projectPath, input.path) : ctx.projectPath;
    const entries = [];
    await collectFiles(searchDir, ctx.projectPath, 0, entries);
    const matched = entries.filter((e) => minimatch(e.relativePath, input.pattern, { dot: false })).sort((a, b) => b.mtime - a.mtime).slice(0, MAX_RESULTS$1);
    if (matched.length === 0) {
      return { success: true, output: "No files matched the pattern." };
    }
    const output = matched.map((e) => e.relativePath).join("\n");
    return {
      success: true,
      output,
      metadata: { matchCount: matched.length }
    };
  }
});
const MAX_RESULTS = 100;
const MAX_LINE_LENGTH = 2e3;
const EXCLUDED_DIRS = [
  "node_modules",
  ".git",
  "dist",
  "out",
  ".cache",
  "build",
  "__pycache__",
  ".venv",
  "target"
];
const GrepTool = buildTool({
  name: "grep",
  description: `Search for a regex pattern in file contents using ripgrep.
- Returns matching lines with file paths and line numbers
- Use include to filter by file type (e.g. "*.ts", "*.{ts,tsx}")
- Supports full regex syntax
- Searches hidden files by default
- Use this tool instead of bash + grep for better performance`,
  inputSchema: z.object({
    pattern: z.string().min(1).describe("Regex pattern to search for"),
    path: z.string().optional().describe("Directory to search in (defaults to project root)"),
    include: z.string().optional().describe("File pattern filter (e.g. '*.ts', '*.{html,css}')")
  }),
  isReadOnly: true,
  isConcurrencySafe: true,
  call: async (input, ctx) => {
    const searchDir = input.path ? resolveSafe(ctx.projectPath, input.path) : ctx.projectPath;
    const useRipgrep = await hasRipgrep();
    if (useRipgrep) {
      return runRipgrep(input, searchDir, ctx);
    }
    return runNativeGrep(input, searchDir, ctx);
  }
});
let _ripgrepAvailable = null;
async function hasRipgrep() {
  if (_ripgrepAvailable !== null) return _ripgrepAvailable;
  return new Promise((resolve2) => {
    const proc = spawn("rg", ["--version"], { stdio: "ignore" });
    proc.on("close", (code) => {
      _ripgrepAvailable = code === 0;
      resolve2(_ripgrepAvailable);
    });
    proc.on("error", () => {
      _ripgrepAvailable = false;
      resolve2(false);
    });
  });
}
async function runRipgrep(input, searchDir, ctx) {
  const args = [
    "-n",
    // line numbers
    "-H",
    // show filenames
    "--hidden",
    // include hidden files
    "--no-messages",
    // suppress error messages
    "--color=never"
  ];
  if (input.include) {
    args.push("--glob", input.include);
  }
  for (const dir of EXCLUDED_DIRS) {
    args.push("--glob", `!${dir}`);
  }
  args.push(input.pattern, searchDir);
  return new Promise((resolve2) => {
    let output = "";
    const proc = spawn("rg", args, { stdio: ["ignore", "pipe", "pipe"] });
    if (ctx.signal) {
      const onAbort = () => proc.kill();
      if (ctx.signal.aborted) {
        proc.kill();
      } else {
        ctx.signal.addEventListener("abort", onAbort, { once: true });
      }
    }
    proc.stdout.on("data", (chunk) => {
      output += chunk.toString();
    });
    proc.stderr.on("data", () => {
    });
    proc.on("close", (code) => {
      if (code === 1 && !output.trim()) {
        resolve2({ success: true, output: "No matches found." });
        return;
      }
      const lines = output.trim().split("\n").filter(Boolean);
      const formatted = formatResults(lines, ctx.projectPath);
      resolve2({
        success: true,
        output: formatted.text,
        metadata: { matchCount: formatted.count, truncated: formatted.truncated }
      });
    });
    proc.on("error", () => {
      resolve2({ success: false, output: "Failed to run ripgrep." });
    });
  });
}
async function runNativeGrep(input, searchDir, ctx) {
  const args = ["-rn", "--color=never"];
  if (input.include) {
    args.push(`--include=${input.include}`);
  }
  for (const dir of EXCLUDED_DIRS) {
    args.push(`--exclude-dir=${dir}`);
  }
  args.push(input.pattern, searchDir);
  return new Promise((resolve2) => {
    let output = "";
    const proc = spawn("grep", args, { stdio: ["ignore", "pipe", "pipe"] });
    if (ctx.signal) {
      const onAbort = () => proc.kill();
      if (ctx.signal.aborted) {
        proc.kill();
      } else {
        ctx.signal.addEventListener("abort", onAbort, { once: true });
      }
    }
    proc.stdout.on("data", (chunk) => {
      output += chunk.toString();
    });
    proc.on("close", (code) => {
      if (code === 1 || !output.trim()) {
        resolve2({ success: true, output: "No matches found." });
        return;
      }
      const lines = output.trim().split("\n").filter(Boolean);
      const formatted = formatResults(lines, ctx.projectPath);
      resolve2({
        success: true,
        output: formatted.text,
        metadata: { matchCount: formatted.count, truncated: formatted.truncated }
      });
    });
    proc.on("error", () => {
      resolve2({ success: false, output: "Failed to run grep." });
    });
  });
}
function formatResults(lines, projectPath) {
  const truncated = lines.length > MAX_RESULTS;
  const limited = lines.slice(0, MAX_RESULTS);
  const formatted = limited.map((line) => {
    if (line.startsWith(projectPath)) {
      line = relative(projectPath, line);
    }
    if (line.length > MAX_LINE_LENGTH) {
      line = line.slice(0, MAX_LINE_LENGTH) + "...";
    }
    return line;
  });
  let text = formatted.join("\n");
  if (truncated) {
    text += `
... (showing ${MAX_RESULTS} of ${lines.length} matches)`;
  }
  return { text, count: limited.length, truncated };
}
const IGNORE_DIRS$1 = /* @__PURE__ */ new Set([
  "node_modules",
  ".git",
  ".next",
  "dist",
  "out",
  ".cache",
  "__pycache__",
  ".venv",
  "target"
]);
async function listDir(dir, projectPath, depth) {
  if (depth > 3) return [];
  const entries = await readdir(dir, { withFileTypes: true });
  const lines = [];
  const sorted = entries.filter((e) => !e.name.startsWith(".") && !IGNORE_DIRS$1.has(e.name)).sort((a, b) => {
    if (a.isDirectory() && !b.isDirectory()) return -1;
    if (!a.isDirectory() && b.isDirectory()) return 1;
    return a.name.localeCompare(b.name);
  });
  for (const entry of sorted) {
    const rel = relative(projectPath, join$1(dir, entry.name));
    const prefix = "  ".repeat(depth);
    if (entry.isDirectory()) {
      lines.push(`${prefix}${rel}/`);
      lines.push(...await listDir(join$1(dir, entry.name), projectPath, depth + 1));
    } else {
      lines.push(`${prefix}${rel}`);
    }
  }
  return lines;
}
const ListFilesTool = buildTool({
  name: "list_files",
  description: "List files and directories at a path in a tree-like format.",
  inputSchema: z.object({
    path: z.string().optional().describe("Directory path relative to project root (defaults to root)")
  }),
  isReadOnly: true,
  isConcurrencySafe: true,
  call: async (input, ctx) => {
    const targetPath = input.path ? resolveSafe(ctx.projectPath, input.path) : ctx.projectPath;
    try {
      const lines = await listDir(targetPath, ctx.projectPath, 0);
      return {
        success: true,
        output: lines.join("\n") || "(empty directory)"
      };
    } catch (err) {
      return {
        success: false,
        output: err instanceof Error ? err.message : String(err)
      };
    }
  }
});
const RenameFileTool = buildTool({
  name: "rename_file",
  description: "Rename or move a file to a new path.",
  inputSchema: z.object({
    old_path: z.string().min(1).describe("Current file path relative to project root"),
    new_path: z.string().min(1).describe("New file path relative to project root")
  }),
  isReadOnly: false,
  isConcurrencySafe: false,
  call: async (input, ctx) => {
    const resolvedOld = resolveSafe(ctx.projectPath, input.old_path);
    const resolvedNew = resolveSafe(ctx.projectPath, input.new_path);
    const parentDir = resolve(resolvedNew, "..");
    await mkdir(parentDir, { recursive: true });
    await rename(resolvedOld, resolvedNew);
    return {
      success: true,
      output: `Renamed: ${input.old_path} → ${input.new_path}`
    };
  }
});
const CreateDirectoryTool = buildTool({
  name: "create_directory",
  description: "Create a directory (and parent directories if needed).",
  inputSchema: z.object({
    path: z.string().min(1).describe("Directory path relative to project root")
  }),
  isReadOnly: false,
  isConcurrencySafe: false,
  call: async (input, ctx) => {
    const resolved = resolveSafe(ctx.projectPath, input.path);
    await mkdir(resolved, { recursive: true });
    return { success: true, output: `Directory created: ${input.path}` };
  }
});
const DEFAULT_TIMEOUT = 12e4;
const MAX_OUTPUT_CHARS = 3e4;
const KILL_GRACE_MS = 3e3;
const BashTool = buildTool({
  name: "bash",
  description: `Execute a shell command in the project directory.
- Use for running builds, tests, installs, git commands, etc.
- Default timeout is 2 minutes — use timeout param for longer commands
- Provide a clear description of what the command does
- Prefer this over manual file operations when a CLI tool exists`,
  inputSchema: z.object({
    command: z.string().min(1).describe("Shell command to execute"),
    description: z.string().min(1).describe("Clear description of what this command does (5-10 words)"),
    timeout: z.number().int().positive().optional().describe("Timeout in milliseconds (default 120000)"),
    cwd: z.string().optional().describe("Working directory relative to project root")
  }),
  isReadOnly: false,
  isConcurrencySafe: false,
  // Always ask for approval except in full-auto mode
  checkPermissions: (input, ctx) => {
    if (ctx.approvalMode === "full-auto") return { behavior: "allow" };
    return { behavior: "ask", description: `Run: ${input.command}` };
  },
  call: async (input, ctx) => {
    const cwd = input.cwd ? resolveSafe(ctx.projectPath, input.cwd) : ctx.projectPath;
    const timeout = input.timeout ?? DEFAULT_TIMEOUT;
    return new Promise((resolve2) => {
      let stdout = "";
      let stderr = "";
      let killed = false;
      let timedOut = false;
      const shell2 = process.platform === "win32" ? "cmd" : "/bin/sh";
      const shellArgs = process.platform === "win32" ? ["/c", input.command] : ["-c", input.command];
      const proc = spawn(shell2, shellArgs, {
        cwd,
        env: { ...process.env },
        stdio: ["ignore", "pipe", "pipe"]
      });
      const onAbort = () => {
        killed = true;
        proc.kill("SIGTERM");
        setTimeout(() => {
          if (!proc.killed) proc.kill("SIGKILL");
        }, KILL_GRACE_MS);
      };
      if (ctx.signal) {
        if (ctx.signal.aborted) {
          onAbort();
        } else {
          ctx.signal.addEventListener("abort", onAbort, { once: true });
        }
      }
      const timer = setTimeout(() => {
        timedOut = true;
        proc.kill("SIGTERM");
        setTimeout(() => {
          if (!proc.killed) proc.kill("SIGKILL");
        }, KILL_GRACE_MS);
      }, timeout);
      proc.stdout.on("data", (chunk) => {
        stdout += chunk.toString();
      });
      proc.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });
      proc.on("close", (code) => {
        clearTimeout(timer);
        ctx.signal?.removeEventListener("abort", onAbort);
        let output = [stdout, stderr].filter(Boolean).join("\n").trim();
        if (output.length > MAX_OUTPUT_CHARS) {
          output = output.slice(0, MAX_OUTPUT_CHARS) + `
... (output truncated, showing first ${MAX_OUTPUT_CHARS} chars)`;
        }
        if (timedOut) {
          output += `
[TIMEOUT after ${timeout}ms]`;
        }
        if (killed && !timedOut) {
          output += "\n[CANCELLED by user]";
        }
        const success = code === 0 && !timedOut && !killed;
        resolve2({
          success,
          output: output || (success ? "(no output)" : `Exit code: ${code}`),
          metadata: { exitCode: code, timedOut, killed }
        });
      });
      proc.on("error", (err) => {
        clearTimeout(timer);
        resolve2({
          success: false,
          output: `Failed to start process: ${err.message}`
        });
      });
    });
  }
});
const TOOL_REGISTRY = [
  ReadFileTool,
  WriteFileTool,
  EditFileTool,
  DeleteFileTool,
  GlobTool,
  GrepTool,
  ListFilesTool,
  RenameFileTool,
  CreateDirectoryTool,
  BashTool
];
function findToolByName(name) {
  return TOOL_REGISTRY.find((t) => t.name === name);
}
function generateToolDocs() {
  return TOOL_REGISTRY.map((tool) => {
    const schema = tool.inputSchema;
    let argsDoc = "";
    if ("shape" in schema && schema.shape) {
      const shape = schema.shape;
      argsDoc = Object.entries(shape).map(([key, val]) => {
        const isOptional = val.isOptional?.() ?? false;
        const desc = val._def?.description ?? val.description ?? "";
        return `  - ${key}${isOptional ? " (optional)" : " (required)"}: ${desc}`;
      }).join("\n");
    }
    return `## ${tool.name}
${tool.description}
${argsDoc ? `Args:
${argsDoc}` : ""}`;
  }).join("\n\n");
}
const index = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  TOOL_REGISTRY,
  findToolByName,
  generateToolDocs
}, Symbol.toStringTag, { value: "Module" }));
const VARIANTS = {
  gemma: {
    toolFormatRepetitions: 1,
    includeExample: true,
    maxSystemPromptChars: 6e3,
    extraInstructions: "Be direct and concise. Respond in the user's language."
  },
  llama: {
    toolFormatRepetitions: 1,
    includeExample: true,
    maxSystemPromptChars: 8e3
  },
  qwen: {
    toolFormatRepetitions: 0,
    includeExample: true,
    maxSystemPromptChars: 8e3
  },
  mistral: {
    toolFormatRepetitions: 1,
    includeExample: true,
    maxSystemPromptChars: 8e3
  },
  codestral: {
    toolFormatRepetitions: 0,
    includeExample: true,
    maxSystemPromptChars: 1e4
  },
  deepseek: {
    toolFormatRepetitions: 0,
    includeExample: true,
    maxSystemPromptChars: 1e4
  },
  phi: {
    toolFormatRepetitions: 2,
    includeExample: true,
    maxSystemPromptChars: 4e3
  }
};
const DEFAULT_VARIANT = {
  toolFormatRepetitions: 1,
  includeExample: true,
  maxSystemPromptChars: 8e3
};
function getPromptVariant(modelId) {
  const lower = modelId.toLowerCase();
  for (const [key, variant] of Object.entries(VARIANTS)) {
    if (lower.includes(key)) {
      return variant;
    }
  }
  return DEFAULT_VARIANT;
}
function buildIdentitySection() {
  return `You are a skilled software engineer working directly in the user's project. You write clean, well-structured, production-quality code. You think before you act: understand the existing codebase before making changes, and explain your reasoning.`;
}
function buildEnvironmentSection(options) {
  const parts = [];
  if (options.projectPath) {
    parts.push(`PROJECT ROOT: ${options.projectPath}`);
  }
  if (options.fileTree) {
    parts.push(`
Current project files:
${options.fileTree}`);
  }
  if (options.keyFileContents && Object.keys(options.keyFileContents).length > 0) {
    parts.push(`
Key project files:`);
    for (const [filename, content] of Object.entries(options.keyFileContents)) {
      parts.push(`
--- ${filename} ---
${content}`);
    }
  }
  return parts.length > 0 ? `# Environment
${parts.join("\n")}` : "";
}
function buildBehaviorSection() {
  return `# Rules

- Before editing a file, ALWAYS read it first with read_file to understand its content and context
- Do not create files unless they are necessary. Prefer editing existing files over creating new ones
- Choose descriptive file names based on content — for a snake game use "snake-game.html", not "index.html" or "game.html"
- For multi-file projects, ensure all cross-file references are correct (CSS links, JS imports, etc.)
- Write COMPLETE, functional code — never use placeholders like "// TODO", "// ...", or "// add code here"
- Follow the coding style that already exists in the project (indentation, naming conventions, patterns)
- When asked to create something new, use write_file — do NOT just show code in your response
- After completing tool operations, provide a clear summary of what was accomplished
- Be careful not to introduce security vulnerabilities
- When you receive a <tool_result>, continue working or summarize results — do NOT repeat the tool call`;
}
function buildToolFormatSection(variant) {
  let section = `# Tool Usage

To use a tool, wrap valid JSON in <tool_call> tags:

<tool_call>
{"name": "tool_name", "args": {"param1": "value1"}}
</tool_call>

IMPORTANT: Use \\n for newlines inside string values (not actual line breaks). Each tool call needs its own <tool_call> tags.`;
  if (variant.includeExample) {
    section += `

EXAMPLE — creating a file:
<tool_call>
{"name": "write_file", "args": {"path": "snake-game.html", "content": "<!DOCTYPE html>\\n<html>\\n<head><title>Snake Game</title></head>\\n<body>\\n<canvas id=\\"game\\"></canvas>\\n</body>\\n</html>"}}
</tool_call>`;
  }
  if (variant.toolFormatRepetitions >= 1) {
    section += `

REMINDER: Always use <tool_call> tags to create or edit files. Never just paste code in your response.`;
  }
  if (variant.toolFormatRepetitions >= 2) {
    section += ` The JSON must be on a single line inside the tags.`;
  }
  if (variant.extraInstructions) {
    section += `

${variant.extraInstructions}`;
  }
  return section;
}
function buildToolReferenceSection() {
  return `# Available Tools

${generateToolDocs()}`;
}
function truncatePrompt(prompt, maxChars) {
  if (prompt.length <= maxChars) return prompt;
  const envHeader = "# Environment\n";
  const envIdx = prompt.indexOf(envHeader);
  if (envIdx !== -1) {
    const nextSectionIdx = prompt.indexOf("\n# ", envIdx + envHeader.length);
    if (nextSectionIdx !== -1) {
      const envSection = prompt.slice(envIdx, nextSectionIdx);
      const excess = prompt.length - maxChars;
      if (envSection.length > excess + 200) {
        const truncatedEnv = envSection.slice(0, envSection.length - excess - 50) + "\n... (project context truncated to fit model budget)\n";
        return prompt.slice(0, envIdx) + truncatedEnv + prompt.slice(nextSectionIdx);
      }
    }
  }
  return prompt.slice(0, maxChars - 50) + "\n... (truncated)";
}
function buildSystemPrompt(options) {
  const variant = getPromptVariant(options.modelId ?? "");
  const sections = [
    buildIdentitySection(),
    buildEnvironmentSection(options),
    buildBehaviorSection(),
    buildToolFormatSection(variant),
    buildToolReferenceSection()
  ].filter(Boolean);
  const prompt = sections.join("\n\n");
  return truncatePrompt(prompt, variant.maxSystemPromptChars);
}
const OPEN_TAG = "<tool_call>";
const CLOSE_TAG = "</tool_call>";
function parseToolCallJson(raw) {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed.name === "string" && parsed.name) {
      return { name: parsed.name, args: parsed.args ?? {} };
    }
  } catch {
  }
  try {
    let sanitized = raw;
    sanitized = sanitized.replace(/\r\n/g, "\\n");
    sanitized = sanitized.replace(/\n/g, "\\n");
    sanitized = sanitized.replace(/\t/g, "\\t");
    sanitized = sanitized.replace(/,\s*([}\]])/g, "$1");
    const parsed = JSON.parse(sanitized);
    if (typeof parsed.name === "string" && parsed.name) {
      return { name: parsed.name, args: parsed.args ?? {} };
    }
  } catch {
  }
  const nameMatch = raw.match(/"name"\s*:\s*"([^"]+)"/);
  if (!nameMatch) return null;
  const name = nameMatch[1];
  const args = {};
  const pathMatch = raw.match(/"path"\s*:\s*"([^"]*(?:\\.[^"]*)*)"/);
  if (pathMatch) args.path = pathMatch[1].replace(/\\"/g, '"');
  const contentMatch = raw.match(/"content"\s*:\s*"([\s\S]*)"\s*\}\s*\}/);
  if (contentMatch) {
    let content = contentMatch[1];
    content = content.replace(/\\n/g, "\n");
    content = content.replace(/\\t/g, "	");
    content = content.replace(/\\"/g, '"');
    content = content.replace(/\\\\/g, "\\");
    args.content = content;
  }
  const oldContentMatch = raw.match(/"old_content"\s*:\s*"([\s\S]*?)(?:"\s*,\s*"new_content)/);
  if (oldContentMatch) args.old_content = oldContentMatch[1].replace(/\\n/g, "\n").replace(/\\"/g, '"');
  const newContentMatch = raw.match(/"new_content"\s*:\s*"([\s\S]*)"\s*\}\s*\}/);
  if (newContentMatch) args.new_content = newContentMatch[1].replace(/\\n/g, "\n").replace(/\\"/g, '"');
  const commandMatch = raw.match(/"command"\s*:\s*"([^"]*(?:\\.[^"]*)*)"/);
  if (commandMatch) args.command = commandMatch[1].replace(/\\"/g, '"');
  const patternMatch = raw.match(/"pattern"\s*:\s*"([^"]*(?:\\.[^"]*)*)"/);
  if (patternMatch) args.pattern = patternMatch[1];
  const oldPathMatch = raw.match(/"old_path"\s*:\s*"([^"]*(?:\\.[^"]*)*)"/);
  if (oldPathMatch) args.old_path = oldPathMatch[1];
  const newPathMatch = raw.match(/"new_path"\s*:\s*"([^"]*(?:\\.[^"]*)*)"/);
  if (newPathMatch) args.new_path = newPathMatch[1];
  return { name, args };
}
class ToolCallParser {
  state = "normal";
  buffer = "";
  toolBuffer = "";
  _pendingToolCall = null;
  /** Feed a chunk of streamed text. May return text to emit and/or a parsed tool call. */
  feed(chunk) {
    this.buffer += chunk;
    const results = [];
    while (this.buffer.length > 0) {
      if (this.state === "normal") {
        const openIdx = this.buffer.indexOf(OPEN_TAG);
        if (openIdx === -1) {
          const safe = this.safeEmitLength(this.buffer, OPEN_TAG);
          if (safe > 0) {
            results.push({ textToEmit: this.buffer.slice(0, safe), toolCall: null });
            this.buffer = this.buffer.slice(safe);
          }
          break;
        }
        if (openIdx > 0) {
          results.push({ textToEmit: this.buffer.slice(0, openIdx), toolCall: null });
        }
        this.buffer = this.buffer.slice(openIdx + OPEN_TAG.length);
        this.state = "collecting";
        this.toolBuffer = "";
      }
      if (this.state === "collecting") {
        const closeIdx = this.buffer.indexOf(CLOSE_TAG);
        const nextOpenIdx = this.buffer.indexOf(OPEN_TAG);
        let endIdx = -1;
        let skipLength = 0;
        if (closeIdx !== -1 && (nextOpenIdx === -1 || closeIdx <= nextOpenIdx)) {
          endIdx = closeIdx;
          skipLength = CLOSE_TAG.length;
        } else if (nextOpenIdx !== -1) {
          endIdx = nextOpenIdx;
          skipLength = 0;
        }
        if (endIdx === -1) {
          this.toolBuffer += this.buffer;
          this.buffer = "";
          break;
        }
        this.toolBuffer += this.buffer.slice(0, endIdx);
        this.buffer = this.buffer.slice(endIdx + skipLength);
        this.state = "normal";
        const toolCall = parseToolCallJson(this.toolBuffer.trim());
        if (toolCall) {
          results.push({ textToEmit: "", toolCall });
        }
        this.toolBuffer = "";
      }
    }
    return results;
  }
  /** Flush any remaining buffered text (call at end of stream). */
  flush() {
    let remaining = "";
    if (this.state === "collecting") {
      const toolCall = parseToolCallJson(this.toolBuffer.trim());
      if (toolCall) {
        this._pendingToolCall = toolCall;
        remaining = this.buffer;
      } else {
        remaining = this.buffer;
      }
    } else {
      remaining = this.buffer;
    }
    this.buffer = "";
    this.toolBuffer = "";
    this.state = "normal";
    return remaining;
  }
  /** Get any tool call found during flush that wasn't properly closed. */
  getPendingToolCall() {
    const tc = this._pendingToolCall;
    this._pendingToolCall = null;
    return tc;
  }
  safeEmitLength(text, tag) {
    for (let i = 1; i < tag.length && i <= text.length; i++) {
      if (text.endsWith(tag.slice(0, i))) {
        return text.length - i;
      }
    }
    return text.length;
  }
}
function extractToolCallsFromText(text) {
  const results = [];
  const regex = /<tool_call>\s*([\s\S]*?)(?:<\/tool_call>|(?=<tool_call>)|$)/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    const raw = match[1].trim();
    if (!raw) continue;
    const parsed = parseToolCallJson(raw);
    if (parsed) {
      results.push(parsed);
    }
  }
  return results;
}
function stripToolCallBlocks(text) {
  let cleaned = text.replace(/<tool_call>[\s\S]*?<\/tool_call>/g, "");
  cleaned = cleaned.replace(/<tool_call>[\s\S]*?(?=<tool_call>)/g, "");
  cleaned = cleaned.replace(/<tool_call>[\s\S]*$/g, "");
  return cleaned.trim();
}
async function addEntry(threadId, runId, type, content) {
  const id = randomUUID();
  const timestamp = Date.now().toString();
  await prisma.$executeRawUnsafe(
    `INSERT INTO tool_logs (id, thread_id, run_id, type, content, timestamp) VALUES (?, ?, ?, ?, ?, ?)`,
    id,
    threadId,
    runId,
    type,
    content,
    timestamp
  );
}
async function logRequest(threadId, runId, message) {
  await addEntry(threadId, runId, "request", message);
}
async function logResponse(threadId, runId, response) {
  await addEntry(threadId, runId, "response", response);
}
async function logToolCall(threadId, runId, name, args) {
  await addEntry(threadId, runId, "tool_call", JSON.stringify({ name, args }));
}
async function logToolResult(threadId, runId, name, result) {
  await addEntry(threadId, runId, "tool_result", JSON.stringify({ name, ...result }));
}
async function logReRequest(threadId, runId, message) {
  await addEntry(threadId, runId, "re_request", message);
}
async function getLogs(threadId) {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT thread_id, run_id, type, content, timestamp FROM tool_logs WHERE thread_id = ? ORDER BY timestamp ASC`,
    threadId
  );
  const runMap = /* @__PURE__ */ new Map();
  for (const row of rows) {
    let log = runMap.get(row.run_id);
    if (!log) {
      log = { threadId: row.thread_id, runId: row.run_id, entries: [] };
      runMap.set(row.run_id, log);
    }
    log.entries.push({
      timestamp: Number(row.timestamp),
      type: row.type,
      content: row.content
    });
  }
  return Array.from(runMap.values());
}
function describeToolCall(name, args) {
  switch (name) {
    case "write_file":
      return `Create file: ${args.path}`;
    case "edit_file":
      return `Edit file: ${args.path}`;
    case "read_file":
      return `Read file: ${args.path}`;
    case "delete_file":
      return `Delete file: ${args.path}`;
    case "list_files":
      return `List files: ${args.path || "."}`;
    case "grep":
      return `Search for "${args.pattern}" in ${args.path || "."}`;
    case "glob":
      return `Glob: ${args.pattern}`;
    case "rename_file":
      return `Rename: ${args.old_path} → ${args.new_path}`;
    case "create_directory":
      return `Create directory: ${args.path}`;
    case "bash":
      return `Run: ${args.description || args.command}`;
    default:
      return `${name}: ${JSON.stringify(args)}`;
  }
}
const ARG_ALIASES = {
  write_file: {
    body: "content",
    text: "content",
    file_content: "content",
    data: "content",
    file_path: "path",
    filename: "path",
    file_name: "path",
    filepath: "path"
  },
  edit_file: {
    file_path: "path",
    filename: "path",
    filepath: "path",
    old_text: "old_content",
    new_text: "new_content",
    original: "old_content",
    replacement: "new_content",
    search: "old_content",
    replace: "new_content"
  },
  read_file: {
    file_path: "path",
    filename: "path",
    filepath: "path"
  },
  delete_file: {
    file_path: "path",
    filename: "path",
    filepath: "path"
  },
  rename_file: {
    source: "old_path",
    destination: "new_path",
    from: "old_path",
    to: "new_path",
    src: "old_path",
    dest: "new_path"
  },
  grep: {
    query: "pattern",
    search: "pattern",
    regex: "pattern",
    directory: "path",
    dir: "path",
    glob: "include",
    filter: "include"
  },
  bash: {
    cmd: "command",
    shell: "command",
    run: "command",
    desc: "description"
  },
  glob: {
    directory: "path",
    dir: "path"
  },
  create_directory: {
    dir: "path",
    directory: "path",
    folder: "path"
  },
  list_files: {
    dir: "path",
    directory: "path"
  }
};
function normalizeArgs(toolName, args) {
  const aliases = ARG_ALIASES[toolName];
  if (!aliases) return args;
  const normalized = {};
  for (const [key, value] of Object.entries(args)) {
    const canonical = aliases[key];
    if (canonical && !(canonical in args) && !(canonical in normalized)) {
      normalized[canonical] = value;
    } else {
      normalized[key] = value;
    }
  }
  return normalized;
}
async function runToolUse(toolCall, ctx, onApprovalNeeded) {
  const tool = findToolByName(toolCall.name);
  if (!tool) {
    const error = `Unknown tool: ${toolCall.name}. Available tools: ${// Lazy import to avoid circular deps
    (await Promise.resolve().then(() => index)).TOOL_REGISTRY.map((t) => t.name).join(", ")}`;
    return { success: false, output: error };
  }
  const normalizedArgs = normalizeArgs(toolCall.name, toolCall.args);
  const parseResult = tool.inputSchema.safeParse(normalizedArgs);
  if (!parseResult.success) {
    const error = `Invalid input for ${tool.name}: ${parseResult.error.message}`;
    await logToolResult(ctx.threadId, ctx.runId, tool.name, { success: false, output: error });
    ctx.onActivity({ kind: "tool_result", tool: tool.name, summary: `Validation error: ${error.slice(0, 100)}` });
    return { success: false, output: error };
  }
  const validatedInput = parseResult.data;
  const validation = tool.validateInput(validatedInput, ctx);
  if (!validation.valid) {
    await logToolResult(ctx.threadId, ctx.runId, tool.name, { success: false, output: validation.error });
    ctx.onActivity({ kind: "tool_result", tool: tool.name, summary: `Validation error: ${validation.error.slice(0, 100)}` });
    return { success: false, output: validation.error };
  }
  const permission = tool.checkPermissions(validatedInput, ctx);
  if (permission.behavior === "deny") {
    const output = `Permission denied: ${permission.reason}`;
    await logToolResult(ctx.threadId, ctx.runId, tool.name, { success: false, output });
    ctx.onActivity({ kind: "tool_result", tool: tool.name, summary: "Permission denied" });
    return { success: false, output };
  }
  if (permission.behavior === "ask") {
    const description2 = describeToolCall(tool.name, toolCall.args);
    const approved = await onApprovalNeeded({
      tool: tool.name,
      args: toolCall.args,
      description: description2
    });
    if (!approved) {
      const output = "Operation rejected by user.";
      await logToolResult(ctx.threadId, ctx.runId, tool.name, { success: false, output });
      ctx.onActivity({ kind: "tool_result", tool: tool.name, summary: "Rejected by user" });
      return { success: false, output };
    }
  }
  const description = describeToolCall(tool.name, toolCall.args);
  await logToolCall(ctx.threadId, ctx.runId, tool.name, toolCall.args);
  ctx.onActivity({ kind: "tool_call", tool: tool.name, summary: description });
  try {
    const result = await tool.call(validatedInput, ctx);
    await logToolResult(ctx.threadId, ctx.runId, tool.name, result);
    ctx.onActivity({
      kind: "tool_result",
      tool: tool.name,
      summary: result.success ? description : `Failed: ${result.output.slice(0, 100)}`
    });
    return result;
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    const result = { success: false, output: error };
    await logToolResult(ctx.threadId, ctx.runId, tool.name, result);
    ctx.onActivity({ kind: "tool_result", tool: tool.name, summary: `Error: ${error.slice(0, 100)}` });
    return result;
  }
}
function partitionToolCalls(toolCalls) {
  const concurrent = [];
  const serial = [];
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
async function runTools(toolCalls, ctx, onApprovalNeeded) {
  if (toolCalls.length === 0) return [];
  const { concurrent, serial } = partitionToolCalls(toolCalls);
  const results = [];
  if (concurrent.length > 0) {
    const concurrentResults = await Promise.all(
      concurrent.map(async (tc) => ({
        toolCall: tc,
        result: await runToolUse(tc, ctx, onApprovalNeeded)
      }))
    );
    results.push(...concurrentResults);
  }
  for (const tc of serial) {
    if (ctx.signal?.aborted) {
      results.push({
        toolCall: tc,
        result: { success: false, output: "Operation cancelled." }
      });
      continue;
    }
    const result = await runToolUse(tc, ctx, onApprovalNeeded);
    results.push({ toolCall: tc, result });
  }
  return results;
}
const MAX_TOOL_ITERATIONS = 20;
const KEY_FILES = [
  "package.json",
  "tsconfig.json",
  "pyproject.toml",
  "Cargo.toml",
  "go.mod",
  "requirements.txt",
  "composer.json",
  "Gemfile"
];
const MAX_KEY_FILE_CHARS = 4e3;
const IGNORE_DIRS = /* @__PURE__ */ new Set([
  "node_modules",
  ".git",
  ".next",
  "dist",
  "out",
  ".cache",
  "__pycache__",
  ".venv",
  "target",
  ".DS_Store",
  "build"
]);
function buildConversationHistory(baseHistory, systemMessages, turns) {
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
async function readKeyFiles(projectPath) {
  const contents = {};
  let totalChars = 0;
  for (const filename of KEY_FILES) {
    if (totalChars >= MAX_KEY_FILE_CHARS) break;
    try {
      const filePath = join$1(projectPath, filename);
      const content = await readFile(filePath, "utf-8");
      const lines = content.split("\n").slice(0, 50);
      const truncated = lines.join("\n");
      if (totalChars + truncated.length <= MAX_KEY_FILE_CHARS) {
        contents[filename] = truncated;
        totalChars += truncated.length;
      }
    } catch {
    }
  }
  return contents;
}
async function generateFileTree(projectPath, maxDepth = 3) {
  const lines = [];
  async function walk(dir, depth) {
    if (depth > maxDepth || lines.length > 200) return;
    try {
      const entries = await readdir(dir, { withFileTypes: true });
      const sorted = entries.filter((e) => !e.name.startsWith(".") && !IGNORE_DIRS.has(e.name)).sort((a, b) => {
        if (a.isDirectory() && !b.isDirectory()) return -1;
        if (!a.isDirectory() && b.isDirectory()) return 1;
        return a.name.localeCompare(b.name);
      });
      for (const entry of sorted) {
        const rel = relative(projectPath, join$1(dir, entry.name));
        const prefix = "  ".repeat(depth);
        if (entry.isDirectory()) {
          lines.push(`${prefix}${rel}/`);
          await walk(join$1(dir, entry.name), depth + 1);
        } else {
          lines.push(`${prefix}${rel}`);
        }
      }
    } catch {
    }
  }
  await walk(projectPath, 0);
  return lines.join("\n");
}
async function runWithTools(options) {
  const { provider, request, threadId, runId, onChunk, onApprovalNeeded, signal } = options;
  const projectPath = request.projectPath;
  if (!projectPath) {
    return provider.sendMessageStream(request, onChunk, signal);
  }
  const [fileTree, keyFileContents] = await Promise.all([
    generateFileTree(projectPath),
    readKeyFiles(projectPath)
  ]);
  const systemPrompt = buildSystemPrompt({
    projectPath,
    fileTree,
    modelId: request.model,
    keyFileContents
  });
  const systemMessages = [
    { role: "user", content: systemPrompt },
    { role: "assistant", content: "Understood. I have access to file system tools and will use them when needed." }
  ];
  const turns = [];
  let iterations = 0;
  let lastResult = null;
  const ctx = {
    projectPath,
    threadId,
    runId,
    approvalMode: request.approvalMode,
    signal,
    onActivity: (activity) => {
      onChunk({
        type: "activity",
        activity: { kind: activity.kind, tool: activity.tool, summary: activity.summary }
      });
    }
  };
  while (iterations < MAX_TOOL_ITERATIONS) {
    iterations++;
    if (signal?.aborted) break;
    const currentMessage = iterations === 1 ? request.message : turns[turns.length - 1]?.toolResults ?? request.message;
    const history = buildConversationHistory(
      request.history,
      systemMessages,
      iterations === 1 ? [] : turns.slice(0, -1)
      // exclude the last turn (it becomes the message)
    );
    const augmentedRequest = {
      ...request,
      history: iterations === 1 ? [...systemMessages, ...request.history] : history,
      message: currentMessage
    };
    const parser = new ToolCallParser();
    let responseText = "";
    const result = await provider.sendMessageStream(
      augmentedRequest,
      (chunk) => {
        if (chunk.type === "delta" && chunk.text) {
          responseText += chunk.text;
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
      signal
    );
    const remaining = parser.flush();
    if (remaining) {
      const clean = stripToolCallBlocks(remaining);
      if (clean) onChunk({ type: "delta", text: clean });
    }
    lastResult = result;
    const fullParser = new ToolCallParser();
    const fullResults = fullParser.feed(responseText);
    const flushed = fullParser.flush();
    if (flushed) fullResults.push(...fullParser.feed(flushed));
    const pendingFromFull = fullParser.getPendingToolCall();
    let parsedToolCalls = fullResults.filter((r) => r.toolCall !== null).map((r) => r.toolCall);
    if (pendingFromFull) parsedToolCalls.push(pendingFromFull);
    if (parsedToolCalls.length === 0) {
      parsedToolCalls = extractToolCallsFromText(responseText);
    }
    if (parsedToolCalls.length === 0) {
      break;
    }
    const toolResults = await runTools(parsedToolCalls, ctx, onApprovalNeeded);
    const resultsMessage = toolResults.map((tr) => `<tool_result>
${JSON.stringify({ name: tr.toolCall.name, success: tr.result.success, output: tr.result.output })}
</tool_result>`).join("\n");
    const wasRejected = toolResults.some((tr) => !tr.result.success && tr.result.output === "Operation rejected by user.");
    const feedbackMessage = wasRejected ? `${resultsMessage}
Some operations were rejected by the user. Please adjust accordingly.` : resultsMessage;
    const cleanText = stripToolCallBlocks(responseText);
    turns.push({
      assistantText: cleanText,
      toolResults: feedbackMessage
    });
    await logReRequest(threadId, runId, feedbackMessage);
    if (iterations >= MAX_TOOL_ITERATIONS - 2) {
      const warning = `
Note: You have used ${iterations} of ${MAX_TOOL_ITERATIONS} available tool iterations. Please wrap up your work.`;
      turns[turns.length - 1].toolResults += warning;
    }
  }
  onChunk({ type: "done" });
  return {
    text: lastResult?.text ?? "",
    sessionId: lastResult?.sessionId ?? null,
    costUsd: lastResult?.costUsd ?? 0,
    durationMs: lastResult?.durationMs ?? 0
  };
}
const activeStreams = /* @__PURE__ */ new Map();
const pendingApprovals = /* @__PURE__ */ new Map();
const LOG_PREVIEW_LIMIT = 240;
function previewText(value, limit = LOG_PREVIEW_LIMIT) {
  return value.length > limit ? `${value.slice(0, limit)}...` : value;
}
function formatError(err) {
  if (err instanceof Error) {
    return err.stack || `${err.name}: ${err.message}`;
  }
  return String(err);
}
function parseDiffStat(summary) {
  const match = summary.match(/\+(\d+)\s+-\s*(\d+)/);
  if (!match) {
    return null;
  }
  const additions = Number.parseInt(match[1], 10);
  const deletions = Number.parseInt(match[2], 10);
  if (Number.isNaN(additions) || Number.isNaN(deletions)) {
    return null;
  }
  return { additions, deletions };
}
function runGitNumstat(cwd) {
  return new Promise((resolve2) => {
    execFile("git", ["diff", "--numstat"], { cwd }, (error, stdout) => {
      if (error) {
        resolve2(null);
        return;
      }
      const rows = String(stdout || "").split("\n").map((line) => line.trim()).filter(Boolean);
      let additions = 0;
      let deletions = 0;
      for (const row of rows) {
        const [a, d] = row.split("	");
        const addNum = Number.parseInt(a, 10);
        const delNum = Number.parseInt(d, 10);
        if (!Number.isNaN(addNum)) additions += addNum;
        if (!Number.isNaN(delNum)) deletions += delNum;
      }
      resolve2({ additions, deletions });
    });
  });
}
function resolveThreadWorkdir$1(projectPath, threadTitle) {
  if (!projectPath) return null;
  const trimmed = threadTitle.trim();
  if (trimmed) {
    const candidate = join$1(projectPath, trimmed);
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return projectPath;
}
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
      console.log(
        `[message:send] thread=${args.threadId} runId=${args.runId} contentChars=${args.content.length}`
      );
      const userMsg = await prisma.message.create({
        data: {
          threadId: args.threadId,
          role: "user",
          content: args.content
        }
      });
      streamResponse(mainWindow2, args.threadId, args.content, args.runId).catch(
        (err) => {
          console.error(
            `[message:send] streamResponse failed thread=${args.threadId} runId=${args.runId}: ${formatError(err)}`
          );
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
      console.log(`[message:stop] aborting stream thread=${args.threadId}`);
      controller.abort();
      activeStreams.delete(args.threadId);
    } else {
      console.log(`[message:stop] no active stream for thread=${args.threadId}`);
    }
  });
  ipcMain.handle(
    "message:tool-approval-response",
    async (_, args) => {
      const key = `${args.threadId}:${args.runId}`;
      const resolve2 = pendingApprovals.get(key);
      if (resolve2) {
        resolve2(args.approved);
        pendingApprovals.delete(key);
      }
    }
  );
  ipcMain.handle("thread:logs", async (_, args) => {
    return getLogs(args.threadId);
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
  let chunkCount = 0;
  let deltaChars = 0;
  let activityCount = 0;
  let thinkingContent = null;
  let latestDiffStat = null;
  const collectedActivities = [];
  try {
    console.log(
      `[stream] Starting stream for thread=${threadId} runId=${runId} provider=${thread.provider} model=${thread.model} approval=${thread.approvalMode || "suggest"} hasSession=${Boolean(thread.sessionId)} historyMessages=${history.length} projectPath=${thread.project?.path || "none"} nativeTools=${provider.supportsNativeTools}`
    );
    const sendRequest = {
      model: thread.model,
      effort: thread.effort,
      approvalMode: thread.approvalMode || "suggest",
      sessionId: thread.sessionId,
      message: _content,
      history: history.slice(0, -1),
      projectPath: thread.project?.path
    };
    const handleChunk = (chunk) => {
      if (chunk.type === "delta" && chunk.text) {
        chunkCount += 1;
        deltaChars += chunk.text.length;
        if (chunkCount <= 3 || chunkCount % 25 === 0) {
          console.log(
            `[stream] delta thread=${threadId} runId=${runId} chunk=${chunkCount} chars=${chunk.text.length} totalChars=${deltaChars} preview="${previewText(chunk.text)}"`
          );
        }
        mainWindow2.webContents.send(`chat:stream:${threadId}`, {
          runId,
          text: chunk.text
        });
      }
      if (chunk.type === "activity" && chunk.activity) {
        activityCount += 1;
        if (chunk.activity.kind === "thinking") {
          thinkingContent = chunk.activity.summary;
        } else {
          collectedActivities.push(chunk.activity);
        }
        const parsedDiffStat = parseDiffStat(chunk.activity.summary);
        if (parsedDiffStat) {
          latestDiffStat = parsedDiffStat;
        }
        console.log(
          `[stream] activity thread=${threadId} runId=${runId} count=${activityCount} kind=${chunk.activity.kind} tool=${chunk.activity.tool || "n/a"} summary="${previewText(chunk.activity.summary)}"`
        );
        mainWindow2.webContents.send(`chat:activity:${threadId}`, {
          runId,
          activity: chunk.activity
        });
      }
      if (chunk.type === "error" && chunk.error) {
        console.error(
          `[stream] provider-error thread=${threadId} runId=${runId} message="${previewText(chunk.error)}"`
        );
      }
    };
    const handleApproval = (req) => {
      return new Promise((resolve2) => {
        const key = `${threadId}:${runId}`;
        pendingApprovals.set(key, resolve2);
        mainWindow2.webContents.send(`chat:tool-approval:${threadId}`, {
          runId,
          tool: req.tool,
          args: req.args,
          description: req.description
        });
      });
    };
    await logRequest(threadId, runId, _content);
    let result;
    if (provider.supportsNativeTools) {
      result = await provider.sendMessageStream(sendRequest, handleChunk, abortController.signal);
    } else {
      result = await runWithTools({
        provider,
        request: sendRequest,
        threadId,
        runId,
        onChunk: handleChunk,
        onApprovalNeeded: handleApproval,
        signal: abortController.signal
      });
    }
    await logResponse(threadId, runId, result.text);
    console.log(
      `[stream] Complete thread=${threadId} runId=${runId} resultChars=${result.text.length} resultDurationMs=${result.durationMs} totalElapsedMs=${Date.now() - startedAt} chunks=${chunkCount} deltaChars=${deltaChars} activities=${activityCount} hasSession=${Boolean(result.sessionId)}`
    );
    const workdir = resolveThreadWorkdir$1(thread.project?.path, thread.title);
    const gitDiffStat = latestDiffStat ?? (workdir ? await runGitNumstat(workdir) : null);
    const lineAdditions = gitDiffStat?.additions ?? null;
    const lineDeletions = gitDiffStat?.deletions ?? null;
    await prisma.message.create({
      data: {
        threadId,
        role: "assistant",
        content: result.text,
        metadata: JSON.stringify({
          runId,
          provider: thread.provider,
          costUsd: result.costUsd,
          durationMs: result.durationMs,
          lineAdditions,
          lineDeletions,
          ...thinkingContent ? { thinking: thinkingContent } : {},
          ...collectedActivities.length > 0 ? { activities: collectedActivities } : {}
        })
      }
    });
    if (result.sessionId) {
      const latestThread = await prisma.thread.findUnique({
        where: { id: threadId },
        select: { provider: true, model: true }
      });
      const sameConfig = latestThread?.provider === thread.provider && latestThread?.model === thread.model;
      if (sameConfig) {
        await prisma.thread.update({
          where: { id: threadId },
          data: { sessionId: result.sessionId }
        });
        console.log(
          `[stream] session updated thread=${threadId} runId=${runId} sessionId=${result.sessionId}`
        );
      } else {
        console.log(
          `[stream] session update skipped thread=${threadId} runId=${runId} reason=config-changed`
        );
      }
    }
    mainWindow2.webContents.send(`chat:complete:${threadId}`, {
      runId,
      text: result.text,
      sessionId: result.sessionId,
      costUsd: result.costUsd,
      durationMs: Date.now() - startedAt
    });
    console.log(
      `[stream] emitted chat:complete thread=${threadId} runId=${runId} chars=${result.text.length}`
    );
  } catch (err) {
    if (err.name === "AbortError") {
      console.log(
        `[stream] Aborted by user thread=${threadId} runId=${runId} elapsedMs=${Date.now() - startedAt}`
      );
    } else {
      console.error(
        `[stream] Error thread=${threadId} runId=${runId}: ${formatError(err)}`
      );
      mainWindow2.webContents.send(`chat:error:${threadId}`, {
        runId,
        message: String(err instanceof Error ? err.message : err)
      });
      console.log(`[stream] emitted chat:error thread=${threadId} runId=${runId}`);
    }
  } finally {
    activeStreams.delete(threadId);
    mainWindow2.webContents.send(`chat:done:${threadId}`, { runId });
    console.log(
      `[stream] emitted chat:done thread=${threadId} runId=${runId} elapsedMs=${Date.now() - startedAt} activeStreams=${activeStreams.size}`
    );
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
  ipcMain.handle("provider:catalog", async () => {
    const providers2 = getAllProviders();
    await Promise.all(
      providers2.map(async (provider) => {
        if (provider instanceof LmStudioProvider) {
          try {
            await provider.refreshCatalogModels();
          } catch {
          }
        }
      })
    );
    return providers2.map((p) => p.getCatalogEntry());
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
  ipcMain.handle(
    "provider:get-config",
    async (_, args) => {
      if (args.provider === "lm-studio") {
        return { baseUrl: getLmStudioBaseUrl() };
      }
      return {};
    }
  );
  ipcMain.handle(
    "provider:set-config",
    async (_, args) => {
      if (args.provider === "lm-studio") {
        const next = setLmStudioBaseUrl(args.config.baseUrl || "");
        return { baseUrl: next };
      }
      return {};
    }
  );
}
const terminalSessions = /* @__PURE__ */ new Map();
let nextTerminalSessionId = 1;
function resolveTerminalShellCandidates() {
  if (process.platform === "win32") {
    return [{ command: "cmd.exe", args: [], label: "cmd" }];
  }
  const envShell = process.env.SHELL?.trim();
  const candidates = [
    envShell,
    "/bin/zsh",
    "/bin/bash",
    "/bin/sh"
  ].filter((value) => Boolean(value && value.length > 0));
  return candidates.map((command) => ({
    command,
    args: ["-i"],
    label: command.split("/").pop() || "shell"
  }));
}
function sendTerminalEvent(targetWebContentsId, channel, payload) {
  const target = webContents.fromId(targetWebContentsId);
  if (!target || target.isDestroyed()) return;
  target.send(channel, payload);
}
function launchDetached(command, args, cwd) {
  try {
    spawn(command, args, { cwd, detached: true, stdio: "ignore" }).unref();
    return true;
  } catch {
    return false;
  }
}
function openInEditor(path, editor) {
  const cliCandidates = {
    vscode: ["code", "code-insiders"],
    cursor: ["cursor"],
    windsurf: ["windsurf"],
    zed: ["zed"]
  };
  if (process.platform === "darwin") {
    const appNames = {
      vscode: "Visual Studio Code",
      cursor: "Cursor",
      windsurf: "Windsurf",
      zed: "Zed"
    };
    if (launchDetached("open", ["-a", appNames[editor], path])) {
      return;
    }
  }
  const candidates = cliCandidates[editor] || [];
  for (const command of candidates) {
    if (launchDetached(command, [path], path)) {
      return;
    }
  }
  if (process.platform === "win32") {
    for (const command of candidates) {
      if (launchDetached("cmd.exe", ["/c", "start", "", command, path], path)) {
        return;
      }
    }
  }
  throw new Error("Nao foi possivel abrir o editor selecionado.");
}
function commandExists(command) {
  const whichCmd = process.platform === "win32" ? "where" : "which";
  const res = spawnSync(whichCmd, [command], { stdio: "ignore" });
  return res.status === 0;
}
function appExistsMac(appName) {
  const appFile = `${appName}.app`;
  const systemPath = join$1("/Applications", appFile);
  const userPath = join$1(homedir(), "Applications", appFile);
  return existsSync(systemPath) || existsSync(userPath);
}
function listInstalledEditors() {
  const allEditors = [
    {
      id: "vscode",
      label: "VS Code",
      commands: ["code", "code-insiders"],
      macApps: ["Visual Studio Code", "Visual Studio Code - Insiders"]
    },
    {
      id: "cursor",
      label: "Cursor",
      commands: ["cursor"],
      macApps: ["Cursor"]
    },
    {
      id: "windsurf",
      label: "Windsurf",
      commands: ["windsurf"],
      macApps: ["Windsurf"]
    },
    {
      id: "zed",
      label: "Zed",
      commands: ["zed"],
      macApps: ["Zed"]
    }
  ];
  return allEditors.filter((editor) => {
    const hasCli = editor.commands.some((cmd) => commandExists(cmd));
    if (hasCli) return true;
    if (process.platform !== "darwin") return false;
    return editor.macApps.some((appName) => appExistsMac(appName));
  }).map((editor) => ({ id: editor.id, label: editor.label }));
}
function registerShellHandlers() {
  ipcMain.handle("shell:open-path", async (_, args) => {
    await shell.openPath(args.path);
  });
  ipcMain.handle("shell:open-url", async (_, args) => {
    await shell.openExternal(args.url);
  });
  ipcMain.handle(
    "shell:open-in-editor",
    async (_, args) => {
      if (!existsSync(args.path)) {
        throw new Error(`Diretorio nao encontrado: ${args.path}`);
      }
      const installedEditors = listInstalledEditors();
      const isInstalled = installedEditors.some((item) => item.id === args.editor);
      if (!isInstalled) {
        throw new Error("Editor selecionado nao esta instalado.");
      }
      openInEditor(args.path, args.editor);
      return { ok: true };
    }
  );
  ipcMain.handle("shell:list-installed-editors", async () => {
    return listInstalledEditors();
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
  ipcMain.handle("terminal:create", async (event, args) => {
    if (!existsSync(args.path)) {
      throw new Error(`Diretorio do projeto nao encontrado: ${args.path}`);
    }
    const shellCandidates = resolveTerminalShellCandidates();
    let proc = null;
    let selectedLabel = "shell";
    let lastError = null;
    for (const candidate of shellCandidates) {
      try {
        proc = pty.spawn(candidate.command, candidate.args, {
          cols: 120,
          rows: 30,
          cwd: args.path,
          env: { ...process.env, TERM: "xterm-256color" },
          name: "xterm-color"
        });
        selectedLabel = candidate.label;
        break;
      } catch (error) {
        lastError = error;
      }
    }
    if (!proc) {
      const reason = lastError instanceof Error ? lastError.message : String(lastError);
      throw new Error(`Falha ao iniciar shell PTY. Motivo: ${reason}`);
    }
    const sessionId = nextTerminalSessionId++;
    const ownerWebContentsId = event.sender.id;
    terminalSessions.set(sessionId, {
      process: proc,
      webContentsId: ownerWebContentsId
    });
    proc.onData((chunk) => {
      sendTerminalEvent(
        ownerWebContentsId,
        `terminal:data:${sessionId}`,
        chunk
      );
    });
    proc.onExit(({ exitCode }) => {
      sendTerminalEvent(ownerWebContentsId, `terminal:exit:${sessionId}`, {
        code: exitCode
      });
      terminalSessions.delete(sessionId);
    });
    return { sessionId, shell: selectedLabel };
  });
  ipcMain.handle(
    "terminal:resize",
    async (_, args) => {
      const session = terminalSessions.get(args.sessionId);
      if (!session) return { ok: false };
      session.process.resize(args.cols, args.rows);
      return { ok: true };
    }
  );
  ipcMain.handle(
    "terminal:write",
    async (_, args) => {
      const session = terminalSessions.get(args.sessionId);
      if (!session) return { ok: false };
      session.process.write(args.data);
      return { ok: true };
    }
  );
  ipcMain.handle("terminal:kill", async (_, args) => {
    const session = terminalSessions.get(args.sessionId);
    if (!session) return { ok: false };
    session.process.kill();
    terminalSessions.delete(args.sessionId);
    return { ok: true };
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
    const { readFile: readFile2 } = await import("node:fs/promises");
    try {
      const content = await readFile2(args.path, "utf-8");
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
function runGit(args, cwd) {
  return new Promise((resolve2) => {
    execFile("git", args, { cwd }, (error, stdout, stderr) => {
      if (error) {
        const code = typeof error.code === "number" ? error.code : 1;
        resolve2({ code, stdout: String(stdout || ""), stderr: String(stderr || "") });
        return;
      }
      resolve2({ code: 0, stdout: String(stdout || ""), stderr: String(stderr || "") });
    });
  });
}
async function getGitSummary(path) {
  const isRepoCheck = await runGit(["rev-parse", "--is-inside-work-tree"], path);
  if (isRepoCheck.code !== 0 || isRepoCheck.stdout.trim() !== "true") {
    return { isRepo: false, currentBranch: null, branches: [], resolvedPath: null };
  }
  const currentBranchRes = await runGit(["branch", "--show-current"], path);
  const currentBranch = currentBranchRes.code === 0 ? currentBranchRes.stdout.trim() || null : null;
  const branchListRes = await runGit(
    ["for-each-ref", "--format=%(refname:short)", "refs/heads"],
    path
  );
  const branches = branchListRes.code === 0 ? branchListRes.stdout.split("\n").map((line) => line.trim()).filter(Boolean) : [];
  return {
    isRepo: true,
    currentBranch,
    branches,
    resolvedPath: path
  };
}
async function resolveThreadWorkdir(threadId) {
  const thread = await prisma.thread.findUnique({
    where: { id: threadId },
    include: { project: { select: { path: true } } }
  });
  if (!thread?.project?.path) {
    return null;
  }
  const projectPath = thread.project.path;
  const threadFolderName = thread.title.trim();
  const candidates = [];
  if (threadFolderName) {
    const candidate = join$1(projectPath, threadFolderName);
    if (existsSync(candidate)) {
      candidates.push(candidate);
    }
  }
  candidates.push(projectPath);
  for (const candidate of candidates) {
    const check = await runGit(["rev-parse", "--is-inside-work-tree"], candidate);
    if (check.code === 0 && check.stdout.trim() === "true") {
      return candidate;
    }
  }
  return candidates[0] ?? null;
}
function registerGitHandlers() {
  ipcMain.handle("git:summary", async (_, args) => {
    return getGitSummary(args.path);
  });
  ipcMain.handle("git:summary-for-thread", async (_, args) => {
    const workdir = await resolveThreadWorkdir(args.threadId);
    if (!workdir) {
      return { isRepo: false, currentBranch: null, branches: [], resolvedPath: null };
    }
    const summary = await getGitSummary(workdir);
    return {
      ...summary,
      resolvedPath: workdir
    };
  });
  ipcMain.handle(
    "git:checkout-branch",
    async (_, args) => {
      const result = await runGit(["checkout", args.branch], args.path);
      if (result.code !== 0) {
        throw new Error(result.stderr.trim() || "Falha ao trocar branch.");
      }
      return getGitSummary(args.path);
    }
  );
  ipcMain.handle(
    "git:checkout-branch-for-thread",
    async (_, args) => {
      const workdir = await resolveThreadWorkdir(args.threadId);
      if (!workdir) {
        throw new Error("Diretorio da thread nao encontrado.");
      }
      const result = await runGit(["checkout", args.branch], workdir);
      if (result.code !== 0) {
        throw new Error(result.stderr.trim() || "Falha ao trocar branch.");
      }
      const summary = await getGitSummary(workdir);
      return {
        ...summary,
        resolvedPath: workdir
      };
    }
  );
}
function registerAllHandlers(mainWindow2) {
  registerProjectHandlers();
  registerThreadHandlers();
  registerMessageHandlers(mainWindow2);
  registerDialogHandlers();
  registerProviderHandlers();
  registerShellHandlers();
  registerGitHandlers();
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
    title: "Duck Code",
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
  app.setName("Duck Code");
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
