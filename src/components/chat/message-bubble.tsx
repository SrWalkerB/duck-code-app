import { useCallback, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Message, ProviderId } from "@/lib/types";
import { Bot, ChevronRight, ChevronDown, Search, FileText, Terminal as TerminalIcon, Pencil, Eye } from "lucide-react";
import { parseOptions, OptionButtons } from "./option-buttons";
import { formatElapsed } from "@/lib/elapsed-time";

const MODEL_LABELS: Record<string, string> = {
  "claude-opus-4-1-20250805": "Opus 4.1",
  "claude-sonnet-4-20250514": "Sonnet 4",
  "claude-3-5-haiku-20241022": "Haiku 3.5",
  "gpt-5.1-codex-mini": "GPT-5.1 Codex Mini",
  "gpt-5-codex": "GPT-5 Codex",
  "gpt-5.1-codex": "GPT-5.1 Codex",
};

function getModelLabel(model: string): string {
  return MODEL_LABELS[model] || model;
}

const proseClasses = `prose dark:prose-invert prose-sm max-w-none
  [&_pre]:rounded-lg [&_pre]:bg-secondary [&_pre]:p-3
  [&_code]:rounded [&_code]:bg-secondary [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:text-xs
  [&_p]:leading-relaxed [&_li]:leading-relaxed
  [&_h1]:text-base [&_h2]:text-sm [&_h3]:text-sm [&_h4]:text-sm
  [&_strong]:text-foreground
  [&_table]:w-full [&_table]:border-collapse [&_table]:text-xs [&_table]:my-4
  [&_th]:border [&_th]:border-border [&_th]:bg-secondary [&_th]:px-3 [&_th]:py-1.5 [&_th]:text-left [&_th]:font-medium
  [&_td]:border [&_td]:border-border [&_td]:px-3 [&_td]:py-1.5
  [&_p]:my-2 [&_h1]:mt-4 [&_h2]:mt-4 [&_h3]:mt-3 [&_ul]:my-2 [&_ol]:my-2 [&_pre]:my-3`;

interface MessageBubbleProps {
  message: Message;
  provider?: ProviderId;
  model?: string;
  onSendMessage?: (content: string) => void;
  isLastAssistant?: boolean;
}

