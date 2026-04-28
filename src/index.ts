#!/usr/bin/env bun

import { VERSION } from "./updater";

const args = process.argv.slice(2);
const command = args[0];

function parseFlags(args: string[]): Record<string, string | boolean> {
  const flags: Record<string, string | boolean> = {};
  for (const arg of args) {
    if (arg === "-h") {
      flags.help = true;
    } else if (arg.startsWith("--")) {
      const eq = arg.indexOf("=");
      if (eq >= 0) {
        flags[arg.slice(2, eq)] = arg.slice(eq + 1);
      } else {
        flags[arg.slice(2)] = true;
      }
    }
  }
  return flags;
}

function parseIntFlag(value: string | boolean | undefined): number | undefined {
  if (typeof value !== "string" || value.length === 0) {
    return undefined;
  }
  return parseInt(value);
}

function parseBooleanFlag(value: string | boolean | undefined): boolean | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value === "boolean") {
    return value;
  }
  if (value === "false") {
    return false;
  }
  if (value === "true") {
    return true;
  }
  return true;
}

const flags = parseFlags(args.slice(1));

const COMMAND_HELP: Record<string, string> = {
  search: `
  Search local conversation content

  USAGE
    jin search "query" [flags]

  FLAGS
    --adapter=<id>     Filter by adapter (e.g. claude-code, codex, gemini-cli)
    --since=<duration> Only search recent conversations (e.g. 7d, 24h, 2w)
    --limit=<n>        Max results (default: 20)
    --json             Output as JSON

  EXAMPLES
    $ jin search "authentication flow"
    $ jin search "migration" --adapter=claude-code --since=30d
    $ jin search "deploy" --json
`,
  conversations: `
  List recent local conversations

  USAGE
    jin conversations [flags]

  FLAGS
    --adapter=<id>     Filter by adapter (e.g. claude-code, codex)
    --since=<duration> Only show recent sessions (e.g. 24h, 7d, 2w)
    --limit=<n>        Max results (default: 50)
    --json             Output as JSON

  EXAMPLES
    $ jin conversations --since=7d
`,
  show: `
  Show one local conversation, full trace, or conversation tree

  USAGE
    jin show <conversation-id> [flags]

  FLAGS
    --trace            Show the full trace containing this conversation
    --tree             Show the trace tree rooted at this conversation
    --json             Output as JSON

  EXAMPLES
    $ jin show abc12345
    $ jin show abc12345 --trace
    $ jin show abc12345 --tree
    $ jin show abc12345 --json
`,
  stats: `
  Token and cost analysis by harness and model

  USAGE
    jin stats [flags]

  FLAGS
    --harness=<id>     Filter by harness
    --adapter=<id>     Compatibility alias for --harness
    --since=<duration> Time range (e.g. 24h, 7d)
    --json             Output as JSON

  EXAMPLES
    $ jin stats --since=30d
    $ jin stats --harness=claude-code --json
`,
  connect: `
  Connect local repos to a workspace or configured destination

  USAGE
    jin connect [repo] [flags]

  FLAGS
    --team=<code>      Add a workspace destination from an onboarding code
    --sink=<id>        Use an existing sink by ID
    --remote=<url>     Match by git remote URL
    --json             Output as JSON

  LOW-LEVEL BYO INTEGRATION
    jin sink add <type> ...
    jin route add --remote="github.com/org/repo" --sink=<id>

  EXAMPLES
    $ jin connect --team=<workspace-code>
    $ jin connect my-repo --sink=workspace-main
    $ jin connect --remote=github.com/org/repo --sink=analytics-webhook
`,
  connections: `
  Show workspace and integration routing for indexed repos

  USAGE
    jin connections

  EXAMPLES
    $ jin connections
`,
  disconnect: `
  Remove routing for one indexed repo

  USAGE
    jin disconnect <repo> [flags]

  FLAGS
    --remove-sink      Also remove the sink if no routes still reference it

  EXAMPLES
    $ jin disconnect my-repo
    $ jin disconnect my-repo --remove-sink
`,
  benchmark: `
  Measure local daemon and one-shot ingest budgets

  USAGE
    jin benchmark [flags]

  FLAGS
    --json             Output as JSON (for CI)

  Measures:
    - Source data profile (files, size, lines)
    - Local daemon resource usage (CPU, RSS, FDs, I/O) if running
    - Cold ingest time and peak memory

  Results saved to ~/.config/jin/benchmarks/

  EXAMPLES
    $ jin benchmark
    $ jin benchmark --json
`,
  export: `
  Export local conversations to files

  USAGE
    jin export [flags]

  FLAGS
    --format=json|md   Output format (default: json)
    --output=<path>    Output directory
    --adapter=<id>     Filter by adapter
    --since=<duration> Time range
    --limit=<n>        Max sessions

  EXAMPLES
    $ jin export --format=md --since=7d
    $ jin export --adapter=codex --output=./exports
`,
  start: `
  Start the local daemon (bootstraps on first run)

  USAGE
    jin start [flags]

  FLAGS
    --foreground       Run in foreground (no daemon)
    --service          Also install OS service

  EXAMPLES
    $ jin start
    $ jin start --foreground
    $ jin start --service
`,
  status: `
  Show local daemon, health, and destination status

  USAGE
    jin status [flags]

  FLAGS
    --json             Output as JSON
    --short            Compact one-line output

  EXAMPLES
    $ jin status
    $ jin status --json
`,
  cache: `
  Manage local performance caches

  USAGE
    jin cache clear

  EXAMPLES
    $ jin cache clear
`,
  sink: `
  Manage low-level integration destinations

  USAGE
    jin sink add <type> [flags]
    jin sink remove <id> [--yes]
    jin sink disable <id>
    jin sink enable <id>

  EXAMPLES
    $ jin sink add postgres --connection-string=postgres://... --id=team-postgres --team-id=jin-team --user-id=eden
    $ jin sink add webhook --url=https://example.com/jin --id=analytics --user-id=eden
    $ jin sink disable team-postgres
`,
  route: `
  Manage low-level routing rules for local conversations

  USAGE
    jin route add --sink=<id> [--remote=<glob>] [--adapter=<id>] [--branch=<glob>] [--name=<glob>]
    jin route remove [--sink=<id>] [--remote=<glob>] [--adapter=<id>] [--branch=<glob>] [--name=<glob>]

  EXAMPLES
    $ jin route add --remote="github.com/acme/*" --sink=team-postgres
    $ jin route add --adapter=cursor --sink=analytics
    $ jin route remove --remote="github.com/acme/*" --sink=team-postgres
`,
  team: `
  jin team — workspace bootstrap and operator tools

  Bootstrap:
    bridge --type=<sink> [--team-id --user-id] ...
                                       Generate a developer onboarding code

  Schema (operator escape hatch):
    schema apply <connection>            Apply jin tables to a Postgres database
    schema check <connection>            Check schema version compatibility
    schema version                       Print expected schema version

  Future (deferred until workspace identity is real):
    init                                 Reserved for guided workspace setup
    status                               Reserved until workspace identity is real

  These commands are for workspace operators, not everyday developers.
  Developers join a workspace with: jin connect --team=<code>
`,
  ingest: `
  Run a one-shot local ingest without starting the daemon

  USAGE
    jin ingest

  EXAMPLES
    $ jin ingest
`,
};

