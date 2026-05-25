import type { DesktopControlAction } from "../../../src/contracts/desktop";
import type {
  DesktopConversationSubview,
  DesktopHomePanel,
  DesktopNavigationView,
} from "../../renderer";

export type MaybePromise = void | Promise<void>;

export interface DesktopShellActions {
  closeConversation(): void;
  openConversation(conversationId: string): MaybePromise;
  refreshShell(): MaybePromise;
  runControlAction(action: DesktopControlAction): MaybePromise;
  selectSubview(subview: DesktopConversationSubview): void;
  setAdapterFilter(value: string): MaybePromise;
  setSinceFilter(value: string): MaybePromise;
  switchView(view: DesktopNavigationView): MaybePromise;
  toggleHomePanel(panel: DesktopHomePanel): void;
  toggleInspector(): void;
  toggleSidebar(): void;
}

export const noopDesktopShellActions: DesktopShellActions = {
  closeConversation() {},
  openConversation() {},
  refreshShell() {},
  runControlAction() {},
  selectSubview() {},
  setAdapterFilter() {},
  setSinceFilter() {},
  switchView() {},
  toggleHomePanel() {},
  toggleInspector() {},
  toggleSidebar() {},
};
