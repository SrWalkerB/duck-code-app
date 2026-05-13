import type { BrowserWindow } from "electron";
import { ipcMain } from "electron";
import { getAllProviders, getProvider } from "../services/providers/factory.js";
import type { ApiProviderId } from "../services/providers/types.js";
import { LmStudioProvider } from "../services/providers/lm-studio.js";
import { OllamaProvider } from "../services/providers/ollama.js";
import {
  getLmStudioBaseUrl,
  setLmStudioBaseUrl,
  getOllamaBaseUrl,
  setOllamaBaseUrl,
} from "../services/providers/provider-config.js";

export function registerProviderHandlers(_mainWindow: BrowserWindow): void {
  ipcMain.handle("provider:catalog", async () => {
    const providers = getAllProviders();

    await Promise.all(
      providers.map(async (provider) => {
        if (provider instanceof LmStudioProvider || provider instanceof OllamaProvider) {
          try {
            await provider.refreshCatalogModels();
          } catch {
            // Keep fallback model list when server is offline.
          }
        }
      })
    );

    return providers.map((p) => p.getCatalogEntry());
  });

  ipcMain.handle(
    "provider:get-config",
    async (_, args: { provider: string }) => {
      if (args.provider === "lm-studio") {
        return { baseUrl: getLmStudioBaseUrl() };
      }
      if (args.provider === "ollama") {
        return { baseUrl: getOllamaBaseUrl() };
      }
      return {};
    }
  );

  ipcMain.handle(
    "provider:set-config",
    async (_, args: { provider: string; config: { baseUrl?: string } }) => {
      if (args.provider === "lm-studio") {
        const next = setLmStudioBaseUrl(args.config.baseUrl || "");
        return { baseUrl: next };
      }
      if (args.provider === "ollama") {
        const next = setOllamaBaseUrl(args.config.baseUrl || "");
        return { baseUrl: next };
      }
      return {};
    }
  );

  ipcMain.handle(
    "provider:list-models",
    async (_, args: { provider: string }) => {
      const provider = getProvider(args.provider as ApiProviderId);
      if (!(provider instanceof LmStudioProvider) && !(provider instanceof OllamaProvider)) {
        return { models: [] as string[] };
      }
      try {
        const models = await provider.fetchModelValues();
        await provider.refreshCatalogModels();
        return { models };
      } catch (err) {
        return {
          models: [] as string[],
          error: err instanceof Error ? err.message : String(err),
        };
      }
    }
  );
}
