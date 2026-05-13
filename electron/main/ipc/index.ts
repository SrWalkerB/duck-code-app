import type { BrowserWindow } from "electron";
import { registerProjectHandlers } from "./projects.js";
import { registerThreadHandlers } from "./threads.js";
import { registerMessageHandlers } from "./messages.js";
import { registerDialogHandlers } from "./dialog.js";
import { registerProviderHandlers } from "./providers.js";
import { registerShellHandlers } from "./shell.js";
import { registerFileHandlers } from "./files.js";
import { registerGitHandlers } from "./git.js";

export function registerAllHandlers(mainWindow: BrowserWindow): void {
  registerProjectHandlers();
  registerThreadHandlers();
  registerMessageHandlers(mainWindow);
  registerDialogHandlers();
  registerProviderHandlers(mainWindow);
  registerShellHandlers();
  registerGitHandlers();
  registerFileHandlers(mainWindow);
}
