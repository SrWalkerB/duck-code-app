import { z } from "zod";
import { readFile, writeFile, stat } from "node:fs/promises";
import { buildTool, resolveSafe, type ValidationResult } from "../tool.js";
import { getFileState, updateFileState } from "../file-state.js";
import { coerceString, coerceBoolean, coerceNumber } from "../schema/coerce.js";

const MAX_FILE_SIZE = 1_048_576; // 1 MB

// ---------------------------------------------------------------------------
// Robust string matching — inspired by claude-code's findActualString()
// ---------------------------------------------------------------------------

/** Normalize curly/smart quotes to straight ASCII quotes. */
function normalizeQuotes(s: string): string {
  return s
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")  // single curly → straight
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"');  // double curly → straight
}

/**
 * Find the actual string in the file content, with progressive fallbacks:
 * 1. Exact match
 * 2. Quote-normalized match (curly → straight)
 * 3. Whitespace-normalized match (trailing spaces, tabs vs spaces)
 *
 * Returns the REAL string from the file that matched (for use in replace),
 * or null if no match was found.
 */
/**
 * Strip `cat -n` line-number prefixes (e.g., "      6\tline content") if the
 * model accidentally copied them from read_file output. Detect by checking
 * whether MOST lines start with `\s*\d+\t`.
 */
function stripLineNumberPrefix(s: string): string {
  const lines = s.split("\n");
  if (lines.length === 0) return s;
  const prefixed = lines.filter((l) => /^\s*\d+\t/.test(l)).length;
  // If at least half of lines look prefixed, treat the whole string as prefixed
  if (prefixed >= Math.max(1, Math.ceil(lines.length / 2))) {
    return lines.map((l) => l.replace(/^\s*\d+\t/, "")).join("\n");
  }
  return s;
}

function findActualString(content: string, searchString: string): string | null {
  // 1. Exact match
  if (content.includes(searchString)) {
    return searchString;
  }

  // 1b. Strip `cat -n` line-number prefix and retry exact
  const dePrefixed = stripLineNumberPrefix(searchString);
  if (dePrefixed !== searchString && content.includes(dePrefixed)) {
    return dePrefixed;
  }

  // 2. Quote-normalized match
  const normalizedContent = normalizeQuotes(content);
  const normalizedSearch = normalizeQuotes(searchString);
  if (normalizedContent.includes(normalizedSearch)) {
    // Find the real string in the original content at the same position
    const idx = normalizedContent.indexOf(normalizedSearch);
    return content.slice(idx, idx + normalizedSearch.length);
  }

  // 3. Whitespace-normalized match: find a window of lines in `content` whose
  // trailing-trimmed text equals the search lines. Return the original lines
  // joined verbatim so replace operates on real file bytes (preserves trailing
  // whitespace and avoids index drift between normalized and original text).
  const originalLines = content.split("\n");
  const searchLinesTrimmed = searchString.split("\n").map((l) => l.trimEnd());
  const window = searchLinesTrimmed.length;
  if (window > 0 && window <= originalLines.length) {
    outer: for (let i = 0; i <= originalLines.length - window; i++) {
      for (let k = 0; k < window; k++) {
        if (originalLines[i + k].trimEnd() !== searchLinesTrimmed[k]) continue outer;
      }
      return originalLines.slice(i, i + window).join("\n");
    }
  }

  return null;
}

/** Count occurrences of a substring. */
function countOccurrences(content: string, search: string): number {
  let count = 0;
  let idx = 0;
  while ((idx = content.indexOf(search, idx)) !== -1) {
    count++;
    idx += 1;
  }
  return count;
}

