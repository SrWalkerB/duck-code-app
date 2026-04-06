import { z } from "zod";
import { unlink } from "node:fs/promises";
import { buildTool, resolveSafe, type PermissionDecision, type ToolUseContext } from "../tool.js";

export const DeleteFileTool = buildTool({
  name: "delete_file",
  description: "Delete a file from the project.",

  inputSchema: z.object({
    path: z.string().min(1).describe("File path relative to the project root"),
  }),

  isReadOnly: false,
  isConcurrencySafe: false,

  // Always ask for approval except in full-auto mode (destructive operation)
  checkPermissions: (input: { path: string }, ctx: ToolUseContext): PermissionDecision => {
    if (ctx.approvalMode === "full-auto") return { behavior: "allow" };
    return { behavior: "ask", description: `Delete file: ${input.path}` };
  },

  call: async (input, ctx) => {
    const resolved = resolveSafe(ctx.projectPath, input.path);
    await unlink(resolved);
    return { success: true, output: `File deleted: ${input.path}` };
  },
});
