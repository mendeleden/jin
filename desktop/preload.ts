import {
  createDesktopBridge,
  type DesktopIpcInvoker,
  type JinDesktopBridge,
} from "./bridge";

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

async function autoInstallDesktopBridge(): Promise<void> {
  try {
    const electron = await import("electron");
    installDesktopBridge(electron.contextBridge, electron.ipcRenderer);
  } catch {
    // Tests can import this module without a real Electron runtime.
  }
}

void autoInstallDesktopBridge();
