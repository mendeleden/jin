import {
  createDesktopBridge,
  type DesktopIpcInvoker,
  type JinDesktopBridge,
} from "./bridge";

type ElectronPreloadApi = {
  contextBridge?: DesktopContextBridge;
  ipcRenderer?: DesktopIpcInvoker;
};

declare const require:
  | undefined
  | ((specifier: "electron") => ElectronPreloadApi);

export interface DesktopContextBridge {
  exposeInMainWorld(key: string, api: JinDesktopBridge): void;
}

export function installDesktopBridge(
  bridge: DesktopContextBridge,
  ipc: DesktopIpcInvoker,
): JinDesktopBridge {
  const api = createDesktopBridge(ipc);
  bridge.exposeInMainWorld("jinDesktop", api);
  return api;
}

function autoInstallDesktopBridge(): void {
  try {
    if (typeof require !== "function") {
      return;
    }

    const electron = require("electron");
    if (!electron.contextBridge || !electron.ipcRenderer) {
      return;
    }

    installDesktopBridge(electron.contextBridge, electron.ipcRenderer);
  } catch {
    // Tests can import this module without a real Electron runtime.
  }
}

autoInstallDesktopBridge();
