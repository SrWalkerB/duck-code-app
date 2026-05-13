import { useCallback, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Message, ProviderId } from "@/lib/types";
import { Bot, Brain, ChevronRight, ChevronDown, Search, FileText, Terminal as TerminalIcon, Pencil, Eye } from "lucide-react";
import { parseOptions, OptionButtons } from "./option-buttons";
import { AskUserPicker } from "./ask-user-picker";
import { formatElapsed } from "@/lib/elapsed-time";
import type { AskUserPayload } from "@/lib/types";

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

const proseClasses = `prose dark:prose-invert prose-sm max-w-none min-w-0 break-words [overflow-wrap:anywhere]
  [&_pre]:max-w-full [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-secondary [&_pre]:p-3
  [&_code]:rounded [&_code]:bg-secondary [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:text-xs
  [&_p]:leading-relaxed [&_p]:break-words [&_li]:leading-relaxed
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
          <p className="text-sm whitespace-pre-wrap break-words [overflow-wrap:anywhere] text-foreground">
            {message.content}
          </p>
        </div>
      </div>
    );
  }

  const parsed = isLastAssistant ? parseOptions(message.content) : null;

  let durationSeconds: number | null = null;
  let thinkingContent: string | null = null;
  let savedActivities: StreamingActivity[] = [];
  if (message.metadata) {
    try {
      const meta = JSON.parse(message.metadata) as Record<string, unknown>;
      if (typeof meta.durationMs === "number") {
        durationSeconds = Math.round(meta.durationMs / 1000);
      }
      if (typeof meta.thinking === "string") {
        thinkingContent = meta.thinking;
      }
      if (Array.isArray(meta.activities)) {
        savedActivities = meta.activities as StreamingActivity[];
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

      {thinkingContent && (
        <div className="mb-3 ml-7">
          <ThinkingCard summary={thinkingContent} />
        </div>
      )}

      {savedActivities.length > 0 && (
        <div className="mb-3 ml-7 flex w-[calc(100%-1.75rem)] flex-col gap-2">
          {savedActivities.map((act, i) => (
            <ActivityItem
              key={i}
              activity={act}
              isLatest={isLastAssistant && i === savedActivities.length - 1}
              onAnswer={(text) => onSendMessage?.(text)}
            />
          ))}
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
  data?: unknown;
}

interface StreamingBubbleProps {
  content: string;
  elapsedSeconds?: number;
  provider?: ProviderId;
  model?: string;
  activities?: StreamingActivity[];
  onAnswer?: (text: string) => void;
}

export function StreamingBubble({
  content,
  elapsedSeconds,
  model,
  activities = [],
  onAnswer,
}: StreamingBubbleProps) {
  const latestActivity = activities[activities.length - 1];
  const statusTitle = content
    ? "Respondendo"
    : latestActivity
      ? "Processando"
      : "Analisando";
  const statusDescription = latestActivity
    ? latestActivity.summary
    : "A IA esta organizando os proximos passos.";

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

      <div className="mb-3 ml-2 w-[calc(100%-0.5rem)] rounded-lg border border-border/55 bg-secondary/45 px-2.5 py-2">
        <div className="flex items-center gap-2">
          <div className="flex size-6 items-center justify-center rounded-md bg-background/70">
            <Bot className="size-3.5 text-muted-foreground/70" />
          </div>
          <div className="min-w-0">
            <p className="text-xs font-medium text-foreground/90">{statusTitle}</p>
            <p className="truncate text-[11px] text-muted-foreground/70">{statusDescription}</p>
          </div>
        </div>
      </div>

      {content && (
        <div className={proseClasses}>
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
        </div>
      )}

      {/* Activities — below text, showing current work */}
      {activities.length > 0 && (
        <div className="mt-4 ml-7 flex w-[calc(100%-1.75rem)] flex-col gap-2">
          {activities.map((act, i) => (
            <ActivityItem
              key={i}
              activity={act}
              isLatest={i === activities.length - 1}
              elapsedSeconds={elapsedSeconds}
              onAnswer={onAnswer}
            />
          ))}
        </div>
      )}

      {/* Loading indicator */}
      <div className="mt-3 ml-7 flex items-center gap-2 py-1">
        <div className="flex items-center gap-1.5">
          <span className="inline-block size-1.5 animate-pulse rounded-full bg-foreground/30" />
          <span className="inline-block size-1.5 animate-pulse rounded-full bg-foreground/30 [animation-delay:150ms]" />
          <span className="inline-block size-1.5 animate-pulse rounded-full bg-foreground/30 [animation-delay:300ms]" />
        </div>
        <span className="text-xs text-muted-foreground/70">Aguardando conclusao...</span>
      </div>
    </div>
  );
}

function isTerminalTool(tool?: string): boolean {
  if (!tool) return false;
  const t = tool.toLowerCase();
  return (
    t.includes("terminal") ||
    t.includes("shell") ||
    t.includes("bash") ||
    t.includes("exec") ||
    t.includes("command") ||
    t.includes("stdin")
  );
}

function getToolIcon(tool?: string) {
  if (!tool) return <TerminalIcon className="size-3.5 shrink-0" />;
  const t = tool.toLowerCase();
  if (isTerminalTool(tool)) return <TerminalIcon className="size-3.5 shrink-0" />;
  if (t.includes("read") || t.includes("cat")) return <Eye className="size-3.5 shrink-0" />;
  if (t.includes("list") || t.includes("ls") || t.includes("search") || t.includes("grep") || t.includes("find")) return <Search className="size-3.5 shrink-0" />;
  if (t.includes("write") || t.includes("edit") || t.includes("patch") || t.includes("create")) return <Pencil className="size-3.5 shrink-0" />;
  return <FileText className="size-3.5 shrink-0" />;
}

function getToolLabel(tool?: string): string {
  if (!tool) return "Action";
  const t = tool.toLowerCase();
  if (isTerminalTool(tool)) return "Terminal";
  if (t.includes("read")) return "Read";
  if (t.includes("write") || t.includes("create")) return "Write";
  if (t.includes("edit") || t.includes("patch")) return "Edit";
  if (t.includes("list") || t.includes("ls")) return "List";
  if (t.includes("search") || t.includes("grep") || t.includes("find")) return "Search";
  return tool.length > 20 ? tool.slice(0, 20) : tool;
}

function ThinkingCard({
  summary,
  isLatest,
  elapsedSeconds,
}: {
  summary: string;
  isLatest?: boolean;
  elapsedSeconds?: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const previewLine = summary.split("\n")[0]?.slice(0, 80) || "Raciocinio do modelo";
  const elapsedLabel =
    isLatest && elapsedSeconds !== undefined && elapsedSeconds > 0
      ? `· ${formatElapsed(elapsedSeconds)}`
      : null;

  return (
    <button
      type="button"
      onClick={() => setExpanded(!expanded)}
      className="flex w-full flex-col rounded-lg border border-purple-500/20 bg-purple-500/5 p-2.5 text-left transition-colors hover:bg-purple-500/10"
    >
      <div className="flex items-center gap-2 text-xs text-muted-foreground/70">
        {expanded
          ? <ChevronDown className="size-3 shrink-0 text-purple-400/60" />
          : <ChevronRight className="size-3 shrink-0 text-purple-400/60" />
        }
        <div className="flex size-5 items-center justify-center rounded-md bg-purple-500/10">
          <Brain className="size-3.5 shrink-0 text-purple-400/80" />
        </div>
        <span className="font-medium text-purple-300/80">Thinking</span>
        {elapsedLabel && (
          <span className="text-[11px] text-muted-foreground/45">{elapsedLabel}</span>
        )}
      </div>

      {!expanded && (
        <span className="mt-1 truncate pl-7 text-[11px] text-muted-foreground/50">
          {previewLine}
        </span>
      )}

      {expanded && (
        <pre className="mt-2 overflow-x-auto whitespace-pre-wrap rounded-lg border border-purple-500/15 bg-purple-500/5 px-3 py-2 text-[11px] text-muted-foreground/60">
          {summary}
        </pre>
      )}
    </button>
  );
}

function ActivityItem({
  activity,
  isLatest,
  elapsedSeconds,
  onAnswer,
}: {
  activity: StreamingActivity;
  isLatest?: boolean;
  elapsedSeconds?: number;
  onAnswer?: (text: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  if (activity.kind === "thinking") {
    return (
      <ThinkingCard
        summary={activity.summary}
        isLatest={isLatest}
        elapsedSeconds={elapsedSeconds}
      />
    );
  }

  if (activity.kind === "ask_user" && activity.data) {
    const payload = activity.data as AskUserPayload;
    return (
      <AskUserPicker
        payload={payload}
        isLatest={isLatest}
        onAnswer={(text) => onAnswer?.(text)}
      />
    );
  }

  const isResult = activity.kind === "tool_result";
  const isTerminal = isTerminalTool(activity.tool);
  const title = isResult ? "Output" : getToolLabel(activity.tool);
  const elapsedLabel =
    isLatest && elapsedSeconds !== undefined && elapsedSeconds > 0
      ? `· ${formatElapsed(elapsedSeconds)}`
      : null;

  return (
    <button
      type="button"
      onClick={() => setExpanded(!expanded)}
      className="flex w-full flex-col rounded-lg border border-border/55 bg-secondary/35 p-2.5 text-left transition-colors hover:bg-secondary/45"
    >
      <div className="flex items-center gap-2 text-xs text-muted-foreground/70">
        {expanded
          ? <ChevronDown className="size-3 shrink-0 text-muted-foreground/40" />
          : <ChevronRight className="size-3 shrink-0 text-muted-foreground/40" />
        }
        {!isResult && (
          <div className="flex size-5 items-center justify-center rounded-md bg-background/70">
            {getToolIcon(activity.tool)}
          </div>
        )}
        <span className="font-medium text-muted-foreground/70">
          {title}
        </span>
        {elapsedLabel && (
          <span className="text-[11px] text-muted-foreground/45">{elapsedLabel}</span>
        )}
      </div>

      {isTerminal && !isResult && (
        <div className="mt-2 rounded-lg border border-border/50 bg-background/60 p-2">
          <div className="mb-1 text-[11px] text-muted-foreground/60">Shell</div>
          <pre className="overflow-x-auto whitespace-pre-wrap font-mono text-xs text-foreground/90">
            {`$ ${activity.summary}`}
          </pre>
        </div>
      )}

      {!isTerminal && (
        <span className="mt-1 truncate pl-7 text-[11px] text-muted-foreground/50">
          {activity.summary}
        </span>
      )}

      {expanded && (
        <pre className="mt-2 overflow-x-auto whitespace-pre-wrap rounded-lg border border-border/30 bg-background/60 px-3 py-2 text-[11px] text-muted-foreground/55">
          {activity.summary}
        </pre>
      )}
    </button>
  );
}
