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
  previewConversation(conversationId: string): MaybePromise;
  loadMoreConversations(): MaybePromise;
  refreshShell(): MaybePromise;
  runControlAction(action: DesktopControlAction): MaybePromise;
  selectSubview(subview: DesktopConversationSubview): void;
  setAdapterFilter(value: string): MaybePromise;
  setConversationSearch(value: string): MaybePromise;
  setRelationshipFilter(value: string): MaybePromise;
  setRepositoryFilter(value: string): MaybePromise;
  setSinceFilter(value: string): MaybePromise;
  showConversationIndex(): void;
  switchView(view: DesktopNavigationView): MaybePromise;
  toggleHomePanel(panel: DesktopHomePanel): void;
  toggleInspector(): void;
  toggleSidebar(): void;
}

export const noopDesktopShellActions: DesktopShellActions = {
  closeConversation() {},
  loadMoreConversations() {},
  openConversation() {},
  previewConversation() {},
  refreshShell() {},
  runControlAction() {},
  selectSubview() {},
  setAdapterFilter() {},
  setConversationSearch() {},
  setRelationshipFilter() {},
  setRepositoryFilter() {},
  setSinceFilter() {},
  showConversationIndex() {},
  switchView() {},
  toggleHomePanel() {},
  toggleInspector() {},
  toggleSidebar() {},
};
