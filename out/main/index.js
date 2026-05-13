import { app, ipcMain, BrowserWindow, dialog, shell, webContents } from "electron";
import { join } from "path";
import { PrismaClient } from "@prisma/client";
import { execFile, spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, mkdirSync, watch } from "node:fs";
import { join as join$1, resolve, relative, extname } from "node:path";
import { z } from "zod";
import { stat, readFile, access, mkdir, writeFile, unlink, readdir, rename } from "node:fs/promises";
import { minimatch } from "minimatch";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
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
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS benchmark_runs (
      id TEXT PRIMARY KEY,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      providers_json TEXT NOT NULL,
      profiles_json TEXT NOT NULL,
      total_models INTEGER NOT NULL,
      total_cases INTEGER NOT NULL,
      succeeded_cases INTEGER NOT NULL,
      failed_cases INTEGER NOT NULL,
      recommended_provider TEXT,
      recommended_model TEXT
    )
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS benchmark_results (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      profile TEXT NOT NULL,
      duration_ms INTEGER NOT NULL,
      output_chars INTEGER NOT NULL,
      chars_per_second REAL NOT NULL,
      success INTEGER NOT NULL,
      error TEXT,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (run_id) REFERENCES benchmark_runs(id) ON DELETE CASCADE
    )
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS idx_benchmark_results_run_id ON benchmark_results(run_id)
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS idx_benchmark_results_profile ON benchmark_results(profile)
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS idx_benchmark_runs_created_at ON benchmark_runs(created_at)
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
    execFile("git", ["diff", "--numstat", "--", "."], { cwd }, (error, stdout) => {
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
const PROVIDER_CATALOG = [
  {
    id: "lm-studio",
    label: "LM Studio (Local)",
    default_model: "local-model",
    models: [{ label: "Modelo local", value: "local-model" }],
    capabilities: {
      supports_effort: false,
      requires_api_key: false
    }
  },
  {
    id: "ollama",
    label: "Ollama (Local)",
    default_model: "local-model",
    models: [{ label: "Modelo local", value: "local-model" }],
    capabilities: {
      supports_effort: false,
      requires_api_key: false
    }
  }
];
const PROVIDER_CONFIG_FILE = "provider-config.json";
const DEFAULT_LM_STUDIO_BASE_URL = "http://127.0.0.1:1234";
const DEFAULT_OLLAMA_BASE_URL = "http://localhost:11434";
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
function getOllamaBaseUrl() {
  const store = readStore();
  return normalizeBaseUrl(store.ollamaBaseUrl || DEFAULT_OLLAMA_BASE_URL);
}
function setOllamaBaseUrl(url) {
  const normalized = normalizeBaseUrl(url);
  const store = readStore();
  store.ollamaBaseUrl = normalized;
  writeStore(store);
  return normalized;
}
class OpenAICompatibleProvider {
  toolMode = "openai";
  getCatalogEntry() {
    return this.catalog;
  }
  // Default stubs — subclasses override as needed
  async getApiKeyStatus() {
    return { configured: true, last4: null };
  }
  async setApiKey(_apiKey) {
  }
  async removeApiKey() {
  }
  async testApiKey(_apiKey) {
    const modelValues = await this.fetchModelValues();
    if (modelValues.length === 0) {
      return `Conexao OK, mas nenhum modelo disponivel.`;
    }
    return `Conexao OK (${modelValues.length} modelo(s) disponivel(is)).`;
  }
  // ---------------------------------------------------------------------------
  // Streaming — handles content, reasoning, and tool_calls
  // ---------------------------------------------------------------------------
  async sendMessageStream(request, onChunk, signal) {
    const startedAt = Date.now();
    const baseUrl = this.getBaseUrl();
    const messages = this.buildMessages(request);
    const body = {
      model: request.model,
      messages,
      stream: true
    };
    if (request.tools && request.tools.length > 0) {
      body.tools = request.tools;
    }
    {
      const promptChars = messages.reduce(
        (n, m) => n + (typeof m.content === "string" ? m.content.length : JSON.stringify(m.content ?? "").length),
        0
      );
      const toolChars = body.tools ? JSON.stringify(body.tools).length : 0;
      console.log(
        `[provider] model=${request.model} messages=${messages.length} promptChars=${promptChars} toolChars=${toolChars} approxTokens=${Math.round((promptChars + toolChars) / 4)}`
      );
    }
    const res = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...this.getAuthHeaders()
      },
      body: JSON.stringify(body),
      signal
    });
    if (!res.ok) {
      throw new Error(`API erro: ${await res.text()}`);
    }
    let fullText = "";
    let thinkingText = "";
    let thinkingEmitted = false;
    let responseId = null;
    let harmonyBuffer = "";
    let harmonyMode = false;
    let firstContentSeen = false;
    let bufferedContent = "";
    const HARMONY_TOKEN_RE = /<\|[^>|]*\|>\s*(?:commentary|analysis|final|assistant|user|system|tool|developer)?\b[ \t:]*/gi;
    const HARMONY_BARE_TOKEN_RE = /<\|[^>|]*\|>/g;
    const HARMONY_PARTIAL_RE = /<\|[^>|]*$/;
    const sanitizeHarmony = (chunk) => {
      let buf = harmonyBuffer + chunk;
      buf = buf.replace(HARMONY_TOKEN_RE, "");
      buf = buf.replace(HARMONY_BARE_TOKEN_RE, "");
      const partial = buf.match(HARMONY_PARTIAL_RE);
      if (partial) {
        harmonyBuffer = partial[0];
        return buf.slice(0, -partial[0].length);
      }
      harmonyBuffer = "";
      return buf;
    };
    const stripHarmonyFinal = (s) => {
      return s.replace(HARMONY_TOKEN_RE, "").replace(HARMONY_BARE_TOKEN_RE, "").replace(/\bfunctions\.[a-z_]+\??/gi, "").replace(/\b(?:commentary|analysis|final)\b\s*[:]?/gi, "").replace(/\bbash\}/g, "").replace(/^[\s,;:.}]+/, "").trim();
    };
    const toolCallMap = /* @__PURE__ */ new Map();
    const reader = res.body?.getReader();
    if (!reader) {
      throw new Error("Resposta de stream invalida.");
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
          if (!firstContentSeen) {
            firstContentSeen = true;
            if (delta.content.trimStart().startsWith("<|")) {
              harmonyMode = true;
            }
          }
          if (harmonyMode) {
            bufferedContent += delta.content;
          } else {
            const cleaned = sanitizeHarmony(delta.content);
            if (cleaned) {
              fullText += cleaned;
              onChunk({ type: "delta", text: cleaned });
            }
          }
        }
        if (delta.tool_calls) {
          for (const tc of delta.tool_calls) {
            const existing = toolCallMap.get(tc.index);
            if (existing) {
              if (tc.function?.arguments) {
                existing.arguments += tc.function.arguments;
              }
            } else {
              toolCallMap.set(tc.index, {
                id: tc.id ?? `call_${tc.index}`,
                name: tc.function?.name ?? "",
                arguments: tc.function?.arguments ?? ""
              });
            }
          }
        }
      }
    }
    if (thinkingText.trim() && !thinkingEmitted) {
      onChunk({
        type: "activity",
        activity: { kind: "thinking", summary: thinkingText.trim() }
      });
    }
    if (harmonyMode && bufferedContent) {
      console.log(`[harmony] raw buffered (${bufferedContent.length} chars):`, bufferedContent.slice(0, 800));
      let candidate = null;
      const finalMatches = [
        ...bufferedContent.matchAll(
          /<\|channel\|>\s*final\s*<\|message\|>([\s\S]*?)(?=<\|end\|>|<\|return\|>|<\|start\|>|<\|channel\|>|$)/gi
        )
      ];
      if (finalMatches.length > 0) {
        candidate = finalMatches[finalMatches.length - 1][1];
      } else {
        const allMessages = [
          ...bufferedContent.matchAll(
            /<\|message\|>([\s\S]*?)(?=<\|end\|>|<\|return\|>|<\|channel\|>|<\|start\|>|$)/gi
          )
        ];
        if (allMessages.length > 0) {
          candidate = allMessages[allMessages.length - 1][1];
        }
      }
      if (!candidate) candidate = bufferedContent;
      const cleaned = stripHarmonyFinal(candidate);
      if (cleaned) {
        fullText = cleaned;
        onChunk({ type: "delta", text: cleaned });
      } else {
        console.warn(`[harmony] empty after sanitization — buffer was: ${bufferedContent.slice(0, 200)}`);
        const fallback = "[modelo retornou resposta vazia ou malformada — tente de novo]";
        fullText = fallback;
        onChunk({ type: "delta", text: fallback });
      }
    } else {
      if (harmonyBuffer) {
        const flushed = harmonyBuffer.replace(HARMONY_TOKEN_RE, "");
        if (flushed) {
          fullText += flushed;
          onChunk({ type: "delta", text: flushed });
        }
        harmonyBuffer = "";
      }
      const cleanedFull = stripHarmonyFinal(fullText);
      if (cleanedFull !== fullText) {
        fullText = cleanedFull;
      }
    }
    const toolCalls = [];
    for (const [, acc] of toolCallMap) {
      if (acc.name) {
        toolCalls.push({
          id: acc.id,
          type: "function",
          function: { name: acc.name, arguments: acc.arguments }
        });
      }
    }
    if (!fullText && toolCalls.length === 0 && thinkingText.trim()) {
      const fallback = thinkingText.trim();
      fullText = fallback;
      onChunk({ type: "delta", text: fallback });
    } else if (!fullText && toolCalls.length === 0) {
      const fallback = "[modelo retornou resposta vazia — tente novamente ou troque de modelo]";
      fullText = fallback;
      onChunk({ type: "delta", text: fallback });
    }
    return {
      text: fullText,
      sessionId: responseId,
      costUsd: 0,
      durationMs: Date.now() - startedAt,
      toolCalls: toolCalls.length > 0 ? toolCalls : void 0
    };
  }
  // ---------------------------------------------------------------------------
  // Build messages array — preserves user, assistant (with tool_calls), and tool roles
  // ---------------------------------------------------------------------------
  buildMessages(request) {
    const messages = [];
    if (request.systemPrompt) {
      messages.push({ role: "system", content: request.systemPrompt });
    }
    for (const msg of request.history) {
      if (msg.role === "tool") {
        messages.push({
          role: "tool",
          content: msg.content,
          tool_call_id: msg.tool_call_id
        });
      } else if (msg.role === "assistant" && msg.tool_calls && msg.tool_calls.length > 0) {
        messages.push({
          role: "assistant",
          content: msg.content || null,
          tool_calls: msg.tool_calls
        });
      } else {
        messages.push({ role: msg.role, content: msg.content });
      }
    }
    if (request.message) {
      messages.push({ role: "user", content: request.message });
    }
    return messages;
  }
}
const BASE_CATALOG$1 = PROVIDER_CATALOG.find(
  (p) => p.id === "lm-studio"
);
class LmStudioProvider extends OpenAICompatibleProvider {
  catalog = BASE_CATALOG$1;
  getBaseUrl() {
    return getLmStudioBaseUrl();
  }
  getAuthHeaders() {
    return {};
  }
  async refreshCatalogModels() {
    const modelValues = await this.fetchModelValues();
    if (modelValues.length === 0) {
      return;
    }
    const models = modelValues.map((value) => ({ label: value, value }));
    this.catalog = {
      ...BASE_CATALOG$1,
      default_model: models[0]?.value || BASE_CATALOG$1.default_model,
      models
    };
  }
  async testApiKey(_apiKey) {
    const modelValues = await this.fetchModelValues();
    if (modelValues.length === 0) {
      return "Conexao com LM Studio OK, mas nenhum modelo LLM disponivel no endpoint /api/v1/models.";
    }
    return `Conexao com LM Studio OK (${modelValues.length} modelo(s) disponivel(is)).`;
  }
  async fetchModelValues() {
    const baseUrl = this.getBaseUrl();
    const res = await fetch(`${baseUrl}/api/v1/models`);
    if (!res.ok) {
      throw new Error(`Falha ao consultar modelos no LM Studio: ${await res.text()}`);
    }
    const json = await res.json();
    const nativeModels = Array.isArray(json.models) ? json.models : [];
    const fromNative = this.extractFromNativeModels(nativeModels);
    if (fromNative.length > 0) {
      return fromNative;
    }
    const fromCompat = (Array.isArray(json.data) ? json.data : []).filter((item) => {
      const t = (item.type || "").toLowerCase();
      return t !== "embedding" && t !== "embeddings";
    }).map((item) => item.id || item.key || item.name || item.display_name || "").map((value) => value.trim()).filter((value) => Boolean(value));
    if (fromCompat.length > 0) {
      return [...new Set(fromCompat)];
    }
    return [];
  }
  extractFromNativeModels(models) {
    if (!Array.isArray(models) || models.length === 0) return [];
    const values = models.filter((item) => (item.type || "llm") !== "embedding").map(
      (item) => item.key || item.selected_variant || item.id || item.name || item.display_name || item.variants?.[0] || ""
    ).map((value) => value.trim()).filter((value) => Boolean(value));
    return [...new Set(values)];
  }
}
const BASE_CATALOG = PROVIDER_CATALOG.find(
  (p) => p.id === "ollama"
);
class OllamaProvider extends OpenAICompatibleProvider {
  catalog = BASE_CATALOG;
  getBaseUrl() {
    return getOllamaBaseUrl();
  }
  getAuthHeaders() {
    return {};
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
  async testApiKey(_apiKey) {
    const modelValues = await this.fetchModelValues();
    if (modelValues.length === 0) {
      return "Conexao com Ollama OK, mas nenhum modelo disponivel. Use 'ollama pull <modelo>' para baixar.";
    }
    return `Conexao com Ollama OK (${modelValues.length} modelo(s) disponivel(is)).`;
  }
  async fetchModelValues() {
    const baseUrl = this.getBaseUrl();
    const res = await fetch(`${baseUrl}/api/tags`);
    if (!res.ok) {
      throw new Error(
        `Falha ao consultar modelos no Ollama: ${await res.text()}`
      );
    }
    const json = await res.json();
    return (json.models || []).map((m) => m.name || m.model || "").filter((v) => Boolean(v));
  }
}
const providers = {
  "lm-studio": new LmStudioProvider(),
  ollama: new OllamaProvider()
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
const MAX_SYSTEM_PROMPT_CHARS = 6e3;
function buildIdentitySection() {
  return `You are a skilled software engineer working directly in the user's project. You write clean, well-structured, production-quality code. You think before you act: understand the existing codebase before making changes, and explain your reasoning.

# LANGUAGE — TOP PRIORITY
You MUST reply in the SAME language as the user's most recent message. Detect language from the user's last message and match it.
- User writes Portuguese → you reply in Portuguese (pt-BR).
- User writes English → you reply in English.
- User writes Spanish → you reply in Spanish.
This applies to: chat text, ask_user question text, ask_user option labels and descriptions, and ALL human-readable text you produce. It does NOT apply to code or file contents.
Example: if the user wrote "Quero melhorar meu jogo da velha", reply STARTS in Portuguese — never "What would you like..." Always "O que você gostaria..." or similar.`;
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
  return parts.length > 0 ? `# Environment
${parts.join("\n")}` : "";
}
function buildBehaviorSection(_mode) {
  const rules = [
    "The Environment section above lists the current project files and, for small projects, their contents. ALWAYS consult it first — a project may already exist even if this chat is new. Do NOT create files that already appear in the file tree; read and edit them instead",
    "Before editing a file, ALWAYS read it first with read_file to understand its content and context. Read each file AT MOST ONCE per turn — if read_file returns a 'File unchanged since last read' stub, STOP re-reading and proceed with the earlier content",
    "EXECUTE the user's request — do not merely inspect and summarize. If the user asks to improve, beautify, refactor, add, or change something, you MUST produce the corresponding edit_file / write_file calls. Saying 'no changes performed' when the user asked for changes is a FAILURE",
    "When the user requests aesthetic improvements ('mais bonito', 'prettier', 'improve style', 'melhorar'), DO NOT ask 'what would you like'. Instead make CONCRETE OPINIONATED CHANGES: pick a modern color palette, add box-shadow, rounded corners, smooth hover/transition, better typography (system-ui or Inter), spacing, and apply them via edit_file. Then briefly summarize what you changed",
    "Don't ask vague open-ended questions like 'what would you like me to work on'. The user already told you in their last message — re-read it and act. Use ask_user only for genuine forks where 2 distinct approaches both make sense",
    "When extracting old_content for edit_file, COPY ONLY the file content — read_file shows lines as '<spaces><number>\\t<content>'. The '<spaces><number>\\t' part is METADATA shown by the tool. Strip it. old_content must contain ONLY what is actually in the file",
    "Do NOT use placeholder text like 'Option1', 'Option2', 'TODO' in ask_user options or anywhere else. If you don't know what to ask, don't call ask_user — just proceed or describe the choice in plain text",
    "NEVER emit special control tokens like '<|channel|>', '<|message|>', or '<|end|>' in your reply. Reply with normal prose and tool calls only",
    "Do not create files unless they are necessary. Prefer editing existing files over creating new ones",
    'Choose descriptive file names based on content — for a snake game use "snake-game.html", not "index.html" or "game.html"',
    "For multi-file projects, ensure all cross-file references are correct (CSS links, JS imports, etc.)",
    'Write COMPLETE, functional code — never use placeholders like "// TODO", "// ...", or "// add code here"',
    "Follow the coding style that already exists in the project (indentation, naming conventions, patterns)",
    "When asked to create something new, use write_file — do NOT just show code in your response",
    "After completing tool operations, provide a clear summary of what was accomplished",
    "Be careful not to introduce security vulnerabilities"
  ];
  rules.push("When you receive tool results, continue working or summarize results — do NOT repeat the tool call");
  rules.push('Every tool argument must be sent as the exact JSON type the schema declares. String fields are JSON strings (e.g. "hello\\nworld"). NEVER send arrays or objects where a string is expected');
  rules.push("If a tool returns an error, read the message carefully and retry with corrected arguments on the next turn. NEVER repeat the exact same failing call");
  rules.push('For edit_file: pass old_content as the EXACT text from read_file output (omit the "N<tab>" line-number prefix), including indentation and whitespace');
  rules.push("ask_user requires 1-4 questions; each question needs 1-4 options. 2-4 options is ideal; 1 is OK for simple confirmations");
  return `# Rules

${rules.map((r) => `- ${r}`).join("\n")}`;
}
function buildOpenAIToolExamplesSection() {
  return `# Tool Usage Examples

read_file({"path": "src/index.ts"})
read_file({"path": "logs/huge.log", "offset": 0, "limit": 500})

write_file({"path": "src/new-file.ts", "content": "export const x = 1;\\n"})

edit_file({"path": "src/a.ts", "old_content": "const x = 1", "new_content": "const x = 2"})
edit_file({"path": "src/a.ts", "old_content": "foo", "new_content": "bar", "replace_all": true})
edit_file({"path": "README.md", "start_line": 10, "end_line": 12, "content": "## Title\\nBody."})

glob({"pattern": "**/*.ts"})
grep({"pattern": "TODO", "include": "**/*.ts"})

ask_user({"questions": [{"question": "Which approach?", "header": "Approach", "options": [{"label": "REST"}, {"label": "GraphQL"}]}]})
ask_user({"questions": [{"question": "Proceed?", "options": [{"label": "Yes"}, {"label": "No"}]}]})

todo_write({"todos": [{"content": "Read script.js", "status": "in_progress"}, {"content": "Add AI logic", "status": "pending"}]})`;
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
  const sections = [
    buildIdentitySection(),
    buildEnvironmentSection(options),
    buildBehaviorSection(),
    buildOpenAIToolExamplesSection()
  ].filter(Boolean);
  const prompt = sections.join("\n\n");
  return truncatePrompt(prompt, MAX_SYSTEM_PROMPT_CHARS);
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
const fileStateMap = /* @__PURE__ */ new Map();
function recordFileRead(absolutePath, content, mtimeMs) {
  fileStateMap.set(absolutePath, { content, timestamp: mtimeMs });
}
function getFileState(absolutePath) {
  return fileStateMap.get(absolutePath);
}
function updateFileState(absolutePath, content, mtimeMs) {
  fileStateMap.set(absolutePath, { content, timestamp: mtimeMs });
}
function clearFileState() {
  fileStateMap.clear();
}
function toStringValue(v) {
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return v.map((x) => String(x)).join("\n");
  if (v && typeof v === "object") {
    const obj = v;
    if (typeof obj.text === "string") return obj.text;
    if (typeof obj.content === "string") return obj.content;
    if (typeof obj.value === "string") return obj.value;
  }
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return v;
}
function coerceString(schema) {
  return z.preprocess(toStringValue, schema);
}
function toBooleanValue(v) {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") {
    if (v === 1) return true;
    if (v === 0) return false;
  }
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    if (s === "true" || s === "yes" || s === "y" || s === "1" || s === "on") return true;
    if (s === "false" || s === "no" || s === "n" || s === "0" || s === "off") return false;
  }
  return v;
}
function coerceBoolean(schema) {
  return z.preprocess(toBooleanValue, schema);
}
function toNumberValue(v) {
  if (typeof v === "number") return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return v;
}
function coerceNumber(schema) {
  return z.preprocess(toNumberValue, schema);
}
const servedReads = /* @__PURE__ */ new Map();
function clearReadDedup() {
  servedReads.clear();
}
const MAX_READ_CHARS = 5e4;
const MAX_FILE_SIZE$2 = 1048576;
const BLOCKED_PATHS = [
  "/dev/zero",
  "/dev/random",
  "/dev/urandom",
  "/dev/stdin",
  "/dev/null",
  "/dev/fd/",
  "/proc/self/fd/"
];
function isBlockedPath(path) {
  return BLOCKED_PATHS.some((bp) => path.startsWith(bp));
}
const ReadFileTool = buildTool({
  name: "read_file",
  description: `Read file contents with line numbers (cat -n format).
- Returns content with line numbers starting at 1
- Use offset and limit for targeted reads of large files
- You MUST read a file before editing it`,
  inputSchema: z.object({
    path: coerceString(z.string().min(1)).describe("File path relative to the project root"),
    offset: coerceNumber(z.number().int().positive().optional()).describe("Line number to start reading from (1-based)"),
    limit: coerceNumber(z.number().int().positive().optional()).describe("Maximum number of lines to return")
  }),
  isReadOnly: true,
  isConcurrencySafe: true,
  call: async (input, ctx) => {
    const resolved = resolveSafe(ctx.projectPath, input.path);
    if (isBlockedPath(resolved)) {
      return { success: false, output: `Blocked: ${input.path} is a device/special path that cannot be read.` };
    }
    let fileStat;
    try {
      fileStat = await stat(resolved);
    } catch {
      return { success: false, output: `File not found: ${input.path}` };
    }
    if (!fileStat.isFile()) {
      return { success: false, output: `${input.path} is not a file. Use list_files for directories.` };
    }
    if (fileStat.size > MAX_FILE_SIZE$2) {
      return {
        success: false,
        output: `File too large: ${input.path} is ${(fileStat.size / 1024 / 1024).toFixed(1)} MB. Maximum is 1 MB. Use offset/limit to read specific sections.`
      };
    }
    const dedupKey = `${resolved}::${input.offset ?? 0}::${input.limit ?? 0}`;
    const prev = servedReads.get(dedupKey);
    const cached = getFileState(resolved);
    if (prev && prev.mtimeMs === fileStat.mtimeMs && cached && cached.timestamp === fileStat.mtimeMs) {
      return {
        success: false,
        output: `STOP RE-READING. File '${input.path}' was already read in this conversation and has not changed. The content is in the earlier read_file tool_result above — scroll up and use it. Do NOT call read_file on this path again. Your next action MUST be either edit_file/write_file (to apply changes), another tool on a DIFFERENT path, or a final text answer to the user. Calling read_file again will fail.`,
        metadata: { dedup: true, totalLines: cached.content.split("\n").length }
      };
    }
    const raw = await readFile(resolved, "utf-8");
    recordFileRead(resolved, raw, fileStat.mtimeMs);
    servedReads.set(dedupKey, { mtimeMs: fileStat.mtimeMs, offset: input.offset, limit: input.limit });
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
- You MUST read existing files with read_file before overwriting them
- Choose descriptive file names based on the content (e.g. snake-game.html, not index.html)
- NEVER create documentation files (*.md) or README files unless explicitly requested`,
  inputSchema: z.object({
    path: coerceString(z.string().min(1)).describe("File path relative to the project root"),
    content: coerceString(z.string()).describe("The content to write to the file (a single JSON string; use \\n for newlines)")
  }),
  isReadOnly: false,
  isConcurrencySafe: false,
  validateInput: (input, ctx) => {
    if (input.content.length > MAX_FILE_SIZE$1) {
      return { valid: false, error: `File content exceeds ${MAX_FILE_SIZE$1} bytes limit` };
    }
    return { valid: true };
  },
  call: async (input, ctx) => {
    const resolved = resolveSafe(ctx.projectPath, input.path);
    let fileExists = false;
    try {
      await access(resolved);
      fileExists = true;
    } catch {
    }
    if (fileExists) {
      const fileState = getFileState(resolved);
      if (!fileState) {
        return {
          success: false,
          output: "File already exists but has not been read yet. Use read_file first to see current content, or use edit_file for targeted changes. This prevents accidental overwrites."
        };
      }
      try {
        const currentStat = await stat(resolved);
        if (currentStat.mtimeMs > fileState.timestamp + 1e3) {
          return {
            success: false,
            output: "File was modified since last read (possibly by an external process). Use read_file to see the current content before overwriting."
          };
        }
      } catch {
      }
    }
    const parentDir = resolve(resolved, "..");
    await mkdir(parentDir, { recursive: true });
    await writeFile(resolved, input.content, "utf-8");
    const newStat = await stat(resolved);
    updateFileState(resolved, input.content, newStat.mtimeMs);
    const action = fileExists ? "overwritten" : "created";
    return {
      success: true,
      output: `File ${action}: ${input.path} (${input.content.length} chars)`,
      metadata: { chars: input.content.length }
    };
  }
});
const MAX_FILE_SIZE = 1048576;
function normalizeQuotes(s) {
  return s.replace(/[\u2018\u2019\u201A\u201B]/g, "'").replace(/[\u201C\u201D\u201E\u201F]/g, '"');
}
function stripLineNumberPrefix(s) {
  const lines = s.split("\n");
  if (lines.length === 0) return s;
  const prefixed = lines.filter((l) => /^\s*\d+\t/.test(l)).length;
  if (prefixed >= Math.max(1, Math.ceil(lines.length / 2))) {
    return lines.map((l) => l.replace(/^\s*\d+\t/, "")).join("\n");
  }
  return s;
}
function findActualString(content, searchString) {
  if (content.includes(searchString)) {
    return searchString;
  }
  const dePrefixed = stripLineNumberPrefix(searchString);
  if (dePrefixed !== searchString && content.includes(dePrefixed)) {
    return dePrefixed;
  }
  const normalizedContent = normalizeQuotes(content);
  const normalizedSearch = normalizeQuotes(searchString);
  if (normalizedContent.includes(normalizedSearch)) {
    const idx = normalizedContent.indexOf(normalizedSearch);
    return content.slice(idx, idx + normalizedSearch.length);
  }
  const originalLines = content.split("\n");
  const searchLinesTrimmed = searchString.split("\n").map((l) => l.trimEnd());
  const window = searchLinesTrimmed.length;
  if (window > 0 && window <= originalLines.length) {
    outer: for (let i = 0; i <= originalLines.length - window; i++) {
      for (let k = 0; k < window; k++) {
        if (originalLines[i + k].trimEnd() !== searchLinesTrimmed[k]) continue outer;
      }
      return originalLines.slice(i, i + window).join("\n");
    }
  }
  return null;
}
function countOccurrences(content, search) {
  let count = 0;
  let idx = 0;
  while ((idx = content.indexOf(search, idx)) !== -1) {
    count++;
    idx += 1;
  }
  return count;
}
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
    path: coerceString(z.string().min(1)).describe("File path relative to the project root"),
    // Mode 1: string replace
    old_content: coerceString(z.string()).optional().describe("Exact text to find and replace (verbatim, no line-number prefix)"),
    new_content: coerceString(z.string()).optional().describe("Replacement text"),
    replace_all: coerceBoolean(z.boolean().optional()).describe("Replace all occurrences (default false)"),
    // Mode 2: line range
    start_line: coerceNumber(z.number().int().positive().optional()).describe("Start line number (1-based) for line-range replacement"),
    end_line: coerceNumber(z.number().int().positive().optional()).describe("End line number (inclusive) for line-range replacement"),
    content: coerceString(z.string()).optional().describe("New content to replace the line range with")
  }),
  isReadOnly: false,
  isConcurrencySafe: false,
  validateInput: (input, ctx) => {
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
    if (hasStringMode && input.old_content === input.new_content) {
      return { valid: false, error: "old_content and new_content are identical. No changes needed." };
    }
    const resolved = resolveSafe(ctx.projectPath, input.path);
    const fileState = getFileState(resolved);
    if (!fileState) {
      return {
        valid: false,
        error: "File has not been read yet. Use read_file first before editing. This ensures you see the current content and prevents accidental overwrites."
      };
    }
    return { valid: true };
  },
  call: async (input, ctx) => {
    const resolved = resolveSafe(ctx.projectPath, input.path);
    const fileState = getFileState(resolved);
    if (fileState) {
      try {
        const currentStat = await stat(resolved);
        if (currentStat.mtimeMs > fileState.timestamp + 1e3) {
          return {
            success: false,
            output: "File was modified since last read (possibly by an external process or a previous edit). Use read_file to see the current content before editing."
          };
        }
      } catch {
      }
    }
    const current = await readFile(resolved, "utf-8");
    let updated;
    if (input.old_content !== void 0) {
      const oldContent = input.old_content;
      const newContent = input.new_content;
      const actualString = findActualString(current, oldContent);
      if (!actualString) {
        const firstLine = oldContent.split("\n")[0]?.slice(0, 60) ?? "";
        let hint = "";
        if (firstLine) {
          for (let n = Math.min(firstLine.length, 30); n >= 8; n -= 4) {
            const probe = firstLine.slice(0, n).trim();
            if (!probe) break;
            const idx = current.indexOf(probe);
            if (idx >= 0) {
              const start = Math.max(0, idx - 40);
              const end = Math.min(current.length, idx + probe.length + 80);
              hint = `
A partial match was found. Actual text in file near that location:
---
${current.slice(start, end)}
---
Copy from here verbatim (no line-number prefix).`;
              break;
            }
          }
        }
        return {
          success: false,
          output: `old_content not found in file '${input.path}'. Common causes: (1) you copied the line-number prefix '\\d+\\t' from read_file — remove it; (2) whitespace/indentation differs; (3) you paraphrased instead of copying. Re-read the file and copy the exact characters, OR use line-range mode (start_line/end_line/content).` + hint
        };
      }
      if (input.replace_all) {
        updated = current.split(actualString).join(newContent);
      } else {
        const occurrences = countOccurrences(current, actualString);
        if (occurrences > 1) {
          return {
            success: false,
            output: `Found ${occurrences} occurrences of old_content in the file. Include more surrounding context to uniquely identify the target, or set replace_all: true to replace all occurrences.`
          };
        }
        updated = current.replace(actualString, newContent);
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
    const newStat = await stat(resolved);
    updateFileState(resolved, updated, newStat.mtimeMs);
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
    try {
      const dirStat = await stat(searchDir);
      if (!dirStat.isDirectory()) {
        return { success: false, output: `${input.path || "."} is not a directory.` };
      }
    } catch {
      return { success: false, output: `Directory not found: ${input.path || "."}` };
    }
    const entries = [];
    await collectFiles(searchDir, ctx.projectPath, 0, entries);
    const allMatched = entries.filter((e) => minimatch(e.relativePath, input.pattern, { dot: false })).sort((a, b) => b.mtime - a.mtime);
    const truncated = allMatched.length > MAX_RESULTS$1;
    const matched = allMatched.slice(0, MAX_RESULTS$1);
    if (matched.length === 0) {
      return { success: true, output: "No files matched the pattern." };
    }
    let output = matched.map((e) => e.relativePath).join("\n");
    if (truncated) {
      output += `
... (truncated: showing ${MAX_RESULTS$1} of ${allMatched.length} matches)`;
    }
    return {
      success: true,
      output,
      metadata: { matchCount: matched.length, totalMatches: allMatched.length, truncated }
    };
  }
});
const MAX_RESULTS = 100;
const MAX_LINE_LENGTH = 2e3;
const MAX_COLUMNS = 500;
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
- Default mode "files_with_matches" returns only file paths (most token-efficient)
- Use output_mode "content" for matching lines with file paths and line numbers
- Use output_mode "count" for match counts per file
- Use context (-A, -B, -C) to show surrounding lines (only with output_mode "content")
- Use case_insensitive for case-insensitive matching
- Use include to filter by file pattern (e.g. "*.ts", "*.{ts,tsx}")
- Supports full regex syntax`,
  inputSchema: z.object({
    pattern: z.string().min(1).describe("Regex pattern to search for"),
    path: z.string().optional().describe("Directory to search in (defaults to project root)"),
    include: z.string().optional().describe("File pattern filter (e.g. '*.ts', '*.{html,css}')"),
    output_mode: z.enum(["content", "files_with_matches", "count"]).optional().describe("Output mode: 'files_with_matches' (default, just paths), 'content' (matching lines), 'count' (match counts)"),
    case_insensitive: z.boolean().optional().describe("Case insensitive search"),
    context: z.number().int().nonnegative().optional().describe("Lines of context before and after each match (requires output_mode 'content')")
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
function buildRipgrepArgs(input, searchDir) {
  const mode = input.output_mode ?? "files_with_matches";
  const args = [];
  switch (mode) {
    case "files_with_matches":
      args.push("--files-with-matches");
      break;
    case "count":
      args.push("--count");
      break;
    case "content":
    default:
      args.push("-n", "-H");
      if (input.context && input.context > 0) {
        args.push("-C", String(input.context));
      }
      break;
  }
  args.push(
    "--hidden",
    "--no-messages",
    "--color=never",
    `--max-columns=${MAX_COLUMNS}`
    // prevent base64/minified lines from flooding output
  );
  if (input.case_insensitive) {
    args.push("-i");
  }
  if (input.include) {
    args.push("--glob", input.include);
  }
  for (const dir of EXCLUDED_DIRS) {
    args.push("--glob", `!${dir}`);
  }
  if (input.pattern.startsWith("-")) {
    args.push("-e", input.pattern);
  } else {
    args.push(input.pattern);
  }
  args.push(searchDir);
  return args;
}
async function runRipgrep(input, searchDir, ctx) {
  const args = buildRipgrepArgs(input, searchDir);
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
  if (input.case_insensitive) {
    args.push("-i");
  }
  if (input.include) {
    args.push(`--include=${input.include}`);
  }
  for (const dir of EXCLUDED_DIRS) {
    args.push(`--exclude-dir=${dir}`);
  }
  if (input.context && input.context > 0) {
    args.push(`-C${input.context}`);
  }
  if (input.pattern.startsWith("-")) {
    args.push("-e", input.pattern);
  } else {
    args.push(input.pattern);
  }
  args.push(searchDir);
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
const optionSchema = z.object({
  label: z.string().min(1).max(80).describe("Display text (1-5 words). Concise and descriptive."),
  description: z.string().max(200).optional().describe("Short explanation of the trade-off or implication. Optional.")
});
const questionSchema = z.object({
  question: z.string().min(1).describe("The full question, ending with '?'. Clear and specific."),
  header: z.string().max(12).optional().describe("Very short chip label (max 12 chars), e.g. 'Library', 'Auth'."),
  options: z.array(optionSchema).min(1).max(4).describe("1-4 choices. Ideally 2-4; 1 is allowed for confirmation."),
  multiSelect: coerceBoolean(z.boolean().default(false)).describe("true = user can pick multiple.")
});
function normalizeToRich(v) {
  if (!v || typeof v !== "object" || Array.isArray(v)) return v;
  const obj = v;
  if (Array.isArray(obj.questions)) return v;
  if (typeof obj.question === "string") {
    const rawOptions = obj.options;
    let options = [];
    if (Array.isArray(rawOptions)) {
      options = rawOptions.map((opt) => {
        if (typeof opt === "string") return { label: opt };
        if (opt && typeof opt === "object") {
          const o = opt;
          return {
            label: typeof o.label === "string" ? o.label : String(o.label ?? o.value ?? ""),
            description: typeof o.description === "string" ? o.description : void 0
          };
        }
        return { label: String(opt) };
      });
    } else if (typeof rawOptions === "string") {
      options = [{ label: rawOptions }];
    }
    if (options.length === 0) {
      options = [{ label: "Yes" }, { label: "No" }];
    }
    return {
      questions: [
        {
          question: obj.question,
          header: typeof obj.header === "string" ? obj.header : void 0,
          options,
          multiSelect: obj.multiSelect ?? false
        }
      ]
    };
  }
  return v;
}
const AskUserTool = buildTool({
  name: "ask_user",
  description: `Ask the user a question (or up to 4 related questions) when you need clarification, a decision, or a preference.

WHEN TO USE:
- Instructions are ambiguous and you need to clarify before proceeding
- You need the user to choose between distinct approaches
- You need a preference that wasn't specified
- You want to confirm before a significant change

WHEN NOT TO USE:
- Questions you can answer yourself by reading the code
- Trivial confirmations (use your best judgment)

AFTER CALLING: include the question in your response and STOP making tool calls. Wait for the user's answer in their next message.

SHAPE:
  { questions: [ { question, header?, options: [{label, description?}], multiSelect? } ] }
- 1 to 4 questions per call.
- Each question: 1 to 4 options. 2-4 is ideal; 1 is OK for a simple "proceed?".
- Option labels should be 1-5 words. Add short description when the trade-off isn't obvious.
- Legacy shape {question, options: string[]} is still accepted.`,
  inputSchema: z.preprocess(
    normalizeToRich,
    z.object({
      questions: z.array(questionSchema).min(1).max(4).describe("1-4 questions to ask the user")
    })
  ),
  isReadOnly: true,
  isConcurrencySafe: false,
  call: async (input, ctx) => {
    const parsed = input;
    const blocks = parsed.questions.map((q, qi) => {
      const headerChip = q.header ? `[${q.header}] ` : "";
      const optsText = q.options.map((o, oi) => {
        const desc = o.description ? ` — ${o.description}` : "";
        return `  ${oi + 1}. ${o.label}${desc}`;
      }).join("\n");
      const multi = q.multiSelect ? " (multi-select)" : "";
      return `Q${parsed.questions.length > 1 ? qi + 1 : ""}: ${headerChip}${q.question}${multi}
${optsText}`;
    });
    const summary = blocks.join("\n\n");
    ctx.onActivity({
      kind: "ask_user",
      tool: "ask_user",
      summary: `Question for user:
${summary}`,
      data: { questions: parsed.questions }
    });
    return {
      success: true,
      output: `Questions sent to user:
${summary}

IMPORTANT: Include the question(s) in your text response and STOP making tool calls. Wait for the user's reply.`
    };
  }
});
let currentTodos = [];
function clearTodos() {
  currentTodos = [];
}
const TodoWriteTool = buildTool({
  name: "todo_write",
  description: `Create or update a structured task list to track your progress on complex work.

Use this tool when:
- Working on a multi-step task (3+ steps)
- You need to organize and track progress on complex work
- The user provides multiple things to do
- You want to show the user what you're working on

How to use:
- Write the FULL todo list each time (not incremental updates)
- Mark exactly ONE task as "in_progress" at a time
- Mark tasks as "completed" immediately after finishing them
- Use imperative form for content (e.g., "Fix authentication bug")

Do NOT use for:
- Single, simple tasks
- Trivial tasks completable in <3 steps
- Purely conversational responses`,
  inputSchema: z.object({
    todos: z.array(z.object({
      content: z.string().min(1).describe("Task description in imperative form (e.g., 'Fix the login bug')"),
      status: z.enum(["pending", "in_progress", "completed"]).describe("Task status")
    })).min(1).describe("The complete todo list (replaces the previous list)")
  }),
  isReadOnly: true,
  // doesn't modify filesystem
  isConcurrencySafe: false,
  validateInput: (input) => {
    const inProgress = input.todos.filter((t) => t.status === "in_progress");
    if (inProgress.length > 1) {
      return { valid: false, error: "Only one task can be in_progress at a time." };
    }
    return { valid: true };
  },
  call: async (input, ctx) => {
    [...currentTodos];
    const allDone = input.todos.every((t) => t.status === "completed");
    currentTodos = allDone ? [] : input.todos;
    const summary = input.todos.map((t) => {
      const icon = t.status === "completed" ? "[x]" : t.status === "in_progress" ? "[>]" : "[ ]";
      return `${icon} ${t.content}`;
    }).join("\n");
    ctx.onActivity({
      kind: "info",
      summary: `Todo list:
${summary}`
    });
    const completed = input.todos.filter((t) => t.status === "completed").length;
    const pending = input.todos.filter((t) => t.status === "pending").length;
    const inProgress = input.todos.filter((t) => t.status === "in_progress").length;
    return {
      success: true,
      output: `Todo list updated: ${completed} completed, ${inProgress} in progress, ${pending} pending.${allDone ? " All tasks completed — list cleared." : ""}`,
      metadata: { total: input.todos.length, completed, inProgress, pending }
    };
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
  BashTool,
  AskUserTool,
  TodoWriteTool
];
function findToolByName(name) {
  return TOOL_REGISTRY.find((t) => t.name === name);
}
const index = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  TOOL_REGISTRY,
  findToolByName
}, Symbol.toStringTag, { value: "Module" }));
function zodToOpenAITool(tool) {
  const jsonSchema = z.toJSONSchema(tool.inputSchema);
  delete jsonSchema.$schema;
  return {
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: jsonSchema
    }
  };
}
function buildOpenAIToolSchemas() {
  return TOOL_REGISTRY.map(zodToOpenAITool);
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
function pathToStr(path) {
  if (path.length === 0) return "(root)";
  return path.map((p) => typeof p === "number" ? `[${p}]` : p).join(".");
}
function extractReceived(issue) {
  if (typeof issue.received === "string") return issue.received;
  if (typeof issue.message === "string") {
    const m = issue.message.match(/received\s+(\w+)/i);
    if (m) return m[1];
  }
  return "unknown";
}
function renderIssue(issue) {
  const path = issue.path ?? [];
  const field = pathToStr(path);
  const code = issue.code;
  switch (code) {
    case "invalid_type": {
      const exp = String(issue.expected ?? "");
      const received = extractReceived(issue);
      if (exp === "string" && received === "array") {
        return `Field '${field}' must be a string. You sent an array — join the lines with \\n into a single string and retry.`;
      }
      if (exp === "string" && received === "object") {
        return `Field '${field}' must be a string. You sent an object — send the raw text as a JSON string instead.`;
      }
      if (exp === "boolean") {
        return `Field '${field}' must be a boolean (true or false). You sent ${received}.`;
      }
      if (exp === "number") {
        return `Field '${field}' must be a number. You sent ${received}.`;
      }
      if (exp === "array") {
        return `Field '${field}' must be an array. You sent ${received}.`;
      }
      return `Field '${field}' must be ${exp} but you sent ${received}.`;
    }
    case "too_small": {
      const origin = String(issue.origin ?? "");
      const minimum = String(issue.minimum ?? "");
      if (origin === "array") {
        return `Field '${field}' must have at least ${minimum} item${minimum === "1" ? "" : "s"}. ${minimum === "1" ? "Provide one value or omit the field." : `Provide ${minimum} or more items, or omit the field if optional.`}`;
      }
      if (origin === "string") {
        return `Field '${field}' must be at least ${minimum} character(s) long.`;
      }
      if (origin === "number") {
        return `Field '${field}' must be >= ${minimum}.`;
      }
      return `Field '${field}' is too small (minimum: ${minimum}).`;
    }
    case "too_big": {
      const origin = String(issue.origin ?? "");
      const maximum = String(issue.maximum ?? "");
      if (origin === "array") {
        return `Field '${field}' may have at most ${maximum} item(s). Remove extras and retry.`;
      }
      if (origin === "string") {
        return `Field '${field}' is too long (max ${maximum} chars).`;
      }
      return `Field '${field}' is too big (max: ${maximum}).`;
    }
    case "invalid_format":
      return `Field '${field}' has an invalid format: ${String(issue.message ?? "")}.`;
    case "unrecognized_keys": {
      const keys = issue.keys ?? [];
      return `Unknown field(s) ${keys.map((k) => `'${k}'`).join(", ")}. Check the tool schema and retry without them.`;
    }
    case "invalid_union":
      return `Field '${field}' doesn't match any accepted shape. ${String(issue.message ?? "")}`;
    case "custom":
      return `Field '${field}': ${String(issue.message ?? "")}`;
    default:
      return `Field '${field}': ${String(issue.message ?? code)}`;
  }
}
function formatZodError(err) {
  const issues = err.issues;
  if (!issues || issues.length === 0) return "Invalid input (no issues reported).";
  if (issues.length === 1) return renderIssue(issues[0]);
  return `${issues.length} validation errors:
` + issues.map((i, idx) => `  ${idx + 1}. ${renderIssue(i)}`).join("\n");
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
    const humanMsg = formatZodError(parseResult.error);
    const error = `Invalid arguments for ${tool.name}. ${humanMsg}`;
    await logToolResult(ctx.threadId, ctx.runId, tool.name, { success: false, output: error });
    ctx.onActivity({ kind: "tool_result", tool: tool.name, summary: `Validation error: ${humanMsg.slice(0, 120)}` });
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
  "Gemfile",
  "README.md",
  "index.html",
  "main.py",
  "main.ts",
  "main.js",
  "index.ts",
  "index.js"
];
const MAX_KEY_FILE_CHARS = 8e3;
const SMART_INCLUDE_EXTS = /* @__PURE__ */ new Set([".html", ".css", ".js", ".ts", ".tsx", ".jsx", ".py", ".md", ".json"]);
const MAX_SMART_INCLUDE_FILES = 6;
const MAX_SMART_INCLUDE_CHARS_PER_FILE = 3e3;
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
async function readKeyFiles(projectPath) {
  const contents = {};
  let totalChars = 0;
  for (const filename of KEY_FILES) {
    if (totalChars >= MAX_KEY_FILE_CHARS) break;
    try {
      const filePath = join$1(projectPath, filename);
      const content = await readFile(filePath, "utf-8");
      const lines = content.split("\n").slice(0, 80);
      const truncated = lines.join("\n");
      if (totalChars + truncated.length <= MAX_KEY_FILE_CHARS) {
        contents[filename] = truncated;
        totalChars += truncated.length;
      }
    } catch {
    }
  }
  try {
    const rootEntries = (await readdir(projectPath, { withFileTypes: true })).filter((e) => !e.name.startsWith(".") && !IGNORE_DIRS.has(e.name));
    const rootFiles = rootEntries.filter((e) => e.isFile()).map((e) => e.name).filter((n) => SMART_INCLUDE_EXTS.has(extname(n).toLowerCase()));
    const totalSourceFiles = rootFiles.length;
    if (totalSourceFiles > 0 && totalSourceFiles <= MAX_SMART_INCLUDE_FILES) {
      for (const name of rootFiles) {
        if (totalChars >= MAX_KEY_FILE_CHARS) break;
        if (contents[name]) continue;
        try {
          const fp = join$1(projectPath, name);
          const st = await stat(fp);
          if (!st.isFile() || st.size > 1e5) continue;
          const raw = await readFile(fp, "utf-8");
          const clipped = raw.length > MAX_SMART_INCLUDE_CHARS_PER_FILE ? `${raw.slice(0, MAX_SMART_INCLUDE_CHARS_PER_FILE)}
... (truncated, use read_file for full content)` : raw;
          if (totalChars + clipped.length <= MAX_KEY_FILE_CHARS) {
            contents[name] = clipped;
            totalChars += clipped.length;
          }
        } catch {
        }
      }
    }
  } catch {
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
function detectLanguage(text) {
  if (!text) return "unknown";
  const lower = text.toLowerCase();
  if (/[ãõáâéêíóôúç]/.test(lower)) return "pt";
  if (/\b(você|gostaria|jogo|melhorar|fazer|quero|preciso|favor|criar|mudar|arquivo|projeto|estilo|deixe|coloque|por que)\b/.test(lower)) return "pt";
  if (/\b(tienes|gracias|por favor|cómo|qué|hola|necesito|quiero)\b/.test(lower)) return "es";
  if (/\b(the|please|would|could|create|change|file|project|style|make)\b/.test(lower)) return "en";
  return "unknown";
}
const LANGUAGE_NAME = {
  pt: "Portuguese (pt-BR)",
  en: "English",
  es: "Spanish"
};
const threadApprovals = /* @__PURE__ */ new Map();
function getThreadApprovals(threadId) {
  let set = threadApprovals.get(threadId);
  if (!set) {
    set = /* @__PURE__ */ new Set();
    threadApprovals.set(threadId, set);
  }
  return set;
}
async function runWithOpenAITools(options) {
  const { provider, request, threadId, runId, onChunk, onApprovalNeeded, signal } = options;
  const projectPath = request.projectPath;
  if (!projectPath) {
    return provider.sendMessageStream(request, onChunk, signal);
  }
  clearFileState();
  clearTodos();
  clearReadDedup();
  const [fileTree, keyFileContents] = await Promise.all([
    generateFileTree(projectPath),
    readKeyFiles(projectPath)
  ]);
  const systemPrompt = buildSystemPrompt({
    projectPath,
    fileTree,
    modelId: request.model
  });
  const tools = buildOpenAIToolSchemas();
  const systemMessages = [
    { role: "user", content: systemPrompt },
    { role: "assistant", content: "Understood. I have access to file system tools and will use them when needed." }
  ];
  const loopHistory = [
    ...systemMessages,
    ...request.history
  ];
  let iterations = 0;
  let lastResult = null;
  console.log(`[openai-tools] approvalMode="${request.approvalMode}" threadId=${threadId}`);
  const approvedTools = getThreadApprovals(threadId);
  const approvalKey = (req) => {
    const path = typeof req.args?.path === "string" && req.args.path || typeof req.args?.file_path === "string" && req.args.file_path || "*";
    return `${req.tool}::${path}`;
  };
  const smartApproval = async (req) => {
    const key = approvalKey(req);
    if (approvedTools.has(key)) return true;
    const approved = await onApprovalNeeded(req);
    if (approved) approvedTools.add(key);
    return approved;
  };
  const recentSignatures = [];
  const LOOP_THRESHOLD = 3;
  const signatureOf = (call) => `${call.name}::${JSON.stringify(call.args ?? {})}`;
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
      content: `[system reminder] The user is writing in ${LANGUAGE_NAME[detectedLang]}. Your reply text and any ask_user labels MUST be in ${LANGUAGE_NAME[detectedLang]}. Do NOT switch language.`
    });
    loopHistory.push({
      role: "assistant",
      content: detectedLang === "pt" ? "Entendido. Vou responder em português." : detectedLang === "es" ? "Entendido. Responderé en español." : "Understood. I will reply in English."
    });
  }
  while (iterations < MAX_TOOL_ITERATIONS) {
    iterations++;
    if (signal?.aborted) break;
    const currentMessage = iterations === 1 ? request.message : "";
    const augmentedRequest = {
      ...request,
      history: loopHistory,
      message: currentMessage,
      tools
    };
    let result;
    try {
      result = await provider.sendMessageStream(
        augmentedRequest,
        (chunk) => {
          if (chunk.type !== "done") {
            onChunk(chunk);
          }
        },
        signal
      );
    } catch (err) {
      throw err;
    }
    lastResult = result;
    if (!result.toolCalls || result.toolCalls.length === 0) {
      break;
    }
    const parsedToolCalls = [];
    const parseFailures = {};
    for (let i = 0; i < result.toolCalls.length; i++) {
      const tc = result.toolCalls[i];
      const rawArgs = tc.function.arguments ?? "";
      try {
        const args = JSON.parse(rawArgs);
        parsedToolCalls.push({ name: tc.function.name, args });
      } catch (err) {
        const preview = rawArgs.length > 200 ? `${rawArgs.slice(0, 200)}...` : rawArgs;
        parseFailures[i] = `Tool arguments were not valid JSON. Parser said: ${err instanceof Error ? err.message : String(err)}. Received: ${preview || "(empty string)"}. Send a single JSON object matching the tool schema and retry.`;
        parsedToolCalls.push({ name: tc.function.name, args: { __parseError: true } });
      }
    }
    const toolResults = [];
    for (let i = 0; i < parsedToolCalls.length; i++) {
      if (parseFailures[i]) {
        toolResults.push({
          toolCall: parsedToolCalls[i],
          result: { success: false, output: parseFailures[i] }
        });
        ctx.onActivity({
          kind: "tool_result",
          tool: parsedToolCalls[i].name,
          summary: `Parse error: ${parseFailures[i].slice(0, 120)}`
        });
      } else {
        const [execResult] = await runTools([parsedToolCalls[i]], ctx, smartApproval);
        toolResults.push(execResult);
      }
    }
    if (iterations === 1 && currentMessage) {
      loopHistory.push({ role: "user", content: currentMessage });
    }
    loopHistory.push({
      role: "assistant",
      content: result.text || "",
      tool_calls: result.toolCalls
    });
    for (let i = 0; i < toolResults.length; i++) {
      const tr = toolResults[i];
      const toolCallId = result.toolCalls[i]?.id ?? `call_${i}`;
      const resultContent = tr.result.success ? tr.result.output : `Error: ${tr.result.output}`;
      loopHistory.push({
        role: "tool",
        content: resultContent,
        tool_call_id: toolCallId
      });
    }
    await logReRequest(threadId, runId, `[OpenAI tools] ${toolResults.length} tool(s) executed`);
    for (const tc of parsedToolCalls) {
      recentSignatures.push(signatureOf(tc));
    }
    const windowSize = LOOP_THRESHOLD * 2;
    if (recentSignatures.length > windowSize) {
      recentSignatures.splice(0, recentSignatures.length - windowSize);
    }
    const tail = recentSignatures.slice(-LOOP_THRESHOLD);
    const isLooping = tail.length === LOOP_THRESHOLD && tail.every((s) => s === tail[0]);
    const last2 = recentSignatures.slice(-2);
    const isReadLoop = last2.length === 2 && last2[0] === last2[1] && last2[0].startsWith("read_file::");
    if (isLooping || isReadLoop) {
      const [loopName] = tail[0].split("::");
      console.warn(`[openai-tools] Loop detected on ${loopName} — forcing stop.`);
      loopHistory.push({
        role: "tool",
        content: `STOP: You have called ${loopName} with the same arguments ${LOOP_THRESHOLD} times in a row. The result will not change. STOP calling tools. Answer the user directly with what you know from the previous tool results, or ask for clarification. Do NOT call any more tools in your next reply.`,
        tool_call_id: `loop_guard_${iterations}`
      });
      const finalRequest = {
        ...request,
        history: loopHistory,
        message: "",
        // Force text-only reply
        tools: []
      };
      try {
        const finalResult = await provider.sendMessageStream(
          finalRequest,
          (chunk) => {
            if (chunk.type !== "done") onChunk(chunk);
          },
          signal
        );
        lastResult = finalResult;
      } catch (err) {
        console.warn(`[openai-tools] final answer after loop failed:`, err);
      }
      break;
    }
    if (iterations >= MAX_TOOL_ITERATIONS - 2) {
      loopHistory.push({
        role: "user",
        content: `Note: You have used ${iterations} of ${MAX_TOOL_ITERATIONS} available tool iterations. Please wrap up your work.`
      });
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
const TITLE_TIMEOUT_MS = 15e3;
const TITLE_MAX_LEN = 60;
const FALLBACK_MAX_LEN = 50;
const TITLE_INSTRUCTION = "Generate a concise 3-6 word title for this conversation in the user's language. Reply with only the title — no quotes, no trailing punctuation, no preface. Conversation start:";
const DEFAULT_TITLE_PATTERN = /^Nova thread(\s+\d+)?$/;
function sanitizeTitle(raw) {
  if (!raw) return null;
  let s = raw.replace(/\r/g, "").trim();
  const lines = s.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length > 0) {
    s = lines[lines.length - 1];
  }
  s = s.replace(/^["'`*_#>\s]+/, "").replace(/["'`*_\s]+$/, "");
  s = s.replace(/[.!?]+$/, "");
  s = s.replace(/\s+/g, " ").trim();
  if (!s) return null;
  if (s.length > TITLE_MAX_LEN) {
    s = s.slice(0, TITLE_MAX_LEN).trimEnd();
  }
  return s;
}
function fallbackFromMessage(message) {
  const trimmed = message.replace(/\s+/g, " ").trim();
  if (!trimmed) return null;
  if (trimmed.length <= FALLBACK_MAX_LEN) return trimmed;
  const slice = trimmed.slice(0, FALLBACK_MAX_LEN);
  const lastSpace = slice.lastIndexOf(" ");
  const cut = lastSpace > 20 ? slice.slice(0, lastSpace) : slice;
  return cut.replace(/[\s,;:.!?-]+$/, "").trim() || null;
}
async function generateViaProvider(provider, model, message) {
  const request = {
    model,
    effort: "low",
    approvalMode: "suggest",
    sessionId: null,
    message: `${TITLE_INSTRUCTION}

${message}`,
    history: []
  };
  const noopChunk = (_chunk) => {
  };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TITLE_TIMEOUT_MS);
  try {
    const result = await provider.sendMessageStream(
      request,
      noopChunk,
      controller.signal
    );
    return sanitizeTitle(result.text);
  } finally {
    clearTimeout(timeout);
  }
}
async function generateAndApplyThreadTitle(mainWindow2, thread, userMessage) {
  try {
    const provider = getProvider(thread.provider);
    let title = null;
    try {
      title = await generateViaProvider(provider, thread.model, userMessage);
    } catch (err) {
      console.warn(
        `[auto-title] provider title gen failed thread=${thread.id}: ${err instanceof Error ? err.message : String(err)}`
      );
      title = fallbackFromMessage(userMessage);
    }
    if (!title) {
      console.log(`[auto-title] no title produced thread=${thread.id}`);
      return;
    }
    const latest = await prisma.thread.findUnique({
      where: { id: thread.id },
      select: { title: true, projectId: true }
    });
    if (!latest) return;
    if (!DEFAULT_TITLE_PATTERN.test(latest.title.trim())) {
      console.log(
        `[auto-title] skipped thread=${thread.id} reason=title-changed current="${latest.title}"`
      );
      return;
    }
    const uniqueTitle = await resolveUniqueThreadTitle(latest.projectId, title);
    await prisma.thread.update({
      where: { id: thread.id },
      data: { title: uniqueTitle }
    });
    mainWindow2.webContents.send("thread:renamed", {
      threadId: thread.id,
      projectId: latest.projectId,
      title: uniqueTitle
    });
    console.log(
      `[auto-title] renamed thread=${thread.id} title="${uniqueTitle}"`
    );
  } catch (err) {
    console.error(
      `[auto-title] unexpected error thread=${thread.id}: ${err instanceof Error ? err.stack || err.message : String(err)}`
    );
  }
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
    execFile("git", ["diff", "--numstat", "--", "."], { cwd }, (error, stdout) => {
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
  const isFirstUserMessage = messages.filter((m) => m.role === "user").length === 1;
  const hasDefaultTitle = DEFAULT_TITLE_PATTERN.test(thread.title.trim());
  if (isFirstUserMessage && hasDefaultTitle) {
    void generateAndApplyThreadTitle(
      mainWindow2,
      {
        id: thread.id,
        projectId: thread.projectId,
        title: thread.title,
        provider: thread.provider,
        model: thread.model
      },
      _content
    );
  }
  const startedAt = Date.now();
  let chunkCount = 0;
  let deltaChars = 0;
  let activityCount = 0;
  let thinkingContent = null;
  let latestDiffStat = null;
  const collectedActivities = [];
  try {
    console.log(
      `[stream] Starting stream for thread=${threadId} runId=${runId} provider=${thread.provider} model=${thread.model} approval=${thread.approvalMode || "suggest"} hasSession=${Boolean(thread.sessionId)} historyMessages=${history.length} projectPath=${thread.project?.path || "none"} toolMode=${provider.toolMode}`
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
    const noToolsMode = (thread.approvalMode || "suggest") === "no-tools";
    if (noToolsMode) {
      console.log(`[stream] no-tools mode — calling provider directly without tools`);
      const lang = detectLanguage(_content);
      const langLine = lang === "pt" ? "Responda SEMPRE em português brasileiro, mesmo se mensagens anteriores estiverem em outro idioma." : lang === "es" ? "Responda SIEMPRE en español." : "Always respond in the same language as the user's last message.";
      sendRequest.systemPrompt = [
        "Você é um assistente de programação útil e direto, integrado a um editor de código local.",
        langLine,
        "Não emita tokens de controle como <|channel|>, <|message|>, <|end|> ou <|return|> — escreva apenas a resposta em texto natural.",
        "Não invente contexto de conversas anteriores. Responda apenas o que foi perguntado nesta mensagem."
      ].join("\n");
      result = await provider.sendMessageStream(sendRequest, handleChunk, abortController.signal);
    } else {
      result = await runWithOpenAITools({
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
          model: thread.model,
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
function registerProviderHandlers(_mainWindow) {
  ipcMain.handle("provider:catalog", async () => {
    const providers2 = getAllProviders();
    await Promise.all(
      providers2.map(async (provider) => {
        if (provider instanceof LmStudioProvider || provider instanceof OllamaProvider) {
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
    "provider:get-config",
    async (_, args) => {
      if (args.provider === "lm-studio") {
        return { baseUrl: getLmStudioBaseUrl() };
      }
      if (args.provider === "ollama") {
        return { baseUrl: getOllamaBaseUrl() };
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
      if (args.provider === "ollama") {
        const next = setOllamaBaseUrl(args.config.baseUrl || "");
        return { baseUrl: next };
      }
      return {};
    }
  );
  ipcMain.handle(
    "provider:list-models",
    async (_, args) => {
      const provider = getProvider(args.provider);
      if (!(provider instanceof LmStudioProvider) && !(provider instanceof OllamaProvider)) {
        return { models: [] };
      }
      try {
        const models = await provider.fetchModelValues();
        await provider.refreshCatalogModels();
        return { models };
      } catch (err) {
        return {
          models: [],
          error: err instanceof Error ? err.message : String(err)
        };
      }
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
