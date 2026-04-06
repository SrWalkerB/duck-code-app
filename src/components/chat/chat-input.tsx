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
import type { ApprovalMode, ProviderId } from "@/lib/types";

const EFFORTS = [
  { label: "Low", value: "low" },
  { label: "Medium", value: "medium" },
  { label: "High", value: "high" },
];

const APPROVAL_MODES = [
  { label: "Suggest", value: "suggest" },
  { label: "Auto-edit", value: "auto-edit" },
  { label: "Full auto", value: "full-auto" },
];

interface ChatInputProps {
  onSend: (content: string) => void;
  onEnqueue: (content: string) => void;
  onStop: () => void;
  isStreaming: boolean;
  disabled?: boolean;
  provider: ProviderId;
  providers: { label: string; value: ProviderId }[];
  models: { label: string; value: string }[];
  supportsEffort: boolean;
  model: string;
  effort: string;
  onProviderChange: (provider: ProviderId) => void;
  onModelChange: (model: string) => void;
  onEffortChange: (effort: string) => void;
  approvalMode: ApprovalMode;
  onApprovalModeChange: (mode: ApprovalMode) => void;
}

export function ChatInput({
  onSend,
  onEnqueue,
  onStop,
  isStreaming,
  disabled,
  provider,
  providers,
  models,
  supportsEffort,
  model,
  effort,
  onProviderChange,
  onModelChange,
  onEffortChange,
  approvalMode,
  onApprovalModeChange,
}: ChatInputProps) {
  const [value, setValue] = useState("");
  const [images, setImages] = useState<{ file: File; preview: string }[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSubmit = useCallback(() => {
    if (!value.trim() || disabled) return;
    if (isStreaming) {
      onEnqueue(value.trim());
    } else {
      onSend(value);
    }
    setValue("");
    setImages([]);
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  }, [value, isStreaming, disabled, onSend, onEnqueue]);

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

  useEffect(() => {
    return () => {
      images.forEach((img) => URL.revokeObjectURL(img.preview));
    };
  }, [images]);

  const selectedProvider =
    providers.find((p) => p.value === provider) ||
    providers[0] || { label: "Provider", value: "claude" as ProviderId };
  const selectedModel =
    models.find((m) => m.value === model) ||
    models[0] || { label: model || "Modelo", value: model };
  const selectedEffort = EFFORTS.find((e) => e.value === effort) || EFFORTS[1];
  const selectedApproval = APPROVAL_MODES.find((a) => a.value === approvalMode) || APPROVAL_MODES[0];

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
                className="flex items-center justify-center rounded-md px-1.5 py-1 text-muted-foreground/50 hover:text-muted-foreground transition-colors"
              >
                <ImageIcon className="size-4" />
              </button>
              <InlineDropdown
                label={selectedProvider?.label || "Provider"}
                items={providers}
                value={provider}
                onChange={(value) => onProviderChange(value as ProviderId)}
              />

              <InlineDropdown
                label={selectedModel.label}
                items={models}
                value={model}
                onChange={onModelChange}
              />

              {supportsEffort && (
                <InlineDropdown
                  label={selectedEffort.label}
                  items={EFFORTS}
                  value={effort}
                  onChange={onEffortChange}
                />
              )}

              <InlineDropdown
                label={selectedApproval.label}
                items={APPROVAL_MODES}
                value={approvalMode}
                onChange={(v) => onApprovalModeChange(v as ApprovalMode)}
              />
            </div>

            {/* Send / Stop */}
            {isStreaming ? (
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={handleSubmit}
                  disabled={!value.trim()}
                  className={cn(
                    "flex size-8 items-center justify-center rounded-full transition-colors",
                    value.trim()
                      ? "bg-foreground/20 text-foreground/70 hover:bg-foreground/30"
                      : "bg-muted-foreground/10 text-muted-foreground/30 cursor-not-allowed"
                  )}
                  title="Enfileirar mensagem"
                >
                  <ArrowUp className="size-4" />
                </button>
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={onStop}
                  className="size-8 rounded-full bg-red-500/20 text-red-400 hover:bg-red-500/30 hover:text-red-300"
                >
                  <Square className="size-3.5" />
                </Button>
              </div>
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
