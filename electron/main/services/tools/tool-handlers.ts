import { readFile, writeFile, unlink, readdir, rename, mkdir } from "node:fs/promises";
import { resolve, relative, join } from "node:path";
import { execFile } from "node:child_process";

export interface ToolResult {
  success: boolean;
  output: string;
}

const MAX_FILE_SIZE = 1_048_576; // 1 MB

function resolveSafe(projectPath: string, relativePath: string): string {
  const resolved = resolve(projectPath, relativePath);
  if (!resolved.startsWith(projectPath)) {
    throw new Error(`Path traversal blocked: ${relativePath}`);
  }
  return resolved;
}

async function ensureParentDir(filePath: string): Promise<void> {
  const dir = resolve(filePath, "..");
  await mkdir(dir, { recursive: true });
}

const handlers: Record<string, (args: Record<string, unknown>, projectPath: string) => Promise<ToolResult>> = {
  async create_file(args, projectPath) {
    const path = String(args.path ?? "");
    const content = String(args.content ?? "");
    if (!path) return { success: false, output: "Missing required arg: path" };
    if (content.length > MAX_FILE_SIZE) return { success: false, output: `File content exceeds ${MAX_FILE_SIZE} bytes limit` };

    const resolved = resolveSafe(projectPath, path);
    await ensureParentDir(resolved);
    await writeFile(resolved, content, "utf-8");
    return { success: true, output: `File created: ${path}` };
  },

  async edit_file(args, projectPath) {
    const path = String(args.path ?? "");
    const oldContent = String(args.old_content ?? "");
    const newContent = String(args.new_content ?? "");
    if (!path) return { success: false, output: "Missing required arg: path" };
    if (!oldContent) return { success: false, output: "Missing required arg: old_content" };

    const resolved = resolveSafe(projectPath, path);
    const current = await readFile(resolved, "utf-8");

    if (!current.includes(oldContent)) {
      return { success: false, output: "old_content not found in file. Make sure you use the exact text." };
    }

    const updated = current.replace(oldContent, newContent);
    if (updated.length > MAX_FILE_SIZE) return { success: false, output: `Resulting file exceeds ${MAX_FILE_SIZE} bytes limit` };
    await writeFile(resolved, updated, "utf-8");
    return { success: true, output: `File edited: ${path}` };
  },

  async read_file(args, projectPath) {
    const path = String(args.path ?? "");
    if (!path) return { success: false, output: "Missing required arg: path" };

    const resolved = resolveSafe(projectPath, path);
    const content = await readFile(resolved, "utf-8");
    const truncated = content.length > 50_000 ? `${content.slice(0, 50_000)}\n... (truncated, ${content.length} total chars)` : content;
    return { success: true, output: truncated };
  },

  async delete_file(args, projectPath) {
    const path = String(args.path ?? "");
    if (!path) return { success: false, output: "Missing required arg: path" };

    const resolved = resolveSafe(projectPath, path);
    await unlink(resolved);
    return { success: true, output: `File deleted: ${path}` };
  },

  async list_files(args, projectPath) {
    const path = String(args.path ?? ".");
    const resolved = resolveSafe(projectPath, path);

    const IGNORE = new Set(["node_modules", ".git", ".next", "dist", "out", ".cache", "__pycache__", ".venv", "target"]);

    async function listDir(dir: string, depth: number): Promise<string[]> {
      if (depth > 3) return [];
      const entries = await readdir(dir, { withFileTypes: true });
      const lines: string[] = [];

      const sorted = entries
        .filter((e) => !e.name.startsWith(".") && !IGNORE.has(e.name))
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
          lines.push(...(await listDir(join(dir, entry.name), depth + 1)));
        } else {
          lines.push(`${prefix}${rel}`);
        }
      }
      return lines;
    }

    const lines = await listDir(resolved, 0);
    return { success: true, output: lines.join("\n") || "(empty directory)" };
  },

  async search_files(args, projectPath) {
    const pattern = String(args.pattern ?? "");
    const path = String(args.path ?? ".");
    if (!pattern) return { success: false, output: "Missing required arg: pattern" };

    const resolved = resolveSafe(projectPath, path);

    return new Promise((res) => {
      execFile(
        "grep",
        ["-rn", "--include=*", "-l", pattern, resolved],
        { timeout: 15_000, maxBuffer: 512_000 },
        (err, stdout) => {
          if (err && !stdout) {
            res({ success: true, output: "No matches found." });
            return;
          }
          const files = stdout
            .trim()
            .split("\n")
            .filter(Boolean)
            .map((f) => relative(projectPath, f))
            .slice(0, 50);
          res({ success: true, output: files.length ? files.join("\n") : "No matches found." });
        }
      );
    });
  },

  async rename_file(args, projectPath) {
    const oldPath = String(args.old_path ?? "");
    const newPath = String(args.new_path ?? "");
    if (!oldPath || !newPath) return { success: false, output: "Missing required args: old_path, new_path" };

    const resolvedOld = resolveSafe(projectPath, oldPath);
    const resolvedNew = resolveSafe(projectPath, newPath);
    await ensureParentDir(resolvedNew);
    await rename(resolvedOld, resolvedNew);
    return { success: true, output: `Renamed: ${oldPath} → ${newPath}` };
  },

  async create_directory(args, projectPath) {
    const path = String(args.path ?? "");
    if (!path) return { success: false, output: "Missing required arg: path" };

    const resolved = resolveSafe(projectPath, path);
    await mkdir(resolved, { recursive: true });
    return { success: true, output: `Directory created: ${path}` };
  },

  async run_command(args, projectPath) {
    const command = String(args.command ?? "");
    const cwd = args.cwd ? resolveSafe(projectPath, String(args.cwd)) : projectPath;
    if (!command) return { success: false, output: "Missing required arg: command" };

    return new Promise((res) => {
      execFile(
        process.platform === "win32" ? "cmd" : "/bin/sh",
        process.platform === "win32" ? ["/c", command] : ["-c", command],
        { cwd, timeout: 30_000, maxBuffer: 1_048_576 },
        (err, stdout, stderr) => {
          const output = [stdout, stderr].filter(Boolean).join("\n").trim();
          if (err) {
            res({ success: false, output: output || err.message });
          } else {
            res({ success: true, output: output || "(no output)" });
          }
        }
      );
    });
  },
};

export async function executeTool(
  name: string,
  args: Record<string, unknown>,
  projectPath: string
): Promise<ToolResult> {
  const handler = handlers[name];
  if (!handler) {
    return { success: false, output: `Unknown tool: ${name}` };
  }

  try {
    return await handler(args, projectPath);
  } catch (err) {
    return { success: false, output: err instanceof Error ? err.message : String(err) };
  }
}
