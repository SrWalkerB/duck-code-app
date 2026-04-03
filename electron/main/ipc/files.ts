import { ipcMain, type BrowserWindow } from "electron";
import { readdir, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import { watch, type FSWatcher } from "node:fs";

export interface FileEntry {
  name: string;
  path: string;
  relativePath: string;
  isDirectory: boolean;
  children?: FileEntry[];
}

const IGNORE = new Set([
  "node_modules",
  ".git",
  ".next",
  "dist",
  "out",
  ".cache",
  ".turbo",
  "__pycache__",
  ".venv",
  "target",
]);

async function listDirectory(
  dirPath: string,
  rootPath: string,
  depth = 0
): Promise<FileEntry[]> {
  if (depth > 5) return [];

  try {
    const entries = await readdir(dirPath, { withFileTypes: true });
    const result: FileEntry[] = [];

    const sorted = entries
      .filter((e) => !e.name.startsWith(".") || e.name === ".env")
      .filter((e) => !IGNORE.has(e.name))
      .sort((a, b) => {
        if (a.isDirectory() && !b.isDirectory()) return -1;
        if (!a.isDirectory() && b.isDirectory()) return 1;
        return a.name.localeCompare(b.name);
      });

    for (const entry of sorted) {
      const fullPath = join(dirPath, entry.name);
      const relPath = relative(rootPath, fullPath);
      const isDir = entry.isDirectory();

      const node: FileEntry = {
        name: entry.name,
        path: fullPath,
        relativePath: relPath,
        isDirectory: isDir,
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

const activeWatchers = new Map<string, FSWatcher>();

export function registerFileHandlers(mainWindow: BrowserWindow): void {
  ipcMain.handle("files:list", async (_, args: { path: string }) => {
    return listDirectory(args.path, args.path);
  });

  ipcMain.handle("files:read", async (_, args: { path: string }) => {
    const { readFile } = await import("node:fs/promises");
    try {
      const content = await readFile(args.path, "utf-8");
      return { content, error: null };
    } catch (err) {
      return { content: null, error: String(err) };
    }
  });

  ipcMain.handle("files:watch", async (_, args: { path: string }) => {
    // Stop existing watcher for this path
    const existing = activeWatchers.get(args.path);
    if (existing) {
      existing.close();
      activeWatchers.delete(args.path);
    }

    try {
      const watcher = watch(args.path, { recursive: true }, (eventType, filename) => {
        if (!filename) return;
        // Skip ignored directories
        const parts = filename.split("/");
        if (parts.some((p) => IGNORE.has(p) || p.startsWith("."))) return;

        mainWindow.webContents.send("files:changed", {
          eventType,
          filename,
          rootPath: args.path,
        });
      });

      activeWatchers.set(args.path, watcher);
      return { watching: true };
    } catch {
      return { watching: false };
    }
  });

  ipcMain.handle("files:unwatch", async (_, args: { path: string }) => {
    const watcher = activeWatchers.get(args.path);
    if (watcher) {
      watcher.close();
      activeWatchers.delete(args.path);
    }
  });
}
