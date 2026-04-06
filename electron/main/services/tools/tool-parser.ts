export interface ParsedToolCall {
  name: string;
  args: Record<string, unknown>;
}

export interface ParserFeedResult {
  /** Text to emit as normal chat delta (outside of tool_call blocks). */
  textToEmit: string;
  /** Parsed tool call if a complete block was found. */
  toolCall: ParsedToolCall | null;
}

const OPEN_TAG = "<tool_call>";
const CLOSE_TAG = "</tool_call>";

type ParserState = "normal" | "collecting";

/** Try to parse a raw string as a tool call JSON. Multiple fallback strategies. */
function parseToolCallJson(raw: string): ParsedToolCall | null {
  if (!raw) return null;

  // 1. Try direct parse
  try {
    const parsed = JSON.parse(raw) as { name?: string; args?: Record<string, unknown> };
    if (typeof parsed.name === "string" && parsed.name) {
      return { name: parsed.name, args: parsed.args ?? {} };
    }
  } catch { /* continue to fallbacks */ }

  // 2. Sanitize common issues from local models (literal newlines, trailing commas)
  try {
    let sanitized = raw;
    sanitized = sanitized.replace(/\r\n/g, "\\n");
    sanitized = sanitized.replace(/\n/g, "\\n");
    sanitized = sanitized.replace(/\t/g, "\\t");
    sanitized = sanitized.replace(/,\s*([}\]])/g, "$1");
    const parsed = JSON.parse(sanitized) as { name?: string; args?: Record<string, unknown> };
    if (typeof parsed.name === "string" && parsed.name) {
      return { name: parsed.name, args: parsed.args ?? {} };
    }
  } catch { /* continue to regex */ }

  // 3. Regex extraction — last resort
  const nameMatch = raw.match(/"name"\s*:\s*"([^"]+)"/);
  if (!nameMatch) return null;

  const name = nameMatch[1];
  const args: Record<string, unknown> = {};

  const pathMatch = raw.match(/"path"\s*:\s*"([^"]*(?:\\.[^"]*)*)"/);
  if (pathMatch) args.path = pathMatch[1].replace(/\\"/g, '"');

  const contentMatch = raw.match(/"content"\s*:\s*"([\s\S]*)"\s*\}\s*\}/);
  if (contentMatch) {
    let content = contentMatch[1];
    content = content.replace(/\\n/g, "\n");
    content = content.replace(/\\t/g, "\t");
    content = content.replace(/\\"/g, '"');
    content = content.replace(/\\\\/g, "\\");
    args.content = content;
  }

  const oldContentMatch = raw.match(/"old_content"\s*:\s*"([\s\S]*?)(?:"\s*,\s*"new_content)/);
  if (oldContentMatch) args.old_content = oldContentMatch[1].replace(/\\n/g, "\n").replace(/\\"/g, '"');

  const newContentMatch = raw.match(/"new_content"\s*:\s*"([\s\S]*)"\s*\}\s*\}/);
  if (newContentMatch) args.new_content = newContentMatch[1].replace(/\\n/g, "\n").replace(/\\"/g, '"');

  const commandMatch = raw.match(/"command"\s*:\s*"([^"]*(?:\\.[^"]*)*)"/);
  if (commandMatch) args.command = commandMatch[1].replace(/\\"/g, '"');

  const patternMatch = raw.match(/"pattern"\s*:\s*"([^"]*(?:\\.[^"]*)*)"/);
  if (patternMatch) args.pattern = patternMatch[1];

  const oldPathMatch = raw.match(/"old_path"\s*:\s*"([^"]*(?:\\.[^"]*)*)"/);
  if (oldPathMatch) args.old_path = oldPathMatch[1];

  const newPathMatch = raw.match(/"new_path"\s*:\s*"([^"]*(?:\\.[^"]*)*)"/);
  if (newPathMatch) args.new_path = newPathMatch[1];

  return { name, args };
}

export class ToolCallParser {
  private state: ParserState = "normal";
  private buffer = "";
  private toolBuffer = "";
  private _pendingToolCall: ParsedToolCall | null = null;

  /** Feed a chunk of streamed text. May return text to emit and/or a parsed tool call. */
  feed(chunk: string): ParserFeedResult[] {
    this.buffer += chunk;
    const results: ParserFeedResult[] = [];

    while (this.buffer.length > 0) {
      if (this.state === "normal") {
        const openIdx = this.buffer.indexOf(OPEN_TAG);

        if (openIdx === -1) {
          const safe = this.safeEmitLength(this.buffer, OPEN_TAG);
          if (safe > 0) {
            results.push({ textToEmit: this.buffer.slice(0, safe), toolCall: null });
            this.buffer = this.buffer.slice(safe);
          }
          break;
        }

        if (openIdx > 0) {
          results.push({ textToEmit: this.buffer.slice(0, openIdx), toolCall: null });
        }
        this.buffer = this.buffer.slice(openIdx + OPEN_TAG.length);
        this.state = "collecting";
        this.toolBuffer = "";
      }

      if (this.state === "collecting") {
        const closeIdx = this.buffer.indexOf(CLOSE_TAG);
        const nextOpenIdx = this.buffer.indexOf(OPEN_TAG);

        // Find which delimiter comes first
        let endIdx = -1;
        let skipLength = 0;

        if (closeIdx !== -1 && (nextOpenIdx === -1 || closeIdx <= nextOpenIdx)) {
          // Close tag found first — standard case
          endIdx = closeIdx;
          skipLength = CLOSE_TAG.length;
        } else if (nextOpenIdx !== -1) {
          // Another open tag before close — model didn't close the tag
          endIdx = nextOpenIdx;
          skipLength = 0; // Don't consume the next <tool_call>
        }

        if (endIdx === -1) {
          // Neither found yet — accumulate and wait
          this.toolBuffer += this.buffer;
          this.buffer = "";
          break;
        }

        this.toolBuffer += this.buffer.slice(0, endIdx);
        this.buffer = this.buffer.slice(endIdx + skipLength);
        this.state = "normal";

        const toolCall = parseToolCallJson(this.toolBuffer.trim());
        if (toolCall) {
          results.push({ textToEmit: "", toolCall });
        }
        // If parse fails, silently discard — don't leak raw JSON to chat
        this.toolBuffer = "";
      }
    }

    return results;
  }

  /** Flush any remaining buffered text (call at end of stream). */
  flush(): string {
    let remaining = "";
    if (this.state === "collecting") {
      // Try to parse the unclosed tool_call
      const toolCall = parseToolCallJson(this.toolBuffer.trim());
      if (toolCall) {
        this._pendingToolCall = toolCall;
        remaining = this.buffer;
      } else {
        // Can't parse — return as remaining text but don't include raw JSON
        remaining = this.buffer;
      }
    } else {
      remaining = this.buffer;
    }
    this.buffer = "";
    this.toolBuffer = "";
    this.state = "normal";
    return remaining;
  }

  /** Get any tool call found during flush that wasn't properly closed. */
  getPendingToolCall(): ParsedToolCall | null {
    const tc = this._pendingToolCall;
    this._pendingToolCall = null;
    return tc;
  }

  private safeEmitLength(text: string, tag: string): number {
    for (let i = 1; i < tag.length && i <= text.length; i++) {
      if (text.endsWith(tag.slice(0, i))) {
        return text.length - i;
      }
    }
    return text.length;
  }
}

/**
 * Extract all tool calls from a complete response text using regex.
 * Handles both <tool_call>...</tool_call> and unclosed <tool_call> blocks.
 */
export function extractToolCallsFromText(text: string): ParsedToolCall[] {
  const results: ParsedToolCall[] = [];

  // Match <tool_call> blocks — closed or delimited by next <tool_call> or end of text
  const regex = /<tool_call>\s*([\s\S]*?)(?:<\/tool_call>|(?=<tool_call>)|$)/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    const raw = match[1].trim();
    if (!raw) continue;

    const parsed = parseToolCallJson(raw);
    if (parsed) {
      results.push(parsed);
    }
  }

  return results;
}

/**
 * Strip all tool_call blocks from response text (for clean display).
 */
export function stripToolCallBlocks(text: string): string {
  // Remove <tool_call>...</tool_call> blocks
  let cleaned = text.replace(/<tool_call>[\s\S]*?<\/tool_call>/g, "");
  // Remove unclosed <tool_call> blocks (delimited by next <tool_call> or greedy to end)
  cleaned = cleaned.replace(/<tool_call>[\s\S]*?(?=<tool_call>)/g, "");
  // Remove any remaining single <tool_call> at the end
  cleaned = cleaned.replace(/<tool_call>[\s\S]*$/g, "");
  return cleaned.trim();
}
