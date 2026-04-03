import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";

export function TerminalPanel() {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const term = new Terminal({
      cursorBlink: false,
      fontSize: 12,
      fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
      theme: {
        background: "#0a0a0b",
        foreground: "#a1a1aa",
        cursor: "#a1a1aa",
        selectionBackground: "#27272a",
      },
      disableStdin: true,
      rows: 10,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(containerRef.current);

    try {
      fitAddon.fit();
    } catch {
      // ignore fit errors on initial render
    }

    term.writeln("\x1b[1;36m  Duck Codex Terminal\x1b[0m");
    term.writeln("");
    term.writeln("\x1b[33m  Terminal em desenvolvimento.\x1b[0m");
    term.writeln("\x1b[90m  A integracao com PTY via Tauri sera implementada em breve.\x1b[0m");
    term.writeln("");

    terminalRef.current = term;

    const resizeObserver = new ResizeObserver(() => {
      try {
        fitAddon.fit();
      } catch {
        // ignore
      }
    });
    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
      term.dispose();
      terminalRef.current = null;
    };
  }, []);

  return (
    <div
      ref={containerRef}
      className="h-full w-full bg-[#0a0a0b]"
      style={{ padding: "4px 0 0 4px" }}
    />
  );
}
