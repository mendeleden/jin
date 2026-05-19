import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { DesktopReactApp } from "./react-renderer";

const root = document.querySelector<HTMLElement>("#app");
if (!root) {
  throw new Error("Desktop React root container was not found.");
}

createRoot(root).render(
  <StrictMode>
    <DesktopReactApp />
  </StrictMode>,
);
