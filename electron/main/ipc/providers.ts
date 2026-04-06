import { ipcMain } from "electron";
import { getAllProviders, getProvider } from "../services/providers/factory.js";
import type { ApiProviderId } from "../services/providers/types.js";
import { LmStudioProvider } from "../services/providers/lm-studio.js";
import {
  getLmStudioBaseUrl,
  setLmStudioBaseUrl,
} from "../services/providers/provider-config.js";

export function registerProviderHandlers(): void {
  ipcMain.handle("provider:catalog", async () => {
    const providers = getAllProviders();

    await Promise.all(
      providers.map(async (provider) => {
        if (provider instanceof LmStudioProvider) {
          try {
            await provider.refreshCatalogModels();
          } catch {
            // Keep fallback model list when LM Studio is offline.
          }
        }
      })
    );

    return providers.map((p) => p.getCatalogEntry());
  });

  ipcMain.handle(
    "provider:api-key-status",
    async (_, args: { provider: string }) => {
      const provider = getProvider(args.provider as ApiProviderId);
      return provider.getApiKeyStatus();
    }
  );

  ipcMain.handle(
    "provider:set-api-key",
    async (_, args: { provider: string; apiKey: string }) => {
      const provider = getProvider(args.provider as ApiProviderId);
      await provider.setApiKey(args.apiKey);
    }
  );

  ipcMain.handle(
    "provider:remove-api-key",
    async (_, args: { provider: string }) => {
      const provider = getProvider(args.provider as ApiProviderId);
      await provider.removeApiKey();
    }
  );

  ipcMain.handle(
    "provider:test-api-key",
    async (_, args: { provider: string; apiKey?: string }) => {
      const provider = getProvider(args.provider as ApiProviderId);
      return provider.testApiKey(args.apiKey);
    }
  );

  ipcMain.handle(
    "provider:get-config",
    async (_, args: { provider: string }) => {
      if (args.provider === "lm-studio") {
        return { baseUrl: getLmStudioBaseUrl() };
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
      return {};
    }
  );
}
