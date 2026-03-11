/**
 * AWS Signature V4 signing for S3 requests.
 * Shared by all S3 harness scripts.
 */
import { createHash, createHmac } from "crypto";

export function signS3Request(
  method: string,
  path: string,
  headers: Record<string, string>,
  accessKey: string,
  secretKey: string,
  endpoint: string,
  region = "us-east-1",
): Record<string, string> {
  const now = new Date();
  const dateStamp = now.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
  const shortDate = dateStamp.slice(0, 8);
  const host = new URL(endpoint).host;

  headers["host"] = host;
  headers["x-amz-date"] = dateStamp;
  headers["x-amz-content-sha256"] = "UNSIGNED-PAYLOAD";

  const signedHeaders = Object.keys(headers).sort().join(";");
  const canonicalHeaders = Object.keys(headers).sort().map((k) => k + ":" + headers[k]).join("\n") + "\n";
  const canonical = [method, path, "", canonicalHeaders, signedHeaders, "UNSIGNED-PAYLOAD"].join("\n");
  const scope = `${shortDate}/${region}/s3/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", dateStamp, scope, createHash("sha256").update(canonical).digest("hex")].join("\n");

  let key: Buffer = createHmac("sha256", "AWS4" + secretKey).update(shortDate).digest();
  key = createHmac("sha256", key).update(region).digest();
  key = createHmac("sha256", key).update("s3").digest();
  key = createHmac("sha256", key).update("aws4_request").digest();
  const signature = createHmac("sha256", key).update(stringToSign).digest("hex");

  headers["authorization"] = `AWS4-HMAC-SHA256 Credential=${accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  return headers;
}
