import { app, BrowserWindow, ipcMain } from "electron";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createDesktopShellService,
  registerDesktopIpcHandlers,
} from "./shell-service";
import {
  DESKTOP_PRELOAD_FILE,
  DESKTOP_WEB_PREFERENCES,
} from "./security";

const CURRENT_DIR = dirname(fileURLToPath(import.meta.url));

async function createMainWindow(): Promise<BrowserWindow> {
  const window = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1180,
    minHeight: 760,
    backgroundColor: "#060e20",
    titleBarStyle: "hiddenInset",
    autoHideMenuBar: true,
    webPreferences: {
      ...DESKTOP_WEB_PREFERENCES,
      preload: join(CURRENT_DIR, DESKTOP_PRELOAD_FILE),
    },
  });

  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event, targetUrl) => {
    if (targetUrl !== window.webContents.getURL()) {
      event.preventDefault();
    }
  });

  await window.loadFile(join(CURRENT_DIR, "index.html"));
  return window;
}

async function bootstrap(): Promise<void> {
  registerDesktopIpcHandlers(ipcMain, createDesktopShellService());
  await createMainWindow();
}

app.whenReady().then(bootstrap).catch((error) => {
  console.error("jin desktop failed to boot", error);
  app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    void createMainWindow();
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
