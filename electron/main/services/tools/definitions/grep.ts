/**
 * Grep Tool — Search for patterns in file contents
 *
 * Uses ripgrep (rg) with fallback to native grep.
 * Supports multiple output modes, context lines, and case-insensitive search.
 * Inspired by claude-code's GrepTool.
 */

import { z } from "zod";
import { spawn } from "node:child_process";
import { relative } from "node:path";
import { buildTool, resolveSafe } from "../tool.js";

const MAX_RESULTS = 100;
const MAX_LINE_LENGTH = 2000;
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
  "target",
];

export const GrepTool = buildTool({
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
    output_mode: z.enum(["content", "files_with_matches", "count"]).optional()
      .describe("Output mode: 'files_with_matches' (default, just paths), 'content' (matching lines), 'count' (match counts)"),
    case_insensitive: z.boolean().optional().describe("Case insensitive search"),
    context: z.number().int().nonnegative().optional().describe("Lines of context before and after each match (requires output_mode 'content')"),
  }),

  isReadOnly: true,
  isConcurrencySafe: true,

  call: async (input, ctx) => {
    const searchDir = input.path
      ? resolveSafe(ctx.projectPath, input.path)
      : ctx.projectPath;

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
// Shared args builder
// ---------------------------------------------------------------------------

type GrepInput = {
  pattern: string;
  path?: string;
  include?: string;
  output_mode?: "content" | "files_with_matches" | "count";
  case_insensitive?: boolean;
  context?: number;
};

function buildRipgrepArgs(input: GrepInput, searchDir: string): string[] {
  const mode = input.output_mode ?? "files_with_matches";
  const args: string[] = [];

  // Output mode
  switch (mode) {
    case "files_with_matches":
      args.push("--files-with-matches");
      break;
    case "count":
      args.push("--count");
      break;
    case "content":
    default:
      args.push("-n", "-H"); // line numbers + filenames
      // Context lines (only for content mode)
      if (input.context && input.context > 0) {
        args.push("-C", String(input.context));
      }
      break;
  }

  args.push(
    "--hidden",
    "--no-messages",
    "--color=never",
    `--max-columns=${MAX_COLUMNS}`, // prevent base64/minified lines from flooding output
  );

  if (input.case_insensitive) {
    args.push("-i");
  }

  if (input.include) {
    args.push("--glob", input.include);
  }

  // Exclude common dirs
  for (const dir of EXCLUDED_DIRS) {
    args.push("--glob", `!${dir}`);
  }

  // Pattern — use -e flag if it starts with '-' to prevent misparse as CLI option
  if (input.pattern.startsWith("-")) {
    args.push("-e", input.pattern);
  } else {
    args.push(input.pattern);
  }

  args.push(searchDir);

  return args;
}

// ---------------------------------------------------------------------------
// Ripgrep execution (preferred)
// ---------------------------------------------------------------------------

async function runRipgrep(
  input: GrepInput,
  searchDir: string,
  ctx: { projectPath: string; signal?: AbortSignal },
): Promise<{ success: boolean; output: string; metadata?: Record<string, unknown> }> {
  const args = buildRipgrepArgs(input, searchDir);

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

    proc.stderr.on("data", () => {});

    proc.on("close", (code) => {
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
  input: GrepInput,
  searchDir: string,
  ctx: { projectPath: string; signal?: AbortSignal },
): Promise<{ success: boolean; output: string; metadata?: Record<string, unknown> }> {
  const args: string[] = ["-rn", "--color=never"];

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

  // Pattern — use -e flag if it starts with '-'
  if (input.pattern.startsWith("-")) {
    args.push("-e", input.pattern);
  } else {
    args.push(input.pattern);
  }

  args.push(searchDir);

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
    text += `\n... (showing ${MAX_RESULTS} of ${lines.length} matches)`;
  }

  return { text, count: limited.length, truncated };
}
