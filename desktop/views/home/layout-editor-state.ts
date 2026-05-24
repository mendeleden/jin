import {
  DEFAULT_HOME_PANEL_LAYOUT,
  normalizeHomePanelLayout,
  type HomePanelLayout,
} from "./layout";

export interface HomeLayoutEditorState {
  draftLayout: readonly HomePanelLayout[];
  editing: boolean;
}

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
  return {
    draftLayout: normalizeHomePanelLayout(homeLayout),
    editing: false,
  };
}

export function homeLayoutEditorReducer(
  state: HomeLayoutEditorState,
  action: HomeLayoutEditorAction,
): HomeLayoutEditorState {
  if (action.type === "sync") {
    return state.editing
      ? state
      : createHomeLayoutEditorState(action.homeLayout);
  }

  if (action.type === "edit") {
    return {
      draftLayout: normalizeHomePanelLayout(action.homeLayout),
      editing: true,
    };
  }

  if (action.type === "cancel") {
    return createHomeLayoutEditorState(action.homeLayout);
  }

  if (action.type === "draft") {
    return state.editing
      ? { ...state, draftLayout: normalizeHomePanelLayout(action.layout) }
      : state;
  }

  if (action.type === "reset") {
    return {
      ...state,
      draftLayout: normalizeHomePanelLayout(DEFAULT_HOME_PANEL_LAYOUT),
    };
  }

  if (action.type === "saved") {
    return {
      draftLayout: normalizeHomePanelLayout(state.draftLayout),
      editing: false,
    };
  }

  return state;
}
