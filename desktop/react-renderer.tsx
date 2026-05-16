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
  const [controller, setController] =
    useState<DesktopRendererController | null>(null);
  const [state, setState] = useState<RendererState>(() =>
    createInitialRendererState(),
  );

  useEffect(() => {
    const controller = new DesktopRendererController({
      bridge,
      onChange: setState,
    });
    controllerRef.current = controller;
    setController(controller);

    setState(controller.getSnapshot());

    void controller.refreshShell({ preserveSelection: true });

    return () => {
      controllerRef.current = null;
      setController(null);
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
    switchView(view) {
      return controllerRef.current?.switchView(view);
    },
    toggleHomePanel(panel) {
      controllerRef.current?.toggleHomePanel(panel);
    },
    toggleSidebar() {
      controllerRef.current?.toggleSidebar();
    },
  };

  return (
    <div className="desktop-react-root">
      <AppShell actions={actions} legacyController={controller} state={state} />
    </div>
  );
}
