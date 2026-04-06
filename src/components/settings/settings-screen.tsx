import { useEffect, useState } from "react";
import { electronAPI } from "@/lib/electron-api";
import { useSettingsStore } from "@/stores/settings-store";
import { useAppStore } from "@/stores/app-store";
import { getProviderEntry } from "@/lib/providers";
import type { ApprovalMode, ProviderId } from "@/lib/types";
import { cn } from "@/lib/utils";
import {
  ArrowLeft,
  Sun,
  Moon,
  Palette,
  KeyRound,
  Cpu,
} from "lucide-react";

type Section = "appearance" | "providers" | "api-keys";

const NAV_ITEMS: { id: Section; label: string; icon: React.ReactNode }[] = [
  { id: "appearance", label: "Appearance", icon: <Palette className="size-4" /> },
  { id: "providers", label: "Providers", icon: <Cpu className="size-4" /> },
  { id: "api-keys", label: "API Keys", icon: <KeyRound className="size-4" /> },
];

const EFFORTS = [
  { label: "Low", value: "low" },
  { label: "Medium", value: "medium" },
  { label: "High", value: "high" },
];

const APPROVAL_MODES: { label: string; value: ApprovalMode; description: string }[] = [
  { label: "Suggest", value: "suggest", description: "Only suggests changes, no execution" },
  { label: "Auto-edit", value: "auto-edit", description: "Can edit files, asks for commands" },
  { label: "Full auto", value: "full-auto", description: "Executes everything without asking" },
];

interface SettingsScreenProps {
  onBack: () => void;
}

export function SettingsScreen({ onBack }: SettingsScreenProps) {
  const [activeSection, setActiveSection] = useState<Section>("appearance");

  return (
    <div className="flex h-full w-full bg-background">
      {/* Left nav */}
      <aside className="flex h-full w-[260px] shrink-0 flex-col border-r border-border/50 bg-sidebar-background">
        <div className="px-3 pt-4 pb-2">
          <button
            type="button"
            onClick={onBack}
            className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
          >
            <ArrowLeft className="size-4" />
            Back to app
          </button>
        </div>

        <div className="px-3 py-2">
          <span className="px-2 text-xs font-medium text-muted-foreground/60 uppercase tracking-wider">
            Settings
          </span>
        </div>

        <nav className="flex flex-col gap-0.5 px-2">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setActiveSection(item.id)}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors text-left",
                activeSection === item.id
                  ? "bg-sidebar-accent text-foreground"
                  : "text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
              )}
            >
              {item.icon}
              {item.label}
            </button>
          ))}
        </nav>
      </aside>

      {/* Content */}
      <main className="flex-1 overflow-y-auto p-8">
        {activeSection === "appearance" && <AppearanceSection />}
        {activeSection === "providers" && <ProvidersSection />}
        {activeSection === "api-keys" && <ApiKeysSection />}
      </main>
    </div>
  );
}

function SectionTitle({ title }: { title: string }) {
  return <h1 className="text-2xl font-semibold text-foreground mb-6">{title}</h1>;
}

function SettingsCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border/60 bg-card divide-y divide-border/40">
      {children}
    </div>
  );
}

