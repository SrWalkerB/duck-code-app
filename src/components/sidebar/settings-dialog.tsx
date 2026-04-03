import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { useSettingsStore } from "@/stores/settings-store";
import { Sun, Moon } from "lucide-react";
import { cn } from "@/lib/utils";

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const MODELS = [
  { label: "Opus 4.6", value: "claude-opus-4-6" },
  { label: "Sonnet 4.6", value: "claude-sonnet-4-6" },
  { label: "Haiku 4.5", value: "claude-haiku-4-5" },
];

const EFFORTS = [
  { label: "Low", value: "low" },
  { label: "Medium", value: "medium" },
  { label: "High", value: "high" },
  { label: "Max", value: "max" },
];

const CONTEXTS = [
  { label: "200k", value: "" },
  { label: "1M", value: "[1m]" },
];

const PERMISSION_MODES = [
  { label: "Default", value: "default" },
  { label: "Accept edits", value: "acceptEdits" },
  { label: "Plan", value: "plan" },
  { label: "Auto", value: "auto" },
];

export function SettingsDialog({ open, onOpenChange }: SettingsDialogProps) {
  const {
    theme,
    defaultModel,
    defaultEffort,
    defaultContext,
    defaultPermissionMode,
    showCost,
    setTheme,
    setDefaultModel,
    setDefaultEffort,
    setDefaultContext,
    setDefaultPermissionMode,
    setShowCost,
  } = useSettingsStore();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>Configure as preferencias do Duck Codex.</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-5 py-2">
          {/* Theme */}
          <div>
            <label className="text-sm font-medium text-foreground">Tema</label>
            <p className="text-xs text-muted-foreground mb-2">Escolha entre tema claro ou escuro.</p>
            <div className="flex gap-2">
              <ThemeOption
                icon={<Moon className="size-4" />}
                label="Dark"
                active={theme === "dark"}
                onClick={() => setTheme("dark")}
              />
              <ThemeOption
                icon={<Sun className="size-4" />}
                label="Light"
                active={theme === "light"}
                onClick={() => setTheme("light")}
              />
            </div>
          </div>

          <Separator />

          {/* Default Model */}
          <div>
            <label className="text-sm font-medium text-foreground">Modelo padrao</label>
            <p className="text-xs text-muted-foreground mb-2">Modelo usado ao criar novas threads.</p>
            <div className="flex gap-2">
              {MODELS.map((m) => (
                <OptionButton
                  key={m.value}
                  label={m.label}
                  active={defaultModel === m.value}
                  onClick={() => setDefaultModel(m.value)}
                />
              ))}
            </div>
          </div>

          {/* Default Effort */}
          <div>
            <label className="text-sm font-medium text-foreground">Effort padrao</label>
            <p className="text-xs text-muted-foreground mb-2">Nivel de esforco para novas threads.</p>
            <div className="flex gap-2">
              {EFFORTS.map((e) => (
                <OptionButton
                  key={e.value}
                  label={e.label}
                  active={defaultEffort === e.value}
                  onClick={() => setDefaultEffort(e.value)}
                />
              ))}
            </div>
          </div>

          {/* Default Context */}
          <div>
            <label className="text-sm font-medium text-foreground">Contexto padrao</label>
            <p className="text-xs text-muted-foreground mb-2">Tamanho da janela de contexto.</p>
            <div className="flex gap-2">
              {CONTEXTS.map((c) => (
                <OptionButton
                  key={c.value || "200k"}
                  label={c.label}
                  active={defaultContext === c.value}
                  onClick={() => setDefaultContext(c.value)}
                />
              ))}
            </div>
          </div>

          {/* Default Permission Mode */}
          <div>
            <label className="text-sm font-medium text-foreground">Permissoes padrao</label>
            <p className="text-xs text-muted-foreground mb-2">Nivel de permissao para novas threads.</p>
            <div className="flex gap-2">
              {PERMISSION_MODES.map((m) => (
                <OptionButton
                  key={m.value}
                  label={m.label}
                  active={defaultPermissionMode === m.value}
                  onClick={() => setDefaultPermissionMode(m.value)}
                />
              ))}
            </div>
          </div>

          <Separator />

          {/* Show Cost */}
          <div className="flex items-center justify-between">
            <div>
              <label className="text-sm font-medium text-foreground">Mostrar custo</label>
              <p className="text-xs text-muted-foreground">Exibir custo por mensagem no chat.</p>
            </div>
            <button
              type="button"
              onClick={() => setShowCost(!showCost)}
              className={cn(
                "relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors",
                showCost ? "bg-primary" : "bg-muted-foreground/30"
              )}
            >
              <span
                className={cn(
                  "pointer-events-none block size-4 rounded-full bg-white shadow-sm ring-0 transition-transform",
                  showCost ? "translate-x-[18px]" : "translate-x-0.5"
                )}
              />
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ThemeOption({
  icon,
  label,
  active,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex flex-1 items-center justify-center gap-2 rounded-lg border px-4 py-2.5 text-sm transition-colors",
        active
          ? "border-primary bg-primary/10 text-foreground"
          : "border-border bg-transparent text-muted-foreground hover:bg-accent"
      )}
    >
      {icon}
      {label}
    </button>
  );
}

function OptionButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex-1 rounded-lg border px-3 py-2 text-xs font-medium transition-colors",
        active
          ? "border-primary bg-primary/10 text-foreground"
          : "border-border bg-transparent text-muted-foreground hover:bg-accent"
      )}
    >
      {label}
    </button>
  );
}
