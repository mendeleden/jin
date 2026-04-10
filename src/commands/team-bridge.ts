import { encodeTeamConfig, type SinkConfig } from "../sinks/types";
import { availableSinks } from "../sinks/registry";

// Generates a base64 onboarding bridge code. This is an operator command.
// Developers consume the code via: jin connect --team=<code>
export async function teamBridgeCommand(opts: {
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
  headers?: string;
}): Promise<void> {
  const sinkType = opts.type;
  if (!sinkType) {
    console.log(`
  jin team bridge — generate a developer onboarding code (operator command)

  Usage:
    jin team bridge --type=webhook --url=https://your-api.com/jin --name=team-prod
    jin team bridge --type=postgres --connection-string=postgres://... --name=team-prod
    jin team bridge --type=s3 --bucket=my-jin-data --region=us-east-1 --name=team-prod

  Options:
    --name=<label>         Human-readable sink name (e.g. "team-prod", "acme-db")
    --team-id=<id>         Team identifier for multi-tenant setups

  Available sink types: ${availableSinks().join(", ")}

  The output is a base64 bridge code for developers to run:
    jin connect --team=<code>
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

  const clean = Object.fromEntries(
    Object.entries(config).filter(([, value]) => value !== undefined),
  ) as SinkConfig;

  const encoded = encodeTeamConfig(clean);

  console.log(`
  Workspace bridge code generated.

  --- Share this with your developers ---

  Developer onboarding:

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
