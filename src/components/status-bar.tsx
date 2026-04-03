import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Monitor, Shield, Cpu, ChevronDown } from "lucide-react";
import { useAppStore } from "@/stores/app-store";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

const PERMISSION_MODES = [
  { value: "default", label: "Default", description: "Pede permissão para tudo" },
  { value: "acceptEdits", label: "Accept edits", description: "Auto-aprova leituras e edições" },
  { value: "plan", label: "Plan mode", description: "Só planeja, não executa" },
  { value: "auto", label: "Auto", description: "Auto-aprova tudo automaticamente" },
  { value: "bypassPermissions", label: "Bypass", description: "Ignora todas as permissões" },
];

export function StatusBar() {
  const [cliVersion, setCliVersion] = useState<string>("");
  const { permissionMode, setPermissionMode } = useAppStore();

  useEffect(() => {
    invoke<string>("get_claude_version")
      .then(setCliVersion)
      .catch(() => setCliVersion("unknown"));
  }, []);

  const currentMode = PERMISSION_MODES.find((m) => m.value === permissionMode) || PERMISSION_MODES[1];

  return (
    <div className="flex items-center gap-4 border-t border-border/30 bg-background px-4 py-1 text-[11px] text-muted-foreground/60">
      <div className="flex items-center gap-1.5">
        <Monitor className="size-3" />
        <span>Local</span>
      </div>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-muted-foreground/60 hover:bg-accent hover:text-muted-foreground transition-colors"
          >
            <Shield className="size-3" />
            <span>{currentMode.label}</span>
            <ChevronDown className="size-2.5" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-[200px]">
          {PERMISSION_MODES.map((mode) => (
            <DropdownMenuItem
              key={mode.value}
              onClick={() => setPermissionMode(mode.value)}
              className={cn(
                "flex flex-col items-start gap-0.5",
                mode.value === permissionMode && "bg-accent text-accent-foreground"
              )}
            >
              <span className="text-xs font-medium">{mode.label}</span>
              <span className="text-[10px] text-muted-foreground">{mode.description}</span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      {cliVersion && (
        <div className="ml-auto flex items-center gap-1.5">
          <Cpu className="size-3" />
          <span>{cliVersion}</span>
        </div>
      )}
    </div>
  );
}
