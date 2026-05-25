import {
  createDesktopLayoutEditorState,
  reduceDesktopLayoutEditorState,
  type DesktopLayoutEditorState,
} from "../../layout/layout-editor-state";
import {
  DEFAULT_SETTINGS_PANEL_LAYOUT,
  normalizeSettingsPanelLayout,
  type SettingsPanelLayout,
} from "./layout";

export type SettingsLayoutEditorState =
  DesktopLayoutEditorState<SettingsPanelLayout>;

export type SettingsLayoutEditorAction =
  | {
      settingsLayout: readonly SettingsPanelLayout[];
      type: "cancel" | "edit" | "sync";
    }
  | {
      layout: readonly SettingsPanelLayout[];
      type: "draft";
    }
  | {
      type: "reset" | "saved";
    };

export function createSettingsLayoutEditorState(
  settingsLayout: readonly SettingsPanelLayout[],
): SettingsLayoutEditorState {
  return createDesktopLayoutEditorState(
    settingsLayout,
    normalizeSettingsPanelLayout,
  );
}

export function settingsLayoutEditorReducer(
  state: SettingsLayoutEditorState,
  action: SettingsLayoutEditorAction,
): SettingsLayoutEditorState {
  return reduceDesktopLayoutEditorState(
    state,
    "settingsLayout" in action
      ? { currentLayout: action.settingsLayout, type: action.type }
      : action,
    {
      defaultLayout: DEFAULT_SETTINGS_PANEL_LAYOUT,
      normalizeLayout: normalizeSettingsPanelLayout,
    },
  );
}
