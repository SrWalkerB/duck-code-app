import { useEffect, useState, useCallback, useRef } from "react";
import { electronAPI } from "@/lib/electron-api";
import {
  ChevronRight,
  ChevronDown,
  File,
  Folder,
  FolderOpen,
  RefreshCw,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface FileEntry {
  name: string;
  path: string;
  relativePath: string;
  isDirectory: boolean;
  children?: FileEntry[];
}

interface FilePanelProps {
  projectPath: string;
  onClose: () => void;
}

export function FilePanel({ projectPath, onClose }: FilePanelProps) {
  const [tree, setTree] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadFiles = useCallback(async () => {
    if (!projectPath) return;
    setLoading(true);
    try {
      const files = (await electronAPI.invoke("files:list", {
        path: projectPath,
      })) as FileEntry[];
      setTree(files);
    } catch (err) {
      console.error("Erro ao listar arquivos:", err);
    } finally {
      setLoading(false);
    }
  }, [projectPath]);

  useEffect(() => {
    loadFiles();

    // Start watching
    electronAPI.invoke("files:watch", { path: projectPath });

    const unsub = electronAPI.on("files:changed", () => {
      // Debounce refresh
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => loadFiles(), 500);
    });

    return () => {
      unsub();
      electronAPI.invoke("files:unwatch", { path: projectPath });
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [projectPath, loadFiles]);

  return (
    <div className="flex h-full w-[280px] shrink-0 flex-col border-l border-border/30 bg-sidebar-background">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border/30 px-3 py-2">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          Files
        </span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={loadFiles}
            className="flex size-6 items-center justify-center rounded-md text-muted-foreground/60 hover:bg-accent hover:text-foreground transition-colors"
            title="Refresh"
          >
            <RefreshCw className={cn("size-3", loading && "animate-spin")} />
          </button>
          <button
            type="button"
            onClick={onClose}
            className="flex size-6 items-center justify-center rounded-md text-muted-foreground/60 hover:bg-accent hover:text-foreground transition-colors"
            title="Fechar"
          >
            <X className="size-3" />
          </button>
        </div>
      </div>

      {/* Tree */}
      <div className="flex-1 overflow-y-auto py-1">
        {tree.length === 0 && !loading && (
          <p className="px-3 py-4 text-xs text-muted-foreground/50 text-center">
            Nenhum arquivo encontrado.
          </p>
        )}
        {tree.map((entry) => (
          <FileNode key={entry.relativePath} entry={entry} depth={0} />
        ))}
      </div>
    </div>
  );
}

function FileNode({ entry, depth }: { entry: FileEntry; depth: number }) {
  const [expanded, setExpanded] = useState(depth < 1);

  const paddingLeft = 8 + depth * 16;

  if (entry.isDirectory) {
    return (
      <div>
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="flex w-full items-center gap-1.5 py-[3px] pr-2 text-left text-xs text-muted-foreground hover:bg-accent/50 hover:text-foreground transition-colors"
          style={{ paddingLeft }}
        >
          {expanded ? (
            <ChevronDown className="size-3 shrink-0 text-muted-foreground/40" />
          ) : (
            <ChevronRight className="size-3 shrink-0 text-muted-foreground/40" />
          )}
          {expanded ? (
            <FolderOpen className="size-3.5 shrink-0 text-blue-400/70" />
          ) : (
            <Folder className="size-3.5 shrink-0 text-blue-400/70" />
          )}
          <span className="truncate">{entry.name}</span>
        </button>
        {expanded && entry.children && (
          <div>
            {entry.children.map((child) => (
              <FileNode
                key={child.relativePath}
                entry={child}
                depth={depth + 1}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      className="flex items-center gap-1.5 py-[3px] pr-2 text-xs text-muted-foreground/70 hover:bg-accent/50 hover:text-foreground transition-colors cursor-default"
      style={{ paddingLeft: paddingLeft + 16 }}
    >
      <File className="size-3.5 shrink-0 text-muted-foreground/30" />
      <span className="truncate">{entry.name}</span>
    </div>
  );
}
