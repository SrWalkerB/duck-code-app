import { useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  Folder,
  FolderOpen,
  FileText,
  FileCode,
  ChevronRight,
  X,
  RefreshCw,
  FileJson,
  FileImage,
  File,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";

interface FileEntry {
  name: string;
  path: string;
  is_dir: boolean;
  size: number;
}

interface TreeNodeState {
  expanded: boolean;
  children: FileEntry[] | null;
  loading: boolean;
}

const CODE_EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".rs", ".py", ".go", ".java",
  ".c", ".cpp", ".h", ".hpp", ".css", ".scss", ".html", ".vue",
  ".svelte", ".rb", ".php", ".swift", ".kt", ".sh", ".zsh", ".bash",
]);

const JSON_EXTENSIONS = new Set([".json", ".jsonc", ".yaml", ".yml", ".toml"]);
const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp", ".ico"]);

function getFileIcon(name: string, isDir: boolean, expanded: boolean) {
  if (isDir) {
    return expanded ? (
      <FolderOpen className="size-4 shrink-0 text-amber-400/80" />
    ) : (
      <Folder className="size-4 shrink-0 text-amber-400/80" />
    );
  }

  const ext = name.includes(".") ? "." + name.split(".").pop()!.toLowerCase() : "";

  if (CODE_EXTENSIONS.has(ext)) return <FileCode className="size-4 shrink-0 text-blue-400/70" />;
  if (JSON_EXTENSIONS.has(ext)) return <FileJson className="size-4 shrink-0 text-yellow-400/70" />;
  if (IMAGE_EXTENSIONS.has(ext)) return <FileImage className="size-4 shrink-0 text-green-400/70" />;
  if (ext === ".md" || ext === ".txt") return <FileText className="size-4 shrink-0 text-muted-foreground/70" />;

  return <File className="size-4 shrink-0 text-muted-foreground/70" />;
}

function TreeNode({
  entry,
  depth,
  selectedFile,
  onSelectFile,
}: {
  entry: FileEntry;
  depth: number;
  selectedFile: string | null;
  onSelectFile: (path: string) => void;
}) {
  const [state, setState] = useState<TreeNodeState>({
    expanded: false,
    children: null,
    loading: false,
  });

  const toggle = useCallback(async () => {
    if (!entry.is_dir) {
      onSelectFile(entry.path);
      return;
    }

    if (state.expanded) {
      setState((s) => ({ ...s, expanded: false }));
      return;
    }

    if (state.children === null) {
      setState((s) => ({ ...s, loading: true }));
      try {
        const children = await invoke<FileEntry[]>("read_directory", { path: entry.path });
        const sorted = children.sort((a, b) => {
          if (a.is_dir !== b.is_dir) return a.is_dir ? -1 : 1;
          return a.name.localeCompare(b.name);
        });
        setState({ expanded: true, children: sorted, loading: false });
      } catch (err) {
        console.error("Erro ao ler diretorio:", err);
        setState((s) => ({ ...s, loading: false }));
      }
    } else {
      setState((s) => ({ ...s, expanded: true }));
    }
  }, [entry, state.children, state.expanded, onSelectFile]);

  const isSelected = !entry.is_dir && selectedFile === entry.path;

  return (
    <div>
      <button
        type="button"
        className={cn(
          "flex w-full items-center gap-1 py-0.5 pr-2 text-left text-xs hover:bg-white/5 transition-colors",
          isSelected && "bg-white/10"
        )}
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
        onClick={toggle}
      >
        {entry.is_dir ? (
          <ChevronRight
            className={cn(
              "size-3 shrink-0 text-muted-foreground/50 transition-transform",
              state.expanded && "rotate-90"
            )}
          />
        ) : (
          <span className="w-3 shrink-0" />
        )}
        {getFileIcon(entry.name, entry.is_dir, state.expanded)}
        <span className="truncate text-foreground/80">{entry.name}</span>
        {state.loading && (
          <RefreshCw className="size-3 shrink-0 animate-spin text-muted-foreground/50" />
        )}
      </button>
      {state.expanded && state.children && (
        <div>
          {state.children.map((child) => (
            <TreeNode
              key={child.path}
              entry={child}
              depth={depth + 1}
              selectedFile={selectedFile}
              onSelectFile={onSelectFile}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface FileExplorerProps {
  projectPath: string;
}

export function FileExplorer({ projectPath }: FileExplorerProps) {
  const [rootEntries, setRootEntries] = useState<FileEntry[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<string | null>(null);
  const [fileLoading, setFileLoading] = useState(false);

  const loadRoot = useCallback(async () => {
    if (!projectPath) return;
    setLoading(true);
    try {
      const entries = await invoke<FileEntry[]>("read_directory", { path: projectPath });
      const sorted = entries.sort((a, b) => {
        if (a.is_dir !== b.is_dir) return a.is_dir ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
      setRootEntries(sorted);
    } catch (err) {
      console.error("Erro ao ler diretorio raiz:", err);
    } finally {
      setLoading(false);
    }
  }, [projectPath]);

  // Load root on first render
  if (rootEntries === null && !loading && projectPath) {
    loadRoot();
  }

  const handleSelectFile = useCallback(async (path: string) => {
    setSelectedFile(path);
    setFileLoading(true);
    try {
      const content = await invoke<string>("read_file_content", { path });
      setFileContent(content);
    } catch (err) {
      console.error("Erro ao ler arquivo:", err);
      setFileContent("// Erro ao carregar arquivo");
    } finally {
      setFileLoading(false);
    }
  }, []);

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border/30 px-3 py-2">
        <span className="text-xs font-medium text-foreground/70 uppercase tracking-wider">
          Arquivos
        </span>
        <button
          type="button"
          onClick={loadRoot}
          className="rounded p-1 text-muted-foreground/50 hover:text-foreground/70 hover:bg-white/5 transition-colors"
          title="Atualizar"
        >
          <RefreshCw className="size-3.5" />
        </button>
      </div>

      {/* Tree */}
      <ScrollArea className={cn("min-h-0", selectedFile ? "flex-1" : "flex-1")}>
        <div className="py-1">
          {loading && (
            <div className="flex items-center justify-center py-8">
              <RefreshCw className="size-4 animate-spin text-muted-foreground/50" />
            </div>
          )}
          {rootEntries?.map((entry) => (
            <TreeNode
              key={entry.path}
              entry={entry}
              depth={0}
              selectedFile={selectedFile}
              onSelectFile={handleSelectFile}
            />
          ))}
        </div>
      </ScrollArea>

      {/* File preview */}
      {selectedFile && (
        <div className="flex flex-col border-t border-border/30 min-h-0" style={{ maxHeight: "40%" }}>
          <div className="flex items-center justify-between px-3 py-1.5 border-b border-border/20">
            <span className="text-[10px] text-muted-foreground/60 truncate">
              {selectedFile.split("/").pop()}
            </span>
            <button
              type="button"
              onClick={() => {
                setSelectedFile(null);
                setFileContent(null);
              }}
              className="rounded p-0.5 text-muted-foreground/50 hover:text-foreground/70 transition-colors"
            >
              <X className="size-3" />
            </button>
          </div>
          <ScrollArea className="flex-1 min-h-0">
            {fileLoading ? (
              <div className="flex items-center justify-center py-4">
                <RefreshCw className="size-3.5 animate-spin text-muted-foreground/50" />
              </div>
            ) : (
              <pre className="px-3 py-2 text-[11px] leading-relaxed text-foreground/70 font-mono whitespace-pre-wrap break-all">
                {fileContent}
              </pre>
            )}
          </ScrollArea>
        </div>
      )}
    </div>
  );
}
