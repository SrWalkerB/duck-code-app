/**
 * Schema coercion preprocessors — robustece tool calls contra modelos pequenos
 * que enviam tipos "próximos mas errados" (array no lugar de string, objeto
 * `{text: "..."}`, número como string, etc.).
 *
 * Uso:
 *   const schema = z.object({
 *     path: coerceString(z.string().min(1)),
 *     content: coerceString(z.string()),
 *     replace_all: coerceBoolean(z.boolean().default(false)),
 *   });
 *
 * Inspirado em `example/openclaude/src/utils/semanticBoolean.ts`.
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// String coercion
// ---------------------------------------------------------------------------

/** Coerce "tipo-próximo" em string. Aceita: string, array (join \n), objeto com .text/.content. */
function toStringValue(v: unknown): unknown {
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return v.map((x) => String(x)).join("\n");
  if (v && typeof v === "object") {
    const obj = v as Record<string, unknown>;
    if (typeof obj.text === "string") return obj.text;
    if (typeof obj.content === "string") return obj.content;
    if (typeof obj.value === "string") return obj.value;
  }
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return v;
}

export function coerceString<T extends z.ZodType<string>>(schema: T): z.ZodType<string> {
  return z.preprocess(toStringValue, schema) as unknown as z.ZodType<string>;
}

// ---------------------------------------------------------------------------
// Array-of-string coercion
// ---------------------------------------------------------------------------

function toStringArray(v: unknown): unknown {
  if (Array.isArray(v)) return v.map((x) => (typeof x === "string" ? x : String(x)));
  if (typeof v === "string") return [v];
  if (v && typeof v === "object") {
    return Object.values(v as Record<string, unknown>).map((x) => String(x));
  }
  return v;
}

export function coerceStringArray<T extends z.ZodType<string[]>>(schema: T): z.ZodType<string[]> {
  return z.preprocess(toStringArray, schema) as unknown as z.ZodType<string[]>;
}

// ---------------------------------------------------------------------------
// Boolean coercion — aceita "true"/"yes"/1/etc.
// ---------------------------------------------------------------------------

function toBooleanValue(v: unknown): unknown {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") {
    if (v === 1) return true;
    if (v === 0) return false;
  }
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    if (s === "true" || s === "yes" || s === "y" || s === "1" || s === "on") return true;
    if (s === "false" || s === "no" || s === "n" || s === "0" || s === "off") return false;
  }
  return v;
}

export function coerceBoolean<T extends z.ZodTypeAny>(schema: T): T {
  return z.preprocess(toBooleanValue, schema) as unknown as T;
}

/** Alias histórico: igual a `coerceBoolean`. Inspirado em `semanticBoolean` do openclaude. */
export const semanticBoolean = coerceBoolean;

// ---------------------------------------------------------------------------
// Number coercion
// ---------------------------------------------------------------------------

function toNumberValue(v: unknown): unknown {
  if (typeof v === "number") return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return v;
}

export function coerceNumber<T extends z.ZodTypeAny>(schema: T): T {
  return z.preprocess(toNumberValue, schema) as unknown as T;
}
