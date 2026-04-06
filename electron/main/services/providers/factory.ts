import { ClaudeProvider } from "./claude.js";
import { OpenAiProvider } from "./openai.js";
import { CodexCliProvider } from "./codex.js";
import { ClaudeCodeCliProvider } from "./claude-code.js";
import { LmStudioProvider } from "./lm-studio.js";
import type { ApiProviderId, ProviderRuntime } from "./types.js";

const providers: Record<ApiProviderId, ProviderRuntime> = {
  claude: new ClaudeProvider(),
  openai: new OpenAiProvider(),
  codex: new CodexCliProvider(),
  "claude-code": new ClaudeCodeCliProvider(),
  "lm-studio": new LmStudioProvider(),
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
