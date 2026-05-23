import {
  formatNumber,
  type RendererState,
} from "../../renderer";
import { RuntimeStateGate } from "../../components/shell/status-panels";
import type { DesktopShellActions } from "../../components/shell/actions";
import { Button } from "../../ui/button";
import { cx } from "../../ui/classnames";
import {
  Eyebrow,
  Panel,
  PanelHeader,
  PanelTitle,
} from "../../ui/panel";
import {
  EmptyState,
  FieldGrid,
  ListPlaceholder,
  RuntimeField,
} from "../../ui/primitives";

export function LogsWorkspace({
  actions,
  state,
}: {
  actions: DesktopShellActions;
  state: RendererState;
}) {
  return (
    <RuntimeStateGate
      actions={actions}
      state={state}
      stopped={{
        description:
          "Start the daemon to stream the current runtime log tail through the Desktop API.",
        label: "Logs",
        title: "Daemon logs are paused while Jin is stopped.",
      }}
      transition={{
        label: "Logs",
        startingDescription: "The log tail will load once the daemon is queryable.",
        stoppingDescription: "The log tail is paused until shutdown completes.",
      }}
    >
      {(snapshot) => {
        const logs = state.logs;
        const logPath = logs?.path ?? snapshot.status.paths.log;

        return (
          <section className="grid min-h-0 grid-cols-12 gap-3.5 overflow-hidden pb-0.5">
            <Panel className="flex min-h-0 flex-col" span="wide">
              <PanelHeader
                actions={
                  <Button
                    onClick={() => void actions.refreshShell()}
                    variant="subtle"
                  >
                    {state.logsLoading ? "Refreshing..." : "Refresh"}
                  </Button>
                }
              >
                <Eyebrow>Runtime log</Eyebrow>
                <PanelTitle>Daemon log tail</PanelTitle>
              </PanelHeader>
              <FieldGrid className="mb-3">
                <RuntimeField label="Path" value={logPath} />
                <RuntimeField
                  label="Lines"
                  value={
                    logs
                      ? `${formatNumber(logs.returnedLines)} shown / ${formatNumber(
                          logs.totalLines,
                        )} total`
                      : `Waiting for ${formatNumber(
                          state.logsRequest.limit ?? 240,
                        )} lines`
                  }
                />
              </FieldGrid>
              <LogsBody actions={actions} state={state} />
            </Panel>
          </section>
        );
      }}
    </RuntimeStateGate>
  );
}

function LogsBody({
  actions,
  state,
}: {
  actions: DesktopShellActions;
  state: RendererState;
}) {
  const logs = state.logs;

  if (state.logsLoading && !logs) {
    return <ListPlaceholder className="mt-1" />;
  }

  if (state.logsError && !logs) {
    return (
      <EmptyState className="mt-1" title="Daemon logs unavailable">
        <p>{state.logsError}</p>
        <Button onClick={() => void actions.refreshShell()}>Retry</Button>
      </EmptyState>
    );
  }

  if (!logs || logs.lines.length === 0) {
    return (
      <EmptyState className="mt-1" title="No log lines available.">
        <p>
          The daemon log file exists, but the current tail did not return any
          lines.
        </p>
      </EmptyState>
    );
  }

  return (
    <div
      aria-label="Daemon log tail"
      className="flex min-h-0 flex-col gap-px overflow-auto rounded-[13px] border border-[var(--line)] bg-[linear-gradient(180deg,rgba(5,8,13,0.92),rgba(7,10,16,0.96)),rgba(255,255,255,0.02)] py-2"
      role="log"
    >
      {logs.truncated ? (
        <div className="mb-[5px] border-b border-[var(--line)] px-3.5 pb-[9px] pt-0.5 text-[0.78rem] text-[var(--text-dim)]">
          Showing the latest {formatNumber(logs.returnedLines)} lines.
        </div>
      ) : null}
      {logs.lines.map((line, index) => (
        <LogLine index={index} key={`${line}-${index}`} line={line} />
      ))}
    </div>
  );
}

function LogLine({ index, line }: { index: number; line: string }) {
  const severity = /\b(error|failed|failure|exception)\b/i.test(line)
    ? "error"
    : /\b(warn|warning|degraded)\b/i.test(line)
      ? "warning"
      : "info";

  return (
    <pre
      className={cx(
        "m-0 grid grid-cols-[54px_minmax(0,1fr)] gap-3 px-3.5 py-1 text-[0.78rem] leading-[1.45] whitespace-pre-wrap text-[var(--text-soft)] [font-family:var(--mono)] hover:bg-white/[0.035]",
        severity === "warning" && "text-[#f4d79a]",
        severity === "error" && "text-[var(--danger)]",
      )}
      data-log-severity={severity}
    >
      <span className="select-none text-right text-[var(--text-dim)]">
        {formatNumber(index + 1)}
      </span>
      <span className="min-w-0 [overflow-wrap:anywhere]">
        {line.length > 0 ? line : " "}
      </span>
    </pre>
  );
}
