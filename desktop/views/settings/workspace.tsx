import { Moon, SunMedium } from "lucide-react";
import { useEffect, useReducer, type ReactNode } from "react";
import { LayoutEditorToolbar } from "../../layout/layout-editor-toolbar";
import { useDesktopLayoutPreferences } from "../../layout/preferences";
import {
  DESKTOP_REFRESH_INTERVAL_OPTIONS,
  DESKTOP_THEME_MODE_OPTIONS,
  type DesktopThemeMode,
  formatDesktopRefreshInterval,
  useDesktopPreferences,
} from "../../preferences";
import type { RendererState } from "../../renderer";
import { cx } from "../../ui/classnames";
import { StatusBadge } from "../../ui/badge";
import {
  Eyebrow,
  Panel,
  PanelHeader,
  PanelTitle,
} from "../../ui/panel";
import {
  FieldGrid,
  RuntimeField,
  SegmentedControl,
} from "../../ui/primitives";
import { SettingsDashboardGrid } from "./dashboard-grid";
import type { SettingsPanelLayout } from "./layout";
import {
  createSettingsLayoutEditorState,
  settingsLayoutEditorReducer,
} from "./layout-editor-state";

export function SettingsWorkspace({ state }: { state: RendererState }) {
  const {
    refreshIntervalMs,
    setRefreshIntervalMs,
    setThemeMode,
    themeMode,
  } = useDesktopPreferences();
  const snapshot = state.snapshot;
  if (!snapshot) {
    return null;
  }

  const { status } = snapshot;

  return (
    <SettingsLayoutEditor>
      {({
        editing,
        layout,
        onCancel,
        onEdit,
        onLayoutChange,
        onReset,
        onSave,
      }) => (
        <div
          className="flex min-h-0 flex-1 flex-col gap-3"
          data-settings-layout-workspace
        >
          <LayoutEditorToolbar
            editing={editing}
            onCancel={onCancel}
            onEdit={onEdit}
            onReset={onReset}
            onSave={onSave}
            surface="settings"
          />
          <SettingsDashboardGrid
            editable={editing}
            items={[
              {
                panelId: "theme",
                children: (
                  <ThemeSettingsPanel
                    onChange={setThemeMode}
                    value={themeMode}
                  />
                ),
              },
              {
                panelId: "refresh",
                children: (
                  <RefreshSettingsPanel
                    onChange={setRefreshIntervalMs}
                    refreshIntervalMs={refreshIntervalMs}
                  />
                ),
              },
              {
                panelId: "runtime",
                children: <RuntimeSettingsPanel status={status} />,
              },
              {
                panelId: "paths",
                children: <PathsSettingsPanel status={status} />,
              },
            ]}
            layout={layout}
            onLayoutChange={onLayoutChange}
          />
        </div>
      )}
    </SettingsLayoutEditor>
  );
}

function SettingsLayoutEditor({
  children,
}: {
  children(props: {
    editing: boolean;
    layout: readonly SettingsPanelLayout[];
    onCancel(): void;
    onEdit(): void;
    onLayoutChange(layout: readonly SettingsPanelLayout[]): void;
    onReset(): void;
    onSave(): void;
  }): ReactNode;
}) {
  const { setSettingsLayout, settingsLayout } = useDesktopLayoutPreferences();
  const [editorState, dispatchEditor] = useReducer(
    settingsLayoutEditorReducer,
    settingsLayout,
    createSettingsLayoutEditorState,
  );

  useEffect(() => {
    dispatchEditor({ settingsLayout, type: "sync" });
  }, [settingsLayout]);

  return children({
    editing: editorState.editing,
    layout: editorState.editing ? editorState.draftLayout : settingsLayout,
    onCancel() {
      dispatchEditor({ settingsLayout, type: "cancel" });
    },
    onEdit() {
      dispatchEditor({ settingsLayout, type: "edit" });
    },
    onLayoutChange(nextLayout) {
      dispatchEditor({ layout: nextLayout, type: "draft" });
    },
    onReset() {
      dispatchEditor({ type: "reset" });
    },
    onSave() {
      setSettingsLayout(editorState.draftLayout);
      dispatchEditor({ type: "saved" });
    },
  });
}

function ThemeSettingsPanel({
  onChange,
  value,
}: {
  onChange(value: DesktopThemeMode): void;
  value: DesktopThemeMode;
}) {
  return (
    <Panel className="flex h-full min-h-0 flex-col overflow-auto" span="none">
      <PanelHeader>
        <Eyebrow>Appearance</Eyebrow>
        <PanelTitle>Theme</PanelTitle>
      </PanelHeader>
      <div className="grid gap-3">
        <FieldGrid className="grid-cols-1">
          <RuntimeField
            label="Mode"
            value={value === "light" ? "Light" : "Dark"}
          />
        </FieldGrid>
        <ThemeModeToggle onChange={onChange} value={value} />
      </div>
    </Panel>
  );
}

