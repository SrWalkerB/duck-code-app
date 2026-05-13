import { ipcMain } from "electron";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { prisma } from "../services/prisma.js";

export async function resolveUniqueThreadTitle(projectId: string, title: string): Promise<string> {
  const baseTitle = title.trim();
  if (!baseTitle) {
    return "Nova thread";
  }

  const existingThreads = await prisma.thread.findMany({
    where: { projectId },
    select: { title: true },
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

function runGitNumstat(cwd: string): Promise<{ additions: number; deletions: number } | null> {
  return new Promise((resolve) => {
    execFile("git", ["diff", "--numstat", "--", "."], { cwd }, (error, stdout) => {
      if (error) {
        resolve(null);
        return;
      }

      const rows = String(stdout || "")
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);

      let additions = 0;
      let deletions = 0;
      for (const row of rows) {
        const [a, d] = row.split("\t");
        const addNum = Number.parseInt(a, 10);
        const delNum = Number.parseInt(d, 10);
        if (!Number.isNaN(addNum)) additions += addNum;
        if (!Number.isNaN(delNum)) deletions += delNum;
      }

      resolve({ additions, deletions });
    });
  });
}

function resolveThreadWorkdir(
  projectPath: string | undefined,
  threadTitle: string
): string | null {
  if (!projectPath) return null;
  const trimmed = threadTitle.trim();
  if (trimmed) {
    const candidate = join(projectPath, trimmed);
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return projectPath;
}

export function registerThreadHandlers(): void {
  ipcMain.handle(
    "thread:list",
    async (_, args: { projectId: string }) => {
      const projectThreads = await prisma.thread.findMany({
        where: { projectId: args.projectId },
        include: { project: { select: { path: true } } },
        orderBy: { updatedAt: "desc" },
      });

      const gitDiffByPath = new Map<string, { additions: number; deletions: number } | null>();

      const enrichedThreads = await Promise.all(
        projectThreads.map(async (thread) => {
          const latestAssistantMessage = await prisma.message.findFirst({
            where: {
              threadId: thread.id,
              role: "assistant",
            },
            orderBy: { createdAt: "desc" },
            select: { metadata: true },
          });

          let lineAdditions: number | null = null;
          let lineDeletions: number | null = null;

          if (latestAssistantMessage?.metadata) {
            try {
              const metadata = JSON.parse(latestAssistantMessage.metadata) as {
                lineAdditions?: unknown;
                lineDeletions?: unknown;
              };

              if (typeof metadata.lineAdditions === "number") {
                lineAdditions = metadata.lineAdditions;
              }

              if (typeof metadata.lineDeletions === "number") {
                lineDeletions = metadata.lineDeletions;
              }
            } catch {
              // Ignore invalid metadata payloads.
            }
          }

          const workdir = resolveThreadWorkdir(thread.project?.path, thread.title);
          if ((lineAdditions === null || lineDeletions === null) && workdir) {
            if (!gitDiffByPath.has(workdir)) {
              gitDiffByPath.set(workdir, await runGitNumstat(workdir));
            }
            const diffStat = gitDiffByPath.get(workdir) ?? null;
            if (lineAdditions === null && diffStat) {
              lineAdditions = diffStat.additions;
            }
            if (lineDeletions === null && diffStat) {
              lineDeletions = diffStat.deletions;
            }
          }

          const threadData = { ...thread } as typeof thread & { project?: { path: string } };
          delete threadData.project;
          return { ...threadData, lineAdditions, lineDeletions };
        })
      );

      return enrichedThreads;
    }
  );

  ipcMain.handle(
    "thread:create",
    async (
      _,
      args: {
        projectId: string;
        title: string;
        provider?: string;
        model?: string;
        effort?: string;
        approvalMode?: string;
      }
    ) => {
      const threadTitle = await resolveUniqueThreadTitle(args.projectId, args.title);

      return prisma.thread.create({
        data: {
          projectId: args.projectId,
          title: threadTitle,
          provider: args.provider ?? "openai",
          model: args.model ?? "gpt-5.1-codex-mini",
          effort: args.effort ?? "medium",
          approvalMode: args.approvalMode ?? "suggest",
        },
      });
    }
  );

  ipcMain.handle(
    "thread:update",
    async (
      _,
      args: {
        id: string;
        title?: string;
        provider?: string;
        model?: string;
        effort?: string;
        approvalMode?: string;
        sessionId?: string | null;
      }
    ) => {
      return prisma.thread.update({
        where: { id: args.id },
        data: {
          ...(args.title !== undefined && { title: args.title }),
          ...(args.provider !== undefined && { provider: args.provider }),
          ...(args.model !== undefined && { model: args.model }),
          ...(args.effort !== undefined && { effort: args.effort }),
          ...(args.approvalMode !== undefined && { approvalMode: args.approvalMode }),
          ...(args.sessionId !== undefined && { sessionId: args.sessionId }),
        },
      });
    }
  );

  ipcMain.handle("thread:delete", async (_, args: { id: string }) => {
    await prisma.thread.delete({ where: { id: args.id } });
  });
}