function usage(): void {
  console.log(`
  jin v${VERSION} — local daemon and conversation index for coding-tool activity

  Local-first:
    start [--foreground|--service]       Start the local daemon
    stop                                 Stop the local daemon
    restart                              Restart the local daemon
    status [--json|--short]              Show daemon, health, and destination status
    conversations [--adapter=X]          List local conversations
    search "query" [--since=7d]          Search local conversation content
    show <id> [--trace|--tree|--json]    Show a conversation, trace, or tree
    export [--format=json|md]            Export local conversations

  Connect:
    connect --team=<code>                Join a workspace
    connect <repo> --sink=<id>           Route a repo to a destination
    connections                          Show current routing
    disconnect <repo>                    Remove routing

  Integrations:
    sink add <type> ...                  Add an integration destination
    sink remove <id>                     Remove a destination
    sink disable|enable <id>             Durable destination control
    route add ... --sink=<id>            Add routing rules
    route remove ...                     Remove routing rules

  Workspace (operator):
    team <subcommand>                    Workspace bootstrap, schema, bridge
                                         Run 'jin team help' for details

  Utility:
    ingest                               One-shot local ingest
    cache clear                          Clear the local discovery cache
    benchmark [--json]                   Measure ingest budgets
    service install|uninstall|status     OS service management
    update [--quiet|--rollback]          Self-update or rollback
    version                              Show version

  Primary path:  jin start
  Config:        ~/.config/jin/config.json
  Help:          jin help <command> for details (e.g. jin help sink)
`);
}

function failRemovedSurface(lines: string[]): never {
  for (const line of lines) {
    console.error(line);
  }
  process.exit(1);
}

