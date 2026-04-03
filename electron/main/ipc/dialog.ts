import { ipcMain, dialog, BrowserWindow } from "electron";

export function registerDialogHandlers(): void {
  ipcMain.handle("project:pick-folder", async () => {
    console.log("[pick-folder] handler called");

    try {
      const windows = BrowserWindow.getAllWindows();
      console.log("[pick-folder] windows count:", windows.length);

      const result = windows.length > 0
        ? await dialog.showOpenDialog(windows[0], {
            properties: ["openDirectory"],
            title: "Selecionar diretorio do projeto",
          })
        : await dialog.showOpenDialog({
            properties: ["openDirectory"],
            title: "Selecionar diretorio do projeto",
          });

      console.log("[pick-folder] result:", result);

      if (result.canceled || result.filePaths.length === 0) {
        return null;
      }

      return result.filePaths[0];
    } catch (err) {
      console.error("[pick-folder] error:", err);
      return null;
    }
  });
}
