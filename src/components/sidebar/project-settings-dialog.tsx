import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { FolderRoot } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/stores/app-store";
import type { Project } from "@/lib/types";

const PRESET_COLORS = [
  "#3b82f6", "#8b5cf6", "#ec4899", "#ef4444",
  "#f97316", "#eab308", "#22c55e", "#06b6d4",
];

interface ProjectSettingsDialogProps {
  project: Project | null;
  onOpenChange: (open: boolean) => void;
}

export function ProjectSettingsDialog({ project, onOpenChange }: ProjectSettingsDialogProps) {
  const [name, setName] = useState("");
  const [color, setColor] = useState("");
  const fetchProjects = useAppStore((s) => s.fetchProjects);

  useEffect(() => {
    if (project) {
      setName(project.name);
      setColor(project.color);
    }
  }, [project]);

  const handleSave = async () => {
    if (!project || !name.trim()) return;
    try {
      await invoke("update_project", {
        id: project.id,
        name: name.trim(),
        color,
      });
      await fetchProjects();
      onOpenChange(false);
    } catch (err) {
      console.error("Erro ao salvar projeto:", err);
    }
  };

  const handleDelete = async () => {
    if (!project) return;
    try {
      await invoke("delete_project", { id: project.id });
      const { activeProjectId, setActiveProject, setActiveThread } = useAppStore.getState();
      if (activeProjectId === project.id) {
        setActiveProject(null);
        setActiveThread(null);
      }
      await fetchProjects();
      onOpenChange(false);
    } catch (err) {
      console.error("Erro ao deletar projeto:", err);
    }
  };

  return (
    <Dialog open={project !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Configuracoes do projeto</DialogTitle>
          <DialogDescription>Edite o nome, cor e configuracoes do projeto.</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-5 py-2">
          {/* Path (read-only) */}
          {project && (
            <div className="flex items-center gap-2 rounded-lg bg-muted px-3 py-2">
              <FolderRoot className="size-4 shrink-0 text-muted-foreground" />
              <span className="truncate text-xs text-muted-foreground">{project.path}</span>
            </div>
          )}

          {/* Name */}
          <div>
            <label className="text-sm font-medium text-foreground">Nome</label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSave()}
              className="mt-1.5"
            />
          </div>

          {/* Color */}
          <div>
            <label className="text-sm font-medium text-foreground">Cor</label>
            <div className="flex gap-3 mt-2">
              {PRESET_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  className="size-7 rounded-full transition-all"
                  style={{
                    backgroundColor: c,
                    outline: color === c ? "2px solid currentColor" : "none",
                    outlineOffset: "2px",
                    transform: color === c ? "scale(1.1)" : "scale(1)",
                  }}
                  onClick={() => setColor(c)}
                />
              ))}
            </div>
          </div>

          <Separator />

          {/* Danger zone */}
          <div className="flex items-center justify-between">
            <div>
              <label className="text-sm font-medium text-destructive">Excluir projeto</label>
              <p className="text-xs text-muted-foreground">Remove o projeto e todas as threads.</p>
            </div>
            <Button variant="destructive" size="sm" onClick={handleDelete}>
              Excluir
            </Button>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={handleSave}>Salvar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
