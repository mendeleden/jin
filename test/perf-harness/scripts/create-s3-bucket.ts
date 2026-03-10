/**
 * Create an S3 bucket via the MinIO/S3 API using AWS Signature V4.
 * Usage: bun run create-s3-bucket.ts <endpoint> <bucket> <accessKey> <secretKey>
 */
import { signS3Request } from "./s3-signer";

const [endpoint, bucket, accessKey, secretKey] = process.argv.slice(2);
if (!endpoint || !bucket || !accessKey || !secretKey) {
  console.error("Usage: bun run create-s3-bucket.ts <endpoint> <bucket> <accessKey> <secretKey>");
  process.exit(1);
}

const headers = signS3Request("PUT", `/${bucket}/`, {}, accessKey, secretKey, endpoint);
const resp = await fetch(`${endpoint}/${bucket}/`, { method: "PUT", headers });

if (resp.ok || resp.status === 409) {
  console.log(JSON.stringify({ ok: true, status: resp.status }));
} else {
  const body = await resp.text();
  console.log(JSON.stringify({ ok: false, status: resp.status, error: body }));
  process.exit(1);
}
