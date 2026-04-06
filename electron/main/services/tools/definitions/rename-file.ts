import { z } from "zod";
import { rename, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { buildTool, resolveSafe } from "../tool.js";

export const RenameFileTool = buildTool({
  name: "rename_file",
  description: "Rename or move a file to a new path.",

  inputSchema: z.object({
    old_path: z.string().min(1).describe("Current file path relative to project root"),
    new_path: z.string().min(1).describe("New file path relative to project root"),
  }),

  isReadOnly: false,
  isConcurrencySafe: false,

  call: async (input, ctx) => {
    const resolvedOld = resolveSafe(ctx.projectPath, input.old_path);
    const resolvedNew = resolveSafe(ctx.projectPath, input.new_path);

    // Ensure parent directories of new path exist
    const parentDir = resolve(resolvedNew, "..");
    await mkdir(parentDir, { recursive: true });

    await rename(resolvedOld, resolvedNew);
    return {
      success: true,
      output: `Renamed: ${input.old_path} → ${input.new_path}`,
    };
  },
});
