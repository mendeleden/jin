import {
  DESKTOP_REFRESH_INTERVAL_OPTIONS,
  formatDesktopRefreshInterval,
  useDesktopPreferences,
} from "../../preferences";
import type { RendererState } from "../../renderer";
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
  const { refreshIntervalMs, setRefreshIntervalMs } = useDesktopPreferences();
  const snapshot = state.snapshot;
  if (!snapshot) {
    return null;
  }

  const { status } = snapshot;

  return (
    <section className="grid min-h-0 grid-cols-12 gap-3.5 overflow-auto pb-0.5">
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
