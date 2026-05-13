/**
 * Converte ZodError em mensagem humana acionável para o modelo.
 *
 * O erro default do zod (`JSON.stringify(issues)`) é ilegível e o modelo
 * acaba repetindo o mesmo erro. Aqui traduzimos cada `code` em texto que
 * diz **o que fazer** para corrigir.
 *
 * Inspirado em `example/openclaude/src/services/tools/toolErrors.ts::formatZodValidationError`.
 */

import type { ZodError } from "zod";

type Issue = Record<string, unknown>;

function pathToStr(path: readonly (string | number)[]): string {
  if (path.length === 0) return "(root)";
  return path.map((p) => (typeof p === "number" ? `[${p}]` : p)).join(".");
}

function extractReceived(issue: Issue): string {
  if (typeof issue.received === "string") return issue.received as string;
  // zod 4 encodes received inside message like "expected string, received number"
  if (typeof issue.message === "string") {
    const m = (issue.message as string).match(/received\s+(\w+)/i);
    if (m) return m[1];
  }
  return "unknown";
}

function renderIssue(issue: Issue): string {
  const path = (issue.path as (string | number)[] | undefined) ?? [];
  const field = pathToStr(path);
  const code = issue.code as string;

  switch (code) {
    case "invalid_type": {
      const exp = String(issue.expected ?? "");
      const received = extractReceived(issue);
      if (exp === "string" && received === "array") {
        return `Field '${field}' must be a string. You sent an array — join the lines with \\n into a single string and retry.`;
      }
      if (exp === "string" && received === "object") {
        return `Field '${field}' must be a string. You sent an object — send the raw text as a JSON string instead.`;
      }
      if (exp === "boolean") {
        return `Field '${field}' must be a boolean (true or false). You sent ${received}.`;
      }
      if (exp === "number") {
        return `Field '${field}' must be a number. You sent ${received}.`;
      }
      if (exp === "array") {
        return `Field '${field}' must be an array. You sent ${received}.`;
      }
      return `Field '${field}' must be ${exp} but you sent ${received}.`;
    }

    case "too_small": {
      const origin = String(issue.origin ?? "");
      const minimum = String(issue.minimum ?? "");
      if (origin === "array") {
        return `Field '${field}' must have at least ${minimum} item${minimum === "1" ? "" : "s"}. ${
          minimum === "1" ? "Provide one value or omit the field." : `Provide ${minimum} or more items, or omit the field if optional.`
        }`;
      }
      if (origin === "string") {
        return `Field '${field}' must be at least ${minimum} character(s) long.`;
      }
      if (origin === "number") {
        return `Field '${field}' must be >= ${minimum}.`;
      }
      return `Field '${field}' is too small (minimum: ${minimum}).`;
    }

    case "too_big": {
      const origin = String(issue.origin ?? "");
      const maximum = String(issue.maximum ?? "");
      if (origin === "array") {
        return `Field '${field}' may have at most ${maximum} item(s). Remove extras and retry.`;
      }
      if (origin === "string") {
        return `Field '${field}' is too long (max ${maximum} chars).`;
      }
      return `Field '${field}' is too big (max: ${maximum}).`;
    }

    case "invalid_format":
      return `Field '${field}' has an invalid format: ${String(issue.message ?? "")}.`;

    case "unrecognized_keys": {
      const keys = (issue.keys as string[] | undefined) ?? [];
      return `Unknown field(s) ${keys.map((k) => `'${k}'`).join(", ")}. Check the tool schema and retry without them.`;
    }

    case "invalid_union":
      return `Field '${field}' doesn't match any accepted shape. ${String(issue.message ?? "")}`;

    case "custom":
      return `Field '${field}': ${String(issue.message ?? "")}`;

    default:
      return `Field '${field}': ${String(issue.message ?? code)}`;
  }
}

/** Retorna mensagem humana agregando todos os issues. */
export function formatZodError(err: ZodError): string {
  const issues = err.issues as unknown as Issue[];
  if (!issues || issues.length === 0) return "Invalid input (no issues reported).";
  if (issues.length === 1) return renderIssue(issues[0]);
  return `${issues.length} validation errors:\n` + issues.map((i, idx) => `  ${idx + 1}. ${renderIssue(i)}`).join("\n");
}
