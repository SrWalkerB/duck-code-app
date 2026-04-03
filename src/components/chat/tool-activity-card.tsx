import { useState } from "react";
import { ChevronRight, Loader2, Check, FileText, Terminal, Search, Pencil, FolderSearch } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ToolActivity } from "@/lib/types";

const TOOL_CONFIG: Record<string, { label: string; icon: typeof FileText; formatInput: (input: Record<string, unknown>) => string }> = {
  Read: {
    label: "Leu",
    icon: FileText,
    formatInput: (input) => basename(String(input.file_path || "")),
  },
  Edit: {
    label: "Editou",
    icon: Pencil,
    formatInput: (input) => basename(String(input.file_path || "")),
  },
  Write: {
    label: "Escreveu",
    icon: Pencil,
    formatInput: (input) => basename(String(input.file_path || "")),
  },
  Bash: {
    label: "Executou",
    icon: Terminal,
    formatInput: (input) => {
      const cmd = String(input.command || "");
      return cmd.length > 60 ? cmd.slice(0, 60) + "…" : cmd;
    },
  },
  Grep: {
    label: "Buscou",
    icon: Search,
    formatInput: (input) => `"${input.pattern || ""}"`,
  },
  Glob: {
    label: "Buscou arquivos",
    icon: FolderSearch,
    formatInput: (input) => String(input.pattern || ""),
  },
};

function getToolConfig(name: string) {
  return TOOL_CONFIG[name] || {
    label: name,
    icon: Terminal,
    formatInput: () => "",
  };
}

function basename(path: string): string {
  return path.split("/").pop() || path;
}

interface ToolActivityCardProps {
  activity: ToolActivity;
}

export function ToolActivityCard({ activity }: ToolActivityCardProps) {
  const [expanded, setExpanded] = useState(false);
  const config = getToolConfig(activity.name);
  const Icon = config.icon;
  const description = config.formatInput(activity.input);
  const isDone = activity.status === "done";
  const hasResult = activity.result && activity.result.length > 0;

  return (
    <div className="my-1.5">
      <button
        type="button"
        onClick={() => hasResult && setExpanded(!expanded)}
        className={cn(
          "flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-left text-xs transition-colors",
          "text-muted-foreground hover:bg-muted/50",
          hasResult && "cursor-pointer",
          !hasResult && "cursor-default"
        )}
      >
        {/* Status icon */}
        {isDone ? (
          <Check className="size-3.5 shrink-0 text-emerald-500" />
        ) : (
          <Loader2 className="size-3.5 shrink-0 animate-spin text-blue-400" />
        )}

        {/* Tool icon + label */}
        <Icon className="size-3.5 shrink-0 text-muted-foreground/60" />
        <span className="text-muted-foreground/80">{config.label}</span>

        {/* Description */}
        {description && (
          <code className="truncate text-[11px] text-foreground/60">{description}</code>
        )}

        {/* Expand chevron */}
        {hasResult && (
          <ChevronRight
            className={cn(
              "ml-auto size-3.5 shrink-0 text-muted-foreground/40 transition-transform",
              expanded && "rotate-90"
            )}
          />
        )}
      </button>

      {/* Expanded result */}
      {expanded && hasResult && (
        <div className="ml-5 mt-1 max-h-48 overflow-auto rounded-md bg-secondary/50 p-3">
          <pre className="whitespace-pre-wrap text-[11px] leading-relaxed text-foreground/70">
            {activity.result!.length > 2000
              ? activity.result!.slice(0, 2000) + "\n…(truncated)"
              : activity.result}
          </pre>
        </div>
      )}
    </div>
  );
}
