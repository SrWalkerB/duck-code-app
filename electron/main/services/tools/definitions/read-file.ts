import { z } from "zod";
import { readFile, stat } from "node:fs/promises";
import { buildTool, resolveSafe } from "../tool.js";
import { recordFileRead, getFileState } from "../file-state.js";
import { coerceString, coerceNumber } from "../schema/coerce.js";

/** Tracks which (path, mtime, offset, limit) tuples were already served in this run. */
const servedReads = new Map<string, { mtimeMs: number; offset?: number; limit?: number }>();

/** Clear per-run read dedup state. Called at start of each tool run. */
export function clearReadDedup(): void {
  servedReads.clear();
}

const MAX_READ_CHARS = 50_000;
const MAX_FILE_SIZE = 1_048_576; // 1 MB — refuse to read larger files

/** Device/special paths that would hang or produce infinite output. */
const BLOCKED_PATHS = [
  "/dev/zero", "/dev/random", "/dev/urandom", "/dev/stdin",
  "/dev/null", "/dev/fd/", "/proc/self/fd/",
];

function isBlockedPath(path: string): boolean {
  return BLOCKED_PATHS.some((bp) => path.startsWith(bp));
}

export const ReadFileTool = buildTool({
  name: "read_file",
  description: `Read file contents with line numbers (cat -n format).
- Returns content with line numbers starting at 1
- Use offset and limit for targeted reads of large files
- You MUST read a file before editing it`,

  inputSchema: z.object({
    path: coerceString(z.string().min(1)).describe("File path relative to the project root"),
    offset: coerceNumber(z.number().int().positive().optional()).describe("Line number to start reading from (1-based)"),
    limit: coerceNumber(z.number().int().positive().optional()).describe("Maximum number of lines to return"),
  }),

  isReadOnly: true,
  isConcurrencySafe: true,

  call: async (input, ctx) => {
    const resolved = resolveSafe(ctx.projectPath, input.path);

    // Block dangerous device paths
    if (isBlockedPath(resolved)) {
      return { success: false, output: `Blocked: ${input.path} is a device/special path that cannot be read.` };
    }

    // Pre-read size guard — stat before reading to avoid OOM on huge files
    let fileStat;
    try {
      fileStat = await stat(resolved);
    } catch {
      return { success: false, output: `File not found: ${input.path}` };
    }

    if (!fileStat.isFile()) {
      return { success: false, output: `${input.path} is not a file. Use list_files for directories.` };
    }

    if (fileStat.size > MAX_FILE_SIZE) {
      return {
        success: false,
        output: `File too large: ${input.path} is ${(fileStat.size / 1024 / 1024).toFixed(1)} MB. Maximum is 1 MB. Use offset/limit to read specific sections.`,
      };
    }

    // --- Dedup: if this exact (path+mtime+offset+limit) was already served, refuse loudly ---
    // Different offset/limit on the same file is legitimate (paging through a
    // large file), so the dedup key must include the range to avoid false positives.
    // Returning success: false forces the model to abandon the re-read pattern.
    const dedupKey = `${resolved}::${input.offset ?? 0}::${input.limit ?? 0}`;
    const prev = servedReads.get(dedupKey);
    const cached = getFileState(resolved);
    if (prev && prev.mtimeMs === fileStat.mtimeMs && cached && cached.timestamp === fileStat.mtimeMs) {
      return {
        success: false,
        output:
          `STOP RE-READING. File '${input.path}' was already read in this conversation and has not changed. ` +
          `The content is in the earlier read_file tool_result above — scroll up and use it. ` +
          `Do NOT call read_file on this path again. Your next action MUST be either edit_file/write_file (to apply changes), ` +
          `another tool on a DIFFERENT path, or a final text answer to the user. Calling read_file again will fail.`,
        metadata: { dedup: true, totalLines: cached.content.split("\n").length },
      };
    }

    const raw = await readFile(resolved, "utf-8");

    // Record in file state cache (used by edit_file and write_file for staleness detection)
    recordFileRead(resolved, raw, fileStat.mtimeMs);
    servedReads.set(dedupKey, { mtimeMs: fileStat.mtimeMs, offset: input.offset, limit: input.limit });

    const allLines = raw.split("\n");
    const totalLines = allLines.length;

    // Apply offset/limit
    const startLine = (input.offset ?? 1) - 1; // convert 1-based to 0-based
    const maxLines = input.limit ?? totalLines;
    const selectedLines = allLines.slice(startLine, startLine + maxLines);

    // Format with line numbers (cat -n style)
    const formatted = selectedLines
      .map((line, i) => {
        const lineNum = startLine + i + 1;
        return `${String(lineNum).padStart(6)}\t${line}`;
      })
      .join("\n");

    // Truncate if too large
    if (formatted.length > MAX_READ_CHARS) {
      const truncated = formatted.slice(0, MAX_READ_CHARS);
      const lastNewline = truncated.lastIndexOf("\n");
      return {
        success: true,
        output: `${truncated.slice(0, lastNewline)}\n... (truncated, showing ${selectedLines.length} of ${totalLines} total lines)`,
        metadata: { totalLines, truncated: true },
      };
    }

    const rangeInfo = input.offset || input.limit
      ? ` (lines ${startLine + 1}-${startLine + selectedLines.length} of ${totalLines})`
      : "";

    return {
      success: true,
      output: formatted + rangeInfo,
      metadata: { totalLines, truncated: false },
    };
  },
});
