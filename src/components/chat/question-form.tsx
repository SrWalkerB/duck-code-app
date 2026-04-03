import { useState, useCallback } from "react";
import { cn } from "@/lib/utils";

interface QuestionOption {
  label: string;
  description?: string;
}

interface Question {
  question: string;
  header: string;
  multiSelect: boolean;
  options: QuestionOption[];
}

interface QuestionFormProps {
  questions: Question[];
  onSubmit: (answers: string) => void;
}

export function QuestionForm({ questions, onSubmit }: QuestionFormProps) {
  const [activeTab, setActiveTab] = useState(0);
  const [answers, setAnswers] = useState<Record<number, string[]>>({});

  const selectAnswer = useCallback(
    (questionIdx: number, label: string) => {
      const q = questions[questionIdx];
      setAnswers((prev) => {
        const current = prev[questionIdx] || [];
        if (q.multiSelect) {
          const already = current.includes(label);
          return {
            ...prev,
            [questionIdx]: already
              ? current.filter((l) => l !== label)
              : [...current, label],
          };
        }
        return { ...prev, [questionIdx]: [label] };
      });
    },
    [questions]
  );

  const allAnswered = questions.every(
    (_, i) => answers[i] && answers[i].length > 0
  );

  const handleSubmit = useCallback(() => {
    const formatted = questions
      .map((q, i) => {
        const selected = answers[i] || [];
        return `${q.header}: ${selected.length > 0 ? selected.join(", ") : "Não respondido"}`;
      })
      .join("\n");
    onSubmit(formatted);
  }, [questions, answers, onSubmit]);

  const isSubmitTab = activeTab === questions.length;

  return (
    <div className="rounded-lg border border-border/40 bg-card overflow-hidden">
      {/* Tab bar */}
      <div className="flex items-center gap-1 px-3 py-2 border-b border-border/30 text-xs overflow-x-auto">
        {questions.map((q, i) => {
          const answered = answers[i] && answers[i].length > 0;
          return (
            <button
              key={i}
              type="button"
              onClick={() => setActiveTab(i)}
              className={cn(
                "px-2.5 py-1 rounded-md transition-colors whitespace-nowrap",
                answered ? "text-emerald-400" : "text-muted-foreground",
                activeTab === i && "bg-secondary text-foreground"
              )}
            >
              {answered && "✓ "}
              {q.header}
            </button>
          );
        })}
        <button
          type="button"
          onClick={() => setActiveTab(questions.length)}
          className={cn(
            "px-2.5 py-1 rounded-md transition-colors whitespace-nowrap",
            allAnswered ? "text-emerald-400" : "text-muted-foreground",
            isSubmitTab && "bg-secondary text-foreground"
          )}
        >
          Submit
        </button>
      </div>

      {/* Content */}
      {isSubmitTab ? (
        <div className="p-4">
          <p className="text-sm font-medium mb-3">Revisar respostas</p>
          {questions.map((q, i) => {
            const selected = answers[i] || [];
            return (
              <div key={i} className="flex items-start gap-2 py-1.5">
                <span
                  className={cn(
                    "text-xs mt-0.5",
                    selected.length > 0
                      ? "text-emerald-400"
                      : "text-muted-foreground"
                  )}
                >
                  ●
                </span>
                <div>
                  <span className="text-xs text-muted-foreground">
                    {q.header}:
                  </span>
                  <span className="text-sm ml-1">
                    {selected.length > 0
                      ? selected.join(", ")
                      : "Não respondido"}
                  </span>
                </div>
              </div>
            );
          })}
          <button
            type="button"
            disabled={!allAnswered}
            onClick={handleSubmit}
            className="mt-4 w-full rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50 transition-colors hover:bg-primary/90"
          >
            Enviar respostas
          </button>
        </div>
      ) : (
        <div className="p-4">
          <p className="text-sm mb-3">{questions[activeTab].question}</p>
          {questions[activeTab].multiSelect && (
            <p className="text-xs text-muted-foreground mb-2">
              Selecione uma ou mais opcoes
            </p>
          )}
          <div className="flex flex-col gap-2">
            {questions[activeTab].options.map((opt) => {
              const selected = (answers[activeTab] || []).includes(opt.label);
              return (
                <button
                  key={opt.label}
                  type="button"
                  onClick={() => selectAnswer(activeTab, opt.label)}
                  className={cn(
                    "flex flex-col gap-0.5 rounded-lg border px-3 py-2.5 text-left text-sm transition-colors",
                    selected
                      ? "border-primary bg-primary/10"
                      : "border-border/50 hover:bg-accent"
                  )}
                >
                  <span className="font-medium">{opt.label}</span>
                  {opt.description && (
                    <span className="text-xs text-muted-foreground">
                      {opt.description}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
