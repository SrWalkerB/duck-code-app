import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { electronAPI } from "@/lib/electron-api";

interface TerminalPanelProps {
  projectPath: string;
  onClose: () => void;
}

export function TerminalPanel({ projectPath, onClose }: TerminalPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const sessionIdRef = useRef<number | null>(null);
  const [shellLabel, setShellLabel] = useState("shell");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', Menlo, monospace",
      theme: {
        background: "#0a0b0d",
        foreground: "#e4e4e7",
        cursor: "#e4e4e7",
        selectionBackground: "#3f3f46",
        black: "#09090b",
        red: "#ef4444",
        green: "#22c55e",
        yellow: "#eab308",
        blue: "#3b82f6",
        magenta: "#a855f7",
        cyan: "#06b6d4",
        white: "#e4e4e7",
        brightBlack: "#52525b",
        brightRed: "#f87171",
        brightGreen: "#4ade80",
        brightYellow: "#facc15",
        brightBlue: "#60a5fa",
        brightMagenta: "#c084fc",
        brightCyan: "#22d3ee",
        brightWhite: "#fafafa",
      },
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(containerRef.current);
    fitAddon.fit();

    terminalRef.current = term;
    fitAddonRef.current = fitAddon;

    let unsubscribeData = () => {};
    let unsubscribeExit = () => {};

    electronAPI
      .invoke("terminal:create", { path: projectPath })
      .then((res) => {
        const data = res as { sessionId: number; shell: string };
        sessionIdRef.current = data.sessionId;
        setShellLabel(data.shell || "shell");

        // Sync terminal size with PTY
        electronAPI.invoke("terminal:resize", {
          sessionId: data.sessionId,
          cols: term.cols,
          rows: term.rows,
        });

        // PTY data -> xterm
        unsubscribeData = electronAPI.on(
          `terminal:data:${data.sessionId}`,
          (chunk) => {
            term.write(String(chunk));
          }
        );

        // PTY exit
        unsubscribeExit = electronAPI.on(
          `terminal:exit:${data.sessionId}`,
          (payload) => {
            const info = payload as { code: number | null };
            const codeLabel = info.code === null ? "null" : String(info.code);
            term.write(`\r\n[processo finalizado: ${codeLabel}]\r\n`);
          }
        );

        // xterm input -> PTY
        term.onData((input) => {
          electronAPI.invoke("terminal:write", {
            sessionId: data.sessionId,
            data: input,
          });
        });
      })
      .catch((err) => {
        setError(String(err));
      });

    // Handle resize
    const resizeObserver = new ResizeObserver(() => {
      fitAddon.fit();
      if (sessionIdRef.current !== null) {
        electronAPI.invoke("terminal:resize", {
          sessionId: sessionIdRef.current,
          cols: term.cols,
          rows: term.rows,
        });
      }
    });
    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
      unsubscribeData();
      unsubscribeExit();
      if (sessionIdRef.current !== null) {
        electronAPI.invoke("terminal:kill", { sessionId: sessionIdRef.current });
      }
      term.dispose();
    };
  }, [projectPath]);

  return (
    <div className="flex h-72 shrink-0 flex-col border-t border-border/30 bg-[#0a0b0d]">
      <div className="flex items-center justify-between border-b border-border/30 px-3 py-2">
        <div className="min-w-0">
          <p className="text-xs font-medium text-zinc-100">
            Terminal {shellLabel}
          </p>
          <p className="truncate text-[11px] text-zinc-400">{projectPath}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="flex size-7 items-center justify-center rounded-md text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-100"
          title="Fechar terminal"
        >
          <X className="size-4" />
        </button>
      </div>

      {error ? (
        <div className="flex-1 px-3 py-2 font-mono text-xs text-red-400">
          {error}
        </div>
      ) : (
        <div ref={containerRef} className="flex-1 overflow-hidden" />
      )}
    </div>
  );
}
