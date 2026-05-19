import { useEffect, useRef, useState } from "react";
import type { JinDesktopBridge } from "./bridge";
import { AppShell, type DesktopShellActions } from "./components/app-shell";
import {
  createInitialRendererState,
  DesktopRendererController,
  type RendererState,
} from "./renderer";
import "./styles.css";

export function DesktopReactApp({
  bridge = window.jinDesktop,
}: {
  bridge?: JinDesktopBridge;
}) {
  const controllerRef = useRef<DesktopRendererController | null>(null);
  const [state, setState] = useState<RendererState>(() =>
    createInitialRendererState(),
  );

  useEffect(() => {
    const controller = new DesktopRendererController({
      bridge,
      onChange: setState,
    });
    controllerRef.current = controller;

    setState(controller.getSnapshot());

    void controller.refreshShell({ preserveSelection: true });

    return () => {
      controllerRef.current = null;
    };
  }, [bridge]);

  const actions: DesktopShellActions = {
    openConversation(conversationId) {
      return controllerRef.current?.openConversation(conversationId);
    },
    refreshShell() {
      return controllerRef.current?.refreshShell({ preserveSelection: true });
    },
    runControlAction(action) {
      return controllerRef.current?.runControlAction(action);
    },
    selectSubview(subview) {
      controllerRef.current?.selectSubview(subview);
    },
    setAdapterFilter(value) {
      return controllerRef.current?.setAdapterFilter(value);
    },
    setSinceFilter(value) {
      return controllerRef.current?.setSinceFilter(value);
    },
    switchView(view) {
      return controllerRef.current?.switchView(view);
    },
    toggleHomePanel(panel) {
      controllerRef.current?.toggleHomePanel(panel);
    },
    toggleInspector() {
      controllerRef.current?.toggleInspector();
    },
    toggleSidebar() {
      controllerRef.current?.toggleSidebar();
    },
  };

  return (
    <div className="desktop-react-root">
      <AppShell actions={actions} state={state} />
    </div>
  );
}
