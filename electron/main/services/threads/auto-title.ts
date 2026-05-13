import { prisma } from "../prisma.js";
import { getProvider } from "../providers/factory.js";
import type {
  ApiProviderId,
  ProviderRuntime,
  SendMessageRequest,
  StreamChunk,
} from "../providers/types.js";
import { resolveUniqueThreadTitle } from "../../ipc/threads.js";
import type { BrowserWindow } from "electron";

const TITLE_TIMEOUT_MS = 15_000;
const TITLE_MAX_LEN = 60;
const FALLBACK_MAX_LEN = 50;

const TITLE_INSTRUCTION =
  "Generate a concise 3-6 word title for this conversation in the user's language. Reply with only the title — no quotes, no trailing punctuation, no preface. Conversation start:";

export const DEFAULT_TITLE_PATTERN = /^Nova thread(\s+\d+)?$/;

function sanitizeTitle(raw: string): string | null {
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

function fallbackFromMessage(message: string): string | null {
  const trimmed = message.replace(/\s+/g, " ").trim();
  if (!trimmed) return null;
  if (trimmed.length <= FALLBACK_MAX_LEN) return trimmed;

  const slice = trimmed.slice(0, FALLBACK_MAX_LEN);
  const lastSpace = slice.lastIndexOf(" ");
  const cut = lastSpace > 20 ? slice.slice(0, lastSpace) : slice;
  return cut.replace(/[\s,;:.!?-]+$/, "").trim() || null;
}

async function generateViaProvider(
  provider: ProviderRuntime,
  model: string,
  message: string
): Promise<string | null> {
  const request: SendMessageRequest = {
    model,
    effort: "low",
    approvalMode: "suggest",
    sessionId: null,
    message: `${TITLE_INSTRUCTION}\n\n${message}`,
    history: [],
  };

  const noopChunk = (_chunk: StreamChunk) => {};
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

export async function generateAndApplyThreadTitle(
  mainWindow: BrowserWindow,
  thread: { id: string; projectId: string; title: string; provider: string; model: string },
  userMessage: string
): Promise<void> {
  try {
    const provider = getProvider(thread.provider as ApiProviderId);

    let title: string | null = null;
    try {
      title = await generateViaProvider(provider, thread.model, userMessage);
    } catch (err) {
      console.warn(
        `[auto-title] provider title gen failed thread=${thread.id}: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
      title = fallbackFromMessage(userMessage);
    }

    if (!title) {
      console.log(`[auto-title] no title produced thread=${thread.id}`);
      return;
    }

    const latest = await prisma.thread.findUnique({
      where: { id: thread.id },
      select: { title: true, projectId: true },
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
      data: { title: uniqueTitle },
    });

    mainWindow.webContents.send("thread:renamed", {
      threadId: thread.id,
      projectId: latest.projectId,
      title: uniqueTitle,
    });

    console.log(
      `[auto-title] renamed thread=${thread.id} title="${uniqueTitle}"`
    );
  } catch (err) {
    console.error(
      `[auto-title] unexpected error thread=${thread.id}: ${
        err instanceof Error ? err.stack || err.message : String(err)
      }`
    );
  }
}