function SettingsRow({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="px-5 py-4 grid gap-3 md:grid-cols-[minmax(210px,260px)_1fr] md:items-center md:gap-6">
      <div>
        <p className="text-sm font-medium text-foreground">{label}</p>
        {description && (
          <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
        )}
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function AppearanceSection() {
  const { theme, setTheme } = useSettingsStore();

  return (
    <div className="max-w-2xl">
      <SectionTitle title="Appearance" />
      <SettingsCard>
        <SettingsRow label="Theme" description="Choose between light and dark mode.">
          <div className="flex gap-2">
            <ThemeButton
              icon={<Moon className="size-3.5" />}
              label="Dark"
              active={theme === "dark"}
              onClick={() => setTheme("dark")}
            />
            <ThemeButton
              icon={<Sun className="size-3.5" />}
              label="Light"
              active={theme === "light"}
              onClick={() => setTheme("light")}
            />
          </div>
        </SettingsRow>
      </SettingsCard>
    </div>
  );
}

function ProvidersSection() {
  const providerCatalog = useAppStore((s) => s.providerCatalog);
  const fetchProviderCatalog = useAppStore((s) => s.fetchProviderCatalog);
  const {
    defaultProvider,
    defaultModels,
    defaultEffort,
    defaultApprovalMode,
    setDefaultProvider,
    setDefaultModel,
    setDefaultEffort,
    setDefaultApprovalMode,
  } = useSettingsStore();

  const providerInfo = getProviderEntry(providerCatalog, defaultProvider);
  const providerOptions = providerCatalog.map((entry) => ({
    label: entry.label,
    value: entry.id as ProviderId,
  }));
  const configuredModel = defaultModels[defaultProvider] || providerInfo.default_model;
  const hasConfiguredModel = providerInfo.models.some(
    (item) => item.value === configuredModel
  );
  const defaultModel = hasConfiguredModel
    ? configuredModel
    : providerInfo.default_model;
  const [lmStudioBaseUrl, setLmStudioBaseUrl] = useState("");
  const [lmStudioBusy, setLmStudioBusy] = useState(false);
  const [lmStudioStatus, setLmStudioStatus] = useState<string | null>(null);

  useEffect(() => {
    if (defaultProvider !== "lm-studio") return;

    electronAPI
      .invoke("provider:get-config", { provider: "lm-studio" })
      .then((config) => {
        const cfg = config as { baseUrl?: string };
        setLmStudioBaseUrl(cfg.baseUrl || "http://127.0.0.1:1234");
      })
      .catch((err) => {
        setLmStudioStatus(String(err));
      });
  }, [defaultProvider]);

  const handleSaveLmStudioConfig = async () => {
    setLmStudioBusy(true);
    setLmStudioStatus(null);
    try {
      const result = (await electronAPI.invoke("provider:set-config", {
        provider: "lm-studio",
        config: { baseUrl: lmStudioBaseUrl },
      })) as { baseUrl?: string };
      setLmStudioBaseUrl(result.baseUrl || lmStudioBaseUrl);
      await fetchProviderCatalog();
      setLmStudioStatus("Configuracao salva.");
    } catch (err) {
      setLmStudioStatus(String(err));
    } finally {
      setLmStudioBusy(false);
    }
  };

  const handleTestLmStudioConnection = async () => {
    setLmStudioBusy(true);
    setLmStudioStatus(null);
    try {
      const message = (await electronAPI.invoke("provider:test-api-key", {
        provider: "lm-studio",
      })) as string;
      await fetchProviderCatalog();
      setLmStudioStatus(message);
    } catch (err) {
      setLmStudioStatus(String(err));
    } finally {
      setLmStudioBusy(false);
    }
  };

  const handleRefreshLmStudioModels = async () => {
    setLmStudioBusy(true);
    setLmStudioStatus(null);
    try {
      await fetchProviderCatalog();
      setLmStudioStatus("Modelos atualizados.");
    } catch (err) {
      setLmStudioStatus(String(err));
    } finally {
      setLmStudioBusy(false);
    }
  };

  return (
    <div className="max-w-2xl flex flex-col gap-6">
      <SectionTitle title="Providers" />

      <SettingsCard>
        <div className="px-5 py-4">
          <p className="text-sm font-medium text-foreground">Default provider</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Provider used when creating new threads.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {providerOptions.map((p) => (
              <SegmentButton
                key={p.value}
                label={p.label}
                active={defaultProvider === p.value}
                onClick={() => setDefaultProvider(p.value)}
              />
            ))}
          </div>
        </div>
      </SettingsCard>

      {defaultProvider === "lm-studio" && (
        <SettingsCard>
          <div className="px-5 py-4">
            <div>
              <p className="text-sm font-medium text-foreground">
                Servidor do LM Studio
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                URL local do servidor (ex: http://127.0.0.1:1234).
              </p>
            </div>

            <input
              type="text"
              value={lmStudioBaseUrl}
              onChange={(e) => setLmStudioBaseUrl(e.target.value)}
              placeholder="http://127.0.0.1:1234"
              className="mt-3 w-full rounded-lg border border-border bg-transparent px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground/40 focus:border-border/80"
            />

            <div className="mt-3 flex gap-2">
              <ActionButton
                label={lmStudioBusy ? "Salvando..." : "Salvar URL"}
                onClick={handleSaveLmStudioConfig}
                disabled={lmStudioBusy}
              />
              <ActionButton
                label={lmStudioBusy ? "Atualizando..." : "Atualizar modelos"}
                onClick={handleRefreshLmStudioModels}
                disabled={lmStudioBusy}
              />
              <ActionButton
                label={lmStudioBusy ? "Testando..." : "Testar conexao"}
                onClick={handleTestLmStudioConnection}
                disabled={lmStudioBusy}
              />
            </div>

            {lmStudioStatus && (
              <p className="mt-3 text-xs text-muted-foreground">{lmStudioStatus}</p>
            )}
          </div>
        </SettingsCard>
      )}

      <SettingsCard>
        <div className="px-5 py-4 flex flex-col gap-3">
          <div>
            <p className="text-sm font-medium text-foreground">Default model</p>
            <p className="text-xs text-muted-foreground mt-0.5">Model used when creating new threads.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {providerInfo.models.map((m) => (
              <SegmentButton
                key={m.value}
                label={m.label}
                active={defaultModel === m.value}
                onClick={() => setDefaultModel(defaultProvider, m.value)}
              />
            ))}
          </div>
        </div>

        {providerInfo.capabilities.supports_effort && (
          <SettingsRow
            label="Default effort"
            description="Effort level for new threads."
          >
            <div className="flex flex-wrap gap-2 md:justify-end">
              {EFFORTS.map((e) => (
                <SegmentButton
                  key={e.value}
                  label={e.label}
                  active={defaultEffort === e.value}
                  onClick={() => setDefaultEffort(e.value)}
                />
              ))}
            </div>
          </SettingsRow>
        )}

        <SettingsRow
          label="Default permissions"
          description="Permission level for new threads."
        >
          <div className="flex flex-wrap gap-2 md:justify-end">
            {APPROVAL_MODES.map((a) => (
              <SegmentButton
                key={a.value}
                label={a.label}
                active={defaultApprovalMode === a.value}
                onClick={() => setDefaultApprovalMode(a.value)}
              />
            ))}
          </div>
        </SettingsRow>
      </SettingsCard>
    </div>
  );
}

function ApiKeysSection() {
  const providerCatalog = useAppStore((s) => s.providerCatalog);
  const apiKeyProviders = providerCatalog.filter(
    (entry) => entry.capabilities.requires_api_key
  );

  const [providerApiKeys, setProviderApiKeys] = useState<Partial<Record<ProviderId, string>>>({});
  const [providerConfigured, setProviderConfigured] = useState<Partial<Record<ProviderId, boolean>>>({});
  const [providerLast4, setProviderLast4] = useState<Partial<Record<ProviderId, string | null>>>({});
  const [providerStatusMessages, setProviderStatusMessages] = useState<Partial<Record<ProviderId, string | null>>>({});
  const [providerBusy, setProviderBusy] = useState<Partial<Record<ProviderId, boolean>>>({});

  useEffect(() => {
    void Promise.all(
      apiKeyProviders.map(async (entry) => {
        try {
          const status = (await electronAPI.invoke("provider:api-key-status", {
            provider: entry.id,
          })) as { configured: boolean; last4: string | null };
          setProviderConfigured((prev) => ({ ...prev, [entry.id]: status.configured }));
          setProviderLast4((prev) => ({ ...prev, [entry.id]: status.last4 }));
        } catch (err) {
          console.error(`Erro ao carregar status da API key:`, err);
        }
      })
    );
  }, [apiKeyProviders]);

  const handleSave = async (provider: ProviderId) => {
    const apiKey = providerApiKeys[provider]?.trim() || "";
    if (!apiKey) return;
    setProviderBusy((prev) => ({ ...prev, [provider]: true }));
    setProviderStatusMessages((prev) => ({ ...prev, [provider]: null }));
    try {
      await electronAPI.invoke("provider:set-api-key", { provider, apiKey });
      const status = (await electronAPI.invoke("provider:api-key-status", { provider })) as {
        configured: boolean;
        last4: string | null;
      };
      setProviderConfigured((prev) => ({ ...prev, [provider]: status.configured }));
      setProviderLast4((prev) => ({ ...prev, [provider]: status.last4 }));
      setProviderApiKeys((prev) => ({ ...prev, [provider]: "" }));
      setProviderStatusMessages((prev) => ({ ...prev, [provider]: "API key salva." }));
    } catch (err) {
      setProviderStatusMessages((prev) => ({ ...prev, [provider]: String(err) }));
    } finally {
      setProviderBusy((prev) => ({ ...prev, [provider]: false }));
    }
  };

  const handleTest = async (provider: ProviderId) => {
    setProviderBusy((prev) => ({ ...prev, [provider]: true }));
    setProviderStatusMessages((prev) => ({ ...prev, [provider]: null }));
    try {
      const message = (await electronAPI.invoke("provider:test-api-key", {
        provider,
        apiKey: providerApiKeys[provider]?.trim() || undefined,
      })) as string;
      setProviderStatusMessages((prev) => ({ ...prev, [provider]: message }));
    } catch (err) {
      setProviderStatusMessages((prev) => ({ ...prev, [provider]: String(err) }));
    } finally {
      setProviderBusy((prev) => ({ ...prev, [provider]: false }));
    }
  };

  const handleRemove = async (provider: ProviderId) => {
    setProviderBusy((prev) => ({ ...prev, [provider]: true }));
    setProviderStatusMessages((prev) => ({ ...prev, [provider]: null }));
    try {
      await electronAPI.invoke("provider:remove-api-key", { provider });
      setProviderConfigured((prev) => ({ ...prev, [provider]: false }));
      setProviderLast4((prev) => ({ ...prev, [provider]: null }));
      setProviderApiKeys((prev) => ({ ...prev, [provider]: "" }));
      setProviderStatusMessages((prev) => ({ ...prev, [provider]: "API key removida." }));
    } catch (err) {
      setProviderStatusMessages((prev) => ({ ...prev, [provider]: String(err) }));
    } finally {
      setProviderBusy((prev) => ({ ...prev, [provider]: false }));
    }
  };

  if (apiKeyProviders.length === 0) {
    return (
      <div className="max-w-2xl">
        <SectionTitle title="API Keys" />
        <p className="text-sm text-muted-foreground">No providers require API keys.</p>
      </div>
    );
  }

  return (
    <div className="max-w-2xl flex flex-col gap-6">
      <SectionTitle title="API Keys" />
      {apiKeyProviders.map((entry) => {
        const provider = entry.id as ProviderId;
        const configured = providerConfigured[provider] ?? false;
        const last4 = providerLast4[provider] ?? null;
        const statusMessage = providerStatusMessages[provider];
        const busy = providerBusy[provider] ?? false;
        const inputValue = providerApiKeys[provider] ?? "";
        const placeholder = provider === "openai" ? "sk-..." : "sk-ant-...";

        return (
          <SettingsCard key={provider}>
            <div className="px-5 py-4">
              <div className="flex items-start justify-between mb-4">
                <div>
                  <p className="text-sm font-medium text-foreground">{entry.label}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {configured
                      ? `Configured${last4 ? ` (···${last4})` : ""}`
                      : "Not configured"}
                  </p>
                  <p className="text-xs text-muted-foreground/60 mt-0.5">
                    Stored locally with AES-256 encryption.
                  </p>
                </div>
                {configured && (
                  <span className="text-xs text-emerald-500 font-medium">Active</span>
                )}
              </div>

              <input
                type="password"
                value={inputValue}
                onChange={(e) =>
                  setProviderApiKeys((prev) => ({ ...prev, [provider]: e.target.value }))
                }
                placeholder={placeholder}
                className="w-full rounded-lg border border-border bg-transparent px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground/40 focus:border-border/80"
              />

              <div className="mt-3 flex gap-2">
                <ActionButton
                  label={busy ? "Saving..." : "Save"}
                  onClick={() => handleSave(provider)}
                  disabled={busy || !inputValue.trim()}
                />
                <ActionButton
                  label={busy ? "Testing..." : "Test"}
                  onClick={() => handleTest(provider)}
                  disabled={busy}
                />
                <ActionButton
                  label="Remove"
                  onClick={() => handleRemove(provider)}
                  disabled={busy || !configured}
                  variant="destructive"
                />
              </div>

              {statusMessage && (
                <p className="mt-3 text-xs text-muted-foreground">{statusMessage}</p>
              )}
            </div>
          </SettingsCard>
        );
      })}
    </div>
  );
}

function ThemeButton({
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
        "flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors",
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

function SegmentButton({
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
        "rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors",
        active
          ? "border-primary bg-primary/10 text-foreground"
          : "border-border bg-transparent text-muted-foreground hover:bg-accent"
      )}
    >
      {label}
    </button>
  );
}

function ActionButton({
  label,
  onClick,
  disabled,
  variant = "default",
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  variant?: "default" | "destructive";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors disabled:pointer-events-none disabled:opacity-40",
        variant === "destructive"
          ? "border-border text-red-500 hover:bg-red-500/10"
          : "border-border text-muted-foreground hover:bg-accent hover:text-foreground"
      )}
    >
      {label}
    </button>
  );
}
