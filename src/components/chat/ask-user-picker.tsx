import { useState } from "react";
import { MessageCircleQuestion, Check } from "lucide-react";
import type { AskUserPayload, AskUserQuestion } from "@/lib/types";

interface Props {
  payload: AskUserPayload;
  onAnswer: (answerText: string) => void;
  isLatest?: boolean;
}

export function AskUserPicker({ payload, onAnswer, isLatest }: Props) {
  const [answered, setAnswered] = useState(false);
  const [pickedByQuestion, setPickedByQuestion] = useState<Record<number, Set<number>>>({});

  if (!payload?.questions?.length) return null;

  const pickSingle = (_qi: number, oi: number, q: AskUserQuestion) => {
    if (answered) return;
    setAnswered(true);
    const label = q.options[oi]?.label ?? "";
    onAnswer(label);
  };

  const toggleMulti = (qi: number, oi: number) => {
    setPickedByQuestion((prev) => {
      const set = new Set(prev[qi] ?? []);
      if (set.has(oi)) set.delete(oi);
      else set.add(oi);
      return { ...prev, [qi]: set };
    });
  };

  const submitMulti = () => {
    if (answered) return;
    const parts: string[] = [];
    payload.questions.forEach((q, qi) => {
      const picks = pickedByQuestion[qi];
      if (!picks || picks.size === 0) return;
      const labels = [...picks].map((oi) => q.options[oi]?.label).filter(Boolean);
      parts.push(`${q.question} → ${labels.join(", ")}`);
    });
    if (parts.length === 0) return;
    setAnswered(true);
    onAnswer(parts.join("\n"));
  };

  const hasMultiSelect = payload.questions.some((q) => q.multiSelect);

  return (
    <div className="rounded-xl border border-border/60 bg-card/70 p-4 shadow-sm">
      <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        <MessageCircleQuestion className="h-3.5 w-3.5 text-blue-400" />
        Selecione uma resposta
      </div>

      <div className="space-y-4">
        {payload.questions.map((q, qi) => (
          <div key={qi} className="space-y-2">
            {q.header && (
              <span className="inline-block rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                {q.header}
              </span>
            )}
            <div className="text-sm font-medium text-foreground">{q.question}</div>
            <div className="grid gap-1.5">
              {q.options.map((opt, oi) => {
                const isPicked = pickedByQuestion[qi]?.has(oi) ?? false;
                return (
                  <button
                    key={oi}
                    type="button"
                    disabled={answered || !isLatest}
                    onClick={() => (q.multiSelect ? toggleMulti(qi, oi) : pickSingle(qi, oi, q))}
                    className={`group flex items-start gap-2 rounded-lg border px-3 py-2 text-left text-sm transition-all
                      ${isPicked
                        ? "border-emerald-500/50 bg-emerald-500/10"
                        : "border-border/60 bg-background/40 hover:border-blue-500/40 hover:bg-blue-500/5"}
                      disabled:cursor-not-allowed disabled:opacity-50`}
                  >
                    <span
                      className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded ${
                        q.multiSelect ? "rounded-sm border-2" : "rounded-full border"
                      } ${isPicked ? "border-emerald-500 bg-emerald-500 text-white" : "border-muted-foreground/40 text-transparent"}`}
                    >
                      {isPicked && <Check className="h-3 w-3" />}
                      {!isPicked && !q.multiSelect && (
                        <span className="text-xs text-muted-foreground/70">{oi + 1}</span>
                      )}
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="block text-foreground/95">{opt.label}</span>
                      {opt.description && (
                        <span className="mt-0.5 block text-[11px] text-muted-foreground/70">
                          {opt.description}
                        </span>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {hasMultiSelect && (
        <div className="mt-3 flex justify-end">
          <button
            type="button"
            disabled={answered || !isLatest}
            onClick={submitMulti}
            className="rounded-md bg-blue-500 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Enviar resposta
          </button>
        </div>
      )}

      {answered && (
        <div className="mt-3 text-[11px] text-muted-foreground">Resposta enviada.</div>
      )}
      {!isLatest && !answered && (
        <div className="mt-3 text-[11px] text-muted-foreground">Pergunta antiga — responda na nova mensagem.</div>
      )}
    </div>
  );
}
