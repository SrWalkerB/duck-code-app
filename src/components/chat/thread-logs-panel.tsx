import { useState, useEffect, useCallback } from "react";
import { electronAPI } from "@/lib/electron-api";
import { X, ChevronDown, ChevronRight, Copy, Check } from "lucide-react";
import { cn } from "@/lib/utils";

interface ToolLogEntry {
  timestamp: number;
  type: "system_prompt" | "request" | "response" | "tool_call" | "tool_result" | "re_request";
  content: string;
}

interface ThreadLogs {
  threadId: string;
  runId: string;
  entries: ToolLogEntry[];
}

const TYPE_LABELS: Record<string, { label: string; color: string }> = {
  system_prompt: { label: "System Prompt", color: "text-purple-400" },
  request: { label: "Request", color: "text-blue-400" },
  response: { label: "Response", color: "text-green-400" },
  tool_call: { label: "Tool Call", color: "text-yellow-400" },
  tool_result: { label: "Tool Result", color: "text-orange-400" },
  re_request: { label: "Re-request", color: "text-cyan-400" },
};

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function LogEntry({ entry }: { entry: ToolLogEntry }) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const typeInfo = TYPE_LABELS[entry.type] ?? { label: entry.type, color: "text-muted-foreground" };
  const preview = entry.content.length > 120 ? `${entry.content.slice(0, 120)}...` : entry.content;

  function handleCopy(e: React.MouseEvent) {
    e.stopPropagation();
    navigator.clipboard.writeText(entry.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="border-b border-border/20 last:border-b-0">
      <button
        type="button"
        className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-accent/30 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? (
          <ChevronDown className="size-3 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="size-3 shrink-0 text-muted-foreground" />
        )}
        <span className="text-[10px] text-muted-foreground/60 font-mono shrink-0">
          {formatTime(entry.timestamp)}
        </span>
        <span className={cn("text-[10px] font-medium uppercase tracking-wider shrink-0", typeInfo.color)}>
          {typeInfo.label}
        </span>
        {!expanded && (
          <span className="text-xs text-muted-foreground/50 truncate">
            {preview}
          </span>
        )}
        <button
          type="button"
          onClick={handleCopy}
          className="ml-auto shrink-0 flex items-center justify-center size-5 rounded text-muted-foreground/40 hover:text-muted-foreground hover:bg-accent transition-colors"
          title="Copiar conteúdo"
        >
          {copied ? (
            <Check className="size-3 text-green-400" />
          ) : (
            <Copy className="size-3" />
          )}
        </button>
      </button>
      {expanded && (
        <div className="px-3 pb-3">
          <pre className="rounded bg-secondary/50 p-3 text-xs text-foreground/80 font-mono whitespace-pre-wrap break-all overflow-x-auto max-h-96 overflow-y-auto">
            {entry.content}
          </pre>
        </div>
      )}
    </div>
  );
}

export function ThreadLogsPanel({
  threadId,
  onClose,
}: {
  threadId: string;
  onClose: () => void;
}) {
  const [logs, setLogs] = useState<ThreadLogs[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchLogs = useCallback(async () => {
    try {
      const result = (await electronAPI.invoke("thread:logs", { threadId })) as ThreadLogs[];
      setLogs(result);
    } catch (err) {
      console.error("Erro ao buscar logs:", err);
    } finally {
      setLoading(false);
    }
  }, [threadId]);

  useEffect(() => {
    fetchLogs();

    // Auto-refresh when stream events happen
    const unsubStream = electronAPI.on(`chat:stream:${threadId}`, () => {});
    const unsubActivity = electronAPI.on(`chat:activity:${threadId}`, () => fetchLogs());
    const unsubComplete = electronAPI.on(`chat:complete:${threadId}`, () => fetchLogs());
    const unsubDone = electronAPI.on(`chat:done:${threadId}`, () => fetchLogs());

    return () => {
      unsubStream();
      unsubActivity();
      unsubComplete();
      unsubDone();
    };
  }, [fetchLogs, threadId]);

  const totalEntries = logs.reduce((sum, l) => sum + l.entries.length, 0);

  return (
    <div className="flex h-full min-h-0 flex-col border-l border-border/30 bg-background w-[420px]">
      <div className="flex items-center justify-between border-b border-border/30 px-4 py-2.5">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-medium">Logs</h2>
          <span className="text-[10px] text-muted-foreground/50">
            {totalEntries} entries
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={fetchLogs}
            className="rounded-md px-2 py-1 text-[10px] text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
          >
            Refresh
          </button>
          <button
            type="button"
            onClick={onClose}
            className="flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
          >
            <X className="size-3.5" />
          </button>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
        {loading && (
          <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
            Carregando...
          </div>
        )}

        {!loading && logs.length === 0 && (
          <div className="flex items-center justify-center py-12 text-sm text-muted-foreground/50">
            Sem logs para esta thread
          </div>
        )}

        {logs.map((log) => (
          <div key={log.runId} className="border-b border-border/40">
            <div className="px-3 py-2 bg-secondary/20">
              <span className="text-[10px] font-mono text-muted-foreground/60">
                Run: {log.runId.slice(0, 8)}...
              </span>
            </div>
            {log.entries.map((entry, idx) => (
              <LogEntry key={`${log.runId}-${idx}`} entry={entry} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
