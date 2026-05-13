import { useState } from "react";
import { electronAPI } from "@/lib/electron-api";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAppStore } from "@/stores/app-store";
import { Folder } from "lucide-react";

const PRESET_COLORS = [
  "#3b82f6", // blue
  "#8b5cf6", // violet
  "#ec4899", // pink
  "#ef4444", // red
  "#f97316", // orange
  "#eab308", // yellow
  "#22c55e", // green
  "#06b6d4", // cyan
];

interface NewProjectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function NewProjectDialog({
  open: isOpen,
  onOpenChange,
}: NewProjectDialogProps) {
  const [name, setName] = useState("");
  const [path, setPath] = useState("");
  const [color, setColor] = useState(PRESET_COLORS[0]);
  const [loading, setLoading] = useState(false);

  const fetchProjects = useAppStore((s) => s.fetchProjects);
  const setActiveProject = useAppStore((s) => s.setActiveProject);
  const setActiveThread = useAppStore((s) => s.setActiveThread);

  const handlePickFolder = async () => {
    console.log("[renderer] handlePickFolder called");
    try {
      const selected = (await electronAPI.invoke("project:pick-folder")) as string | null;
      console.log("[renderer] pick-folder result:", selected);
      if (selected) {
        setPath(selected);
        if (!name) {
          const parts = selected.split("/");
          setName(parts[parts.length - 1] || "");
        }
      }
    } catch (err) {
      console.error("Erro ao abrir seletor de pasta:", err);
    }
  };

  const handleCreate = async () => {
    if (!name.trim() || !path.trim()) return;
    setLoading(true);
    try {
      const project = (await electronAPI.invoke("project:create", {
        name: name.trim(),
        path: path.trim(),
        color,
      })) as { id: string };
      await fetchProjects();
      setActiveProject(project.id);
      setActiveThread(null);
      onOpenChange(false);
      setName("");
      setPath("");
      setColor(PRESET_COLORS[0]);
    } catch (err) {
      console.error("Erro ao criar projeto:", err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" onPointerDownOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>Novo Projeto</DialogTitle>
          <DialogDescription>
            Crie um novo projeto para organizar suas conversas.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-sm text-muted-foreground">Nome</label>
            <Input
              placeholder="Meu projeto"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-sm text-muted-foreground">Caminho</label>
            <div className="flex gap-2">
              <Input
                placeholder="/home/user/projeto"
                value={path}
                onChange={(e) => setPath(e.target.value)}
                className="flex-1"
              />
              <Button
                variant="outline"
                size="icon"
                onClick={handlePickFolder}
                type="button"
              >
                <Folder className="size-4" />
              </Button>
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-sm text-muted-foreground">Cor</label>
            <div className="flex gap-2">
              {PRESET_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  className="size-7 rounded-full transition-all ring-offset-background"
                  style={{
                    backgroundColor: c,
                    boxShadow: color === c ? `0 0 0 2px var(--background), 0 0 0 4px ${c}` : "none",
                    transform: color === c ? "scale(1.15)" : "scale(1)",
                  }}
                  onClick={() => setColor(c)}
                />
              ))}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            Cancelar
          </Button>
          <Button onClick={handleCreate} disabled={loading || !name.trim() || !path.trim()}>
            {loading ? "Criando..." : "Criar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
