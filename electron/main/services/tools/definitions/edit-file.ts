import { z } from "zod";
import { readFile, writeFile } from "node:fs/promises";
import { buildTool, resolveSafe, type ValidationResult } from "../tool.js";

const MAX_FILE_SIZE = 1_048_576; // 1 MB

export const EditFileTool = buildTool({
  name: "edit_file",
  description: `Perform exact string replacements in a file. Two modes available:

Mode 1 — String replace (recommended):
  Provide old_content and new_content. old_content must be unique in the file.
  The edit FAILS if old_content appears more than once — provide more surrounding
  context to make it unique, or use replace_all: true to change every occurrence.

Mode 2 — Line range replace:
  Provide start_line, end_line, and content to replace a range of lines.
  Use read_file first to see line numbers.

IMPORTANT: You MUST read the file with read_file before editing it.`,

  inputSchema: z.object({
    path: z.string().min(1).describe("File path relative to the project root"),
    // Mode 1: string replace
    old_content: z.string().optional().describe("Exact text to find and replace"),
    new_content: z.string().optional().describe("Replacement text"),
    replace_all: z.boolean().optional().describe("Replace all occurrences (default false)"),
    // Mode 2: line range
    start_line: z.number().int().positive().optional().describe("Start line number (1-based) for line-range replacement"),
    end_line: z.number().int().positive().optional().describe("End line number (inclusive) for line-range replacement"),
    content: z.string().optional().describe("New content to replace the line range with"),
  }),

  isReadOnly: false,
  isConcurrencySafe: false,

  validateInput: (input): ValidationResult => {
    const hasStringMode = input.old_content !== undefined;
    const hasLineMode = input.start_line !== undefined && input.end_line !== undefined;

    if (!hasStringMode && !hasLineMode) {
      return {
        valid: false,
        error: "Provide either (old_content + new_content) for string replace, or (start_line + end_line + content) for line-range replace.",
      };
    }

    if (hasStringMode && input.new_content === undefined) {
      return { valid: false, error: "new_content is required when using old_content." };
    }

    if (hasLineMode && input.content === undefined) {
      return { valid: false, error: "content is required when using start_line/end_line." };
    }

    if (hasLineMode && input.start_line! > input.end_line!) {
      return { valid: false, error: "start_line must be <= end_line." };
    }

    return { valid: true };
  },

  call: async (input, ctx) => {
    const resolved = resolveSafe(ctx.projectPath, input.path);
    const current = await readFile(resolved, "utf-8");

    let updated: string;

    if (input.old_content !== undefined) {
      // --- Mode 1: String replace ---
      const oldContent = input.old_content;
      const newContent = input.new_content!;

      if (!current.includes(oldContent)) {
        return {
          success: false,
          output: "old_content not found in file. Make sure you use the exact text including whitespace and indentation. Use read_file first to see the current content.",
        };
      }

      if (input.replace_all) {
        updated = current.split(oldContent).join(newContent);
      } else {
        // Check uniqueness
        const firstIdx = current.indexOf(oldContent);
        const secondIdx = current.indexOf(oldContent, firstIdx + 1);
        if (secondIdx !== -1) {
          return {
            success: false,
            output: "old_content appears more than once in the file. Provide more surrounding context to make it unique, or set replace_all: true.",
          };
        }
        updated = current.replace(oldContent, newContent);
      }
    } else {
      // --- Mode 2: Line range replace ---
      const lines = current.split("\n");
      const startIdx = input.start_line! - 1; // 0-based
      const endIdx = input.end_line!; // end_line is inclusive, so endIdx for splice

      if (startIdx >= lines.length) {
        return {
          success: false,
          output: `start_line ${input.start_line} is beyond end of file (${lines.length} lines).`,
        };
      }

      const newLines = input.content!.split("\n");
      lines.splice(startIdx, endIdx - startIdx, ...newLines);
      updated = lines.join("\n");
    }

    if (updated.length > MAX_FILE_SIZE) {
      return { success: false, output: `Resulting file exceeds ${MAX_FILE_SIZE} bytes limit.` };
    }

    await writeFile(resolved, updated, "utf-8");
    return {
      success: true,
      output: `File edited: ${input.path}`,
    };
  },
});
