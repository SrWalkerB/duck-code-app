import { z } from "zod";
import { readdir, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import { minimatch } from "minimatch";
import { buildTool, resolveSafe } from "../tool.js";

const MAX_RESULTS = 100;
const IGNORE_DIRS = new Set([
  "node_modules", ".git", ".next", "dist", "out", ".cache",
  "__pycache__", ".venv", "target", ".DS_Store", "build",
]);

interface FileEntry {
  relativePath: string;
  mtime: number;
}

async function collectFiles(
  dir: string,
  projectPath: string,
  depth: number,
  entries: FileEntry[],
): Promise<void> {
  if (depth > 8 || entries.length > MAX_RESULTS * 2) return;

  try {
    const dirEntries = await readdir(dir, { withFileTypes: true });

    for (const entry of dirEntries) {
      if (entry.name.startsWith(".") && IGNORE_DIRS.has(entry.name)) continue;
      if (IGNORE_DIRS.has(entry.name)) continue;

      const fullPath = join(dir, entry.name);
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
    // Permission errors — skip
  }
}

export const GlobTool = buildTool({
  name: "glob",
  description: `Find files matching a glob pattern (e.g. '**/*.ts', 'src/**/*.css').
Returns matching file paths sorted by modification time (most recently modified first).`,

  inputSchema: z.object({
    pattern: z.string().min(1).describe("Glob pattern to match files against"),
    path: z.string().optional().describe("Directory to search in (defaults to project root)"),
  }),

  isReadOnly: true,
  isConcurrencySafe: true,

  call: async (input, ctx) => {
    const searchDir = input.path
      ? resolveSafe(ctx.projectPath, input.path)
      : ctx.projectPath;

    // Validate that search directory exists and is a directory
    try {
      const dirStat = await stat(searchDir);
      if (!dirStat.isDirectory()) {
        return { success: false, output: `${input.path || "."} is not a directory.` };
      }
    } catch {
      return { success: false, output: `Directory not found: ${input.path || "."}` };
    }

    const entries: FileEntry[] = [];
    await collectFiles(searchDir, ctx.projectPath, 0, entries);

    // Filter by glob pattern
    const allMatched = entries
      .filter((e) => minimatch(e.relativePath, input.pattern, { dot: false }))
      .sort((a, b) => b.mtime - a.mtime); // most recent first

    const truncated = allMatched.length > MAX_RESULTS;
    const matched = allMatched.slice(0, MAX_RESULTS);

    if (matched.length === 0) {
      return { success: true, output: "No files matched the pattern." };
    }

    let output = matched.map((e) => e.relativePath).join("\n");
    if (truncated) {
      output += `\n... (truncated: showing ${MAX_RESULTS} of ${allMatched.length} matches)`;
    }

    return {
      success: true,
      output,
      metadata: { matchCount: matched.length, totalMatches: allMatched.length, truncated },
    };
  },
});
