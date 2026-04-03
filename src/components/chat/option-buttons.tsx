import { cn } from "@/lib/utils";

interface ParsedOptions {
  questionText: string;
  options: { key: string; label: string }[];
}

/**
 * Detects patterns like:
 * A) SaaS/produto — hero, features
 * B) Portfólio — apresentação
 * or inline: a) Option one b) Option two c) Option three
 * or bold: **A) Option** or **A.** Option
 */
export function parseOptions(text: string): ParsedOptions | null {
  const letterMultiline = parseMultilineLetterOptions(text);
  if (letterMultiline) return letterMultiline;

  const numberMultiline = parseMultilineNumberOptions(text);
  if (numberMultiline) return numberMultiline;

  const letterInline = parseInlineLetterOptions(text);
  if (letterInline) return letterInline;

  const numberInline = parseInlineNumberOptions(text);
  if (numberInline) return numberInline;

  return null;
}

interface OptionButtonsProps {
  options: { key: string; label: string }[];
  onSelect: (value: string) => void;
}

export function OptionButtons({ options, onSelect }: OptionButtonsProps) {
  return (
    <div className="flex flex-col gap-1.5 mt-3 not-prose">
      {options.map((opt) => (
        <button
          key={opt.key}
          type="button"
          onClick={() => onSelect(`${opt.key}) ${opt.label}`)}
          className={cn(
            "flex items-center gap-3 rounded-lg border border-border/50 px-3 py-2.5 text-left text-sm transition-colors",
            "hover:bg-accent hover:border-border text-foreground"
          )}
        >
          <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-secondary text-xs font-semibold text-muted-foreground">
            {opt.key}
          </span>
          <span className="text-sm">{opt.label}</span>
        </button>
      ))}
    </div>
  );
}

function parseMultilineLetterOptions(text: string): ParsedOptions | null {
  const pattern = /^[*\-•]?\s*\*{0,2}([A-Ha-h])[).]\*{0,2}\s+(.+)$/gm;
  const matches = [...text.matchAll(pattern)];
  if (matches.length < 2) return null;

  const firstMatchIndex = text.indexOf(matches[0][0]);
  const questionText = text.slice(0, firstMatchIndex).trim();
  const options = matches.map((m) => ({
    key: m[1].toUpperCase(),
    label: m[2].trim().replace(/\*+$/g, ""),
  }));

  if (!isSequentialLetters(options.map((o) => o.key))) return null;
  if (!isLikelyChoiceQuestion(questionText, options)) return null;

  return { questionText, options };
}

function parseMultilineNumberOptions(text: string): ParsedOptions | null {
  const pattern = /^[*\-•]?\s*\*{0,2}([1-9]\d{0,1})[).]\*{0,2}\s+(.+)$/gm;
  const matches = [...text.matchAll(pattern)];
  if (matches.length < 2) return null;

  const firstMatchIndex = text.indexOf(matches[0][0]);
  const questionText = text.slice(0, firstMatchIndex).trim();
  const options = matches.map((m) => ({
    key: m[1],
    label: m[2].trim().replace(/\*+$/g, ""),
  }));

  if (!isSequentialNumbers(options.map((o) => o.key))) return null;
  if (!isLikelyChoiceQuestion(questionText, options)) return null;

  return { questionText, options };
}

function parseInlineLetterOptions(text: string): ParsedOptions | null {
  const pattern = /(?:^|\s)([A-Ha-h])[).]\s+/g;
  const matches = [...text.matchAll(pattern)];
  if (matches.length < 2) return null;

  const firstMatch = matches[0][0].trimStart();
  const firstMatchIndex = text.indexOf(firstMatch);
  const questionText = text.slice(0, firstMatchIndex).trim();

  const options: { key: string; label: string }[] = [];
  for (let i = 0; i < matches.length; i++) {
    const match = matches[i];
    const key = match[1].toUpperCase();
    const start = match.index! + match[0].length;
    const end = i + 1 < matches.length ? matches[i + 1].index! : text.length;
    const label = text.slice(start, end).trim();
    if (label) options.push({ key, label });
  }

  if (options.length < 2) return null;
  if (!isSequentialLetters(options.map((o) => o.key))) return null;
  if (!isLikelyChoiceQuestion(questionText, options)) return null;

  return { questionText, options };
}

function parseInlineNumberOptions(text: string): ParsedOptions | null {
  const pattern = /(?:^|\s)([1-9]\d{0,1})[).]\s+/g;
  const matches = [...text.matchAll(pattern)];
  if (matches.length < 2) return null;

  const firstMatch = matches[0][0].trimStart();
  const firstMatchIndex = text.indexOf(firstMatch);
  const questionText = text.slice(0, firstMatchIndex).trim();

  const options: { key: string; label: string }[] = [];
  for (let i = 0; i < matches.length; i++) {
    const match = matches[i];
    const key = match[1];
    const start = match.index! + match[0].length;
    const end = i + 1 < matches.length ? matches[i + 1].index! : text.length;
    const label = text.slice(start, end).trim();
    if (label) options.push({ key, label });
  }

  if (options.length < 2) return null;
  if (!isSequentialNumbers(options.map((o) => o.key))) return null;
  if (!isLikelyChoiceQuestion(questionText, options)) return null;

  return { questionText, options };
}

function isSequentialLetters(keys: string[]): boolean {
  if (keys.length < 2) return false;
  const first = keys[0].charCodeAt(0);
  return keys.every((key, idx) => key.charCodeAt(0) === first + idx);
}

function isSequentialNumbers(keys: string[]): boolean {
  if (keys.length < 2) return false;
  const first = Number(keys[0]);
  if (!Number.isFinite(first)) return false;
  return keys.every((key, idx) => Number(key) === first + idx);
}

function isLikelyChoiceQuestion(
  questionText: string,
  options: { key: string; label: string }[]
): boolean {
  if (options.length > 8) return false;
  if (options.some((opt) => opt.label.length > 180 || opt.label.length < 2)) return false;

  if (!questionText) return true;

  const normalized = questionText.toLowerCase();
  return (
    normalized.includes("?") ||
    normalized.includes("escolh") ||
    normalized.includes("opcao") ||
    normalized.includes("opção") ||
    normalized.includes("qual") ||
    normalized.includes("choose") ||
    normalized.includes("which") ||
    normalized.includes("select")
  );
}
