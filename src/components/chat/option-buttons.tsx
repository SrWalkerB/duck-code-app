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
  // Patterns to detect:
  // **A)** Text here         (bold letter)
  // **A.** Text here         (bold letter with dot)
  // A) Text here             (plain letter)
  // a) Text here             (lowercase)
  // - **A)** Text here       (with bullet)
  const multilinePattern = /^[*\-•]?\s*\*{0,2}([A-Da-d])[).]\*{0,2}\s+(.+)$/gm;
  const multilineMatches = [...text.matchAll(multilinePattern)];

  if (multilineMatches.length >= 2) {
    const firstMatchIndex = text.indexOf(multilineMatches[0][0]);
    const questionText = text.slice(0, firstMatchIndex).trim();
    const options = multilineMatches.map((m) => ({
      key: m[1].toUpperCase(),
      label: m[2].trim().replace(/\*+$/g, ""),
    }));
    return { questionText, options };
  }

  // Inline: options on single line "a) opt1 b) opt2 c) opt3"
  const inlinePattern = /(?:^|\s)([A-Da-d])\)\s+/g;
  const inlineMatches = [...text.matchAll(inlinePattern)];

  if (inlineMatches.length >= 2) {
    const firstMatchIndex = text.indexOf(inlineMatches[0][0].trimStart());
    const questionText = text.slice(0, firstMatchIndex).trim();

    const options: { key: string; label: string }[] = [];
    for (let i = 0; i < inlineMatches.length; i++) {
      const match = inlineMatches[i];
      const key = match[1].toUpperCase();
      const start = match.index! + match[0].length;
      const end = i + 1 < inlineMatches.length ? inlineMatches[i + 1].index! : text.length;
      const label = text.slice(start, end).trim();
      if (label) {
        options.push({ key, label });
      }
    }

    if (options.length >= 2) {
      return { questionText, options };
    }
  }

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
