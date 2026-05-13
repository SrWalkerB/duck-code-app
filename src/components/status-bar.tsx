import { Monitor, Cpu } from "lucide-react";
import { useAppStore } from "@/stores/app-store";
import { getProviderEntry } from "@/lib/providers";

export function StatusBar() {
  const {
    activeProjectId,
    activeThreadId,
    threads,
    providerCatalog,
  } = useAppStore();

  const activeThread =
    activeProjectId && activeThreadId
      ? (threads[activeProjectId] || []).find(
          (thread) => thread.id === activeThreadId
        )
      : null;

  const activeProvider = activeThread?.provider || "lm-studio";
  const providerInfo = getProviderEntry(providerCatalog, activeProvider);

  return (
    <div className="flex items-center gap-4 border-t border-border/30 bg-background px-4 py-1 text-[11px] text-muted-foreground/60">
      <div className="flex items-center gap-1.5">
        <Monitor className="size-3" />
        <span>Local</span>
      </div>

      <div className="ml-auto flex items-center gap-1.5">
        <Cpu className="size-3" />
        <span>{providerInfo.label}</span>
      </div>
    </div>
  );
}
