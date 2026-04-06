/**
 * Grep Tool — Search for patterns in file contents
 *
 * Inspired by OpenCode's grep.ts:
 * - Uses ripgrep (rg) with fallback to grep
 * - 100 max results (vs 50 before)
 * - Line truncation at 2K chars
 * - Hidden file support
 * - Abort signal support
 */

import { z } from "zod";
import { spawn } from "node:child_process";
import { relative } from "node:path";
import { buildTool, resolveSafe } from "../tool.js";

const MAX_RESULTS = 100;
const MAX_LINE_LENGTH = 2000;

const EXCLUDED_DIRS = [
  "node_modules",
  ".git",
  "dist",
  "out",
  ".cache",
  "build",
  "__pycache__",
  ".venv",
  "target",
];

export const GrepTool = buildTool({
  name: "grep",
  description: `Search for a regex pattern in file contents using ripgrep.
- Returns matching lines with file paths and line numbers
- Use include to filter by file type (e.g. "*.ts", "*.{ts,tsx}")
- Supports full regex syntax
- Searches hidden files by default
- Use this tool instead of bash + grep for better performance`,

  inputSchema: z.object({
    pattern: z.string().min(1).describe("Regex pattern to search for"),
    path: z.string().optional().describe("Directory to search in (defaults to project root)"),
    include: z
      .string()
      .optional()
      .describe("File pattern filter (e.g. '*.ts', '*.{html,css}')"),
  }),

  isReadOnly: true,
  isConcurrencySafe: true,

  call: async (input, ctx) => {
    const searchDir = input.path
      ? resolveSafe(ctx.projectPath, input.path)
      : ctx.projectPath;

    // Try ripgrep first, fallback to grep
    const useRipgrep = await hasRipgrep();

    if (useRipgrep) {
      return runRipgrep(input, searchDir, ctx);
    }
    return runNativeGrep(input, searchDir, ctx);
  },
});

// ---------------------------------------------------------------------------
// Ripgrep detection (cached)
// ---------------------------------------------------------------------------

let _ripgrepAvailable: boolean | null = null;

async function hasRipgrep(): Promise<boolean> {
  if (_ripgrepAvailable !== null) return _ripgrepAvailable;

  return new Promise((resolve) => {
    const proc = spawn("rg", ["--version"], { stdio: "ignore" });
    proc.on("close", (code) => {
      _ripgrepAvailable = code === 0;
      resolve(_ripgrepAvailable);
    });
    proc.on("error", () => {
      _ripgrepAvailable = false;
      resolve(false);
    });
  });
}

// ---------------------------------------------------------------------------
// Ripgrep execution (preferred)
// ---------------------------------------------------------------------------

async function runRipgrep(
  input: { pattern: string; path?: string; include?: string },
  searchDir: string,
  ctx: { projectPath: string; signal?: AbortSignal },
): Promise<{ success: boolean; output: string; metadata?: Record<string, unknown> }> {
  const args: string[] = [
    "-n", // line numbers
    "-H", // show filenames
    "--hidden", // include hidden files
    "--no-messages", // suppress error messages
    "--color=never",
  ];

  if (input.include) {
    args.push("--glob", input.include);
  }

  // Exclude common dirs
  for (const dir of EXCLUDED_DIRS) {
    args.push("--glob", `!${dir}`);
  }

  args.push(input.pattern, searchDir);

  return new Promise((resolve) => {
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

    proc.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });

    // Suppress stderr
    proc.stderr.on("data", () => {});

    proc.on("close", (code) => {
      // Exit code 1 = no matches, 2 = errors
      if (code === 1 && !output.trim()) {
        resolve({ success: true, output: "No matches found." });
        return;
      }

      const lines = output.trim().split("\n").filter(Boolean);
      const formatted = formatResults(lines, ctx.projectPath);

      resolve({
        success: true,
        output: formatted.text,
        metadata: { matchCount: formatted.count, truncated: formatted.truncated },
      });
    });

    proc.on("error", () => {
      resolve({ success: false, output: "Failed to run ripgrep." });
    });
  });
}

// ---------------------------------------------------------------------------
// Native grep fallback
// ---------------------------------------------------------------------------

async function runNativeGrep(
  input: { pattern: string; path?: string; include?: string },
  searchDir: string,
  ctx: { projectPath: string; signal?: AbortSignal },
): Promise<{ success: boolean; output: string; metadata?: Record<string, unknown> }> {
  const args: string[] = ["-rn", "--color=never"];

  if (input.include) {
    args.push(`--include=${input.include}`);
  }

  for (const dir of EXCLUDED_DIRS) {
    args.push(`--exclude-dir=${dir}`);
  }

  args.push(input.pattern, searchDir);

  return new Promise((resolve) => {
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

    proc.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });

    proc.on("close", (code) => {
      if (code === 1 || !output.trim()) {
        resolve({ success: true, output: "No matches found." });
        return;
      }

      const lines = output.trim().split("\n").filter(Boolean);
      const formatted = formatResults(lines, ctx.projectPath);

      resolve({
        success: true,
        output: formatted.text,
        metadata: { matchCount: formatted.count, truncated: formatted.truncated },
      });
    });

    proc.on("error", () => {
      resolve({ success: false, output: "Failed to run grep." });
    });
  });
}

// ---------------------------------------------------------------------------
// Format results: relative paths, line truncation, result limit
// ---------------------------------------------------------------------------

function formatResults(
  lines: string[],
  projectPath: string,
): { text: string; count: number; truncated: boolean } {
  const truncated = lines.length > MAX_RESULTS;
  const limited = lines.slice(0, MAX_RESULTS);

  const formatted = limited.map((line) => {
    // Convert absolute paths to relative
    if (line.startsWith(projectPath)) {
      line = relative(projectPath, line);
    }
    // Truncate long lines
    if (line.length > MAX_LINE_LENGTH) {
      line = line.slice(0, MAX_LINE_LENGTH) + "...";
    }
    return line;
  });

  let text = formatted.join("\n");
  if (truncated) {
    text += `\n... (showing ${MAX_RESULTS} of ${lines.length} matches)`;
  }

  return { text, count: limited.length, truncated };
}
