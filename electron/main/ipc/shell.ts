import { ipcMain, shell, webContents } from "electron";
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { IPty } from "node-pty";
import * as pty from "node-pty";

type TerminalSession = {
  process: IPty;
  webContentsId: number;
};

type CodeEditorId = "vscode" | "cursor" | "windsurf" | "zed";
type CodeEditorOption = { id: CodeEditorId; label: string };

const terminalSessions = new Map<number, TerminalSession>();
let nextTerminalSessionId = 1;

function resolveTerminalShellCandidates(): Array<{
  command: string;
  args: string[];
  label: string;
}> {
  if (process.platform === "win32") {
    return [{ command: "cmd.exe", args: [], label: "cmd" }];
  }

  const envShell = process.env.SHELL?.trim();
  const candidates = [
    envShell,
    "/bin/zsh",
    "/bin/bash",
    "/bin/sh",
  ].filter((value): value is string => Boolean(value && value.length > 0));

  return candidates.map((command) => ({
    command,
    args: ["-i"],
    label: command.split("/").pop() || "shell",
  }));
}

function sendTerminalEvent(
  targetWebContentsId: number,
  channel: string,
  payload: unknown
): void {
  const target = webContents.fromId(targetWebContentsId);
  if (!target || target.isDestroyed()) return;
  target.send(channel, payload);
}

function launchDetached(command: string, args: string[], cwd?: string): boolean {
  try {
    spawn(command, args, { cwd, detached: true, stdio: "ignore" }).unref();
    return true;
  } catch {
    return false;
  }
}

function openInEditor(path: string, editor: CodeEditorId): void {
  const cliCandidates: Record<CodeEditorId, string[]> = {
    vscode: ["code", "code-insiders"],
    cursor: ["cursor"],
    windsurf: ["windsurf"],
    zed: ["zed"],
  };

  if (process.platform === "darwin") {
    const appNames: Record<CodeEditorId, string> = {
      vscode: "Visual Studio Code",
      cursor: "Cursor",
      windsurf: "Windsurf",
      zed: "Zed",
    };
    if (launchDetached("open", ["-a", appNames[editor], path])) {
      return;
    }
  }

  const candidates = cliCandidates[editor] || [];
  for (const command of candidates) {
    if (launchDetached(command, [path], path)) {
      return;
    }
  }

  if (process.platform === "win32") {
    for (const command of candidates) {
      if (launchDetached("cmd.exe", ["/c", "start", "", command, path], path)) {
        return;
      }
    }
  }

  throw new Error("Nao foi possivel abrir o editor selecionado.");
}

function commandExists(command: string): boolean {
  const whichCmd = process.platform === "win32" ? "where" : "which";
  const res = spawnSync(whichCmd, [command], { stdio: "ignore" });
  return res.status === 0;
}

function appExistsMac(appName: string): boolean {
  const appFile = `${appName}.app`;
  const systemPath = join("/Applications", appFile);
  const userPath = join(homedir(), "Applications", appFile);
  return existsSync(systemPath) || existsSync(userPath);
}

function listInstalledEditors(): CodeEditorOption[] {
  const allEditors: Array<{
    id: CodeEditorId;
    label: string;
    commands: string[];
    macApps: string[];
  }> = [
    {
      id: "vscode",
      label: "VS Code",
      commands: ["code", "code-insiders"],
      macApps: ["Visual Studio Code", "Visual Studio Code - Insiders"],
    },
    {
      id: "cursor",
      label: "Cursor",
      commands: ["cursor"],
      macApps: ["Cursor"],
    },
    {
      id: "windsurf",
      label: "Windsurf",
      commands: ["windsurf"],
      macApps: ["Windsurf"],
    },
    {
      id: "zed",
      label: "Zed",
      commands: ["zed"],
      macApps: ["Zed"],
    },
  ];

  return allEditors
    .filter((editor) => {
      const hasCli = editor.commands.some((cmd) => commandExists(cmd));
      if (hasCli) return true;
      if (process.platform !== "darwin") return false;
      return editor.macApps.some((appName) => appExistsMac(appName));
    })
    .map((editor) => ({ id: editor.id, label: editor.label }));
}

