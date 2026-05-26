import { renderToStaticMarkup } from "react-dom/server";
import { RefreshCw } from "lucide-react";
import {
  getIncompatibleCompatibility,
  renderDesktopViewSubtitle,
  renderDesktopViewTitle,
  type RendererState,
} from "../renderer";
import { ActiveWorkspace } from "../views/workspace-switcher";
import { Button } from "../ui/button";
import { Eyebrow, Panel, PanelTitle } from "../ui/panel";
import {
  noopDesktopShellActions,
  type DesktopShellActions,
} from "./shell/actions";
import { NoticeStack, ShellFrame } from "./shell/frame";
import { CompatibilityView } from "./shell/status-panels";

export type { DesktopShellActions } from "./shell/actions";

export function renderDesktopReactShellToStaticMarkup(
  state: RendererState,
): string {
  return renderToStaticMarkup(
    <AppShell actions={noopDesktopShellActions} state={state} />,
  );
}

export function AppShell({
  actions,
  state,
}: {
  actions: DesktopShellActions;
  state: RendererState;
}) {
  if (state.loading && !state.snapshot) {
    return (
      <ShellFrame
        actions={actions}
        state={state}
        subtitle="Restoring the typed daemon-backed shell"
        title="Booting Desktop"
      >
        <Panel className="p-[18px]" data-state-panel="loading" span="wide">
          <Eyebrow>Transport</Eyebrow>
          <PanelTitle>Loading the desktop workbench.</PanelTitle>
          <p className="m-0 mt-2.5 leading-[1.55] text-[var(--text-soft)]">
            The renderer is reconnecting through the preload bridge before
            loading the conversation library.
          </p>
        </Panel>
      </ShellFrame>
    );
  }

  if (!state.snapshot) {
    return (
      <ShellFrame
        actions={actions}
        state={state}
        subtitle="Renderer bridge did not return a snapshot"
        title="Desktop unavailable"
      >
        <NoticeStack state={state} />
        <Panel className="p-[18px]" data-state-panel="bridge" span="wide">
          <Eyebrow>Bridge</Eyebrow>
          <PanelTitle>Desktop could not reach its typed preload bridge.</PanelTitle>
          <p className="m-0 mt-2.5 leading-[1.55] text-[var(--text-soft)]">
            {state.message ??
              "Refresh after the Electron main process is available."}
          </p>
          <div className="mt-4 flex flex-wrap gap-2.5">
            <Button
              onClick={() => void actions.refreshShell()}
              variant="primary"
            >
              <RefreshCw aria-hidden="true" />
              Retry
            </Button>
          </div>
        </Panel>
      </ShellFrame>
    );
  }

  const compatibility = getIncompatibleCompatibility(state);
  return (
    <ShellFrame
      actions={actions}
      state={state}
      subtitle={renderDesktopViewSubtitle(state)}
      title={renderDesktopViewTitle(state.activeView)}
    >
      <NoticeStack state={state} />
      {compatibility ? (
        <CompatibilityView state={state} />
      ) : (
        <ActiveWorkspace actions={actions} state={state} />
      )}
    </ShellFrame>
  );
}
