import { useEffect, useState } from "react";
import { electronAPI } from "@/lib/electron-api";
import { useSettingsStore } from "@/stores/settings-store";
import { useAppStore } from "@/stores/app-store";
import { ArrowLeft, Sun, Moon, Palette, Cpu, RefreshCw, CheckCircle2, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ProviderId } from "@/lib/types";

type Section = "appearance" | "providers";

const NAV_ITEMS: { id: Section; label: string; icon: React.ReactNode }[] = [
  { id: "appearance", label: "Aparência", icon: <Palette className="size-4" /> },
  { id: "providers", label: "Providers", icon: <Cpu className="size-4" /> },
];

const PROVIDERS: { id: ProviderId; label: string; defaultBaseUrl: string }[] = [
  { id: "lm-studio", label: "LM Studio", defaultBaseUrl: "http://127.0.0.1:1234" },
  { id: "ollama", label: "Ollama", defaultBaseUrl: "http://localhost:11434" },
];

export function SettingsScreen() {
  const setActiveView = useAppStore((s) => s.setActiveView);
  const theme = useSettingsStore((s) => s.theme);
  const toggleTheme = useSettingsStore((s) => s.toggleTheme);
  const [section, setSection] = useState<Section>("appearance");

  return (
    <div className="flex h-full">
      <aside className="flex w-56 flex-col border-r border-border/40 bg-background/40 px-2 py-3">
        <button
          type="button"
          onClick={() => setActiveView("chat")}
          className="mb-3 flex items-center gap-2 rounded px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" />
          Voltar para chat
        </button>

        <nav className="flex flex-col gap-0.5">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setSection(item.id)}
              className={cn(
                "flex items-center gap-2 rounded px-2 py-1.5 text-sm transition-colors",
                section === item.id
                  ? "bg-muted text-foreground"
                  : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
              )}
            >
              {item.icon}
              {item.label}
            </button>
          ))}
        </nav>
      </aside>

      <main className="flex-1 overflow-auto px-8 py-6">
        {section === "appearance" && (
          <section className="max-w-xl space-y-4">
            <h2 className="text-lg font-semibold">Aparência</h2>
            <div className="rounded-lg border border-border/50 bg-card p-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium">Tema</div>
                  <div className="text-xs text-muted-foreground">
                    {theme === "dark" ? "Escuro" : "Claro"}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={toggleTheme}
                  className="rounded-md border border-border bg-background p-2 hover:bg-muted"
                >
                  {theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
                </button>
              </div>
            </div>
          </section>
        )}

        {section === "providers" && <ProvidersSection />}
      </main>
    </div>
  );
}

function ProvidersSection() {
  return (
    <section className="max-w-2xl space-y-4">
      <h2 className="text-lg font-semibold">Providers</h2>
      <p className="text-xs text-muted-foreground">
        Configure os endpoints dos servidores locais. As mudanças são salvas automaticamente.
      </p>
      {PROVIDERS.map((p) => (
        <ProviderCard key={p.id} providerId={p.id} label={p.label} defaultBaseUrl={p.defaultBaseUrl} />
      ))}
    </section>
  );
}

function ProviderCard({
  providerId,
  label,
  defaultBaseUrl,
}: {
  providerId: ProviderId;
  label: string;
  defaultBaseUrl: string;
}) {
  const fetchProviderCatalog = useAppStore((s) => s.fetchProviderCatalog);
  const [baseUrl, setBaseUrl] = useState<string>("");
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [models, setModels] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastChecked, setLastChecked] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    void electronAPI
      .invoke("provider:get-config", { provider: providerId })
      .then((cfg) => {
        if (cancelled) return;
        const next = (cfg as { baseUrl?: string })?.baseUrl ?? defaultBaseUrl;
        setBaseUrl(next);
      })
      .catch(() => setBaseUrl(defaultBaseUrl));
    return () => {
      cancelled = true;
    };
  }, [providerId, defaultBaseUrl]);

  const persist = async (next: string) => {
    setBaseUrl(next);
    try {
      await electronAPI.invoke("provider:set-config", {
        provider: providerId,
        config: { baseUrl: next },
      });
      setSavedAt(Date.now());
    } catch {
      // ignore
    }
  };

  const refreshModels = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = (await electronAPI.invoke("provider:list-models", {
        provider: providerId,
      })) as { models: string[]; error?: string };
      setModels(res.models ?? []);
      if (res.error) setError(res.error);
      setLastChecked(Date.now());
      // Refresh global catalog so chat-input dropdown updates too
      await fetchProviderCatalog();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setLastChecked(Date.now());
    } finally {
      setLoading(false);
    }
  };

  // Auto-fetch on first mount per provider
  useEffect(() => {
    if (baseUrl) void refreshModels();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseUrl]);

  const isOnline = lastChecked !== null && !error && models.length > 0;

  return (
    <div className="rounded-lg border border-border/50 bg-card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">{label}</span>
            {lastChecked !== null && (
              <span className={cn("inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px]", isOnline ? "bg-emerald-500/15 text-emerald-400" : "bg-red-500/15 text-red-400")}>
                {isOnline ? <CheckCircle2 className="size-3" /> : <XCircle className="size-3" />}
                {isOnline ? "Online" : "Offline"}
              </span>
            )}
          </div>
          <div className="text-[11px] text-muted-foreground">{providerId}</div>
        </div>
        {savedAt && (
          <span className="text-[11px] text-emerald-400">Salvo</span>
        )}
      </div>

      <label className="block">
        <span className="mb-1 block text-xs text-muted-foreground">Base URL</span>
        <input
          type="text"
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
          onBlur={() => persist(baseUrl)}
          placeholder={defaultBaseUrl}
          className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm font-mono outline-none focus:border-blue-500/50"
        />
      </label>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">
            Modelos disponíveis {models.length > 0 && <span className="text-foreground">({models.length})</span>}
          </span>
          <button
            type="button"
            onClick={refreshModels}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1 text-xs hover:bg-muted disabled:opacity-50"
          >
            <RefreshCw className={cn("size-3", loading && "animate-spin")} />
            {loading ? "Buscando..." : "Buscar modelos"}
          </button>
        </div>

        {error && (
          <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-400">
            {error}
          </div>
        )}

        {!error && models.length === 0 && lastChecked !== null && !loading && (
          <div className="rounded-md border border-border/50 bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
            Nenhum modelo retornado pelo servidor. Verifique se há modelos carregados.
          </div>
        )}

        {models.length > 0 && (
          <div className="max-h-48 overflow-auto rounded-md border border-border/50 bg-background/40 p-1">
            <ul className="divide-y divide-border/30">
              {models.map((m) => (
                <li
                  key={m}
                  className="px-2 py-1.5 text-xs font-mono text-foreground/85"
                >
                  {m}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
