/**
 * Tool Definitions — System Prompt Builder
 *
 * Generates the system prompt injected into LLM conversations.
 * The prompt is structured in 5 sections focused on quality, not format.
 *
 * Inspired by OpenClaude's prompts.ts and OpenCode's system.ts
 */

import type { ToolMode } from "../providers/types.js";

// Aggressive cap — local models on LM Studio default to 4096-token context.
// 6_000 chars ≈ 1500 tokens leaves room for tool schemas (~800), history,
// and the model's reply. Larger models simply truncate less; small models
// stop emitting "?" tokens when their context isn't saturated.
const MAX_SYSTEM_PROMPT_CHARS = 6_000;

// ---------------------------------------------------------------------------
// System Prompt Options
// ---------------------------------------------------------------------------

export interface SystemPromptOptions {
  projectPath?: string;
  fileTree?: string;
  modelId?: string;
  /** Contents of key project files (package.json, etc.) */
  keyFileContents?: Record<string, string>;
  /** Tool mode — when "openai", skips Tool Format and Tool Reference sections */
  mode?: ToolMode;
}

// ---------------------------------------------------------------------------
// Section 1: Identity
// ---------------------------------------------------------------------------

function buildIdentitySection(): string {
  return `You are a skilled software engineer working directly in the user's project. You write clean, well-structured, production-quality code. You think before you act: understand the existing codebase before making changes, and explain your reasoning.

# LANGUAGE — TOP PRIORITY
You MUST reply in the SAME language as the user's most recent message. Detect language from the user's last message and match it.
- User writes Portuguese → you reply in Portuguese (pt-BR).
- User writes English → you reply in English.
- User writes Spanish → you reply in Spanish.
This applies to: chat text, ask_user question text, ask_user option labels and descriptions, and ALL human-readable text you produce. It does NOT apply to code or file contents.
Example: if the user wrote "Quero melhorar meu jogo da velha", reply STARTS in Portuguese — never "What would you like..." Always "O que você gostaria..." or similar.`;
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

  // Skip embedding key file contents in openai-mode: tools (read_file) can
  // fetch them on demand, and dumping them here saturates small local models'
  // context window — a leading cause of "?" hallucination on gpt-oss-20b.
  if (
    options.mode !== "openai" &&
    options.keyFileContents &&
    Object.keys(options.keyFileContents).length > 0
  ) {
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

function buildBehaviorSection(_mode?: ToolMode): string {
  const rules = [
    "The Environment section above lists the current project files and, for small projects, their contents. ALWAYS consult it first — a project may already exist even if this chat is new. Do NOT create files that already appear in the file tree; read and edit them instead",
    "Before editing a file, ALWAYS read it first with read_file to understand its content and context. Read each file AT MOST ONCE per turn — if read_file returns a 'File unchanged since last read' stub, STOP re-reading and proceed with the earlier content",
    "EXECUTE the user's request — do not merely inspect and summarize. If the user asks to improve, beautify, refactor, add, or change something, you MUST produce the corresponding edit_file / write_file calls. Saying 'no changes performed' when the user asked for changes is a FAILURE",
    "When the user requests aesthetic improvements ('mais bonito', 'prettier', 'improve style', 'melhorar'), DO NOT ask 'what would you like'. Instead make CONCRETE OPINIONATED CHANGES: pick a modern color palette, add box-shadow, rounded corners, smooth hover/transition, better typography (system-ui or Inter), spacing, and apply them via edit_file. Then briefly summarize what you changed",
    "Don't ask vague open-ended questions like 'what would you like me to work on'. The user already told you in their last message — re-read it and act. Use ask_user only for genuine forks where 2 distinct approaches both make sense",
    "When extracting old_content for edit_file, COPY ONLY the file content — read_file shows lines as '<spaces><number>\\t<content>'. The '<spaces><number>\\t' part is METADATA shown by the tool. Strip it. old_content must contain ONLY what is actually in the file",
    "Do NOT use placeholder text like 'Option1', 'Option2', 'TODO' in ask_user options or anywhere else. If you don't know what to ask, don't call ask_user — just proceed or describe the choice in plain text",
    "NEVER emit special control tokens like '<|channel|>', '<|message|>', or '<|end|>' in your reply. Reply with normal prose and tool calls only",
    "Do not create files unless they are necessary. Prefer editing existing files over creating new ones",
    'Choose descriptive file names based on content — for a snake game use "snake-game.html", not "index.html" or "game.html"',
    "For multi-file projects, ensure all cross-file references are correct (CSS links, JS imports, etc.)",
    'Write COMPLETE, functional code — never use placeholders like "// TODO", "// ...", or "// add code here"',
    "Follow the coding style that already exists in the project (indentation, naming conventions, patterns)",
    "When asked to create something new, use write_file — do NOT just show code in your response",
    "After completing tool operations, provide a clear summary of what was accomplished",
    "Be careful not to introduce security vulnerabilities",
  ];

  rules.push("When you receive tool results, continue working or summarize results — do NOT repeat the tool call");
  rules.push("Every tool argument must be sent as the exact JSON type the schema declares. String fields are JSON strings (e.g. \"hello\\nworld\"). NEVER send arrays or objects where a string is expected");
  rules.push("If a tool returns an error, read the message carefully and retry with corrected arguments on the next turn. NEVER repeat the exact same failing call");
  rules.push("For edit_file: pass old_content as the EXACT text from read_file output (omit the \"N<tab>\" line-number prefix), including indentation and whitespace");
  rules.push("ask_user requires 1-4 questions; each question needs 1-4 options. 2-4 options is ideal; 1 is OK for simple confirmations");

  return `# Rules\n\n${rules.map((r) => `- ${r}`).join("\n")}`;
}

// ---------------------------------------------------------------------------
// Section 4b (OpenAI mode): Tool examples — compact usage samples for small models
// ---------------------------------------------------------------------------

function buildOpenAIToolExamplesSection(): string {
  return `# Tool Usage Examples

read_file({"path": "src/index.ts"})
read_file({"path": "logs/huge.log", "offset": 0, "limit": 500})

write_file({"path": "src/new-file.ts", "content": "export const x = 1;\\n"})

edit_file({"path": "src/a.ts", "old_content": "const x = 1", "new_content": "const x = 2"})
edit_file({"path": "src/a.ts", "old_content": "foo", "new_content": "bar", "replace_all": true})
edit_file({"path": "README.md", "start_line": 10, "end_line": 12, "content": "## Title\\nBody."})

glob({"pattern": "**/*.ts"})
grep({"pattern": "TODO", "include": "**/*.ts"})

ask_user({"questions": [{"question": "Which approach?", "header": "Approach", "options": [{"label": "REST"}, {"label": "GraphQL"}]}]})
ask_user({"questions": [{"question": "Proceed?", "options": [{"label": "Yes"}, {"label": "No"}]}]})

todo_write({"todos": [{"content": "Read script.js", "status": "in_progress"}, {"content": "Add AI logic", "status": "pending"}]})`;
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
  const sections = [
    buildIdentitySection(),
    buildEnvironmentSection(options),
    buildBehaviorSection(options.mode),
    buildOpenAIToolExamplesSection(),
  ].filter(Boolean);

  const prompt = sections.join("\n\n");

  return truncatePrompt(prompt, MAX_SYSTEM_PROMPT_CHARS);
}
