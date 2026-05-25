import { Moon, SunMedium } from "lucide-react";
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
    <section className="grid min-h-0 grid-cols-12 gap-3.5 overflow-auto pb-0.5">
      <Panel span="span">
        <PanelHeader>
          <Eyebrow>Appearance</Eyebrow>
          <PanelTitle>Theme</PanelTitle>
        </PanelHeader>
        <div className="grid gap-3">
          <FieldGrid className="grid-cols-1">
            <RuntimeField
              label="Mode"
              value={themeMode === "light" ? "Light" : "Dark"}
            />
          </FieldGrid>
          <ThemeModeToggle onChange={setThemeMode} value={themeMode} />
        </div>
      </Panel>

      <Panel span="span">
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
            buttonClassName="min-w-[60px] px-3"
            onChange={setRefreshIntervalMs}
            options={DESKTOP_REFRESH_INTERVAL_OPTIONS}
            value={refreshIntervalMs}
          />
        </div>
      </Panel>

      <Panel span="span">
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

      <Panel span="span">
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
    </section>
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
