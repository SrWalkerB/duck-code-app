import { useState, useRef, useCallback, useEffect } from "react";
import { ArrowUp, Square, ChevronDown, Image as ImageIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

const MODELS = [
  { label: "Opus 4.6", value: "claude-opus-4-6" },
  { label: "Sonnet 4.6", value: "claude-sonnet-4-6" },
  { label: "Haiku 4.5", value: "claude-haiku-4-5" },
];

const CONTEXTS = [
  { label: "200k", value: "" },
  { label: "1M", value: "[1m]" },
];

const EFFORTS = [
  { label: "Low", value: "low" },
  { label: "Medium", value: "medium" },
  { label: "High", value: "high" },
  { label: "Max", value: "max" },
];

interface ChatInputProps {
  onSend: (content: string) => void;
  onStop: () => void;
  isStreaming: boolean;
  disabled?: boolean;
  model: string;
  context: string;
  reasoning: string;
  onModelChange: (model: string) => void;
  onContextChange: (context: string) => void;
  onReasoningChange: (reasoning: string) => void;
}

export function ChatInput({
  onSend,
  onStop,
  isStreaming,
  disabled,
  model,
  context,
  reasoning,
  onModelChange,
  onContextChange,
  onReasoningChange,
}: ChatInputProps) {
  const [value, setValue] = useState("");
  const [images, setImages] = useState<{ file: File; preview: string }[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSubmit = useCallback(() => {
    if (!value.trim() || isStreaming || disabled) return;
    onSend(value);
    setValue("");
    setImages([]);
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  }, [value, isStreaming, disabled, onSend]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setValue(e.target.value);
    const el = e.target;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 200) + "px";
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    const items = Array.from(e.clipboardData.items);
    const imageItems = items.filter((item) => item.type.startsWith("image/"));
    if (imageItems.length === 0) return;

    e.preventDefault();
    for (const item of imageItems) {
      const file = item.getAsFile();
      if (file) {
        const preview = URL.createObjectURL(file);
        setImages((prev) => [...prev, { file, preview }]);
      }
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files).filter((f) =>
      f.type.startsWith("image/")
    );
    for (const file of files) {
      const preview = URL.createObjectURL(file);
      setImages((prev) => [...prev, { file, preview }]);
    }
  };

  // Cleanup object URLs when images are removed
  useEffect(() => {
    return () => {
      images.forEach((img) => URL.revokeObjectURL(img.preview));
    };
  }, [images]);

  const selectedModel = MODELS.find((m) => m.value === model) || MODELS[1];
  const selectedContext = CONTEXTS.find((c) => c.value === context) || CONTEXTS[0];
  const selectedEffort = EFFORTS.find((e) => e.value === reasoning) || EFFORTS[1];

  return (
    <div className="border-t border-border/30 bg-background p-4">
      <div className="mx-auto max-w-3xl">
        <div
          className="relative rounded-2xl border border-border/40 bg-muted focus-within:border-border/60 transition-colors"
          onDragOver={handleDragOver}
          onDrop={handleDrop}
        >
          {images.length > 0 && (
            <div className="flex gap-2 px-4 pt-3 pb-1">
              {images.map((img, i) => (
                <div key={i} className="relative group">
                  <img
                    src={img.preview}
                    alt=""
                    className="h-16 w-16 rounded-lg object-cover border border-border/40"
                  />
                  <button
                    type="button"
                    onClick={() =>
                      setImages((prev) => prev.filter((_, j) => j !== i))
                    }
                    className="absolute -top-1.5 -right-1.5 hidden group-hover:flex size-4 items-center justify-center rounded-full bg-destructive text-destructive-foreground text-[10px]"
                  >
                    &times;
                  </button>
                </div>
              ))}
            </div>
          )}
          <textarea
            ref={textareaRef}
            value={value}
            onChange={handleInput}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder="Envie uma mensagem..."
            disabled={disabled}
            rows={1}
            className="block w-full resize-none bg-transparent px-4 pt-3 pb-12 text-sm text-foreground placeholder:text-muted-foreground/50 outline-none"
            style={{ minHeight: "44px", maxHeight: "200px" }}
          />

          {/* Bottom controls row */}
          <div className="absolute bottom-2 left-2 right-2 flex items-center justify-between">
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => {/* TODO: file dialog */}}
                className="flex items-center justify-center rounded-md px-1.5 py-1 text-muted-foreground/50 hover:text-muted-foreground transition-colors"
              >
                <ImageIcon className="size-4" />
              </button>
              <InlineDropdown
                label={selectedModel.label}
                items={MODELS}
                value={model}
                onChange={onModelChange}
              />

              <InlineDropdown
                label={selectedContext.label}
                items={CONTEXTS}
                value={context}
                onChange={onContextChange}
              />

              <InlineDropdown
                label={selectedEffort.label}
                items={EFFORTS}
                value={reasoning}
                onChange={onReasoningChange}
              />
            </div>

            {/* Send / Stop */}
            {isStreaming ? (
              <Button
                size="icon"
                variant="ghost"
                onClick={onStop}
                className="size-8 rounded-full bg-red-500/20 text-red-400 hover:bg-red-500/30 hover:text-red-300"
              >
                <Square className="size-3.5" />
              </Button>
            ) : (
              <button
                type="button"
                onClick={handleSubmit}
                disabled={!value.trim() || disabled}
                className={cn(
                  "flex size-8 items-center justify-center rounded-full transition-colors",
                  value.trim()
                    ? "bg-foreground text-background hover:bg-foreground/80"
                    : "bg-muted-foreground/20 text-muted-foreground/40 cursor-not-allowed"
                )}
              >
                <ArrowUp className="size-4" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function InlineDropdown({
  label,
  items,
  value,
  onChange,
}: {
  label: string;
  items: { label: string; value: string }[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-0.5 rounded-md px-2 py-1 text-[11px] text-muted-foreground/70 transition-colors hover:bg-accent hover:text-muted-foreground"
        >
          {label}
          <ChevronDown className="size-3" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[120px]">
        {items.map((item) => (
          <DropdownMenuItem
            key={item.value}
            onClick={() => onChange(item.value)}
            className={cn(
              item.value === value && "bg-accent text-accent-foreground"
            )}
          >
            {item.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
