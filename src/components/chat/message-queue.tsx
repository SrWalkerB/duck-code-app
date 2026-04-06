import type { QueuedMessage } from "@/stores/app-store";
import { CornerDownRight, Trash2 } from "lucide-react";

interface MessageQueueProps {
  queue: QueuedMessage[];
  onSteer: (index: number) => void;
  onRemove: (index: number) => void;
}

export function MessageQueue({ queue, onSteer, onRemove }: MessageQueueProps) {
  if (queue.length === 0) return null;

  return (
    <div className="border-t border-border/30 bg-background px-4 pt-2">
      <div className="mx-auto max-w-3xl">
        {queue.map((msg, i) => (
          <div
            key={i}
            className="flex items-center gap-2 rounded-xl border border-border/40 bg-muted/50 px-3 py-2 mb-1.5"
          >
            <CornerDownRight className="size-3.5 shrink-0 text-muted-foreground/50" />
            <span className="flex-1 truncate text-sm text-foreground/80">
              {msg.content}
            </span>
            <button
              type="button"
              onClick={() => onSteer(i)}
              title="Enviar agora (para geracao atual)"
              className="shrink-0 flex items-center gap-1 rounded-md bg-foreground/10 px-2.5 py-1 text-xs font-medium text-foreground/70 hover:bg-foreground/20 transition-colors"
            >
              <CornerDownRight className="size-3" />
              Steer
            </button>
            <button
              type="button"
              onClick={() => onRemove(i)}
              title="Remover da fila"
              className="shrink-0 flex items-center justify-center rounded-md p-1 text-muted-foreground/50 hover:text-destructive hover:bg-destructive/10 transition-colors"
            >
              <Trash2 className="size-3.5" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
