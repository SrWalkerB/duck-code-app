/**
 * AskUserQuestion Tool — pausa a execução e pergunta ao usuário.
 *
 * Schema rico inspirado em `example/openclaude/src/tools/AskUserQuestionTool/`:
 * `questions` é um array (1-4 perguntas), cada uma com `question`, `header` (chip
 * curto), `options` (1-4 escolhas com `{label, description}`), e `multiSelect`.
 *
 * Para tolerar modelos pequenos que ainda mandam o shape legado
 * (`{question: "...", options: ["A","B"]}`), um preprocessor normaliza a entrada
 * antes do zod validar.
 */

import { z } from "zod";
import { buildTool } from "../tool.js";
import { coerceBoolean } from "../schema/coerce.js";

// ---------------------------------------------------------------------------
// Rich schema
// ---------------------------------------------------------------------------

const optionSchema = z.object({
  label: z.string().min(1).max(80).describe("Display text (1-5 words). Concise and descriptive."),
  description: z.string().max(200).optional().describe("Short explanation of the trade-off or implication. Optional."),
});

const questionSchema = z.object({
  question: z.string().min(1).describe("The full question, ending with '?'. Clear and specific."),
  header: z.string().max(12).optional().describe("Very short chip label (max 12 chars), e.g. 'Library', 'Auth'."),
  options: z.array(optionSchema).min(1).max(4).describe("1-4 choices. Ideally 2-4; 1 is allowed for confirmation."),
  multiSelect: coerceBoolean(z.boolean().default(false)).describe("true = user can pick multiple."),
});

// ---------------------------------------------------------------------------
// Legacy → rich normalizer (preprocessor)
// ---------------------------------------------------------------------------

/**
 * Accepts legacy shape `{question, options: string[]}` OR partial mixes and
 * maps them to the rich `{questions: [...]}` shape. Uses `unknown` input so
 * we can probe duck-typed fields safely.
 */
function normalizeToRich(v: unknown): unknown {
  if (!v || typeof v !== "object" || Array.isArray(v)) return v;
  const obj = v as Record<string, unknown>;

  // Already rich
  if (Array.isArray(obj.questions)) return v;

  // Legacy: single question at top level
  if (typeof obj.question === "string") {
    const rawOptions = obj.options;
    let options: { label: string; description?: string }[] = [];

    if (Array.isArray(rawOptions)) {
      options = rawOptions.map((opt): { label: string; description?: string } => {
        if (typeof opt === "string") return { label: opt };
        if (opt && typeof opt === "object") {
          const o = opt as Record<string, unknown>;
          return {
            label: typeof o.label === "string" ? o.label : String(o.label ?? o.value ?? ""),
            description: typeof o.description === "string" ? o.description : undefined,
          };
        }
        return { label: String(opt) };
      });
    } else if (typeof rawOptions === "string") {
      options = [{ label: rawOptions }];
    }

    // If no options at all, provide default Yes/No confirmation pair
    if (options.length === 0) {
      options = [{ label: "Yes" }, { label: "No" }];
    }

    return {
      questions: [
        {
          question: obj.question,
          header: typeof obj.header === "string" ? obj.header : undefined,
          options,
          multiSelect: obj.multiSelect ?? false,
        },
      ],
    };
  }

  return v;
}

// ---------------------------------------------------------------------------
// Tool
// ---------------------------------------------------------------------------

export const AskUserTool = buildTool({
  name: "ask_user",
  description: `Ask the user a question (or up to 4 related questions) when you need clarification, a decision, or a preference.

WHEN TO USE:
- Instructions are ambiguous and you need to clarify before proceeding
- You need the user to choose between distinct approaches
- You need a preference that wasn't specified
- You want to confirm before a significant change

WHEN NOT TO USE:
- Questions you can answer yourself by reading the code
- Trivial confirmations (use your best judgment)

AFTER CALLING: include the question in your response and STOP making tool calls. Wait for the user's answer in their next message.

SHAPE:
  { questions: [ { question, header?, options: [{label, description?}], multiSelect? } ] }
- 1 to 4 questions per call.
- Each question: 1 to 4 options. 2-4 is ideal; 1 is OK for a simple "proceed?".
- Option labels should be 1-5 words. Add short description when the trade-off isn't obvious.
- Legacy shape {question, options: string[]} is still accepted.`,

  inputSchema: z.preprocess(
    normalizeToRich,
    z.object({
      questions: z.array(questionSchema).min(1).max(4).describe("1-4 questions to ask the user"),
    }),
  ),

  isReadOnly: true,
  isConcurrencySafe: false,

  call: async (input, ctx) => {
    const parsed = input as { questions: { question: string; header?: string; options: { label: string; description?: string }[]; multiSelect: boolean }[] };

    // Format a readable summary for the activity feed + tool_result
    const blocks = parsed.questions.map((q, qi) => {
      const headerChip = q.header ? `[${q.header}] ` : "";
      const optsText = q.options
        .map((o, oi) => {
          const desc = o.description ? ` — ${o.description}` : "";
          return `  ${oi + 1}. ${o.label}${desc}`;
        })
        .join("\n");
      const multi = q.multiSelect ? " (multi-select)" : "";
      return `Q${parsed.questions.length > 1 ? qi + 1 : ""}: ${headerChip}${q.question}${multi}\n${optsText}`;
    });

    const summary = blocks.join("\n\n");

    ctx.onActivity({
      kind: "ask_user",
      tool: "ask_user",
      summary: `Question for user:\n${summary}`,
      data: { questions: parsed.questions },
    });

    return {
      success: true,
      output: `Questions sent to user:\n${summary}\n\nIMPORTANT: Include the question(s) in your text response and STOP making tool calls. Wait for the user's reply.`,
    };
  },
});
