import type { JinDesktopBridge } from "./bridge";

declare global {
  interface Window {
    jinDesktop: JinDesktopBridge;
  }
}

export {};
