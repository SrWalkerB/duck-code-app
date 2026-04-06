import { z } from "zod";
import { readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import { buildTool, resolveSafe } from "../tool.js";

const IGNORE_DIRS = new Set([
  "node_modules", ".git", ".next", "dist", "out", ".cache",
  "__pycache__", ".venv", "target",
]);

async function listDir(dir: string, projectPath: string, depth: number): Promise<string[]> {
  if (depth > 3) return [];

  const entries = await readdir(dir, { withFileTypes: true });
  const lines: string[] = [];

  const sorted = entries
    .filter((e) => !e.name.startsWith(".") && !IGNORE_DIRS.has(e.name))
    .sort((a, b) => {
      if (a.isDirectory() && !b.isDirectory()) return -1;
      if (!a.isDirectory() && b.isDirectory()) return 1;
      return a.name.localeCompare(b.name);
    });

  for (const entry of sorted) {
    const rel = relative(projectPath, join(dir, entry.name));
    const prefix = "  ".repeat(depth);
    if (entry.isDirectory()) {
      lines.push(`${prefix}${rel}/`);
      lines.push(...(await listDir(join(dir, entry.name), projectPath, depth + 1)));
    } else {
      lines.push(`${prefix}${rel}`);
    }
  }
  return lines;
}

export const ListFilesTool = buildTool({
  name: "list_files",
  description: "List files and directories at a path in a tree-like format.",

  inputSchema: z.object({
    path: z.string().optional().describe("Directory path relative to project root (defaults to root)"),
  }),

  isReadOnly: true,
  isConcurrencySafe: true,

  call: async (input, ctx) => {
    const targetPath = input.path
      ? resolveSafe(ctx.projectPath, input.path)
      : ctx.projectPath;

    try {
      const lines = await listDir(targetPath, ctx.projectPath, 0);
      return {
        success: true,
        output: lines.join("\n") || "(empty directory)",
      };
    } catch (err) {
      return {
        success: false,
        output: err instanceof Error ? err.message : String(err),
      };
    }
  },
});
