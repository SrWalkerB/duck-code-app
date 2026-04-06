import { z } from "zod";
import { writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { buildTool, resolveSafe } from "../tool.js";

const MAX_FILE_SIZE = 1_048_576; // 1 MB

export const WriteFileTool = buildTool({
  name: "write_file",
  description: `Create a new file or completely overwrite an existing one.
- Creates parent directories automatically if needed
- For existing files, prefer edit_file instead — it only changes what's needed
- Choose descriptive file names based on the content (e.g. snake-game.html, not index.html)
- NEVER create documentation files (*.md) or README files unless explicitly requested`,

  inputSchema: z.object({
    path: z.string().min(1).describe("File path relative to the project root"),
    content: z.string().describe("The content to write to the file"),
  }),

  isReadOnly: false,
  isConcurrencySafe: false,

  validateInput: (input) => {
    if (input.content.length > MAX_FILE_SIZE) {
      return { valid: false, error: `File content exceeds ${MAX_FILE_SIZE} bytes limit` };
    }
    return { valid: true };
  },

  call: async (input, ctx) => {
    const resolved = resolveSafe(ctx.projectPath, input.path);
    // Ensure parent directories exist
    const parentDir = resolve(resolved, "..");
    await mkdir(parentDir, { recursive: true });
    await writeFile(resolved, input.content, "utf-8");
    return {
      success: true,
      output: `File created: ${input.path} (${input.content.length} chars)`,
      metadata: { chars: input.content.length },
    };
  },
});
