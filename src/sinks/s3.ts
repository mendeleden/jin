import { createHash, createHmac } from "crypto";
import type {
  Sink as LegacySink,
  SinkConfig as LegacySinkConfig,
  PushPayload as LegacyPushPayload,
  PushResult as LegacyPushResult,
  V2Sink as SnapshotSink,
  V2SinkConfig as SnapshotSinkConfig,
  V2PushPayload as SnapshotPushPayload,
  V2PushResult as SnapshotPushResult,
} from "./types";

const DEFAULT_PREFIX = "jin";
const LEGACY_PAYLOAD_ERROR =
  "S3 sink requires BP-06 snapshot payloads (conversation + messages + toolCalls).";

type S3Config = LegacySinkConfig | SnapshotSinkConfig;
type Payload = LegacyPushPayload | SnapshotPushPayload;
type S3ConfigFields = {
  id?: string;
  name?: string;
  bucket?: string;
  region?: string;
  endpoint?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  prefix?: string;
};

/**
 * S3-compatible object sink (AWS S3, Cloudflare R2, MinIO).
 *
 * BP-06 object sinks upload one JSON file per conversation snapshot at:
 *   {prefix}/{adapter_id}/{conversation_id}.json
 */
export class S3Sink implements LegacySink, SnapshotSink {
  id: string;
  name: string;

  private bucket: string;
  private region: string;
  private endpoint: string;
  private accessKeyId: string;
  private secretAccessKey: string;
  private prefix: string;

  constructor(config: S3Config) {
    const values = config as S3ConfigFields;

    if (!values.bucket) throw new Error("S3 sink requires 'bucket'");
    if (!values.accessKeyId) throw new Error("S3 sink requires 'accessKeyId'");
    if (!values.secretAccessKey) throw new Error("S3 sink requires 'secretAccessKey'");

    this.id = values.id ?? "s3";
    this.name = values.name ?? "S3-Compatible Storage";
    this.bucket = values.bucket;
    this.region = values.region ?? "us-east-1";
    this.endpoint = normalizeEndpoint(
      values.endpoint ?? `https://s3.${this.region}.amazonaws.com`,
    );
    this.accessKeyId = values.accessKeyId;
    this.secretAccessKey = values.secretAccessKey;
    this.prefix = normalizePrefix(values.prefix);
  }

  async healthCheck(): Promise<{ ok: boolean; error?: string }> {
    try {
      const path = this.getBucketPath();
      const response = await fetch(this.buildUrl(path), {
        method: "HEAD",
        headers: this.sign("HEAD", path, {}),
      });

      if (response.ok) {
        return { ok: true };
      }

      return { ok: false, error: formatStatus(response) };
    } catch (error) {
      return { ok: false, error: formatThrownError(error) };
    }
  }

  async push(data: LegacyPushPayload[]): Promise<LegacyPushResult>;
  async push(data: SnapshotPushPayload[]): Promise<SnapshotPushResult>;
  async push(
    data: Payload[],
  ): Promise<LegacyPushResult | SnapshotPushResult> {
    if (data.length === 0) {
      return { pushed: 0, failed: 0, errors: [] };
    }

    if (data.some(isLegacyPayload)) {
      return {
        pushed: 0,
        failed: data.length,
        errors: data.map((payload) =>
          formatLegacyPayloadError(payload as LegacyPushPayload),
        ),
      };
    }

    return this.pushSnapshots(data as SnapshotPushPayload[]);
  }

  async close(): Promise<void> {}

  private async pushSnapshots(
    payloads: SnapshotPushPayload[],
  ): Promise<SnapshotPushResult> {
    let pushed = 0;
    let failed = 0;
    const errors: SnapshotPushResult["errors"] = [];

    for (const payload of payloads) {
      try {
        const key = this.getObjectKey(payload);
        const path = this.getObjectPath(key);
        const body = JSON.stringify({
          conversation: payload.conversation,
          messages: payload.messages,
          toolCalls: payload.toolCalls,
        });

        const response = await fetch(this.buildUrl(path), {
          method: "PUT",
          headers: this.sign(
            "PUT",
            path,
            {
              "Content-Type": "application/json",
              "Content-Length": String(Buffer.byteLength(body)),
            },
            body,
          ),
          body,
        });

        if (response.ok) {
          pushed += 1;
          continue;
        }

        failed += 1;
        errors.push({
          conversationId: payload.conversation.id,
          error: await formatResponseError(response),
        });
      } catch (error) {
        failed += 1;
        errors.push({
          conversationId: payload.conversation.id,
          error: formatThrownError(error),
        });
      }
    }

    return { pushed, failed, errors };
  }

