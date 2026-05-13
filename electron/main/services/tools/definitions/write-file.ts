import { z } from "zod";
import { writeFile, mkdir, stat, access } from "node:fs/promises";
import { resolve } from "node:path";
import { buildTool, resolveSafe } from "../tool.js";
import { getFileState, updateFileState } from "../file-state.js";
import { coerceString } from "../schema/coerce.js";

const MAX_FILE_SIZE = 1_048_576; // 1 MB

export const WriteFileTool = buildTool({
  name: "write_file",
  description: `Create a new file or completely overwrite an existing one.
- Creates parent directories automatically if needed
- For existing files, prefer edit_file instead — it only changes what's needed
- You MUST read existing files with read_file before overwriting them
- Choose descriptive file names based on the content (e.g. snake-game.html, not index.html)
- NEVER create documentation files (*.md) or README files unless explicitly requested`,

  inputSchema: z.object({
    path: coerceString(z.string().min(1)).describe("File path relative to the project root"),
    content: coerceString(z.string()).describe("The content to write to the file (a single JSON string; use \\n for newlines)"),
  }),

  isReadOnly: false,
  isConcurrencySafe: false,

  validateInput: (input, ctx) => {
    if (input.content.length > MAX_FILE_SIZE) {
      return { valid: false, error: `File content exceeds ${MAX_FILE_SIZE} bytes limit` };
    }
    return { valid: true };
  },

  call: async (input, ctx) => {
    const resolved = resolveSafe(ctx.projectPath, input.path);

    // Check if file already exists
    let fileExists = false;
    try {
      await access(resolved);
      fileExists = true;
    } catch {
      // File doesn't exist — creating new file is always allowed
    }

    if (fileExists) {
      // Read-before-write enforcement for existing files
      const fileState = getFileState(resolved);
      if (!fileState) {
        return {
          success: false,
          output: "File already exists but has not been read yet. Use read_file first to see current content, or use edit_file for targeted changes. This prevents accidental overwrites.",
        };
      }

      // Staleness check — ensure file hasn't been modified since last read
      try {
        const currentStat = await stat(resolved);
        if (currentStat.mtimeMs > fileState.timestamp + 1000) {
          return {
            success: false,
            output: "File was modified since last read (possibly by an external process). Use read_file to see the current content before overwriting.",
          };
        }
      } catch {
        // stat failed — file might have been deleted between access and stat, proceed
      }
    }

    // Ensure parent directories exist
    const parentDir = resolve(resolved, "..");
    await mkdir(parentDir, { recursive: true });
    await writeFile(resolved, input.content, "utf-8");

    // Update file state cache
    const newStat = await stat(resolved);
    updateFileState(resolved, input.content, newStat.mtimeMs);

    const action = fileExists ? "overwritten" : "created";
    return {
      success: true,
      output: `File ${action}: ${input.path} (${input.content.length} chars)`,
      metadata: { chars: input.content.length },
    };
  },
});
