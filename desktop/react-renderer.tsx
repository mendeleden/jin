import { useEffect, useRef, useState } from "react";
import type { JinDesktopBridge } from "./bridge";
import { AppShell, type DesktopShellActions } from "./components/app-shell";
import { DesktopLayoutPreferencesProvider } from "./layout/preferences";
import {
  DesktopPreferencesProvider,
  useDesktopPreferences,
} from "./preferences";
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
  return (
    <DesktopPreferencesProvider>
      <DesktopLayoutPreferencesProvider>
        <DesktopReactAppContent bridge={bridge} />
      </DesktopLayoutPreferencesProvider>
    </DesktopPreferencesProvider>
  );
}

function DesktopReactAppContent({
  bridge,
}: {
  bridge: JinDesktopBridge;
}) {
  const { refreshIntervalMs, themeMode } = useDesktopPreferences();
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

    return () => {
      controllerRef.current = null;
    };
  }, [bridge]);

  useEffect(() => {
    let refreshInFlight = false;
    const refreshLifecycle = async () => {
      const controller = controllerRef.current;
      if (!controller || refreshInFlight) {
        return;
      }
      refreshInFlight = true;
      try {
        await controller.refreshShell({
          preserveSelection: true,
          preserveMessage: true,
        });
      } finally {
        refreshInFlight = false;
      }
    };

    void refreshLifecycle();
    const refreshInterval = window.setInterval(
      () => void refreshLifecycle(),
      refreshIntervalMs,
    );

    return () => {
      window.clearInterval(refreshInterval);
    };
  }, [bridge, refreshIntervalMs]);

  const actions: DesktopShellActions = {
    closeConversation() {
      controllerRef.current?.closeConversation();
    },
    openConversation(conversationId) {
      return controllerRef.current?.openConversation(conversationId);
    },
    previewConversation(conversationId) {
      return controllerRef.current?.previewConversation(conversationId);
    },
    loadMoreConversations() {
      return controllerRef.current?.loadMoreConversations();
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
    setConversationSearch(value) {
      return controllerRef.current?.setConversationSearch(value);
    },
    setRelationshipFilter(value) {
      return controllerRef.current?.setRelationshipFilter(value);
    },
    setRepositoryFilter(value) {
      return controllerRef.current?.setRepositoryFilter(value);
    },
    setSinceFilter(value) {
      return controllerRef.current?.setSinceFilter(value);
    },
    showConversationIndex() {
      controllerRef.current?.showConversationIndex();
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
    <div className="desktop-react-root" data-theme={themeMode}>
      <AppShell actions={actions} state={state} />
    </div>
  );
}