export function MessageBubble({
  message,
  model,
  onSendMessage,
  isLastAssistant,
}: MessageBubbleProps) {
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
          <p className="text-sm whitespace-pre-wrap text-foreground">
            {message.content}
          </p>
        </div>
      </div>
    );
  }

  const parsed = isLastAssistant ? parseOptions(message.content) : null;

  let durationSeconds: number | null = null;
  if (message.metadata) {
    try {
      const meta = JSON.parse(message.metadata) as Record<string, unknown>;
      if (typeof meta.durationMs === "number") {
        durationSeconds = Math.round(meta.durationMs / 1000);
      }
    } catch {
      // ignore
    }
  }

  return (
    <div className="py-4">
      {model && (
        <div className="mb-2 flex items-center gap-1.5">
          <Bot className="size-4 text-muted-foreground/60" />
          <span className="text-xs font-medium text-muted-foreground/60">
            {getModelLabel(model)}
          </span>
          {durationSeconds !== null && durationSeconds > 0 && (
            <>
              <span className="text-xs text-muted-foreground/40">·</span>
              <span className="text-xs text-muted-foreground/40">
                {formatElapsed(durationSeconds)}
              </span>
            </>
          )}
        </div>
      )}

      <div className={proseClasses}>
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

interface StreamingActivity {
  kind: string;
  tool?: string;
  summary: string;
}

interface StreamingBubbleProps {
  content: string;
  elapsedSeconds?: number;
  provider?: ProviderId;
  model?: string;
  activities?: StreamingActivity[];
}

export function StreamingBubble({
  content,
  elapsedSeconds,
  model,
  activities = [],
}: StreamingBubbleProps) {
  return (
    <div className="py-4">
      {model && (
        <div className="mb-2 flex items-center gap-1.5">
          <Bot className="size-4 text-muted-foreground/60" />
          <span className="text-xs font-medium text-muted-foreground/60">
            {getModelLabel(model)}
          </span>
          {elapsedSeconds !== undefined && elapsedSeconds > 0 && (
            <>
              <span className="text-xs text-muted-foreground/40">·</span>
              <span className="text-xs text-muted-foreground/40">
                {formatElapsed(elapsedSeconds)}
              </span>
            </>
          )}
        </div>
      )}

      {content && (
        <div className={proseClasses}>
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
        </div>
      )}

      {/* Activities — below text, showing current work */}
      {activities.length > 0 && (
        <div className="mt-2 flex flex-col gap-0.5">
          {activities.map((act, i) => (
            <ActivityItem key={i} activity={act} />
          ))}
        </div>
      )}

      {/* Loading indicator */}
      <div className="flex items-center gap-2 py-1 mt-1">
        <div className="flex items-center gap-1.5">
          <span className="inline-block size-1.5 animate-pulse rounded-full bg-foreground/30" />
          <span className="inline-block size-1.5 animate-pulse rounded-full bg-foreground/30 [animation-delay:150ms]" />
          <span className="inline-block size-1.5 animate-pulse rounded-full bg-foreground/30 [animation-delay:300ms]" />
        </div>
        {!content && activities.length === 0 && (
          <span className="text-sm text-muted-foreground">Pensando...</span>
        )}
      </div>
    </div>
  );
}

function getToolIcon(tool?: string) {
  if (!tool) return <TerminalIcon className="size-3.5 shrink-0" />;
  const t = tool.toLowerCase();
  if (t.includes("read") || t.includes("cat")) return <Eye className="size-3.5 shrink-0" />;
  if (t.includes("list") || t.includes("ls") || t.includes("search") || t.includes("grep") || t.includes("find")) return <Search className="size-3.5 shrink-0" />;
  if (t.includes("write") || t.includes("edit") || t.includes("patch") || t.includes("create")) return <Pencil className="size-3.5 shrink-0" />;
  if (t.includes("shell") || t.includes("bash") || t.includes("exec") || t.includes("command")) return <TerminalIcon className="size-3.5 shrink-0" />;
  return <FileText className="size-3.5 shrink-0" />;
}

function getToolLabel(tool?: string): string {
  if (!tool) return "Action";
  const t = tool.toLowerCase();
  if (t.includes("read")) return "Read";
  if (t.includes("write") || t.includes("create")) return "Write";
  if (t.includes("edit") || t.includes("patch")) return "Edit";
  if (t.includes("list") || t.includes("ls")) return "List";
  if (t.includes("search") || t.includes("grep") || t.includes("find")) return "Search";
  if (t.includes("shell") || t.includes("bash") || t.includes("exec") || t.includes("command")) return "Ran";
  return tool.length > 20 ? tool.slice(0, 20) : tool;
}

function ActivityItem({ activity }: { activity: StreamingActivity }) {
  const [expanded, setExpanded] = useState(false);
  const isResult = activity.kind === "tool_result";

  return (
    <button
      type="button"
      onClick={() => setExpanded(!expanded)}
      className="flex flex-col w-full text-left group"
    >
      <div className="flex items-center gap-2 py-1 px-2.5 rounded-md text-xs text-muted-foreground/60 hover:bg-secondary/50 transition-colors">
        {expanded
          ? <ChevronDown className="size-3 shrink-0 text-muted-foreground/40" />
          : <ChevronRight className="size-3 shrink-0 text-muted-foreground/40" />
        }
        {!isResult && getToolIcon(activity.tool)}
        <span className="font-medium text-muted-foreground/70">
          {isResult ? "Output" : getToolLabel(activity.tool)}
        </span>
        <span className="text-muted-foreground/40 truncate text-[11px]">
          {activity.summary}
        </span>
      </div>
      {expanded && (
        <pre className="ml-7 mt-0.5 mb-1 text-[11px] text-muted-foreground/50 bg-secondary/40 rounded-md px-3 py-2 overflow-x-auto max-w-full whitespace-pre-wrap border border-border/20">
          {activity.summary}
        </pre>
      )}
    </button>
  );
}
