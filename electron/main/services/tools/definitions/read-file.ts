import { z } from "zod";
import { readFile } from "node:fs/promises";
import { buildTool, resolveSafe } from "../tool.js";

const MAX_READ_CHARS = 50_000;

export const ReadFileTool = buildTool({
  name: "read_file",
  description: `Read file contents with line numbers (cat -n format).
- Returns content with line numbers starting at 1
- Use offset and limit for targeted reads of large files
- You MUST read a file before editing it`,

  inputSchema: z.object({
    path: z.string().min(1).describe("File path relative to the project root"),
    offset: z.number().int().positive().optional().describe("Line number to start reading from (1-based)"),
    limit: z.number().int().positive().optional().describe("Maximum number of lines to return"),
  }),

  isReadOnly: true,
  isConcurrencySafe: true,

  call: async (input, ctx) => {
    const resolved = resolveSafe(ctx.projectPath, input.path);
    const raw = await readFile(resolved, "utf-8");
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
