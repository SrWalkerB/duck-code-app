/**
 * Prompt Variants — Model-specific prompt tuning
 *
 * Different local models respond better to different prompt styles.
 * This registry provides per-model configuration for the system prompt.
 */

export interface PromptVariant {
  /** How many times to reinforce the XML tool_call format (0-2) */
  toolFormatRepetitions: number;
  /** Whether to include a concrete tool_call example */
  includeExample: boolean;
  /** Maximum total characters for the system prompt */
  maxSystemPromptChars: number;
  /** Extra instructions specific to this model family */
  extraInstructions?: string;
}

const VARIANTS: Record<string, PromptVariant> = {
  gemma: {
    toolFormatRepetitions: 1,
    includeExample: true,
    maxSystemPromptChars: 6000,
    extraInstructions: "Be direct and concise. Respond in the user's language.",
  },
  llama: {
    toolFormatRepetitions: 1,
    includeExample: true,
    maxSystemPromptChars: 8000,
  },
  qwen: {
    toolFormatRepetitions: 0,
    includeExample: true,
    maxSystemPromptChars: 8000,
  },
  mistral: {
    toolFormatRepetitions: 1,
    includeExample: true,
    maxSystemPromptChars: 8000,
  },
  codestral: {
    toolFormatRepetitions: 0,
    includeExample: true,
    maxSystemPromptChars: 10000,
  },
  deepseek: {
    toolFormatRepetitions: 0,
    includeExample: true,
    maxSystemPromptChars: 10000,
  },
  phi: {
    toolFormatRepetitions: 2,
    includeExample: true,
    maxSystemPromptChars: 4000,
  },
};

const DEFAULT_VARIANT: PromptVariant = {
  toolFormatRepetitions: 1,
  includeExample: true,
  maxSystemPromptChars: 8000,
};

/**
 * Get the prompt variant for a given model ID.
 * Detection is by substring matching on the model ID string.
 */
export function getPromptVariant(modelId: string): PromptVariant {
  const lower = modelId.toLowerCase();

  for (const [key, variant] of Object.entries(VARIANTS)) {
    if (lower.includes(key)) {
      return variant;
    }
  }

  return DEFAULT_VARIANT;
}
