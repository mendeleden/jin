import type { ReactNode } from "react";
import { Play, RefreshCw } from "lucide-react";
import {
  capitalize,
  getIncompatibleCompatibility,
  isTransitionalRuntimeState,
  type RendererState,
} from "../../renderer";
import { Button } from "../../ui/button";
import { Eyebrow, Panel, PanelTitle } from "../../ui/panel";
import { FieldGrid, RuntimeField } from "../../ui/primitives";
import type { DesktopShellActions } from "./actions";

type DesktopSnapshot = NonNullable<RendererState["snapshot"]>;
type RuntimeState = DesktopSnapshot["status"]["runtime"]["state"];

interface LifecycleCopy {
  description: string;
  label: string;
  showRefresh?: boolean;
  title: string;
}

interface TransitionLifecycleCopy {
  label?: string | ((runtimeState: RuntimeState) => string);
  showRefresh?: boolean;
  startingDescription: string;
  startingTitle?: string;
  stoppingDescription: string;
  stoppingTitle?: string;
}

export function RuntimeStateGate({
  actions,
  children,
  state,
  stopped,
  transition,
}: {
  actions: DesktopShellActions;
  children(snapshot: DesktopSnapshot): ReactNode;
  state: RendererState;
  stopped: LifecycleCopy;
  transition: TransitionLifecycleCopy;
}) {
  const snapshot = state.snapshot;
  if (!snapshot) {
    return null;
  }

  const runtimeState = snapshot.status.runtime.state;
  if (runtimeState === "stopped") {
    return (
      <LifecycleState
        actions={actions}
        description={stopped.description}
        label={stopped.label}
        showRefresh={stopped.showRefresh}
        state={state}
        title={stopped.title}
      />
    );
  }

  if (isTransitionalRuntimeState(runtimeState)) {
    const starting = runtimeState === "starting";
    return (
      <LifecycleState
        actions={actions}
        description={
          starting
            ? transition.startingDescription
            : transition.stoppingDescription
        }
        label={transitionLabel(transition.label, runtimeState)}
        showRefresh={transition.showRefresh}
        state={state}
        title={
          starting
            ? (transition.startingTitle ?? "Jin is starting up.")
            : (transition.stoppingTitle ?? "Jin is shutting down.")
        }
      />
    );
  }

  return <>{children(snapshot)}</>;
}

export function CompatibilityView({ state }: { state: RendererState }) {
  const compatibility = getIncompatibleCompatibility(state);
  if (!compatibility) {
    return null;
  }

  const title =
    compatibility.reason === "desktop_too_old"
      ? "Desktop update required."
      : "Jin CLI update required.";
  const command =
    compatibility.reason === "desktop_too_old"
      ? compatibility.updateCommand
      : compatibility.cliUpdateCommand;

  return (
    <Panel className="p-[18px]" data-state-panel="compatibility" span="wide">
      <Eyebrow>Compatibility</Eyebrow>
      <PanelTitle>{title}</PanelTitle>
      <p className="m-0 mt-2.5 leading-[1.55] text-[var(--text-soft)]">
        {compatibility.message}
      </p>
      <FieldGrid>
        <RuntimeField label="Jin version" value={compatibility.jinVersion} />
        <RuntimeField
          label="Desktop API"
          value={String(compatibility.clientDesktopApiVersion)}
        />
        <RuntimeField
          label="Daemon API"
          value={String(compatibility.desktopApiVersion)}
        />
        <RuntimeField
          label="Minimum Desktop API"
          value={String(compatibility.minimumDesktopApiVersion)}
        />
      </FieldGrid>
      <div className="mt-4 flex flex-wrap gap-2.5">
        <code className="rounded-lg border border-[var(--line)] bg-white/[0.03] px-2.5 py-2 text-[var(--text-soft)] [font-family:var(--mono)]">
          {command}
        </code>
      </div>
    </Panel>
  );
}

export function LifecycleState({
  actions,
  description,
  label,
  showRefresh = true,
  state,
  title,
}: {
  actions: DesktopShellActions;
  description: string;
  label: string;
  showRefresh?: boolean;
  state: RendererState;
  title: string;
}) {
  const snapshot = state.snapshot;
  const showStart = snapshot?.status.runtime.state === "stopped";

  return (
    <Panel className="p-[18px]" data-state-panel="lifecycle" span="wide">
      <Eyebrow>{label}</Eyebrow>
      <PanelTitle>{title}</PanelTitle>
      <p className="m-0 mt-2.5 leading-[1.55] text-[var(--text-soft)]">
        {description}
      </p>
      {snapshot ? (
        <FieldGrid>
          <RuntimeField label="Socket" value={snapshot.status.paths.socket} />
          <RuntimeField label="Store" value={snapshot.status.paths.store} />
          <RuntimeField
            label="Runtime owner"
            value={snapshot.status.runtime.owner?.mode ?? "none"}
          />
        </FieldGrid>
      ) : null}
      {showStart || showRefresh ? (
        <div className="mt-4 flex flex-wrap gap-2.5">
          {showStart ? (
            <Button
              disabled={state.busyAction === "start"}
              onClick={() => void actions.runControlAction("start")}
              variant="primary"
            >
              <Play aria-hidden="true" />
              {state.busyAction === "start" ? "Starting..." : "Start Jin"}
            </Button>
          ) : null}
          {showRefresh ? (
            <Button onClick={() => void actions.refreshShell()}>
              <RefreshCw aria-hidden="true" />
              Refresh
            </Button>
          ) : null}
        </div>
      ) : null}
    </Panel>
  );
}

function transitionLabel(
  label: TransitionLifecycleCopy["label"],
  runtimeState: RuntimeState,
): string {
  if (typeof label === "function") {
    return label(runtimeState);
  }

  return label ?? capitalize(runtimeState);
}
