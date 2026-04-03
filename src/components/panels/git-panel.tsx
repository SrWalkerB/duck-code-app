import { useState, useCallback, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  GitBranch,
  GitCommit,
  FileWarning,
  RefreshCw,
  Plus,
  Minus,
  FileQuestion,
  FilePen,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";

interface GitStatusEntry {
  status: string;
  path: string;
}

interface GitLogEntry {
  hash: string;
  message: string;
  author: string;
  date: string;
}

type Tab = "status" | "log" | "branches";

function StatusBadge({ status }: { status: string }) {
  const config: Record<string, { label: string; className: string; icon: React.ReactNode }> = {
    M: {
      label: "Modificado",
      className: "bg-amber-500/20 text-amber-400",
      icon: <FilePen className="size-3" />,
    },
    A: {
      label: "Adicionado",
      className: "bg-green-500/20 text-green-400",
      icon: <Plus className="size-3" />,
    },
    D: {
      label: "Removido",
      className: "bg-red-500/20 text-red-400",
      icon: <Minus className="size-3" />,
    },
    "?": {
      label: "Novo",
      className: "bg-blue-500/20 text-blue-400",
      icon: <FileQuestion className="size-3" />,
    },
  };

  const c = config[status] || {
    label: status,
    className: "bg-muted text-muted-foreground",
    icon: <FileWarning className="size-3" />,
  };

  return (
    <span
      className={cn("inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium", c.className)}
      title={c.label}
    >
      {c.icon}
      {status}
    </span>
  );
}

function relativeDate(dateStr: string): string {
  try {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return "agora";
    if (diffMin < 60) return `${diffMin}min`;
    const diffH = Math.floor(diffMin / 60);
    if (diffH < 24) return `${diffH}h`;
    const diffD = Math.floor(diffH / 24);
    if (diffD < 30) return `${diffD}d`;
    const diffM = Math.floor(diffD / 30);
    return `${diffM}m`;
  } catch {
    return dateStr;
  }
}

interface GitPanelProps {
  projectPath: string;
}

export function GitPanel({ projectPath }: GitPanelProps) {
  const [activeTab, setActiveTab] = useState<Tab>("status");
  const [statusEntries, setStatusEntries] = useState<GitStatusEntry[]>([]);
  const [logEntries, setLogEntries] = useState<GitLogEntry[]>([]);
  const [branches, setBranches] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchStatus = useCallback(async () => {
    if (!projectPath) return;
    setLoading(true);
    try {
      const entries = await invoke<GitStatusEntry[]>("git_status", { projectPath });
      setStatusEntries(entries);
    } catch (err) {
      console.error("Erro ao buscar git status:", err);
    } finally {
      setLoading(false);
    }
  }, [projectPath]);

  const fetchLog = useCallback(async () => {
    if (!projectPath) return;
    setLoading(true);
    try {
      const entries = await invoke<GitLogEntry[]>("git_log", { projectPath, count: 20 });
      setLogEntries(entries);
    } catch (err) {
      console.error("Erro ao buscar git log:", err);
    } finally {
      setLoading(false);
    }
  }, [projectPath]);

  const fetchBranches = useCallback(async () => {
    if (!projectPath) return;
    setLoading(true);
    try {
      const branchList = await invoke<string[]>("git_branches", { projectPath });
      setBranches(branchList);
    } catch (err) {
      console.error("Erro ao buscar branches:", err);
    } finally {
      setLoading(false);
    }
  }, [projectPath]);

  const refresh = useCallback(() => {
    if (activeTab === "status") fetchStatus();
    else if (activeTab === "log") fetchLog();
    else fetchBranches();
  }, [activeTab, fetchStatus, fetchLog, fetchBranches]);

  useEffect(() => {
    refresh();
  }, [activeTab, projectPath]); // eslint-disable-line react-hooks/exhaustive-deps

  const tabs: { id: Tab; label: string }[] = [
    { id: "status", label: "Status" },
    { id: "log", label: "Log" },
    { id: "branches", label: "Branches" },
  ];

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border/30 px-3 py-2">
        <span className="text-xs font-medium text-foreground/70 uppercase tracking-wider">
          Git
        </span>
        <button
          type="button"
          onClick={refresh}
          className="rounded p-1 text-muted-foreground/50 hover:text-foreground/70 hover:bg-white/5 transition-colors"
          title="Atualizar"
        >
          <RefreshCw className={cn("size-3.5", loading && "animate-spin")} />
        </button>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-border/20">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              "flex-1 py-1.5 text-[11px] font-medium transition-colors",
              activeTab === tab.id
                ? "text-foreground border-b-2 border-foreground/50"
                : "text-muted-foreground/60 hover:text-muted-foreground"
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <ScrollArea className="flex-1 min-h-0">
        {loading && (
          <div className="flex items-center justify-center py-8">
            <RefreshCw className="size-4 animate-spin text-muted-foreground/50" />
          </div>
        )}

        {!loading && activeTab === "status" && (
          <div className="py-1">
            {statusEntries.length === 0 ? (
              <p className="px-3 py-4 text-center text-xs text-muted-foreground/50">
                Nenhuma alteracao pendente
              </p>
            ) : (
              statusEntries.map((entry) => (
                <div
                  key={entry.path}
                  className="flex items-center gap-2 px-3 py-1 hover:bg-white/5 transition-colors"
                >
                  <StatusBadge status={entry.status} />
                  <span className="truncate text-xs text-foreground/70">{entry.path}</span>
                </div>
              ))
            )}
          </div>
        )}

        {!loading && activeTab === "log" && (
          <div className="py-1">
            {logEntries.length === 0 ? (
              <p className="px-3 py-4 text-center text-xs text-muted-foreground/50">
                Nenhum commit encontrado
              </p>
            ) : (
              logEntries.map((entry) => (
                <div
                  key={entry.hash}
                  className="px-3 py-2 hover:bg-white/5 transition-colors border-b border-border/10 last:border-0"
                >
                  <div className="flex items-center gap-2">
                    <GitCommit className="size-3 shrink-0 text-muted-foreground/50" />
                    <span className="text-[10px] font-mono text-muted-foreground/60">
                      {entry.hash.slice(0, 7)}
                    </span>
                    <span className="text-[10px] text-muted-foreground/40 ml-auto">
                      {relativeDate(entry.date)}
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-foreground/70 truncate pl-5">
                    {entry.message}
                  </p>
                  <p className="text-[10px] text-muted-foreground/40 pl-5">{entry.author}</p>
                </div>
              ))
            )}
          </div>
        )}

        {!loading && activeTab === "branches" && (
          <div className="py-1">
            {branches.length === 0 ? (
              <p className="px-3 py-4 text-center text-xs text-muted-foreground/50">
                Nenhuma branch encontrada
              </p>
            ) : (
              branches.map((branch) => {
                const isCurrent = branch.startsWith("* ");
                const name = isCurrent ? branch.slice(2) : branch;
                return (
                  <div
                    key={branch}
                    className={cn(
                      "flex items-center gap-2 px-3 py-1.5 hover:bg-white/5 transition-colors",
                      isCurrent && "bg-white/5"
                    )}
                  >
                    <GitBranch
                      className={cn(
                        "size-3.5 shrink-0",
                        isCurrent ? "text-green-400" : "text-muted-foreground/50"
                      )}
                    />
                    <span
                      className={cn(
                        "text-xs truncate",
                        isCurrent ? "text-foreground font-medium" : "text-foreground/70"
                      )}
                    >
                      {name}
                    </span>
                    {isCurrent && (
                      <span className="text-[10px] text-green-400/70 ml-auto">atual</span>
                    )}
                  </div>
                );
              })
            )}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
