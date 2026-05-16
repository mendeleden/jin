import { mountDesktopRenderer } from "./renderer";

const root = document.querySelector<HTMLElement>("#app");
if (!root) {
  throw new Error("Desktop renderer root container was not found.");
}

mountDesktopRenderer(root, window.jinDesktop);