// ---------------------------------------------------------------------------
// Tool definition
// ---------------------------------------------------------------------------

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
    path: coerceString(z.string().min(1)).describe("File path relative to the project root"),
    // Mode 1: string replace
    old_content: coerceString(z.string()).optional().describe("Exact text to find and replace (verbatim, no line-number prefix)"),
    new_content: coerceString(z.string()).optional().describe("Replacement text"),
    replace_all: coerceBoolean(z.boolean().optional()).describe("Replace all occurrences (default false)"),
    // Mode 2: line range
    start_line: coerceNumber(z.number().int().positive().optional()).describe("Start line number (1-based) for line-range replacement"),
    end_line: coerceNumber(z.number().int().positive().optional()).describe("End line number (inclusive) for line-range replacement"),
    content: coerceString(z.string()).optional().describe("New content to replace the line range with"),
  }),

  isReadOnly: false,
  isConcurrencySafe: false,

  validateInput: (input, ctx): ValidationResult => {
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

    // No-op guard
    if (hasStringMode && input.old_content === input.new_content) {
      return { valid: false, error: "old_content and new_content are identical. No changes needed." };
    }

    // Read-before-write enforcement
    const resolved = resolveSafe(ctx.projectPath, input.path);
    const fileState = getFileState(resolved);
    if (!fileState) {
      return {
        valid: false,
        error: "File has not been read yet. Use read_file first before editing. This ensures you see the current content and prevents accidental overwrites.",
      };
    }

    return { valid: true };
  },

  call: async (input, ctx) => {
    const resolved = resolveSafe(ctx.projectPath, input.path);

    // Staleness check — ensure file hasn't been modified since last read
    const fileState = getFileState(resolved);
    if (fileState) {
      try {
        const currentStat = await stat(resolved);
        if (currentStat.mtimeMs > fileState.timestamp + 1000) {
          return {
            success: false,
            output: "File was modified since last read (possibly by an external process or a previous edit). Use read_file to see the current content before editing.",
          };
        }
      } catch {
        // File was deleted — let the readFile below handle the error
      }
    }

    const current = await readFile(resolved, "utf-8");

    let updated: string;

    if (input.old_content !== undefined) {
      // --- Mode 1: String replace ---
      const oldContent = input.old_content;
      const newContent = input.new_content!;

      // Use robust matching with progressive fallbacks
      const actualString = findActualString(current, oldContent);

      if (!actualString) {
        // Build a hint: show the first ~20 chars of old_content + a snippet
        // around any partial match in the file.
        const firstLine = oldContent.split("\n")[0]?.slice(0, 60) ?? "";
        let hint = "";
        if (firstLine) {
          // Try to find a partial match by progressively shorter prefixes.
          for (let n = Math.min(firstLine.length, 30); n >= 8; n -= 4) {
            const probe = firstLine.slice(0, n).trim();
            if (!probe) break;
            const idx = current.indexOf(probe);
            if (idx >= 0) {
              const start = Math.max(0, idx - 40);
              const end = Math.min(current.length, idx + probe.length + 80);
              hint = `\nA partial match was found. Actual text in file near that location:\n---\n${current.slice(start, end)}\n---\nCopy from here verbatim (no line-number prefix).`;
              break;
            }
          }
        }
        return {
          success: false,
          output:
            `old_content not found in file '${input.path}'. Common causes: (1) you copied the line-number prefix '\\d+\\t' from read_file — remove it; (2) whitespace/indentation differs; (3) you paraphrased instead of copying. Re-read the file and copy the exact characters, OR use line-range mode (start_line/end_line/content).` +
            hint,
        };
      }

      if (input.replace_all) {
        updated = current.split(actualString).join(newContent);
      } else {
        // Check uniqueness using the actual matched string
        const occurrences = countOccurrences(current, actualString);
        if (occurrences > 1) {
          return {
            success: false,
            output: `Found ${occurrences} occurrences of old_content in the file. Include more surrounding context to uniquely identify the target, or set replace_all: true to replace all occurrences.`,
          };
        }
        updated = current.replace(actualString, newContent);
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

    // Update file state cache so subsequent edits in the same turn work correctly
    const newStat = await stat(resolved);
    updateFileState(resolved, updated, newStat.mtimeMs);

    return {
      success: true,
      output: `File edited: ${input.path}`,
    };
  },
});
