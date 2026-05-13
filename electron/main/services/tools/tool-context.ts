/**
 * Tool Context — Shared utilities for tool execution loops
 *
 * Extracted from tool-executor.ts so both the XML and OpenAI tool loops
 * can reuse project context gathering without duplication.
 */

import { readFile, readdir, stat } from "node:fs/promises";
import { extname, join, relative } from "node:path";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const MAX_TOOL_ITERATIONS = 20;

export const KEY_FILES = [
  "package.json",
  "tsconfig.json",
  "pyproject.toml",
  "Cargo.toml",
  "go.mod",
  "requirements.txt",
  "composer.json",
  "Gemfile",
  "README.md",
  "index.html",
  "main.py",
  "main.ts",
  "main.js",
  "index.ts",
  "index.js",
];

export const MAX_KEY_FILE_CHARS = 8000;

/** Extensions eligible for "smart inclusion" in small projects. */
const SMART_INCLUDE_EXTS = new Set([".html", ".css", ".js", ".ts", ".tsx", ".jsx", ".py", ".md", ".json"]);
const MAX_SMART_INCLUDE_FILES = 6;
const MAX_SMART_INCLUDE_CHARS_PER_FILE = 3000;

export const IGNORE_DIRS = new Set([
  "node_modules", ".git", ".next", "dist", "out", ".cache",
  "__pycache__", ".venv", "target", ".DS_Store", "build",
]);

// ---------------------------------------------------------------------------
// Project context — auto-read key files
// ---------------------------------------------------------------------------

export async function readKeyFiles(projectPath: string): Promise<Record<string, string>> {
  const contents: Record<string, string> = {};
  let totalChars = 0;

  // 1. Well-known key files at root
  for (const filename of KEY_FILES) {
    if (totalChars >= MAX_KEY_FILE_CHARS) break;

    try {
      const filePath = join(projectPath, filename);
      const content = await readFile(filePath, "utf-8");
      const lines = content.split("\n").slice(0, 80);
      const truncated = lines.join("\n");

      if (totalChars + truncated.length <= MAX_KEY_FILE_CHARS) {
        contents[filename] = truncated;
        totalChars += truncated.length;
      }
    } catch {
      // File doesn't exist — skip
    }
  }

  // 2. Smart inclusion for small projects: if the root has only a handful
  // of source files, include their contents so the model doesn't waste
  // iterations re-discovering what already exists.
  try {
    const rootEntries = (await readdir(projectPath, { withFileTypes: true }))
      .filter((e) => !e.name.startsWith(".") && !IGNORE_DIRS.has(e.name));

    const rootFiles = rootEntries
      .filter((e) => e.isFile())
      .map((e) => e.name)
      .filter((n) => SMART_INCLUDE_EXTS.has(extname(n).toLowerCase()));

    const totalSourceFiles = rootFiles.length;
    if (totalSourceFiles > 0 && totalSourceFiles <= MAX_SMART_INCLUDE_FILES) {
      for (const name of rootFiles) {
        if (totalChars >= MAX_KEY_FILE_CHARS) break;
        if (contents[name]) continue;
        try {
          const fp = join(projectPath, name);
          const st = await stat(fp);
          if (!st.isFile() || st.size > 100_000) continue;
          const raw = await readFile(fp, "utf-8");
          const clipped = raw.length > MAX_SMART_INCLUDE_CHARS_PER_FILE
            ? `${raw.slice(0, MAX_SMART_INCLUDE_CHARS_PER_FILE)}\n... (truncated, use read_file for full content)`
            : raw;
          if (totalChars + clipped.length <= MAX_KEY_FILE_CHARS) {
            contents[name] = clipped;
            totalChars += clipped.length;
          }
        } catch {
          // skip unreadable
        }
      }
    }
  } catch {
    // projectPath not accessible — skip smart inclusion
  }

  return contents;
}

// ---------------------------------------------------------------------------
// File tree generation
// ---------------------------------------------------------------------------

export async function generateFileTree(projectPath: string, maxDepth = 3): Promise<string> {
  const lines: string[] = [];

  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > maxDepth || lines.length > 200) return;
    try {
      const entries = await readdir(dir, { withFileTypes: true });
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
          await walk(join(dir, entry.name), depth + 1);
        } else {
          lines.push(`${prefix}${rel}`);
        }
      }
    } catch {
      // Permission errors — skip
    }
  }

  await walk(projectPath, 0);
  return lines.join("\n");
}
