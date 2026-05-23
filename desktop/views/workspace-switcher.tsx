import type { RendererState } from "../renderer";
import type { DesktopShellActions } from "../components/shell/actions";
import { HomeWorkspace } from "./home/workspace";
import { ConversationsWorkspace } from "./conversations/workspace";
import { LogsWorkspace } from "./logs/workspace";
import { RoutingWorkspace } from "./routing/workspace";
import { SettingsWorkspace } from "./settings/workspace";

export function ActiveWorkspace({
  actions,
  state,
}: {
  actions: DesktopShellActions;
  state: RendererState;
}) {
  if (state.activeView === "home") {
    return <HomeWorkspace actions={actions} state={state} />;
  }

  if (state.activeView === "conversations") {
    return <ConversationsWorkspace actions={actions} state={state} />;
  }

  if (state.activeView === "routing") {
    return <RoutingWorkspace actions={actions} state={state} />;
  }

  if (state.activeView === "logs") {
    return <LogsWorkspace actions={actions} state={state} />;
  }

  return <SettingsWorkspace state={state} />;
}
