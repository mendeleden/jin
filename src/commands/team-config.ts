import { encodeTeamConfig, type SinkConfig } from "../sinks/types";
import { availableSinks } from "../sinks/registry";

export async function teamConfigCommand(opts: {
  type?: string;
  name?: string;
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
    jin team-config --type=webhook --url=https://your-api.com/jin --name=team-prod
    jin team-config --type=postgres --connection-string=postgres://... --name=team-prod
    jin team-config --type=s3 --bucket=my-jin-data --region=us-east-1 --name=team-prod

  Options:
    --name=<label>         Human-readable sink name (e.g. "team-prod", "acme-db")
    --team-id=<id>         Team identifier for multi-tenant setups

  Available sink types: ${availableSinks().join(", ")}

  The output is a base64 code that teammates use:
    jin init --team=<code>
`);
    return;
  }

  const config: SinkConfig = {
    type: sinkType as SinkConfig["type"],
    id: opts.name,
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

  Fresh install:

    curl -fsSL https://raw.githubusercontent.com/mendeleden/jin/main/install.sh | sh && jin init --team=${encoded}

  Existing install (workspace onboarding bridge):

    jin connect --team=${encoded}

  Low-level BYO integration config stays separate:

    jin sink add ...
    jin route add ...

  --- Config details ---
  ${JSON.stringify(clean, null, 2)}

  --- Raw base64 ---
  ${encoded}
`);
}
