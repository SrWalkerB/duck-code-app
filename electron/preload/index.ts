import { contextBridge, ipcRenderer } from "electron";

export type ElectronAPI = {
  invoke: (channel: string, ...args: unknown[]) => Promise<unknown>;
  on: (
    channel: string,
    callback: (...args: unknown[]) => void
  ) => () => void;
};

contextBridge.exposeInMainWorld("electronAPI", {
  invoke: (channel: string, ...args: unknown[]) =>
    ipcRenderer.invoke(channel, ...args),

  on: (channel: string, callback: (...args: unknown[]) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, ...args: unknown[]) =>
      callback(...args);
    ipcRenderer.on(channel, listener);
    return () => {
      ipcRenderer.removeListener(channel, listener);
    };
  },
} satisfies ElectronAPI);
