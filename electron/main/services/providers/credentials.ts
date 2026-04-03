import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
} from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { app } from "electron";
import os from "node:os";

const CREDENTIALS_FILE = "provider-credentials.json";

interface CredentialEntry {
  ciphertext: string;
  nonce: string;
  authTag: string;
  updatedAt: number;
}

type CredentialsStore = Record<string, CredentialEntry>;

function getFilePath(): string {
  const dir = app.getPath("userData");
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return join(dir, CREDENTIALS_FILE);
}

function readStore(): CredentialsStore {
  const filePath = getFilePath();
  if (!existsSync(filePath)) return {};
  try {
    return JSON.parse(readFileSync(filePath, "utf8")) as CredentialsStore;
  } catch {
    return {};
  }
}

function writeStore(store: CredentialsStore): void {
  writeFileSync(getFilePath(), JSON.stringify(store, null, 2), "utf8");
}

function getEncryptionKey(): Buffer {
  const seed = [
    "duck-codex-provider-credentials",
    os.hostname(),
    os.homedir(),
    os.userInfo().username,
  ].join(":");
  return scryptSync(seed, "duck-codex-aes-gcm", 32);
}

function encrypt(plainText: string): {
  ciphertext: string;
  nonce: string;
  authTag: string;
} {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getEncryptionKey(), nonce);
  const ciphertext = Buffer.concat([
    cipher.update(plainText, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return {
    ciphertext: ciphertext.toString("base64"),
    nonce: nonce.toString("base64"),
    authTag: authTag.toString("base64"),
  };
}

function decrypt(
  ciphertext: string,
  nonce: string,
  authTag: string
): string {
  const decipher = createDecipheriv(
    "aes-256-gcm",
    getEncryptionKey(),
    Buffer.from(nonce, "base64")
  );
  decipher.setAuthTag(Buffer.from(authTag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, "base64")),
    decipher.final(),
  ])
    .toString("utf8")
    .trim();
}

export function loadApiKey(provider: string): string {
  const store = readStore();
  const entry = store[provider];
  if (!entry) {
    throw new Error(`${provider.toUpperCase()} API key nao configurada`);
  }
  const decrypted = decrypt(entry.ciphertext, entry.nonce, entry.authTag);
  if (!decrypted) {
    throw new Error(`${provider.toUpperCase()} API key nao configurada`);
  }
  return decrypted;
}

export function saveApiKey(provider: string, apiKey: string): void {
  const trimmed = apiKey.trim();
  if (!trimmed) throw new Error("API key vazia");

  const encrypted = encrypt(trimmed);
  const store = readStore();
  store[provider] = {
    ciphertext: encrypted.ciphertext,
    nonce: encrypted.nonce,
    authTag: encrypted.authTag,
    updatedAt: Date.now(),
  };
  writeStore(store);
}

export function removeApiKey(provider: string): void {
  const store = readStore();
  delete store[provider];
  writeStore(store);
}

export function getApiKeyStatus(
  provider: string
): { configured: boolean; last4: string | null } {
  try {
    const key = loadApiKey(provider);
    return {
      configured: key.length > 0,
      last4: key.length >= 4 ? key.slice(-4) : null,
    };
  } catch {
    return { configured: false, last4: null };
  }
}
