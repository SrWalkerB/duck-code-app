import { useState, useEffect } from "react";
import { electronAPI } from "@/lib/electron-api";
import {
  ChevronRight,
  FolderOpen,
  MessageSquare,
  Plus,
  Pencil,
  Palette,
  Trash2,
  Sun,
  Moon,
  FolderRoot,
  Settings,
  Loader2,
  CheckCircle2,
  BookOpen,
  ChevronsUpDown,
  ChevronsDownUp,
  SquarePen,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useAppStore } from "@/stores/app-store";
import { relativeTime } from "@/lib/relative-time";
import { cn } from "@/lib/utils";
import { NewProjectDialog } from "./new-project-dialog";
import { useSettingsStore } from "@/stores/settings-store";
import type { Project, Thread } from "@/lib/types";
import { getProviderEntry } from "@/lib/providers";

export function Sidebar() {
  const {
    projects,
    threads,
    activeProjectId,
    activeThreadId,
    isStreaming,
    streamingThreadId,
    setActiveProject,
    setActiveThread,
    setActiveView,
    fetchProjects,
    fetchThreads,
    providerCatalog,
  } = useAppStore();

  // Track recently completed threads for success indicator
  const [completedThread, setCompletedThread] = useState<string | null>(null);
  const prevStreamingRef = useState({ prev: false })[0];
  useEffect(() => {
    if (prevStreamingRef.prev && !isStreaming && streamingThreadId) {
      setCompletedThread(streamingThreadId);
      const timer = setTimeout(() => setCompletedThread(null), 3000);
      return () => clearTimeout(timer);
    }
    prevStreamingRef.prev = isStreaming;
  }, [isStreaming, streamingThreadId, prevStreamingRef]);

  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const { theme, toggleTheme } = useSettingsStore();

  // Rename project dialog
  const [renameProject, setRenameProject] = useState<Project | null>(null);
  const [renameProjectName, setRenameProjectName] = useState("");

  // Change color dialog
  const [colorProject, setColorProject] = useState<Project | null>(null);
  const [colorProjectColor, setColorProjectColor] = useState("");

  // Rename thread dialog
  const [renameThread, setRenameThread] = useState<Thread | null>(null);
  const [renameThreadTitle, setRenameThreadTitle] = useState("");

  // Expanded projects
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set());

  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

  // Auto-expand active project and fetch its threads
  useEffect(() => {
    if (activeProjectId) {
      setExpandedProjects((prev) => new Set([...prev, activeProjectId]));
    }
  }, [activeProjectId]);

  // Fetch threads for all projects on mount
  useEffect(() => {
    projects.forEach((p) => fetchThreads(p.id));
  }, [projects, fetchThreads]);

  const handleToggleProject = (projectId: string, isOpen: boolean) => {
    setExpandedProjects((prev) => {
      const next = new Set(prev);
      if (isOpen) {
        next.add(projectId);
      } else {
        next.delete(projectId);
      }
      return next;
    });
  };

  const handleExpandAll = () => {
    setExpandedProjects(new Set(projects.map((p) => p.id)));
  };

  const handleCollapseAll = () => {
    setExpandedProjects(new Set());
  };

  const {
    defaultProvider,
    defaultModels,
    defaultEffort,
  } = useSettingsStore();

  const handleNewThread = async (projectId: string) => {
    try {
      const provider = defaultProvider;
      const providerInfo = getProviderEntry(providerCatalog, provider);
      const providerModel = defaultModels[provider] || providerInfo.default_model;
      const thread = (await electronAPI.invoke("thread:create", {
        projectId,
        title: "Nova thread",
        provider,
        model: providerModel,
        effort: defaultEffort,
      })) as Thread;
      await fetchThreads(projectId);
      setActiveProject(projectId);
      setActiveThread(thread.id);
    } catch (err) {
      console.error("Erro ao criar thread:", err);
    }
  };

  const handleCreateNewThread = () => {
    if (activeProjectId) {
      handleNewThread(activeProjectId);
    } else if (projects.length > 0) {
      handleNewThread(projects[0].id);
    } else {
      setNewProjectOpen(true);
    }
  };

  const handleRenameProject = async () => {
    if (!renameProject || !renameProjectName.trim()) return;
    try {
      await electronAPI.invoke("project:update", {
        id: renameProject.id,
        name: renameProjectName.trim(),
      });
      await fetchProjects();
      setRenameProject(null);
    } catch (err) {
      console.error("Erro ao renomear projeto:", err);
    }
  };

  const handleChangeColor = async () => {
    if (!colorProject || !colorProjectColor) return;
    try {
      await electronAPI.invoke("project:update", {
        id: colorProject.id,
        color: colorProjectColor,
      });
      await fetchProjects();
      setColorProject(null);
    } catch (err) {
      console.error("Erro ao mudar cor:", err);
    }
  };

  const handleDeleteProject = async (project: Project) => {
    try {
      await electronAPI.invoke("project:delete", { id: project.id });
      if (activeProjectId === project.id) {
        setActiveProject(null);
        setActiveThread(null);
      }
      await fetchProjects();
    } catch (err) {
      console.error("Erro ao deletar projeto:", err);
    }
  };

  const handleRenameThread = async () => {
    if (!renameThread || !renameThreadTitle.trim()) return;
    try {
      await electronAPI.invoke("thread:update", {
        id: renameThread.id,
        title: renameThreadTitle.trim(),
      });
      await fetchThreads(renameThread.projectId);
      setRenameThread(null);
    } catch (err) {
      console.error("Erro ao renomear thread:", err);
    }
  };

  const handleDeleteThread = async (thread: Thread) => {
    try {
      await electronAPI.invoke("thread:delete", { id: thread.id });
      if (activeThreadId === thread.id) {
        setActiveThread(null);
      }
      await fetchThreads(thread.projectId);
    } catch (err) {
      console.error("Erro ao deletar thread:", err);
    }
  };

  const handleSelectThread = (thread: Thread) => {
    setActiveProject(thread.projectId);
    setActiveThread(thread.id);
  };

  const isDark = theme === "dark";

  return (
    <aside className="flex h-full w-[280px] shrink-0 flex-col border-r border-border/50 bg-sidebar-background">
      {/* Top actions — Codex style */}
      <div className="flex flex-col gap-0.5 px-3 pt-3 pb-1">
        <button
          type="button"
          className="flex items-center gap-3 rounded-md px-2 py-2 text-sm text-foreground transition-colors hover:bg-sidebar-accent"
          onClick={() => setNewProjectOpen(true)}
        >
          <SquarePen className="size-4" />
          New project
        </button>
        <button
          type="button"
          className="flex items-center gap-3 rounded-md px-2 py-2 text-sm text-muted-foreground/50 cursor-not-allowed"
          disabled
        >
          <BookOpen className="size-4" />
          Skills
        </button>
      </div>

      {/* Threads header with expand/collapse */}
      <div className="flex items-center justify-between px-3 py-2">
        <span className="px-2 text-xs font-medium text-muted-foreground/60 uppercase tracking-wider">
          Threads
        </span>
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            onClick={handleExpandAll}
            className="flex size-6 items-center justify-center rounded-md text-muted-foreground/50 transition-colors hover:bg-sidebar-accent hover:text-foreground"
            title="Expandir todos"
          >
            <ChevronsUpDown className="size-3.5" />
          </button>
          <button
            type="button"
            onClick={handleCollapseAll}
            className="flex size-6 items-center justify-center rounded-md text-muted-foreground/50 transition-colors hover:bg-sidebar-accent hover:text-foreground"
            title="Colapsar todos"
          >
            <ChevronsDownUp className="size-3.5" />
          </button>
        </div>
      </div>

      {/* Projects + Threads tree */}
      <ScrollArea className="flex-1">
        <div className="px-2">
          {projects.length === 0 ? (
            <div className="px-3 py-8 text-center text-xs text-muted-foreground">
              Nenhum projeto ainda.
            </div>
          ) : (
            projects.map((project) => {
              const projectThreads = threads[project.id] || [];
              const isExpanded = expandedProjects.has(project.id);

              return (
                <Collapsible
                  key={project.id}
                  open={isExpanded}
                  onOpenChange={(open) => handleToggleProject(project.id, open)}
                >
                  <div className="group flex w-full items-center">
                    <ContextMenu>
                      <ContextMenuTrigger asChild>
                        <CollapsibleTrigger className="flex flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground">
                          <ChevronRight
                            className={cn(
                              "size-3.5 shrink-0 transition-transform",
                              isExpanded && "rotate-90"
                            )}
                          />
                          <FolderOpen
                            className="size-4 shrink-0"
                            style={{ color: project.color }}
                          />
                          <span className="truncate">{project.name}</span>
                        </CollapsibleTrigger>
                      </ContextMenuTrigger>
                      <ContextMenuContent>
                        <ContextMenuItem onClick={() => handleNewThread(project.id)}>
                          <Plus className="size-4" />
                          Nova thread
                        </ContextMenuItem>
                        <ContextMenuItem disabled>
                          <FolderRoot className="size-4" />
                          <span className="truncate text-xs opacity-70">{project.path}</span>
                        </ContextMenuItem>
                        <ContextMenuSeparator />
                        <ContextMenuItem
                          onClick={() => {
                            setRenameProject(project);
                            setRenameProjectName(project.name);
                          }}
                        >
                          <Pencil className="size-4" />
                          Renomear
                        </ContextMenuItem>
                        <ContextMenuItem
                          onClick={() => {
                            setColorProject(project);
                            setColorProjectColor(project.color);
                          }}
                        >
                          <Palette className="size-4" />
                          Mudar cor
                        </ContextMenuItem>
                        <ContextMenuSeparator />
                        <ContextMenuItem
                          variant="destructive"
                          onClick={() => handleDeleteProject(project)}
                        >
                          <Trash2 className="size-4" />
                          Excluir
                        </ContextMenuItem>
                      </ContextMenuContent>
                    </ContextMenu>
                    <button
                      type="button"
                      className="mr-1 flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground/60 opacity-0 transition-all hover:bg-sidebar-accent hover:text-foreground group-hover:opacity-100"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleNewThread(project.id);
                      }}
                      title="Nova thread"
                    >
                      <Plus className="size-3.5" />
                    </button>
                  </div>

                  <CollapsibleContent>
                    <div className="ml-3 pl-2">
                      {projectThreads.length === 0 ? (
                        <p className="px-2 py-1.5 text-xs text-muted-foreground/40">
                          No threads
                        </p>
                      ) : (
                        projectThreads.map((thread) => (
                          <ContextMenu key={thread.id}>
                            <ContextMenuTrigger asChild>
                              <button
                                type="button"
                                className={cn(
                                  "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors",
                                  activeThreadId === thread.id
                                    ? "bg-sidebar-accent text-foreground"
                                    : "text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
                                )}
                                onClick={() => handleSelectThread(thread)}
                              >
                                {isStreaming && streamingThreadId === thread.id ? (
                                  <Loader2 className="size-3.5 shrink-0 animate-spin text-blue-400" />
                                ) : completedThread === thread.id ? (
                                  <CheckCircle2 className="size-3.5 shrink-0 text-emerald-500" />
                                ) : (
                                  <MessageSquare className="size-3.5 shrink-0" />
                                )}
                                <span className="flex-1 truncate">{thread.title}</span>
                                <span className="shrink-0 text-[10px] text-muted-foreground/60">
                                  {relativeTime(thread.updatedAt)}
                                </span>
                              </button>
                            </ContextMenuTrigger>
                            <ContextMenuContent>
                              <ContextMenuItem
                                onClick={() => {
                                  setRenameThread(thread);
                                  setRenameThreadTitle(thread.title);
                                }}
                              >
                                <Pencil className="size-4" />
                                Renomear
                              </ContextMenuItem>
                              <ContextMenuSeparator />
                              <ContextMenuItem
                                variant="destructive"
                                onClick={() => handleDeleteThread(thread)}
                              >
                                <Trash2 className="size-4" />
                                Excluir
                              </ContextMenuItem>
                            </ContextMenuContent>
                          </ContextMenu>
                        ))
                      )}
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              );
            })
          )}
        </div>
      </ScrollArea>

      <Separator className="bg-border/30" />

      {/* Bottom — Settings + Theme toggle */}
      <div className="flex items-center justify-between px-3 py-2">
        <button
          type="button"
          className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
          onClick={() => setActiveView("settings")}
        >
          <Settings className="size-4" />
          Settings
        </button>
        <Button
          variant="ghost"
          size="icon"
          className="size-8 text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
          onClick={toggleTheme}
          title={isDark ? "Tema claro" : "Tema escuro"}
        >
          {isDark ? <Sun className="size-3.5" /> : <Moon className="size-3.5" />}
        </Button>
      </div>

      {/* Dialogs */}
      <NewProjectDialog open={newProjectOpen} onOpenChange={setNewProjectOpen} />

      <Dialog
        open={renameProject !== null}
        onOpenChange={(open) => !open && setRenameProject(null)}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Renomear projeto</DialogTitle>
            <DialogDescription>Escolha um novo nome para o projeto.</DialogDescription>
          </DialogHeader>
          <Input
            value={renameProjectName}
            onChange={(e) => setRenameProjectName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleRenameProject()}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameProject(null)}>Cancelar</Button>
            <Button onClick={handleRenameProject}>Salvar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={colorProject !== null}
        onOpenChange={(open) => !open && setColorProject(null)}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Mudar cor</DialogTitle>
            <DialogDescription>Escolha uma nova cor para o projeto.</DialogDescription>
          </DialogHeader>
          <div className="flex gap-3 justify-center py-2">
            {["#3b82f6", "#8b5cf6", "#ec4899", "#ef4444", "#f97316", "#eab308", "#22c55e", "#06b6d4"].map((c) => (
              <button
                key={c}
                type="button"
                className="size-8 rounded-full border-2 transition-all"
                style={{
                  backgroundColor: c,
                  borderColor: colorProjectColor === c ? "#fff" : "transparent",
                  transform: colorProjectColor === c ? "scale(1.15)" : "scale(1)",
                }}
                onClick={() => setColorProjectColor(c)}
              />
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setColorProject(null)}>Cancelar</Button>
            <Button onClick={handleChangeColor}>Salvar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={renameThread !== null}
        onOpenChange={(open) => !open && setRenameThread(null)}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Renomear thread</DialogTitle>
            <DialogDescription>Escolha um novo titulo para a thread.</DialogDescription>
          </DialogHeader>
          <Input
            value={renameThreadTitle}
            onChange={(e) => setRenameThreadTitle(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleRenameThread()}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameThread(null)}>Cancelar</Button>
            <Button onClick={handleRenameThread}>Salvar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </aside>
  );
}
