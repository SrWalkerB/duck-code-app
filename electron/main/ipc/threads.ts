import { ipcMain } from "electron";
import { prisma } from "../services/prisma.js";

export function registerThreadHandlers(): void {
  ipcMain.handle(
    "thread:list",
    async (_, args: { projectId: string }) => {
      return prisma.thread.findMany({
        where: { projectId: args.projectId },
        orderBy: { updatedAt: "desc" },
      });
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
      return prisma.thread.create({
        data: {
          projectId: args.projectId,
          title: args.title,
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
