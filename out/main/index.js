import { app, ipcMain, BrowserWindow, dialog, shell } from "electron";
import { join } from "path";
import { PrismaClient } from "@prisma/client";
import { randomBytes, createCipheriv, createDecipheriv, scryptSync } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join as join$1 } from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
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
          effort: args.effort ?? "medium"
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
  }
];
const CATALOG$2 = PROVIDER_CATALOG.find((p) => p.id === "claude");
class ClaudeProvider {
  getCatalogEntry() {
    return CATALOG$2;
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
const CATALOG$1 = PROVIDER_CATALOG.find((p) => p.id === "openai");
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
    return CATALOG$1;
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
const CATALOG = PROVIDER_CATALOG.find((p) => p.id === "codex");
class CodexCliProvider {
  getCatalogEntry() {
    return CATALOG;
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
      const proc = spawn("codex", ["--version"], {
        stdio: ["ignore", "pipe", "pipe"]
      });
      let stdout = "";
      proc.stdout.on("data", (chunk) => {
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
  async sendMessageStream(request, onChunk, signal) {
    const startedAt = Date.now();
    const args = [
      "exec",
      "--json",
      "-m",
      request.model,
      "--dangerously-bypass-approvals-and-sandbox"
    ];
    return new Promise((resolve, reject) => {
      const proc = spawn("codex", args, {
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env }
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
      let threadId = null;
      let stderrOutput = "";
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
          console.log("[codex-cli] event:", event.type);
          if (event.type === "thread.started" && event.thread_id) {
            threadId = event.thread_id;
          }
          if (event.type === "item.completed") {
            const item = event.item;
            if (item?.type === "agent_message" && typeof item.text === "string") {
              fullText += item.text;
              onChunk({ type: "delta", text: item.text });
            }
          }
          if (event.type === "message.delta") {
            const delta = event.delta;
            if (delta) {
              fullText += delta;
              onChunk({ type: "delta", text: delta });
            }
          }
        }
      });
      proc.stderr.on("data", (chunk) => {
        stderrOutput += chunk.toString();
      });
      proc.on("error", (err) => {
        onChunk({ type: "error", error: err.message });
        reject(new Error(`Codex CLI erro: ${err.message}`));
      });
      proc.on("close", (code) => {
        if (lineBuffer.trim()) {
          try {
            const event = JSON.parse(lineBuffer.trim());
            if (event.type === "item.completed") {
              const item = event.item;
              if (item?.type === "agent_message" && typeof item.text === "string") {
                fullText += item.text;
                onChunk({ type: "delta", text: item.text });
              }
            }
          } catch {
          }
        }
        if (code !== 0 && code !== null) {
          const errMsg = stderrOutput.trim() || `Codex CLI saiu com codigo ${code}`;
          onChunk({ type: "error", error: errMsg });
          reject(new Error(errMsg));
          return;
        }
        onChunk({ type: "done" });
        resolve({
          text: fullText,
          sessionId: threadId,
          costUsd: 0,
          durationMs: Date.now() - startedAt
        });
      });
    });
  }
}
const providers = {
  claude: new ClaudeProvider(),
  openai: new OpenAiProvider(),
  codex: new CodexCliProvider()
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
    where: { id: threadId }
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
        sessionId: thread.sessionId,
        message: _content,
        history: history.slice(0, -1)
        // exclude the just-added user message (it's in `message`)
      },
      (chunk) => {
        if (chunk.type === "delta" && chunk.text) {
          mainWindow2.webContents.send(`chat:stream:${threadId}`, {
            runId,
            text: chunk.text
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
function registerAllHandlers(mainWindow2) {
  registerProjectHandlers();
  registerThreadHandlers();
  registerMessageHandlers(mainWindow2);
  registerDialogHandlers();
  registerProviderHandlers();
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
