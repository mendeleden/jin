export interface DesktopLayoutEditorState<TLayout> {
  draftLayout: readonly TLayout[];
  editing: boolean;
}

export type DesktopLayoutEditorAction<TLayout> =
  | {
      currentLayout: readonly TLayout[];
      type: "cancel" | "edit" | "sync";
    }
  | {
      layout: readonly TLayout[];
      type: "draft";
    }
  | {
      type: "reset" | "saved";
    };

export interface DesktopLayoutEditorReducerOptions<TLayout> {
  defaultLayout: readonly TLayout[];
  normalizeLayout(layout: readonly TLayout[]): TLayout[];
}

export function createDesktopLayoutEditorState<TLayout>(
  currentLayout: readonly TLayout[],
  normalizeLayout: DesktopLayoutEditorReducerOptions<TLayout>["normalizeLayout"],
): DesktopLayoutEditorState<TLayout> {
  return {
    draftLayout: normalizeLayout(currentLayout),
    editing: false,
  };
}

export function reduceDesktopLayoutEditorState<TLayout>(
  state: DesktopLayoutEditorState<TLayout>,
  action: DesktopLayoutEditorAction<TLayout>,
  options: DesktopLayoutEditorReducerOptions<TLayout>,
): DesktopLayoutEditorState<TLayout> {
  if (action.type === "sync") {
    return state.editing
      ? state
      : createDesktopLayoutEditorState(
          action.currentLayout,
          options.normalizeLayout,
        );
  }

  if (action.type === "edit") {
    return {
      draftLayout: options.normalizeLayout(action.currentLayout),
      editing: true,
    };
  }

  if (action.type === "cancel") {
    return createDesktopLayoutEditorState(
      action.currentLayout,
      options.normalizeLayout,
    );
  }

  if (action.type === "draft") {
    return state.editing
      ? { ...state, draftLayout: options.normalizeLayout(action.layout) }
      : state;
  }

  if (action.type === "reset") {
    return {
      ...state,
      draftLayout: options.normalizeLayout(options.defaultLayout),
    };
  }

  if (action.type === "saved") {
    return {
      draftLayout: options.normalizeLayout(state.draftLayout),
      editing: false,
    };
  }

  return state;
}
