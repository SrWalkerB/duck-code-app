import { z } from "zod";
import { mkdir } from "node:fs/promises";
import { buildTool, resolveSafe } from "../tool.js";

export const CreateDirectoryTool = buildTool({
  name: "create_directory",
  description: "Create a directory (and parent directories if needed).",

  inputSchema: z.object({
    path: z.string().min(1).describe("Directory path relative to project root"),
  }),

  isReadOnly: false,
  isConcurrencySafe: false,

  call: async (input, ctx) => {
    const resolved = resolveSafe(ctx.projectPath, input.path);
    await mkdir(resolved, { recursive: true });
    return { success: true, output: `Directory created: ${input.path}` };
  },
});
