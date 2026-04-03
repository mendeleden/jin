import type { Adapter, ChangeHint } from "../contracts/adapters";
import type { RouteConfig } from "../contracts/config";
import type { Sink } from "../contracts/sinks";
import type { ConversationStore } from "../contracts/store";

export type PipelineWorkItem =
  | { kind: "reconcile-adapters" }
  | { kind: "ingest-all"; hint: ChangeHint }
  | { kind: "ingest-adapter"; adapterId: string; hint: ChangeHint }
  | { kind: "push" }
  | { kind: "shutdown-flush" };

export type QueueablePipelineWorkItem = Exclude<
  PipelineWorkItem,
  { kind: "shutdown-flush" }
>;

export interface IngestResult {
  scannedRefCount: number;
  loadedConversationCount: number;
  changedConversationIds: string[];
  anyChanged: boolean;
}

export interface PushSummary {
  sinkAttempts: number;
  pushedConversations: number;
  failedConversations: number;
}

export interface PipelineLogger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string, error?: unknown): void;
}

export interface PipelineWatchEvent {
  adapterId: string;
  path: string;
}

export interface PipelineWatcher {
  addPath(path: string, adapterId: string): void;
  close(): void;
}

export type PipelineWatcherFactory = (options: {
  debounceMs: number;
  onChange: (event: PipelineWatchEvent) => void;
}) => PipelineWatcher;

export type PipelineAdapterSource =
  | ReadonlyArray<Adapter>
  | (() => Promise<ReadonlyArray<Adapter>>);

export interface RunPipelineOptions {
  adapterSource: PipelineAdapterSource;
  store: ConversationStore;
  sinks: ReadonlyArray<Sink>;
  routes: ReadonlyArray<RouteConfig>;
  logger?: PipelineLogger;
  ingestBatchSize?: number;
  pushBatchSize?: number;
  watchDebounceMs?: number;
  scanIntervalMs?: number | null;
  scheduleStartupWork?: boolean;
  watcherFactory?: PipelineWatcherFactory;
  shutdownDrainTimeoutMs?: number;
  onShutdownTimeout?: (
    result: PipelineShutdownResult,
  ) => void | Promise<void>;
}

export interface PipelineShutdownResult {
  timedOut: boolean;
  abandonedWorkItems: number;
}

export interface PipelineHandle {
  enqueue(work: QueueablePipelineWorkItem): boolean;
  waitForIdle(): Promise<void>;
  shutdown(): Promise<PipelineShutdownResult>;
}
