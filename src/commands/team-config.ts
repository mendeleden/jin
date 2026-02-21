import { encodeTeamConfig, type SinkConfig } from "../sinks/types";
import { availableSinks } from "../sinks/registry";

export async function teamConfigCommand(opts: {
  type?: string;
  url?: string;
  connectionString?: string;
  bucket?: string;
  region?: string;
  endpoint?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  prefix?: string;
  teamId?: string;
  headers?: string; // JSON string
}): Promise<void> {
  const sinkType = opts.type;
  if (!sinkType) {
    console.log(`
  jin team-config — generate a team onboarding code

  Usage:
    jin team-config --type=webhook --url=https://your-api.com/jin --team-id=myteam
    jin team-config --type=postgres --connection-string=postgres://... --team-id=myteam
    jin team-config --type=s3 --bucket=my-jin-data --region=us-east-1 --access-key-id=AK... --secret-access-key=SK... --team-id=myteam

  Available sink types: ${availableSinks().join(", ")}

  The output is a base64 code that teammates use:
    jin init --team=<code>
`);
    return;
  }

  const config: SinkConfig = {
    type: sinkType as SinkConfig["type"],
    url: opts.url,
    connectionString: opts.connectionString,
    bucket: opts.bucket,
    region: opts.region,
    endpoint: opts.endpoint,
    accessKeyId: opts.accessKeyId,
    secretAccessKey: opts.secretAccessKey,
    prefix: opts.prefix || "jin/",
    teamId: opts.teamId || "default",
    headers: opts.headers ? JSON.parse(opts.headers) : undefined,
  };

  // Remove undefined keys
  const clean = Object.fromEntries(
    Object.entries(config).filter(([_, v]) => v !== undefined)
  ) as SinkConfig;

  const encoded = encodeTeamConfig(clean);

  console.log(`
  Team config generated.

  --- Share this with your team ---

  One-liner install + connect:

    curl -fsSL https://your-host/jin/install.sh | sh && jin init --team=${encoded}

  Or if jin is already installed:

    jin init --team=${encoded}

  --- Config details ---
  ${JSON.stringify(clean, null, 2)}

  --- Raw base64 ---
  ${encoded}
`);
}
