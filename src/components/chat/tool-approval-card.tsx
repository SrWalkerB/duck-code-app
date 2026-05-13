import { useAppStore } from "@/stores/app-store";
import { Check, X, ShieldAlert, FileText, Pencil, FilePlus, Trash2, Terminal, FolderPlus, FolderOpen, Search, FileSearch, ListChecks, MessageCircleQuestion } from "lucide-react";
import type { LucideIcon } from "lucide-react";

const TOOL_META: Record<string, { icon: LucideIcon; label: string; accent: string }> = {
  read_file:       { icon: FileText,          label: "Ler arquivo",      accent: "text-sky-400" },
  write_file:      { icon: FilePlus,          label: "Criar arquivo",    accent: "text-emerald-400" },
  edit_file:       { icon: Pencil,            label: "Editar arquivo",   accent: "text-amber-400" },
  delete_file:     { icon: Trash2,            label: "Apagar arquivo",   accent: "text-red-400" },
  rename_file:     { icon: FileText,          label: "Renomear arquivo", accent: "text-violet-400" },
  create_directory:{ icon: FolderPlus,        label: "Criar diretório",  accent: "text-emerald-400" },
  list_files:      { icon: FolderOpen,        label: "Listar arquivos",  accent: "text-sky-400" },
  glob:            { icon: Search,            label: "Buscar arquivos",  accent: "text-sky-400" },
  grep:            { icon: FileSearch,        label: "Buscar texto",     accent: "text-sky-400" },
  bash:            { icon: Terminal,          label: "Executar comando", accent: "text-orange-400" },
  ask_user:        { icon: MessageCircleQuestion, label: "Pergunta ao usuário", accent: "text-blue-400" },
  todo_write:      { icon: ListChecks,        label: "Atualizar tarefas", accent: "text-emerald-400" },
};

const LONG_FIELDS = new Set(["content", "old_content", "new_content", "command"]);

function formatValue(key: string, value: unknown): string {
  if (typeof value === "string") return value;
  return JSON.stringify(value, null, LONG_FIELDS.has(key) ? 2 : 0);
}

export function ToolApprovalCard() {
  const activeThreadId = useAppStore((s) => s.activeThreadId);
  const activeStreams = useAppStore((s) => s.activeStreams);
  const respondToolApproval = useAppStore((s) => s.respondToolApproval);

  const pending = activeThreadId
    ? activeStreams[activeThreadId]?.pendingToolApproval ?? null
    : null;
  if (!pending || !activeThreadId) return null;

  const meta = TOOL_META[pending.tool] ?? {
    icon: ShieldAlert,
    label: pending.tool,
    accent: "text-yellow-400",
  };
  const Icon = meta.icon;

  const target =
    (pending.args?.path as string | undefined) ??
    (pending.args?.file_path as string | undefined) ??
    (pending.args?.pattern as string | undefined) ??
    (pending.args?.command as string | undefined) ??
    null;

  // Split args into "summary row" (path, small scalars) and "detail block" (content, diffs)
  const args = pending.args ?? {};
  const summaryEntries: [string, unknown][] = [];
  const detailEntries: [string, unknown][] = [];
  for (const [k, v] of Object.entries(args)) {
    const strVal = typeof v === "string" ? v : JSON.stringify(v);
    if (LONG_FIELDS.has(k) || strVal.length > 120) detailEntries.push([k, v]);
    else summaryEntries.push([k, v]);
  }

  const handleApprove = () => respondToolApproval(activeThreadId, true);
  const handleReject = () => respondToolApproval(activeThreadId, false);

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-3">
      <div className="overflow-hidden rounded-xl border border-border/60 bg-card shadow-lg shadow-black/20 backdrop-blur">
        {/* Header */}
        <div className="flex items-center gap-3 border-b border-border/60 bg-muted/30 px-4 py-3">
          <div className={`flex h-9 w-9 items-center justify-center rounded-lg bg-background ${meta.accent}`}>
            <Icon className="h-4 w-4" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Aprovação necessária
              </span>
              <span className="text-[10px] rounded bg-background px-1.5 py-0.5 text-muted-foreground">
                {pending.tool}
              </span>
            </div>
            <div className="truncate text-sm font-medium text-foreground">
              {meta.label}
              {target ? <span className="ml-1.5 text-muted-foreground">— {target}</span> : null}
            </div>
          </div>
        </div>

        {/* Body */}
        <div className="space-y-3 px-4 py-3">
          {summaryEntries.length > 0 && (
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
              {summaryEntries.map(([k, v]) => (
                <div key={k} className="flex items-center gap-1.5">
                  <span className="text-muted-foreground">{k}:</span>
                  <span className="font-mono text-foreground/90">{formatValue(k, v)}</span>
                </div>
              ))}
            </div>
          )}

          {detailEntries.map(([k, v]) => {
            const str = typeof v === "string" ? v : JSON.stringify(v, null, 2);
            const preview = str.length > 600 ? `${str.slice(0, 600)}\n…` : str;
            const isDiffField = k === "old_content" || k === "new_content";
            const tone = isDiffField
              ? k === "old_content"
                ? "border-red-500/20 bg-red-500/5"
                : "border-emerald-500/20 bg-emerald-500/5"
              : "border-border/60 bg-muted/30";
            return (
              <div key={k} className={`rounded-md border ${tone} p-2.5`}>
                <div className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {k}
                </div>
                <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all font-mono text-[11px] leading-relaxed text-foreground/85">
                  {preview}
                </pre>
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-2 border-t border-border/60 bg-muted/20 px-4 py-2.5">
          <span className="text-[11px] text-muted-foreground">
            {target
              ? "Aprovação válida para este alvo nesta conversa."
              : "Aprovação válida para esta ferramenta nesta conversa."}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleReject}
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground/90 transition-colors hover:border-red-500/40 hover:bg-red-500/10 hover:text-red-400"
            >
              <X className="h-3.5 w-3.5" />
              Rejeitar
            </button>
            <button
              type="button"
              onClick={handleApprove}
              autoFocus
              className="inline-flex items-center gap-1.5 rounded-md bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition-all hover:bg-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
            >
              <Check className="h-3.5 w-3.5" />
              Aprovar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
