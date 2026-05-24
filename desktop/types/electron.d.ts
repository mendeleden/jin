declare module "electron" {
  export interface BrowserWindowConstructorOptions {
    width?: number;
    height?: number;
    minWidth?: number;
    minHeight?: number;
    backgroundColor?: string;
    icon?: string;
    titleBarStyle?: string;
    autoHideMenuBar?: boolean;
    webPreferences?: {
      preload?: string;
      contextIsolation?: boolean;
      nodeIntegration?: boolean;
      sandbox?: boolean;
    };
  }

  export class BrowserWindow {
    constructor(options?: BrowserWindowConstructorOptions);
    loadFile(path: string): Promise<void>;
    static getAllWindows(): BrowserWindow[];
  }

  export const app: {
    whenReady(): Promise<void>;
    on(event: string, listener: (...args: unknown[]) => void): void;
    quit(): void;
  };

  export const ipcMain: {
    handle(
      channel: string,
      listener: (event: unknown, ...args: unknown[]) => unknown,
    ): void;
    removeHandler(channel: string): void;
  };

  export const ipcRenderer: {
    invoke(channel: string, ...args: unknown[]): Promise<unknown>;
  };

  export const contextBridge: {
    exposeInMainWorld(key: string, api: unknown): void;
  };
}
