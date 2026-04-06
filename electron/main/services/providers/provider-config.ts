import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { app } from "electron";

const PROVIDER_CONFIG_FILE = "provider-config.json";
const DEFAULT_LM_STUDIO_BASE_URL = "http://127.0.0.1:1234";

interface ProviderConfigStore {
  lmStudioBaseUrl?: string;
}

function getFilePath(): string {
  const dir = app.getPath("userData");
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return join(dir, PROVIDER_CONFIG_FILE);
}

function readStore(): ProviderConfigStore {
  const filePath = getFilePath();
  if (!existsSync(filePath)) return {};
  try {
    return JSON.parse(readFileSync(filePath, "utf8")) as ProviderConfigStore;
  } catch {
    return {};
  }
}

function writeStore(store: ProviderConfigStore): void {
  writeFileSync(getFilePath(), JSON.stringify(store, null, 2), "utf8");
}

export function normalizeBaseUrl(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) return DEFAULT_LM_STUDIO_BASE_URL;
  return trimmed.replace(/\/+$/, "");
}

export function getLmStudioBaseUrl(): string {
  const store = readStore();
  return normalizeBaseUrl(store.lmStudioBaseUrl || DEFAULT_LM_STUDIO_BASE_URL);
}

export function setLmStudioBaseUrl(url: string): string {
  const normalized = normalizeBaseUrl(url);
  const store = readStore();
  store.lmStudioBaseUrl = normalized;
  writeStore(store);
  return normalized;
}

