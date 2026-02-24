import type { Session, Message } from "../adapters/types";

export interface Sink {
  id: string;
  name: string;

  /** Verify the connection / credentials are valid. */
  healthCheck(): Promise<{ ok: boolean; error?: string }>;

  /** Push sessions and their messages to the sink. */
  push(data: PushPayload[]): Promise<PushResult>;

  /** Close connections / cleanup. */
  close(): Promise<void>;
}

export interface PushPayload {
  session: Session;
  messages: Message[];
}

export interface PushResult {
  pushed: number;
  failed: number;
  errors: string[];
}

export interface SinkConfig {
  type: "webhook" | "postgres" | "s3";
  id?: string; // unique identifier for routing; auto-generated as type-index if omitted

  // Webhook
  url?: string;
  headers?: Record<string, string>;

  // Postgres
  connectionString?: string;
  table?: string; // defaults to "jin_sessions" / "jin_messages"
  schema?: string; // defaults to "public"

  // S3-compatible (AWS S3, Cloudflare R2, MinIO, GCS)
  bucket?: string;
  region?: string;
  endpoint?: string; // for R2/MinIO
  accessKeyId?: string;
  secretAccessKey?: string;
  prefix?: string; // key prefix, e.g. "jin/"

  // Shared
  batchSize?: number;
  teamId?: string; // identifies the team in multi-tenant setups
  developerId?: string; // identifies the individual developer
}

/** Decode a base64-encoded team config string into SinkConfig */
export function decodeTeamConfig(encoded: string): SinkConfig {
  const json = Buffer.from(encoded, "base64").toString("utf-8");
  return JSON.parse(json) as SinkConfig;
}

/** Encode a SinkConfig into a shareable base64 string */
export function encodeTeamConfig(config: SinkConfig): string {
  return Buffer.from(JSON.stringify(config)).toString("base64");
}
