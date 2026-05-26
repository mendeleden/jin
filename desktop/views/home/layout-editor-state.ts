import {
  DEFAULT_HOME_PANEL_LAYOUT,
  normalizeHomePanelLayout,
  type HomePanelLayout,
} from "./layout";
import {
  createDesktopLayoutEditorState,
  reduceDesktopLayoutEditorState,
  type DesktopLayoutEditorState,
} from "../../layout/layout-editor-state";

export type HomeLayoutEditorState =
  DesktopLayoutEditorState<HomePanelLayout>;

export type HomeLayoutEditorAction =
  | {
      homeLayout: readonly HomePanelLayout[];
      type: "cancel" | "edit" | "sync";
    }
  | {
      layout: readonly HomePanelLayout[];
      type: "draft";
    }
  | {
      type: "reset" | "saved";
    };

export function createHomeLayoutEditorState(
  homeLayout: readonly HomePanelLayout[],
): HomeLayoutEditorState {
  return createDesktopLayoutEditorState(homeLayout, normalizeHomePanelLayout);
}

export function homeLayoutEditorReducer(
  state: HomeLayoutEditorState,
  action: HomeLayoutEditorAction,
): HomeLayoutEditorState {
  return reduceDesktopLayoutEditorState(
    state,
    "homeLayout" in action
      ? { currentLayout: action.homeLayout, type: action.type }
      : action,
    {
      defaultLayout: DEFAULT_HOME_PANEL_LAYOUT,
      normalizeLayout: normalizeHomePanelLayout,
    },
  );
}
