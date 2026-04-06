import { useEffect, useState } from "react";
import { electronAPI } from "@/lib/electron-api";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { useSettingsStore } from "@/stores/settings-store";
import { useAppStore } from "@/stores/app-store";
import { Sun, Moon } from "lucide-react";
import { cn } from "@/lib/utils";
import { getProviderEntry } from "@/lib/providers";
import type { ProviderId } from "@/lib/types";

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const EFFORTS = [
  { label: "Low", value: "low" },
  { label: "Medium", value: "medium" },
  { label: "High", value: "high" },
];

export function SettingsDialog({ open, onOpenChange }: SettingsDialogProps) {
  const providerCatalog = useAppStore((s) => s.providerCatalog);
  const fetchProviderCatalog = useAppStore((s) => s.fetchProviderCatalog);
  const [providerApiKeys, setProviderApiKeys] = useState<
    Partial<Record<ProviderId, string>>
  >({});
  const [providerConfigured, setProviderConfigured] = useState<
    Partial<Record<ProviderId, boolean>>
  >({});
  const [providerLast4, setProviderLast4] = useState<
    Partial<Record<ProviderId, string | null>>
  >({});
  const [providerStatusMessages, setProviderStatusMessages] = useState<
    Partial<Record<ProviderId, string | null>>
  >({});
  const [providerBusy, setProviderBusy] = useState<
    Partial<Record<ProviderId, boolean>>
  >({});
  const [lmStudioBaseUrl, setLmStudioBaseUrl] = useState("");
  const [lmStudioBusy, setLmStudioBusy] = useState(false);
  const [lmStudioStatus, setLmStudioStatus] = useState<string | null>(null);

  const {
    theme,
    defaultProvider,
    defaultModels,
    defaultEffort,
    setTheme,
    setDefaultProvider,
    setDefaultModel,
    setDefaultEffort,
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
  const apiKeyProviders = providerCatalog.filter(
    (entry) => entry.capabilities.requires_api_key
  );

  useEffect(() => {
    if (!open) return;

    void Promise.all(
      apiKeyProviders.map(async (entry) => {
        try {
          const status = (await electronAPI.invoke("provider:api-key-status", {
            provider: entry.id,
          })) as { configured: boolean; last4: string | null };
          setProviderConfigured((prev) => ({
            ...prev,
            [entry.id]: status.configured,
          }));
          setProviderLast4((prev) => ({ ...prev, [entry.id]: status.last4 }));
        } catch (err) {
          console.error(`Erro ao carregar status da API key:`, err);
        }
      })
    );
  }, [apiKeyProviders, open]);

  useEffect(() => {
    if (!open || defaultProvider !== "lm-studio") return;

    electronAPI
      .invoke("provider:get-config", { provider: "lm-studio" })
      .then((config) => {
        const cfg = config as { baseUrl?: string };
        setLmStudioBaseUrl(cfg.baseUrl || "http://127.0.0.1:1234");
      })
      .catch((err) => setLmStudioStatus(String(err)));
  }, [defaultProvider, open]);

  const handleSaveProviderKey = async (provider: ProviderId) => {
    const apiKey = providerApiKeys[provider]?.trim() || "";
    if (!apiKey) return;

    setProviderBusy((prev) => ({ ...prev, [provider]: true }));
    setProviderStatusMessages((prev) => ({ ...prev, [provider]: null }));
    try {
      await electronAPI.invoke("provider:set-api-key", { provider, apiKey });
      const status = (await electronAPI.invoke("provider:api-key-status", {
        provider,
      })) as { configured: boolean; last4: string | null };
      setProviderConfigured((prev) => ({
        ...prev,
        [provider]: status.configured,
      }));
      setProviderLast4((prev) => ({ ...prev, [provider]: status.last4 }));
      setProviderApiKeys((prev) => ({ ...prev, [provider]: "" }));
      setProviderStatusMessages((prev) => ({
        ...prev,
        [provider]: "API key salva.",
      }));
    } catch (err) {
      setProviderStatusMessages((prev) => ({
        ...prev,
        [provider]: String(err),
      }));
    } finally {
      setProviderBusy((prev) => ({ ...prev, [provider]: false }));
    }
  };

  const handleTestProviderKey = async (provider: ProviderId) => {
    setProviderBusy((prev) => ({ ...prev, [provider]: true }));
    setProviderStatusMessages((prev) => ({ ...prev, [provider]: null }));
    try {
      const message = (await electronAPI.invoke("provider:test-api-key", {
        provider,
        apiKey: providerApiKeys[provider]?.trim() || undefined,
      })) as string;
      setProviderStatusMessages((prev) => ({ ...prev, [provider]: message }));
    } catch (err) {
      setProviderStatusMessages((prev) => ({
        ...prev,
        [provider]: String(err),
      }));
    } finally {
      setProviderBusy((prev) => ({ ...prev, [provider]: false }));
    }
  };

  const handleRemoveProviderKey = async (provider: ProviderId) => {
    setProviderBusy((prev) => ({ ...prev, [provider]: true }));
    setProviderStatusMessages((prev) => ({ ...prev, [provider]: null }));
    try {
      await electronAPI.invoke("provider:remove-api-key", { provider });
      setProviderConfigured((prev) => ({ ...prev, [provider]: false }));
      setProviderLast4((prev) => ({ ...prev, [provider]: null }));
      setProviderApiKeys((prev) => ({ ...prev, [provider]: "" }));
      setProviderStatusMessages((prev) => ({
        ...prev,
        [provider]: "API key removida.",
      }));
    } catch (err) {
      setProviderStatusMessages((prev) => ({
        ...prev,
        [provider]: String(err),
      }));
    } finally {
      setProviderBusy((prev) => ({ ...prev, [provider]: false }));
    }
  };

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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>
            Configure as preferencias do Duck Code.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-5 py-2">
          {/* Theme */}
          <div>
            <label className="text-sm font-medium text-foreground">Tema</label>
            <p className="text-xs text-muted-foreground mb-2">
              Escolha entre tema claro ou escuro.
            </p>
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

          {/* Default Provider */}
          <div>
            <label className="text-sm font-medium text-foreground">
              Provider padrao
            </label>
            <p className="text-xs text-muted-foreground mb-2">
              Provider usado ao criar novas threads.
            </p>
            <div className="grid grid-cols-2 gap-2">
              {providerOptions.map((provider) => (
                <OptionButton
                  key={provider.value}
                  label={provider.label}
                  active={defaultProvider === provider.value}
                  onClick={() => setDefaultProvider(provider.value)}
                />
              ))}
            </div>
          </div>

          {/* Default Model */}
          <div>
            <label className="text-sm font-medium text-foreground">
              Modelo padrao
            </label>
            <p className="text-xs text-muted-foreground mb-2">
              Modelo usado ao criar novas threads.
            </p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {providerInfo.models.map((m) => (
                <OptionButton
                  key={m.value}
                  label={m.label}
                  active={defaultModel === m.value}
                  onClick={() => setDefaultModel(defaultProvider, m.value)}
                />
              ))}
            </div>
          </div>

          <Separator />

          {/* API Keys */}
          {apiKeyProviders.length > 0 && (
            <div className="flex flex-col gap-3">
              <div>
                <label className="text-sm font-medium text-foreground">
                  API Keys
                </label>
                <p className="text-xs text-muted-foreground mb-2">
                  Cadastre as chaves dos providers.
                </p>
              </div>

              {apiKeyProviders.map((entry) => {
                const provider = entry.id as ProviderId;
                const configured = providerConfigured[provider] ?? false;
                const last4 = providerLast4[provider] ?? null;
                const statusMessage = providerStatusMessages[provider];
                const busy = providerBusy[provider] ?? false;
                const inputValue = providerApiKeys[provider] ?? "";
                const placeholder =
                  provider === "openai" ? "sk-..." : "sk-ant-...";

                return (
                  <div
                    key={provider}
                    className="rounded-lg border border-border/60 p-3"
                  >
                    <div>
                      <p className="text-sm font-medium text-foreground">
                        {entry.label}
                      </p>
                      <p className="text-xs font-medium text-foreground">
                        {configured
                          ? `Configurada${last4 ? ` (...${last4})` : ""}`
                          : "Nao configurada"}
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        A chave fica salva localmente com criptografia.
                      </p>
                    </div>

                    <input
                      type="password"
                      value={inputValue}
                      onChange={(event) =>
                        setProviderApiKeys((prev) => ({
                          ...prev,
                          [provider]: event.target.value,
                        }))
                      }
                      placeholder={placeholder}
                      className="mt-3 w-full rounded-lg border border-border bg-transparent px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground/50"
                    />

                    <div className="mt-3 grid grid-cols-3 gap-2">
                      <OptionButton
                        label={busy ? "Salvando..." : "Salvar"}
                        active={false}
                        onClick={() => handleSaveProviderKey(provider)}
                      />
                      <OptionButton
                        label={busy ? "Testando..." : "Testar"}
                        active={false}
                        onClick={() => handleTestProviderKey(provider)}
                      />
                      <OptionButton
                        label="Remover"
                        active={false}
                        onClick={() => handleRemoveProviderKey(provider)}
                      />
                    </div>

                    {statusMessage && (
                      <p className="mt-3 text-xs text-muted-foreground">
                        {statusMessage}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Effort */}
          {providerInfo.capabilities.supports_effort && (
            <div>
              <label className="text-sm font-medium text-foreground">
                Effort padrao
              </label>
              <p className="text-xs text-muted-foreground mb-2">
                Nivel de esforco para novas threads.
              </p>
              <div className="grid grid-cols-3 gap-2">
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
          )}

          {defaultProvider === "lm-studio" && (
            <>
              <Separator />
              <div>
                <label className="text-sm font-medium text-foreground">
                  Servidor do LM Studio
                </label>
                <p className="text-xs text-muted-foreground mb-2">
                  URL local do servidor (ex: http://127.0.0.1:1234).
                </p>

                <input
                  type="text"
                  value={lmStudioBaseUrl}
                  onChange={(event) => setLmStudioBaseUrl(event.target.value)}
                  placeholder="http://127.0.0.1:1234"
                  className="w-full rounded-lg border border-border bg-transparent px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground/50"
                />

                <div className="mt-3 grid grid-cols-2 gap-2">
                  <OptionButton
                    label={lmStudioBusy ? "Salvando..." : "Salvar URL"}
                    active={false}
                    onClick={handleSaveLmStudioConfig}
                    disabled={lmStudioBusy}
                  />
                  <OptionButton
                    label={lmStudioBusy ? "Testando..." : "Testar conexao"}
                    active={false}
                    onClick={handleTestLmStudioConnection}
                    disabled={lmStudioBusy}
                  />
                </div>

                {lmStudioStatus && (
                  <p className="mt-3 text-xs text-muted-foreground">
                    {lmStudioStatus}
                  </p>
                )}
              </div>
            </>
          )}
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
  disabled,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "w-full rounded-lg border px-3 py-2 text-xs font-medium transition-colors disabled:pointer-events-none disabled:opacity-40",
        active
          ? "border-primary bg-primary/10 text-foreground"
          : "border-border bg-transparent text-muted-foreground hover:bg-accent"
      )}
    >
      {label}
    </button>
  );
}
