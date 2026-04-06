/**
 * Tool Registry — central registry of all available tools.
 *
 * To add a new tool:
 * 1. Create a file in this directory (e.g., my-tool.ts)
 * 2. Export the tool using buildTool()
 * 3. Import and add it to TOOL_REGISTRY below
 *
 * The tool will automatically:
 * - Appear in the system prompt sent to the LLM
 * - Be validated with its Zod schema
 * - Have permissions checked based on approvalMode
 * - Be logged in the database
 * - Participate in concurrent/serial orchestration
 */

import type { ToolDef } from "../tool.js";
import { ReadFileTool } from "./read-file.js";
import { WriteFileTool } from "./write-file.js";
import { EditFileTool } from "./edit-file.js";
import { DeleteFileTool } from "./delete-file.js";
import { GlobTool } from "./glob.js";
import { GrepTool } from "./grep.js";
import { ListFilesTool } from "./list-files.js";
import { RenameFileTool } from "./rename-file.js";
import { CreateDirectoryTool } from "./create-directory.js";
import { BashTool } from "./bash.js";

export const TOOL_REGISTRY: ToolDef<any>[] = [
  ReadFileTool,
  WriteFileTool,
  EditFileTool,
  DeleteFileTool,
  GlobTool,
  GrepTool,
  ListFilesTool,
  RenameFileTool,
  CreateDirectoryTool,
  BashTool,
];

/** Find a tool by its name. Returns undefined if not found. */
export function findToolByName(name: string): ToolDef<any> | undefined {
  return TOOL_REGISTRY.find((t) => t.name === name);
}

/** Generate tool descriptions for the system prompt */
export function generateToolDocs(): string {
  return TOOL_REGISTRY.map((tool) => {
    const schema = tool.inputSchema;
    // Extract parameter info from Zod schema
    let argsDoc = "";
    if ("shape" in schema && schema.shape) {
      const shape = schema.shape as Record<string, any>;
      argsDoc = Object.entries(shape)
        .map(([key, val]) => {
          const isOptional = val.isOptional?.() ?? false;
          const desc = val._def?.description ?? val.description ?? "";
          return `  - ${key}${isOptional ? " (optional)" : " (required)"}: ${desc}`;
        })
        .join("\n");
    }
    return `## ${tool.name}\n${tool.description}\n${argsDoc ? `Args:\n${argsDoc}` : ""}`;
  }).join("\n\n");
}
