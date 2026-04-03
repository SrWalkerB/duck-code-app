import { ipcMain, shell } from "electron";
import { spawn } from "node:child_process";

export function registerShellHandlers(): void {
  ipcMain.handle("shell:open-path", async (_, args: { path: string }) => {
    await shell.openPath(args.path);
  });

  ipcMain.handle("shell:open-url", async (_, args: { url: string }) => {
    await shell.openExternal(args.url);
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
}
