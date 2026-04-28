export const SINK_TYPES = ["postgres", "s3", "webhook"] as const;

export type SinkType = (typeof SINK_TYPES)[number];

export const DEFAULT_SCAN_INTERVAL_MS = 60_000;
export const DEFAULT_S3_REGION = "us-east-1";
export const DEFAULT_S3_PREFIX = "jin/";
export const DEFAULT_WEBHOOK_TIMEOUT_MS = 30_000;

export interface RouteMatch {
  remote?: string;
  adapter?: string;
  branch?: string;
  name?: string;
}

export interface RouteConfig {
  match: RouteMatch;
  sinks: string[];
}

export interface AdapterConfig {
  enabled: boolean;
  dataDir?: string;
  allowProtectedSource?: boolean;
}

export interface WatchConfig {
  pollIntervalMs: number;
}

export interface SinkConfigBase {
  id: string;
  type: SinkType;
  enabled: boolean;
  teamId?: string;
  userId?: string;
}

export interface PostgresSinkConfig extends SinkConfigBase {
  type: "postgres";
  connectionString: string;
}

export interface S3SinkConfig extends SinkConfigBase {
  type: "s3";
  bucket: string;
  region?: string;
  endpoint?: string;
  accessKeyId: string;
  secretAccessKey: string;
  prefix?: string;
  pathStyle?: boolean;
}

export interface WebhookSinkConfig extends SinkConfigBase {
  type: "webhook";
  url: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
}

export type SinkConfig =
  | PostgresSinkConfig
  | S3SinkConfig
  | WebhookSinkConfig;

export interface JinConfig {
  adapters: Record<string, AdapterConfig>;
  sinks: SinkConfig[];
  routes: RouteConfig[];
  watch: WatchConfig;
}
