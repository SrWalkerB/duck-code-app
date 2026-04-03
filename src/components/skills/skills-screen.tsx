import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ChevronRight, Package } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

interface Skill {
  name: string;
  description: string;
  file: string;
}

interface PluginSkills {
  plugin: string;
  skills: Skill[];
}

export function SkillsScreen() {
  const [plugins, setPlugins] = useState<PluginSkills[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedPlugins, setExpandedPlugins] = useState<Set<string>>(new Set());

  useEffect(() => {
    invoke<PluginSkills[]>("list_skills")
      .then((data) => {
        setPlugins(data);
        setExpandedPlugins(new Set(data.map((p) => p.plugin)));
      })
      .catch((err) => setError(String(err)))
      .finally(() => setLoading(false));
  }, []);

  const togglePlugin = (plugin: string) => {
    setExpandedPlugins((prev) => {
      const next = new Set(prev);
      if (next.has(plugin)) {
        next.delete(plugin);
      } else {
        next.add(plugin);
      }
      return next;
    });
  };

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-sm text-muted-foreground">Carregando skills...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-sm text-destructive">Erro ao carregar skills: {error}</p>
      </div>
    );
  }

  if (plugins.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-sm text-muted-foreground text-center max-w-sm">
          Nenhum plugin instalado. Instale skills via Claude Code CLI.
        </p>
      </div>
    );
  }

  const totalSkills = plugins.reduce((acc, p) => acc + p.skills.length, 0);

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="border-b border-border/50 px-6 py-4">
        <h1 className="text-lg font-semibold">Skills</h1>
        <p className="text-xs text-muted-foreground mt-0.5">
          {totalSkills} skill{totalSkills !== 1 ? "s" : ""} em {plugins.length} plugin{plugins.length !== 1 ? "s" : ""}
        </p>
      </div>
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-2xl space-y-4">
          {plugins.map((plugin) => {
            const isExpanded = expandedPlugins.has(plugin.plugin);
            return (
              <Collapsible
                key={plugin.plugin}
                open={isExpanded}
                onOpenChange={() => togglePlugin(plugin.plugin)}
              >
                <CollapsibleTrigger className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm font-medium hover:bg-muted/50 transition-colors">
                  <ChevronRight
                    className={cn(
                      "size-4 shrink-0 transition-transform text-muted-foreground",
                      isExpanded && "rotate-90"
                    )}
                  />
                  <span>{plugin.plugin}</span>
                  <span className="text-xs text-muted-foreground font-normal">
                    ({plugin.skills.length})
                  </span>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="mt-1 ml-6 space-y-1">
                    {plugin.skills.map((skill) => (
                      <div
                        key={skill.file}
                        className="rounded-md border border-border/50 bg-card px-3 py-2"
                      >
                        <div className="flex items-center gap-2">
                          <Package className="size-3.5 shrink-0 text-muted-foreground" />
                          <span className="text-sm font-medium">{skill.name}</span>
                        </div>
                        {skill.description && (
                          <p className="mt-0.5 text-xs text-muted-foreground line-clamp-2 pl-[22px]">
                            {skill.description}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                </CollapsibleContent>
              </Collapsible>
            );
          })}
        </div>
      </div>
    </div>
  );
}
