export const RUNTIME_MODES = ["foreground", "daemon", "service"] as const;

export type RuntimeMode = (typeof RUNTIME_MODES)[number];

export const RUNTIME_STATES = [
  "stopped",
  "starting",
  "running",
  "degraded",
  "stopping",
] as const;

export type RuntimeState = (typeof RUNTIME_STATES)[number];

export const SHUTDOWN_DRAIN_TIMEOUT_MS = 15_000;

export interface RuntimeOwnershipRecord {
  pid: number;
  mode: RuntimeMode;
  startedAt: string;
  configDir: string;
  storePath: string;
  logPath?: string;
}

export interface RuntimeIssue {
  subsystem: "ingest" | "push";
  message: string;
  paused?: boolean;
}

export interface RuntimeStatus {
  state: RuntimeState;
  owner?: RuntimeOwnershipRecord;
  issues: RuntimeIssue[];
}