export function registerShellHandlers(): void {
  ipcMain.handle("shell:open-path", async (_, args: { path: string }) => {
    await shell.openPath(args.path);
  });

  ipcMain.handle("shell:open-url", async (_, args: { url: string }) => {
    await shell.openExternal(args.url);
  });

  ipcMain.handle(
    "shell:open-in-editor",
    async (_, args: { path: string; editor: CodeEditorId }) => {
      if (!existsSync(args.path)) {
        throw new Error(`Diretorio nao encontrado: ${args.path}`);
      }
      const installedEditors = listInstalledEditors();
      const isInstalled = installedEditors.some((item) => item.id === args.editor);
      if (!isInstalled) {
        throw new Error("Editor selecionado nao esta instalado.");
      }
      openInEditor(args.path, args.editor);
      return { ok: true };
    }
  );

  ipcMain.handle("shell:list-installed-editors", async () => {
    return listInstalledEditors();
  });

  ipcMain.handle("shell:open-terminal", async (_, args: { path: string }) => {
    const platform = process.platform;
    if (platform === "linux") {
      // Try common terminals
      for (const term of ["x-terminal-emulator", "gnome-terminal", "konsole", "xterm"]) {
        try {
          spawn(term, [], { cwd: args.path, detached: true, stdio: "ignore" }).unref();
          return;
        } catch {
          continue;
        }
      }
    } else if (platform === "darwin") {
      spawn("open", ["-a", "Terminal", args.path], { detached: true, stdio: "ignore" }).unref();
    } else if (platform === "win32") {
      spawn("cmd.exe", ["/c", "start", "cmd.exe"], { cwd: args.path, detached: true, stdio: "ignore" }).unref();
    }
  });

  ipcMain.handle("terminal:create", async (event, args: { path: string }) => {
    if (!existsSync(args.path)) {
      throw new Error(`Diretorio do projeto nao encontrado: ${args.path}`);
    }

    const shellCandidates = resolveTerminalShellCandidates();
    let proc: IPty | null = null;
    let selectedLabel = "shell";
    let lastError: unknown = null;

    for (const candidate of shellCandidates) {
      try {
        proc = pty.spawn(candidate.command, candidate.args, {
          cols: 120,
          rows: 30,
          cwd: args.path,
          env: { ...process.env, TERM: "xterm-256color" },
          name: "xterm-color",
        });
        selectedLabel = candidate.label;
        break;
      } catch (error) {
        lastError = error;
      }
    }

    if (!proc) {
      const reason = lastError instanceof Error ? lastError.message : String(lastError);
      throw new Error(`Falha ao iniciar shell PTY. Motivo: ${reason}`);
    }

    const sessionId = nextTerminalSessionId++;
    const ownerWebContentsId = event.sender.id;
    terminalSessions.set(sessionId, {
      process: proc,
      webContentsId: ownerWebContentsId,
    });

    proc.onData((chunk) => {
      sendTerminalEvent(
        ownerWebContentsId,
        `terminal:data:${sessionId}`,
        chunk
      );
    });

    proc.onExit(({ exitCode }) => {
      sendTerminalEvent(ownerWebContentsId, `terminal:exit:${sessionId}`, {
        code: exitCode,
      });
      terminalSessions.delete(sessionId);
    });

    return { sessionId, shell: selectedLabel };
  });

  ipcMain.handle(
    "terminal:resize",
    async (_, args: { sessionId: number; cols: number; rows: number }) => {
      const session = terminalSessions.get(args.sessionId);
      if (!session) return { ok: false };
      session.process.resize(args.cols, args.rows);
      return { ok: true };
    }
  );

  ipcMain.handle(
    "terminal:write",
    async (_, args: { sessionId: number; data: string }) => {
      const session = terminalSessions.get(args.sessionId);
      if (!session) return { ok: false };
      session.process.write(args.data);
      return { ok: true };
    }
  );

  ipcMain.handle("terminal:kill", async (_, args: { sessionId: number }) => {
    const session = terminalSessions.get(args.sessionId);
    if (!session) return { ok: false };
    session.process.kill();
    terminalSessions.delete(args.sessionId);
    return { ok: true };
  });
}
