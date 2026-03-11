/**
 * Verify S3 push results. Lists bucket objects, samples one, counts total messages.
 * Usage: bun run verify-s3.ts <endpoint> <bucket> <accessKey> <secretKey>
 */
import { signS3Request } from "./s3-signer";

const [endpoint, bucket, accessKey, secretKey] = process.argv.slice(2);
if (!endpoint || !bucket || !accessKey || !secretKey) {
  console.error("Usage: bun run verify-s3.ts <endpoint> <bucket> <accessKey> <secretKey>");
  process.exit(1);
}

async function s3Get(path: string): Promise<Response> {
  const headers = signS3Request("GET", path, {}, accessKey, secretKey, endpoint);
  return fetch(`${endpoint}${path}`, { headers });
}

// List all objects in bucket
const listResp = await s3Get(`/${bucket}/`);
const xml = await listResp.text();
const keys = [...xml.matchAll(/<Key>([^<]+)<\/Key>/g)].map((m) => m[1]);
const jsonKeys = keys.filter((k) => k.endsWith(".json"));

// Sample first object to verify structure
let sample = null;
if (jsonKeys.length > 0) {
  const sampleResp = await s3Get(`/${bucket}/${jsonKeys[0]}`);
  const data = await sampleResp.json();
  sample = {
    key: jsonKeys[0],
    hasSession: !!data.session,
    hasMeta: !!data._meta,
    messageCount: (data.messages || []).length,
    teamId: data._meta?.teamId || "",
    developerId: data._meta?.developerId || "",
  };
}

// Count total messages across all objects
let totalMessages = 0;
for (const key of jsonKeys) {
  try {
    const resp = await s3Get(`/${bucket}/${key}`);
    const data = await resp.json();
    totalMessages += (data.messages || []).length;
  } catch {}
}

const result = {
  sessions: jsonKeys.length,
  totalMessages,
  sample,
};

console.log(JSON.stringify(result));
