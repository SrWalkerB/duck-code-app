import { ipcMain } from "electron";
import { prisma } from "../services/prisma.js";

export function registerProjectHandlers(): void {
  ipcMain.handle("project:list", async () => {
    return prisma.project.findMany({
      orderBy: { updatedAt: "desc" },
    });
  });

  ipcMain.handle(
    "project:create",
    async (_, args: { name: string; path: string; color?: string }) => {
      return prisma.project.create({
        data: {
          name: args.name,
          path: args.path,
          color: args.color ?? "#3b82f6",
        },
      });
    }
  );

  ipcMain.handle(
    "project:update",
    async (_, args: { id: string; name?: string; color?: string }) => {
      return prisma.project.update({
        where: { id: args.id },
        data: {
          ...(args.name !== undefined && { name: args.name }),
          ...(args.color !== undefined && { color: args.color }),
        },
      });
    }
  );

  ipcMain.handle("project:delete", async (_, args: { id: string }) => {
    await prisma.project.delete({ where: { id: args.id } });
  });
}
