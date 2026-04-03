import { ipcMain } from "electron";
import { getAllProviders, getProvider } from "../services/providers/factory.js";
import type { ApiProviderId } from "../services/providers/types.js";

export function registerProviderHandlers(): void {
  ipcMain.handle("provider:catalog", () => {
    return getAllProviders().map((p) => p.getCatalogEntry());
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
}