function RefreshSettingsPanel({
  onChange,
  refreshIntervalMs,
}: {
  onChange(value: (typeof DESKTOP_REFRESH_INTERVAL_OPTIONS)[number]["value"]): void;
  refreshIntervalMs: (typeof DESKTOP_REFRESH_INTERVAL_OPTIONS)[number]["value"];
}) {
  return (
    <Panel className="flex h-full min-h-0 flex-col overflow-auto" span="none">
      <PanelHeader>
        <Eyebrow>Desktop</Eyebrow>
        <PanelTitle>Shell refresh</PanelTitle>
      </PanelHeader>
      <div className="grid gap-3">
        <FieldGrid className="grid-cols-1">
          <RuntimeField
            label="Auto-refresh"
            value={`Every ${formatDesktopRefreshInterval(refreshIntervalMs)}`}
          />
        </FieldGrid>
        <SegmentedControl
          ariaLabel="Desktop auto-refresh interval"
          buttonClassName="min-w-[60px] flex-1 px-3"
          className="w-full"
          onChange={onChange}
          options={DESKTOP_REFRESH_INTERVAL_OPTIONS}
          value={refreshIntervalMs}
        />
      </div>
    </Panel>
  );
}

function RuntimeSettingsPanel({
  status,
}: {
  status: NonNullable<RendererState["snapshot"]>["status"];
}) {
  return (
    <Panel className="flex h-full min-h-0 flex-col overflow-auto" span="none">
      <PanelHeader actions={<StatusBadge value={status.runtime.state} />}>
        <Eyebrow>Runtime</Eyebrow>
        <PanelTitle>Daemon status</PanelTitle>
      </PanelHeader>
      <FieldGrid>
        <RuntimeField
          label="Runtime owner"
          value={status.runtime.owner?.mode ?? "none"}
        />
        <RuntimeField label="Health" value={status.health.status} />
        <RuntimeField label="Ingest" value={status.health.ingest} />
        <RuntimeField label="Push" value={status.health.push} />
      </FieldGrid>
    </Panel>
  );
}

function PathsSettingsPanel({
  status,
}: {
  status: NonNullable<RendererState["snapshot"]>["status"];
}) {
  return (
    <Panel className="flex h-full min-h-0 flex-col overflow-auto" span="none">
      <PanelHeader>
        <Eyebrow>Paths</Eyebrow>
        <PanelTitle>Local files</PanelTitle>
      </PanelHeader>
      <FieldGrid>
        <RuntimeField label="Config" value={status.paths.config} />
        <RuntimeField label="Store" value={status.paths.store} />
        <RuntimeField label="Socket" value={status.paths.socket} />
        <RuntimeField label="Log" value={status.paths.log} />
      </FieldGrid>
    </Panel>
  );
}

function ThemeModeToggle({
  onChange,
  value,
}: {
  onChange(value: DesktopThemeMode): void;
  value: DesktopThemeMode;
}) {
  return (
    <div
      aria-label="Desktop theme mode"
      className="grid min-h-[50px] grid-cols-2 gap-1 rounded-[16px] border border-[var(--control-border)] bg-[var(--control-bg)] p-1 shadow-[inset_0_1px_0_var(--control-highlight)]"
      data-theme-mode-toggle
      role="group"
    >
      {DESKTOP_THEME_MODE_OPTIONS.map((option) => {
        const selected = option.value === value;
        const Icon = option.value === "light" ? SunMedium : Moon;
        return (
          <button
            aria-pressed={selected}
            className={cx(
              "group relative inline-flex min-w-0 cursor-pointer items-center justify-center gap-2 overflow-hidden rounded-[12px] border border-transparent px-3 py-2 text-[0.86rem] font-bold text-[var(--control-text)] transition-[background,border-color,box-shadow,color,transform]",
              "hover:border-[var(--control-border-hover)] hover:bg-[var(--control-bg-hover)] hover:text-[var(--text)]",
              selected &&
                "border-[var(--picker-selected-border)] bg-[var(--picker-selected-bg)] text-[var(--picker-selected-text)] shadow-[var(--picker-selected-shadow)] hover:text-[var(--picker-selected-text)]",
            )}
            data-selected={selected ? "true" : undefined}
            key={option.value}
            onClick={() => onChange(option.value)}
            type="button"
          >
            <span
              className={cx(
                "inline-flex h-7 w-7 flex-none items-center justify-center rounded-full border border-[var(--control-border-subtle)] bg-[var(--control-bg-subtle)] text-current transition-colors [&_svg]:h-[15px] [&_svg]:w-[15px]",
                selected &&
                  "border-[var(--picker-selected-border)] bg-[var(--picker-selected-icon-bg)]",
              )}
            >
              <Icon aria-hidden="true" />
            </span>
            <span className="truncate">{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}
