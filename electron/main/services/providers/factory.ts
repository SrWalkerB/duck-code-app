import { LmStudioProvider } from "./lm-studio.js";
import { OllamaProvider } from "./ollama.js";
import type { ApiProviderId, ProviderRuntime } from "./types.js";

const providers: Record<ApiProviderId, ProviderRuntime> = {
  "lm-studio": new LmStudioProvider(),
  ollama: new OllamaProvider(),
};

export function getProvider(id: ApiProviderId): ProviderRuntime {
  const provider = providers[id];
  if (!provider) {
    throw new Error(`Provider desconhecido: ${id}`);
  }
  return provider;
}

export function getAllProviders(): ProviderRuntime[] {
  return Object.values(providers);
}
