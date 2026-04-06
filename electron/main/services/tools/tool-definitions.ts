/**
 * Tool Definitions — System Prompt Builder
 *
 * Generates the system prompt injected into LLM conversations.
 * The prompt is structured in 5 sections focused on quality, not format.
 *
 * Inspired by OpenClaude's prompts.ts and OpenCode's system.ts
 */

import { generateToolDocs } from "./definitions/index.js";
import { getPromptVariant, type PromptVariant } from "./prompt-variants.js";

// ---------------------------------------------------------------------------
// System Prompt Options
// ---------------------------------------------------------------------------

export interface SystemPromptOptions {
  projectPath?: string;
  fileTree?: string;
  modelId?: string;
  /** Contents of key project files (package.json, etc.) */
  keyFileContents?: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Section 1: Identity
// ---------------------------------------------------------------------------

function buildIdentitySection(): string {
  return `You are a skilled software engineer working directly in the user's project. You write clean, well-structured, production-quality code. You think before you act: understand the existing codebase before making changes, and explain your reasoning.`;
}

// ---------------------------------------------------------------------------
// Section 2: Environment
// ---------------------------------------------------------------------------

function buildEnvironmentSection(options: SystemPromptOptions): string {
  const parts: string[] = [];

  if (options.projectPath) {
    parts.push(`PROJECT ROOT: ${options.projectPath}`);
  }

  if (options.fileTree) {
    parts.push(`\nCurrent project files:\n${options.fileTree}`);
  }

  if (options.keyFileContents && Object.keys(options.keyFileContents).length > 0) {
    parts.push(`\nKey project files:`);
    for (const [filename, content] of Object.entries(options.keyFileContents)) {
      parts.push(`\n--- ${filename} ---\n${content}`);
    }
  }

  return parts.length > 0 ? `# Environment\n${parts.join("\n")}` : "";
}

// ---------------------------------------------------------------------------
// Section 3: Behavior Rules (quality-focused, inspired by OpenClaude)
// ---------------------------------------------------------------------------

function buildBehaviorSection(): string {
  return `# Rules

- Before editing a file, ALWAYS read it first with read_file to understand its content and context
- Do not create files unless they are necessary. Prefer editing existing files over creating new ones
- Choose descriptive file names based on content — for a snake game use "snake-game.html", not "index.html" or "game.html"
- For multi-file projects, ensure all cross-file references are correct (CSS links, JS imports, etc.)
- Write COMPLETE, functional code — never use placeholders like "// TODO", "// ...", or "// add code here"
- Follow the coding style that already exists in the project (indentation, naming conventions, patterns)
- When asked to create something new, use write_file — do NOT just show code in your response
- After completing tool operations, provide a clear summary of what was accomplished
- Be careful not to introduce security vulnerabilities
- When you receive a <tool_result>, continue working or summarize results — do NOT repeat the tool call`;
}

// ---------------------------------------------------------------------------
// Section 4: Tool Format (minimal, just enough for XML protocol)
// ---------------------------------------------------------------------------

function buildToolFormatSection(variant: PromptVariant): string {
  let section = `# Tool Usage

To use a tool, wrap valid JSON in <tool_call> tags:

<tool_call>
{"name": "tool_name", "args": {"param1": "value1"}}
</tool_call>

IMPORTANT: Use \\n for newlines inside string values (not actual line breaks). Each tool call needs its own <tool_call> tags.`;

  if (variant.includeExample) {
    section += `

EXAMPLE — creating a file:
<tool_call>
{"name": "write_file", "args": {"path": "snake-game.html", "content": "<!DOCTYPE html>\\n<html>\\n<head><title>Snake Game</title></head>\\n<body>\\n<canvas id=\\"game\\"></canvas>\\n</body>\\n</html>"}}
</tool_call>`;
  }

  // Some models need extra reinforcement
  if (variant.toolFormatRepetitions >= 1) {
    section += `\n\nREMINDER: Always use <tool_call> tags to create or edit files. Never just paste code in your response.`;
  }
  if (variant.toolFormatRepetitions >= 2) {
    section += ` The JSON must be on a single line inside the tags.`;
  }

  if (variant.extraInstructions) {
    section += `\n\n${variant.extraInstructions}`;
  }

  return section;
}

// ---------------------------------------------------------------------------
// Section 5: Tool Reference (auto-generated from registry)
// ---------------------------------------------------------------------------

function buildToolReferenceSection(): string {
  return `# Available Tools\n\n${generateToolDocs()}`;
}

// ---------------------------------------------------------------------------
// Truncate prompt to fit model budget
// ---------------------------------------------------------------------------

function truncatePrompt(prompt: string, maxChars: number): string {
  if (prompt.length <= maxChars) return prompt;

  // Strategy: find and truncate the environment section first
  const envHeader = "# Environment\n";
  const envIdx = prompt.indexOf(envHeader);

  if (envIdx !== -1) {
    // Find the next section after environment
    const nextSectionIdx = prompt.indexOf("\n# ", envIdx + envHeader.length);
    if (nextSectionIdx !== -1) {
      const envSection = prompt.slice(envIdx, nextSectionIdx);
      const excess = prompt.length - maxChars;

      if (envSection.length > excess + 200) {
        // Truncate environment section
        const truncatedEnv = envSection.slice(0, envSection.length - excess - 50) +
          "\n... (project context truncated to fit model budget)\n";
        return prompt.slice(0, envIdx) + truncatedEnv + prompt.slice(nextSectionIdx);
      }
    }
  }

  // Last resort: hard truncate
  return prompt.slice(0, maxChars - 50) + "\n... (truncated)";
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export function buildSystemPrompt(options: SystemPromptOptions): string {
  const variant = getPromptVariant(options.modelId ?? "");

  const sections = [
    buildIdentitySection(),
    buildEnvironmentSection(options),
    buildBehaviorSection(),
    buildToolFormatSection(variant),
    buildToolReferenceSection(),
  ].filter(Boolean);

  const prompt = sections.join("\n\n");

  return truncatePrompt(prompt, variant.maxSystemPromptChars);
}
