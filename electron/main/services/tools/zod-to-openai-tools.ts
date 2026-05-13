/**
 * Zod-to-OpenAI Tool Schema Converter
 *
 * Converts the Zod-based ToolDef schemas into OpenAI function tool schemas.
 * Uses Zod v4's built-in toJSONSchema() for reliable JSON Schema generation.
 */

import { z } from "zod";
import { TOOL_REGISTRY } from "./definitions/index.js";
import type { ToolDef } from "./tool.js";
import type { OpenAIFunctionTool } from "../providers/types.js";

/**
 * Convert a single ToolDef into an OpenAI function tool schema.
 */
export function zodToOpenAITool(tool: ToolDef): OpenAIFunctionTool {
  const jsonSchema = z.toJSONSchema(tool.inputSchema) as Record<string, unknown>;

  // Remove keys that OpenAI doesn't accept
  delete jsonSchema.$schema;

  return {
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: jsonSchema,
    },
  };
}

/**
 * Convert the entire tool registry into OpenAI function tool schemas.
 */
export function buildOpenAIToolSchemas(): OpenAIFunctionTool[] {
  return TOOL_REGISTRY.map(zodToOpenAITool);
}