async function main(): Promise<void> {
  // Any command with --help or -h shows per-command help
  if (flags.help && command && COMMAND_HELP[command]) {
    console.log(COMMAND_HELP[command]);
    return;
  }

  switch (command) {
    // ── Lifecycle ──────────────────────────────────────────────────────
    case "start": {
      if (flags.ui || flags.all || flags.port) {
        failRemovedSurface([
          "  Error: `jin start` no longer supports dashboard flags.",
          "  Removed: `--ui`, `--all`, and `--port`.",
          "  Use `jin start` or `jin start --service` for lifecycle control only.",
        ]);
      }
      if (flags.foreground) {
        const { watchCommand } = await import("./commands/watch");
        await watchCommand({ daemon: false });
      } else {
        const { startCommand } = await import("./commands/start");
        await startCommand({ service: !!flags.service });
      }
      break;
    }
    case "stop": {
      if (flags.ui) {
        failRemovedSurface([
          "  Error: `jin stop --ui` was removed with the dashboard surface.",
          "  Use `jin stop` to stop the local daemon.",
        ]);
      }
      const { stopCommand } = await import("./commands/stop");
      await stopCommand();
      break;
    }
    case "restart": {
      if (flags.ui || flags.all || flags.port) {
        failRemovedSurface([
          "  Error: `jin restart` no longer supports dashboard flags.",
          "  Removed: `--ui`, `--all`, and `--port`.",
          "  Use `jin restart` or `jin restart --service` for runtime lifecycle control.",
        ]);
      }
      const { restartCommand } = await import("./commands/start");
      await restartCommand({ service: !!flags.service });
      break;
    }
    case "ingest": {
      const { ingestCommand } = await import("./commands/ingest");
      await ingestCommand();
      break;
    }
    case "__worker": {
      const { runWorkerServerCommand } = await import("./pipeline/ingest-worker");
      await runWorkerServerCommand();
      break;
    }
    case "status": {
      const { statusCommand } = await import("./commands/status");
      await statusCommand({
        json: !!flags.json,
        short: !!flags.short,
      });
      break;
    }
    case "cache": {
      const action = args[1];
      switch (action) {
        case "clear": {
          const { cacheClearCommand } = await import("./commands/cache");
          await cacheClearCommand();
          break;
        }
        default:
          console.error(`Unknown cache action: ${action || "(missing)"}`);
          console.log(COMMAND_HELP.cache);
          process.exit(1);
      }
      break;
    }

    // ── Connections ───────────────────────────────────────────────────────
    case "connect": {
      if (flags.postgres || flags.s3 || flags.webhook) {
        failRemovedSurface([
          "  Error: `jin connect` no longer creates sinks directly.",
          "  Removed: `--postgres`, `--s3`, and `--webhook`.",
          "  Use `jin sink add ...` to configure a destination, then `jin connect <repo> --sink=<id>` or `jin route add ...`.",
        ]);
      }
      const { connectCommand } = await import("./commands/connect");
      const project = args[1] && !args[1].startsWith("--") ? args[1] : "";
      await connectCommand(project, {
        sink: flags.sink as string | undefined,
        team: flags.team as string | undefined,
        id: flags.id as string | undefined,
        teamId: flags.teamId as string | undefined,
        userId: (flags["user-id"] || flags.userId) as string | undefined,
        remote: flags.remote as string | undefined,
        json: !!flags.json,
        yes: !!flags.yes,
      });
      break;
    }
    case "connections": {
      const { connectionsCommand } = await import("./commands/connect");
      await connectionsCommand();
      break;
    }
    case "disconnect": {
      const { disconnectCommand } = await import("./commands/connect");
      const project = args[1] && !args[1].startsWith("--") ? args[1] : "";
      await disconnectCommand(project, {
        "remove-sink": !!flags["remove-sink"],
        removeSink: !!flags.removeSink,
        yes: !!flags.yes,
      });
      break;
    }
    case "sink": {
      const {
        sinkAddCommand,
        sinkRemoveCommand,
        sinkDisableCommand,
        sinkEnableCommand,
      } = await import("./commands/sink");
      const action = args[1];
      const sinkId = args[2];

      switch (action) {
        case "add": {
          const type = args[2] as "postgres" | "s3" | "webhook" | undefined;
          if (!type || type.startsWith("--")) {
            console.error("Usage: jin sink add <postgres|s3|webhook> [flags]");
            process.exit(1);
          }
          await sinkAddCommand(type, {
            id: flags.id as string | undefined,
            connectionString: (flags["connection-string"] ||
              flags.connectionString) as string | undefined,
            url: flags.url as string | undefined,
            headers: flags.headers
              ? JSON.parse(flags.headers as string)
              : undefined,
            timeoutMs:
              parseIntFlag(flags["timeout-ms"]) ?? parseIntFlag(flags.timeoutMs),
            bucket: flags.bucket as string | undefined,
            region: flags.region as string | undefined,
            endpoint: flags.endpoint as string | undefined,
            accessKeyId: (flags["access-key-id"] ||
              flags.accessKeyId) as string | undefined,
            secretAccessKey: (flags["secret-access-key"] ||
              flags.secretAccessKey) as string | undefined,
            prefix: flags.prefix as string | undefined,
            teamId: (flags["team-id"] || flags.teamId) as string | undefined,
            userId: (flags["user-id"] || flags.userId) as string | undefined,
            pathStyle:
              parseBooleanFlag(flags["path-style"]) ??
              parseBooleanFlag(flags.pathStyle),
            yes: !!flags.yes,
          });
          break;
        }
        case "remove":
          if (!sinkId || sinkId.startsWith("--")) {
            console.error("Usage: jin sink remove <sink-id> [--yes]");
            process.exit(1);
          }
          await sinkRemoveCommand(sinkId, { yes: !!flags.yes });
          break;
        case "disable":
          if (!sinkId || sinkId.startsWith("--")) {
            console.error("Usage: jin sink disable <sink-id>");
            process.exit(1);
          }
          await sinkDisableCommand(sinkId);
          break;
        case "enable":
          if (!sinkId || sinkId.startsWith("--")) {
            console.error("Usage: jin sink enable <sink-id>");
            process.exit(1);
          }
          await sinkEnableCommand(sinkId);
          break;
        default:
          console.error(`Unknown sink action: ${action || "(missing)"}`);
          console.log(COMMAND_HELP.sink);
          process.exit(1);
      }
      break;
    }
    case "route": {
      const { routeAddCommand, routeRemoveCommand } = await import("./commands/route");
      const action = args[1];
      const routeOpts = {
        sink: flags.sink as string | undefined,
        remote: flags.remote as string | undefined,
        adapter: flags.adapter as string | undefined,
        branch: flags.branch as string | undefined,
        name: flags.name as string | undefined,
        yes: !!flags.yes,
      };

      switch (action) {
        case "add":
          await routeAddCommand(routeOpts);
          break;
        case "remove":
          await routeRemoveCommand(routeOpts);
          break;
        default:
          console.error(`Unknown route action: ${action || "(missing)"}`);
          console.log(COMMAND_HELP.route);
          process.exit(1);
      }
      break;
    }

    // ── Data ───────────────────────────────────────────────────────────
    case "conversations": {
      const { listCommand } = await import("./commands/list");
      await listCommand({
        adapter: flags.adapter as string | undefined,
        since: flags.since as string | undefined,
        limit: flags.limit ? parseInt(flags.limit as string) : undefined,
        json: !!flags.json,
      });
      break;
    }
    case "search": {
      const { searchCommand } = await import("./commands/search");
      const query = args[1] && !args[1].startsWith("--") ? args[1] : "";
      if (!query) {
        console.error('Usage: jin search "query" [--adapter=X] [--since=7d] [--limit=<n>] [--json]');
        process.exit(1);
      }
      await searchCommand(query, {
        adapter: flags.adapter as string | undefined,
        since: flags.since as string | undefined,
        local: !!flags.local,
        sink: flags.sink as string | undefined,
        allSinks: !!flags["all-sinks"],
        limit: flags.limit ? parseInt(flags.limit as string) : undefined,
        json: !!flags.json,
      });
      break;
    }
    case "show": {
      const { showCommand } = await import("./commands/show");
      const sessionId = args[1];
      if (!sessionId || sessionId.startsWith("--") || sessionId === "-h") {
        console.error("Usage: jin show <conversation-id> [--trace|--tree|--json]");
        process.exit(1);
      }
      await showCommand(sessionId, {
        json: !!flags.json,
        markdown: !flags.json,
        trace: !!flags.trace,
        tree: !!flags.tree,
        sink: flags.sink as string | undefined,
        allSinks: !!flags["all-sinks"],
      });
      break;
    }
    case "stats": {
      const { analyzeCommand } = await import("./commands/analyze");
      await analyzeCommand({
        harness: (flags.harness as string | undefined) ?? (flags.adapter as string | undefined),
        since: flags.since as string | undefined,
        json: !!flags.json,
      });
      break;
    }
    case "export": {
      const { exportCommand } = await import("./commands/export");
      await exportCommand({
        format: (flags.format as "json" | "markdown") || "json",
        output: flags.output as string | undefined,
        adapter: flags.adapter as string | undefined,
        since: flags.since as string | undefined,
        limit: flags.limit ? parseInt(flags.limit as string) : undefined,
      });
      break;
    }

    // ── Performance ────────────────────────────────────────────────────
    case "benchmark": {
      const { benchmarkCommand } = await import("./commands/benchmark");
      await benchmarkCommand({ json: !!flags.json });
      break;
    }

    // ── Team (operator) ─────────────────────────────────────────────
    case "team": {
      const teamAction = args[1];
      const teamFlags = parseFlags(args.slice(2));

      switch (teamAction) {
        case "bridge": {
          const { teamBridgeCommand } = await import("./commands/team-bridge");
          await teamBridgeCommand({
            name: teamFlags.name as string | undefined,
            type: teamFlags.type as string | undefined,
            url: teamFlags.url as string | undefined,
            connectionString: (teamFlags["connection-string"] || teamFlags.connectionString) as string | undefined,
            bucket: teamFlags.bucket as string | undefined,
            region: teamFlags.region as string | undefined,
            endpoint: teamFlags.endpoint as string | undefined,
            accessKeyId: (teamFlags["access-key-id"] || teamFlags.accessKeyId) as string | undefined,
            secretAccessKey: (teamFlags["secret-access-key"] || teamFlags.secretAccessKey) as string | undefined,
            prefix: teamFlags.prefix as string | undefined,
            teamId: (teamFlags["team-id"] || teamFlags.teamId) as string | undefined,
            userId: (teamFlags["user-id"] || teamFlags.userId) as string | undefined,
            headers: teamFlags.headers as string | undefined,
          });
          break;
        }
        case "schema": {
          const schemaAction = args[2];
          const schemaFlags = parseFlags(args.slice(3));
          switch (schemaAction) {
            case "apply": {
              const { schemaApplyCommand } = await import("./commands/schema");
              await schemaApplyCommand({
                connectionString: (schemaFlags["connection-string"] || schemaFlags.connectionString) as string | undefined,
                dryRun: !!schemaFlags["dry-run"] || !!schemaFlags.dryRun,
              });
              break;
            }
            case "check": {
              const { schemaCheckCommand } = await import("./commands/schema");
              await schemaCheckCommand({
                connectionString: (schemaFlags["connection-string"] || schemaFlags.connectionString) as string | undefined,
              });
              break;
            }
            case "version": {
              const { schemaVersionCommand } = await import("./commands/schema");
              schemaVersionCommand();
              break;
            }
            default:
              console.log(`
  jin team schema — operator escape hatch for Postgres integrations

  USAGE
    jin team schema apply --connection-string="postgres://..."  [--dry-run]
    jin team schema check --connection-string="postgres://..."
    jin team schema version
`);
              break;
          }
          break;
        }
        case "help":
        default:
          console.log(COMMAND_HELP.team);
          break;
      }
      break;
    }

    // ── Admin ──────────────────────────────────────────────────────────
    case "service": {
      const { serviceCommand } = await import("./commands/service");
      const action = args[1];
      await serviceCommand(action);
      break;
    }
    case "update": {
      if (flags.rollback) {
        const { rollback } = await import("./updater");
        await rollback();
      } else {
        const { selfUpdate } = await import("./updater");
        const quiet = args.includes("--quiet") || args.includes("-q");
        await selfUpdate({ quiet });
      }
      break;
    }
    case "version":
    case "--version":
    case "-v":
      console.log(`jin ${VERSION}`);
      break;

    // ── Help ───────────────────────────────────────────────────────────
    case "help":
    case "--help":
    case "-h":
    case undefined: {
      const topic = args[1];
      if (topic && COMMAND_HELP[topic]) {
        console.log(COMMAND_HELP[topic]);
      } else {
        usage();
      }
      break;
    }
    case "init":
      failRemovedSurface([
        "  Error: `jin init` was removed.",
        "  Use `jin start` for local bootstrap and `jin connect --team=<code>` for workspace onboarding.",
      ]);
    case "sessions":
      failRemovedSurface([
        "  Error: `jin sessions` was removed.",
        "  Use `jin conversations`.",
      ]);
    case "team-config":
      failRemovedSurface([
        "  Error: `jin team-config` was removed.",
        "  Use `jin team bridge`.",
      ]);
    case "ui":
      failRemovedSurface([
        "  Error: `jin ui` was removed.",
        "  Use `jin status`, `jin start`, and `jin stop` for the daemon-first local surface.",
      ]);
    default:
      console.error(`Unknown command: ${command}`);
      usage();
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
