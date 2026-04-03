import type { BrowserWindow } from "electron";
import { registerProjectHandlers } from "./projects.js";
import { registerThreadHandlers } from "./threads.js";
import { registerMessageHandlers } from "./messages.js";
import { registerDialogHandlers } from "./dialog.js";
import { registerProviderHandlers } from "./providers.js";

export function registerAllHandlers(mainWindow: BrowserWindow): void {
  registerProjectHandlers();
  registerThreadHandlers();
  registerMessageHandlers(mainWindow);
  registerDialogHandlers();
  registerProviderHandlers();
}
