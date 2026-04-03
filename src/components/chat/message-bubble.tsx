import { useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Message, ToolActivity } from "@/lib/types";
import { Bot } from "lucide-react";
import { ToolActivityCard } from "./tool-activity-card";
import { parseOptions, OptionButtons } from "./option-buttons";
import { QuestionForm } from "./question-form";

const MODEL_LABELS: Record<string, string> = {
  "claude-opus-4-6": "Opus 4.6",
  "claude-sonnet-4-6": "Sonnet 4.6",
  "claude-haiku-4-5": "Haiku 4.5",
};

function getModelLabel(model: string): string {
  const base = model.replace("[1m]", "");
  return MODEL_LABELS[base] || base;
}

interface MessageBubbleProps {
  message: Message;
  model?: string;
  onSendMessage?: (content: string) => void;
  isLastAssistant?: boolean;
}

export function MessageBubble({ message, model, onSendMessage, isLastAssistant }: MessageBubbleProps) {
  const isUser = message.role === "user";

  const handleOptionSelect = useCallback(
    (value: string) => {
      onSendMessage?.(value);
    },
    [onSendMessage]
  );

  if (isUser) {
    return (
      <div className="flex justify-end py-3">
        <div className="max-w-[85%] rounded-2xl bg-secondary px-4 py-2.5">
          <p className="text-sm whitespace-pre-wrap text-foreground">{message.content}</p>
        </div>
      </div>
    );
  }

  // Check if this message has selectable options (only on last assistant message)
  const parsed = isLastAssistant ? parseOptions(message.content) : null;

  return (
    <div className="py-4">
      {/* Model label with bot icon */}
      {model && (
        <div className="mb-2 flex items-center gap-1.5">
          <Bot className="size-4 text-muted-foreground/60" />
          <span className="text-xs font-medium text-muted-foreground/60">{getModelLabel(model)}</span>
        </div>
      )}

      <div className="prose dark:prose-invert prose-sm max-w-none
        [&_pre]:rounded-lg [&_pre]:bg-secondary [&_pre]:p-3
        [&_code]:rounded [&_code]:bg-secondary [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:text-xs
        [&_p]:leading-relaxed [&_li]:leading-relaxed
        [&_h1]:text-base [&_h2]:text-sm [&_h3]:text-sm [&_h4]:text-sm
        [&_strong]:text-foreground
        [&_table]:w-full [&_table]:border-collapse [&_table]:text-xs [&_table]:my-4
        [&_th]:border [&_th]:border-border [&_th]:bg-secondary [&_th]:px-3 [&_th]:py-1.5 [&_th]:text-left [&_th]:font-medium
        [&_td]:border [&_td]:border-border [&_td]:px-3 [&_td]:py-1.5
        [&_p]:my-2 [&_h1]:mt-4 [&_h2]:mt-4 [&_h3]:mt-3 [&_ul]:my-2 [&_ol]:my-2 [&_pre]:my-3">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>
          {parsed ? parsed.questionText : message.content}
        </ReactMarkdown>
      </div>

      {parsed && onSendMessage && (
        <OptionButtons options={parsed.options} onSelect={handleOptionSelect} />
      )}
    </div>
  );
}

interface StreamingBubbleProps {
  content: string;
  toolUse: string | null;
  toolActivities?: ToolActivity[];
  model?: string;
  onAnswerQuestion?: (answers: string) => void;
}

export function StreamingBubble({ content, toolUse, toolActivities = [], model, onAnswerQuestion }: StreamingBubbleProps) {
  return (
    <div className="py-4">
      {/* Model label with bot icon */}
      {model && (
        <div className="mb-2 flex items-center gap-1.5">
          <Bot className="size-4 text-muted-foreground/60" />
          <span className="text-xs font-medium text-muted-foreground/60">{getModelLabel(model)}</span>
        </div>
      )}

      {/* Tool activities */}
      {toolActivities.length > 0 && (
        <div className="mb-2">
          {toolActivities.map((activity) => {
            if (
              activity.name === "AskUserQuestion" &&
              activity.status === "running"
            ) {
              const input = activity.input as {
                questions?: {
                  question: string;
                  header: string;
                  multiSelect: boolean;
                  options: { label: string; description?: string }[];
                }[];
              };
              if (input.questions && Array.isArray(input.questions)) {
                return (
                  <QuestionForm
                    key={activity.tool_use_id}
                    questions={input.questions}
                    onSubmit={onAnswerQuestion!}
                  />
                );
              }
            }
            return (
              <ToolActivityCard
                key={activity.tool_use_id}
                activity={activity}
              />
            );
          })}
        </div>
      )}

      {/* Thinking/tool use indicator (when no tool activities) */}
      {toolUse && toolActivities.length === 0 && (
        <p className="mb-2 text-sm text-muted-foreground">{toolUse}</p>
      )}

      {content ? (
        <div className="prose dark:prose-invert prose-sm max-w-none
          [&_pre]:rounded-lg [&_pre]:bg-secondary [&_pre]:p-3
          [&_code]:rounded [&_code]:bg-secondary [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:text-xs
          [&_p]:leading-relaxed [&_li]:leading-relaxed
          [&_h1]:text-base [&_h2]:text-sm [&_h3]:text-sm [&_h4]:text-sm
          [&_strong]:text-foreground">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
          <span className="inline-block size-2 animate-pulse rounded-full bg-foreground/40 ml-1 align-middle" />
        </div>
      ) : (
        <div className="flex items-center gap-1.5 py-1">
          <span className="inline-block size-1.5 animate-pulse rounded-full bg-foreground/30" />
          <span className="inline-block size-1.5 animate-pulse rounded-full bg-foreground/30 [animation-delay:150ms]" />
          <span className="inline-block size-1.5 animate-pulse rounded-full bg-foreground/30 [animation-delay:300ms]" />
        </div>
      )}
    </div>
  );
}
