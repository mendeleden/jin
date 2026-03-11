import { createHash, createHmac } from "crypto";
import type { Sink, SinkConfig, PushPayload, PushResult } from "./types";

/**
 * S3-compatible sink (AWS S3, Cloudflare R2, MinIO, GCS).
 *
 * Zero-dependency — implements AWS Signature V4 signing directly.
 * Each session is stored as a JSON file at:
 *   s3://bucket/prefix/team_id/developer_id/adapter_id/session_id.json
 */
export class S3Sink implements Sink {
  id = "s3";
  name = "S3-Compatible Storage";
  private bucket: string;
  private region: string;
  private endpoint: string;
  private accessKeyId: string;
  private secretAccessKey: string;
  private prefix: string;
  private teamId: string;
  private developerId: string;

  constructor(config: SinkConfig) {
    if (!config.bucket) throw new Error("S3 sink requires 'bucket'");
    if (!config.accessKeyId) throw new Error("S3 sink requires 'accessKeyId'");
    if (!config.secretAccessKey) throw new Error("S3 sink requires 'secretAccessKey'");

    this.bucket = config.bucket;
    this.region = config.region || "us-east-1";
    this.endpoint = config.endpoint || `https://s3.${this.region}.amazonaws.com`;
    this.accessKeyId = config.accessKeyId;
    this.secretAccessKey = config.secretAccessKey;
    this.prefix = config.prefix || "jin/";
    this.teamId = config.teamId || "default";
    this.developerId = config.developerId || "unknown";
  }

  async healthCheck(): Promise<{ ok: boolean; error?: string }> {
    try {
      // HEAD bucket to verify access
      const url = `${this.endpoint}/${this.bucket}/`;
      const headers = this.sign("HEAD", `/${this.bucket}/`, {});
      const resp = await fetch(url, { method: "HEAD", headers });
      if (resp.ok || resp.status === 200 || resp.status === 301) return { ok: true };
      return { ok: false, error: `HTTP ${resp.status}` };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  }

  async push(data: PushPayload[]): Promise<PushResult> {
    let pushed = 0;
    let failed = 0;
    const errors: string[] = [];

    for (const { session, messages } of data) {
      try {
        const key = [
          this.prefix,
          this.teamId,
          this.developerId,
          session.adapterId,
          `${session.id}.json`,
        ]
          .filter(Boolean)
          .join("/")
          .replace(/\/+/g, "/");

        const body = JSON.stringify({
          session,
          messages,
          _meta: {
            teamId: this.teamId,
            developerId: this.developerId,
            pushedAt: new Date().toISOString(),
          },
        });

        const path = `/${this.bucket}/${key}`;
        const url = `${this.endpoint}${path}`;
        const headers = this.sign("PUT", path, {
          "Content-Type": "application/json",
          "Content-Length": String(Buffer.byteLength(body)),
        }, body);

        const resp = await fetch(url, {
          method: "PUT",
          headers,
          body,
        });

        if (resp.ok) {
          pushed++;
        } else {
          failed++;
          const text = await resp.text();
          errors.push(`S3 PUT ${key}: HTTP ${resp.status} — ${text.slice(0, 200)}`);
        }
      } catch (err) {
        failed++;
        errors.push(`Session ${session.id}: ${err}`);
      }
    }

    return { pushed, failed, errors };
  }

  async close(): Promise<void> {}

  /** AWS Signature V4 signing */
  private sign(
    method: string,
    path: string,
    extraHeaders: Record<string, string>,
    body?: string
  ): Record<string, string> {
    const now = new Date();
    const dateStamp = now.toISOString().slice(0, 10).replace(/-/g, "");
    const amzDate = now.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z/, "Z");
    const service = "s3";
    const scope = `${dateStamp}/${this.region}/${service}/aws4_request`;

    const payloadHash = sha256(body || "");

    const headers: Record<string, string> = {
      Host: new URL(this.endpoint).host,
      "X-Amz-Date": amzDate,
      "X-Amz-Content-Sha256": payloadHash,
      ...extraHeaders,
    };

    // Canonical headers
    const signedHeaderKeys = Object.keys(headers)
      .map((k) => k.toLowerCase())
      .sort();
    const canonicalHeaders = signedHeaderKeys
      .map((k) => `${k}:${headers[Object.keys(headers).find((h) => h.toLowerCase() === k)!].trim()}`)
      .join("\n") + "\n";
    const signedHeaders = signedHeaderKeys.join(";");

    // Canonical request
    const canonicalRequest = [
      method,
      path,
      "", // query string
      canonicalHeaders,
      signedHeaders,
      payloadHash,
    ].join("\n");

    // String to sign
    const stringToSign = [
      "AWS4-HMAC-SHA256",
      amzDate,
      scope,
      sha256(canonicalRequest),
    ].join("\n");

    // Signing key
    const kDate = hmacSha256(`AWS4${this.secretAccessKey}`, dateStamp);
    const kRegion = hmacSha256(kDate, this.region);
    const kService = hmacSha256(kRegion, service);
    const kSigning = hmacSha256(kService, "aws4_request");

    // Signature
    const signature = hmacSha256Hex(kSigning, stringToSign);

    headers["Authorization"] =
      `AWS4-HMAC-SHA256 Credential=${this.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

    return headers;
  }
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
