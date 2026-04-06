import { useAppStore } from "@/stores/app-store";
import { Shield, Check, X } from "lucide-react";

const TOOL_ICONS: Record<string, string> = {
  create_file: "📄",
  edit_file: "✏️",
  delete_file: "🗑️",
  rename_file: "📝",
  create_directory: "📁",
  run_command: "⚡",
};

export function ToolApprovalCard() {
  const activeThreadId = useAppStore((s) => s.activeThreadId);
  const activeStreams = useAppStore((s) => s.activeStreams);
  const respondToolApproval = useAppStore((s) => s.respondToolApproval);

  const pendingToolApproval = activeThreadId
    ? activeStreams[activeThreadId]?.pendingToolApproval ?? null
    : null;

  if (!pendingToolApproval || !activeThreadId) return null;

  const icon = TOOL_ICONS[pendingToolApproval.tool] ?? "🔧";

  return (
    <div className="mx-auto max-w-2xl px-4 py-2">
      <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/5 p-4">
        <div className="flex items-center gap-2 mb-3">
          <Shield className="h-4 w-4 text-yellow-500" />
          <span className="text-xs font-medium text-yellow-500 uppercase tracking-wide">
            Aprovação necessária
          </span>
        </div>

        <div className="mb-3">
          <p className="text-sm text-foreground">
            {icon} {pendingToolApproval.description}
          </p>
        </div>

        {pendingToolApproval.args && Object.keys(pendingToolApproval.args).length > 0 && (
          <div className="mb-3 rounded bg-secondary/50 p-2 text-xs font-mono text-muted-foreground overflow-x-auto">
            {Object.entries(pendingToolApproval.args).map(([key, value]) => {
              const strValue = typeof value === "string" ? value : JSON.stringify(value);
              const truncated = strValue.length > 200 ? `${strValue.slice(0, 200)}...` : strValue;
              return (
                <div key={key} className="mb-1 last:mb-0">
                  <span className="text-foreground/60">{key}:</span>{" "}
                  <span className="text-foreground/80">{truncated}</span>
                </div>
              );
            })}
          </div>
        )}

        <div className="flex gap-2">
          <button
            onClick={() => respondToolApproval(activeThreadId, true)}
            className="flex items-center gap-1.5 rounded-md bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-700 transition-colors"
          >
            <Check className="h-3 w-3" />
            Aprovar
          </button>
          <button
            onClick={() => respondToolApproval(activeThreadId, false)}
            className="flex items-center gap-1.5 rounded-md bg-red-600/80 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700 transition-colors"
          >
            <X className="h-3 w-3" />
            Rejeitar
          </button>
        </div>
      </div>
    </div>
  );
}