  private getBucketPath(): string {
    return `/${this.bucket}/`;
  }

  private getObjectKey(payload: SnapshotPushPayload): string {
    return [this.prefix, payload.conversation.adapterId, `${payload.conversation.id}.json`]
      .filter(Boolean)
      .join("/");
  }

  private getObjectPath(key: string): string {
    return `/${this.bucket}/${key}`;
  }

  private buildUrl(path: string): string {
    return `${this.endpoint}${path}`;
  }

  /** AWS Signature V4 signing */
  private sign(
    method: string,
    path: string,
    extraHeaders: Record<string, string>,
    body = "",
  ): Record<string, string> {
    const now = new Date();
    const dateStamp = now.toISOString().slice(0, 10).replace(/-/g, "");
    const amzDate = now.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z/, "Z");
    const service = "s3";
    const scope = `${dateStamp}/${this.region}/${service}/aws4_request`;
    const payloadHash = sha256(body);

    const headers: Record<string, string> = {
      Host: new URL(this.endpoint).host,
      "X-Amz-Date": amzDate,
      "X-Amz-Content-Sha256": payloadHash,
      ...extraHeaders,
    };

    const canonicalHeaders = Object.entries(headers)
      .map(([key, value]) => [key.toLowerCase(), value.trim()] as const)
      .sort(([left], [right]) => left.localeCompare(right));
    const signedHeaders = canonicalHeaders.map(([key]) => key).join(";");
    const canonicalHeaderBlock =
      canonicalHeaders.map(([key, value]) => `${key}:${value}`).join("\n") + "\n";

    const canonicalRequest = [
      method,
      path,
      "",
      canonicalHeaderBlock,
      signedHeaders,
      payloadHash,
    ].join("\n");

    const stringToSign = [
      "AWS4-HMAC-SHA256",
      amzDate,
      scope,
      sha256(canonicalRequest),
    ].join("\n");

    const kDate = hmacSha256(`AWS4${this.secretAccessKey}`, dateStamp);
    const kRegion = hmacSha256(kDate, this.region);
    const kService = hmacSha256(kRegion, service);
    const kSigning = hmacSha256(kService, "aws4_request");

    headers.Authorization =
      `AWS4-HMAC-SHA256 Credential=${this.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${hmacSha256Hex(kSigning, stringToSign)}`;

    return headers;
  }
}

function normalizeEndpoint(endpoint: string): string {
  return endpoint.replace(/\/+$/, "");
}

function normalizePrefix(prefix?: string): string {
  const normalized = (prefix ?? DEFAULT_PREFIX)
    .replace(/\/+/g, "/")
    .replace(/^\/+/, "")
    .replace(/\/+$/, "");

  return normalized;
}

function isLegacyPayload(payload: Payload): payload is LegacyPushPayload {
  return "session" in payload;
}

function formatLegacyPayloadError(payload: LegacyPushPayload): string {
  return `Conversation ${payload.session.id}: ${LEGACY_PAYLOAD_ERROR}`;
}

function formatStatus(response: Response): string {
  return response.statusText
    ? `HTTP ${response.status} ${response.statusText}`
    : `HTTP ${response.status}`;
}

async function formatResponseError(response: Response): Promise<string> {
  const body = (await response.text()).trim();
  const status = formatStatus(response);
  return body.length > 0 ? `${status}: ${body.slice(0, 200)}` : status;
}

function formatThrownError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function sha256(data: string): string {
  return createHash("sha256").update(data).digest("hex");
}

function hmacSha256(key: string | Buffer, data: string): Buffer {
  return createHmac("sha256", key).update(data).digest();
}

function hmacSha256Hex(key: Buffer, data: string): string {
  return createHmac("sha256", key).update(data).digest("hex");
}
