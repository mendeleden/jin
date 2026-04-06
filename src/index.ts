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
  sessions: `
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
    $ jin sessions --adapter=claude-code --json   # compatibility alias
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
  Token and cost analysis by adapter and model

  USAGE
    jin stats [flags]

  FLAGS
    --adapter=<id>     Filter by adapter
    --since=<duration> Time range (e.g. 24h, 7d)
    --json             Output as JSON

  EXAMPLES
    $ jin stats --since=30d
    $ jin stats --adapter=claude-code --json
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

  COMPATIBILITY SHORTCUTS
    --postgres=<url>   Legacy one-step sink creation + routing
    --s3=<bucket>      Legacy one-step sink creation + routing
    --webhook=<url>    Legacy one-step sink creation + routing

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
  init: `
  Compatibility bootstrap helper for onboarding and setup

  USAGE
    jin init [flags]

  FLAGS
    --team=<code>      Add a workspace destination from an onboarding code
    --skills           Install jin as a skill/command in detected coding tools
    --json             Output as JSON

  PRIMARY LOCAL-FIRST PATH
    jin start          Bootstraps the local daemon and index on first run

  COMPATIBILITY NOTE
    jin init remains for onboarding/setup compatibility. It will not run a
    second ingest coordinator while the daemon is active.

  EXAMPLES
    $ jin init
    $ jin init --team=<code> --skills
`,
  start: `
  Start the local daemon (bootstraps on first run)

  USAGE
    jin start [flags]

  FLAGS
    --foreground       Run in foreground (no daemon)
    --service          Also install OS service
    --ui               Also start dashboard
    --all              Start watcher + UI
    --port=<n>         Dashboard port (default: 4000)

  EXAMPLES
    $ jin start
    $ jin start --foreground
    $ jin start --all --port=8080
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
  sink: `
  Manage low-level integration destinations

  USAGE
    jin sink add <type> [flags]
    jin sink remove <id> [--yes]
    jin sink disable <id>
    jin sink enable <id>

  EXAMPLES
    $ jin sink add postgres --connection-string=postgres://... --id=team-postgres
    $ jin sink add webhook --url=https://example.com/jin --id=analytics
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
  "team-config": `
  Generate a workspace onboarding bridge code

  USAGE
    jin team-config --type=<sink-type> [flags]

  EXAMPLES
    $ jin team-config --type=webhook --url=https://workspace.example/jin --name=workspace-main
    $ jin team-config --type=postgres --connection-string=postgres://... --name=workspace-main
`,
  ingest: `
  Run a one-shot local ingest without starting the daemon

  USAGE
    jin ingest

  EXAMPLES
    $ jin ingest
`,
};

COMMAND_HELP.conversations = COMMAND_HELP.sessions;

function usage(): void {
  console.log(`
  jin v${VERSION} — local daemon and conversation index for coding-tool activity

  Local-first:
    start [--foreground|--service]       Start the local daemon
    stop [--watcher|--ui]                Stop running components
    restart                              Restart the local daemon
    status [--json|--short]              Show daemon, health, and destination status
    conversations [--adapter=X]          List local conversations
    search "query" [--since=7d]          Search local conversation content
    show <id> [--trace|--tree|--json]    Show a conversation, trace, or tree
    export [--format=json|md]            Export local conversations

  Workspace:
    connect --team=<code>                Add a workspace destination
    connect <repo> --sink=<id>           Route a local repo to a destination
    connections                          Show current repo routing and destinations
    disconnect <repo>                    Remove repo routing
    team-config --type=<sink>            Generate a workspace onboarding code

  Integrations:
    sink add <type> ...                  Add a generic integration destination
    sink remove <id>                     Remove a destination
    sink disable|enable <id>             Durable destination control
    route add ... --sink=<id>            Add routing rules
    route remove ...                     Remove routing rules

  Compatibility / Admin:
    init [--team=<code>] [--skills]      Compatibility bootstrap helper
    ingest                               One-shot local ingest
    benchmark [--json]                   Measure local daemon and ingest budgets
    service install|uninstall|status     OS service (systemd/launchd)
    ui [--port=4000]                     Local dashboard
    update [--quiet|--rollback]          Self-update or rollback
    version                              Show version

  Primary path:  jin start
  Config:        ~/.config/jin/config.json
  Help:          jin help <command> for details (e.g. jin help sink)
`);
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
      if (flags.foreground) {
        const { watchCommand } = await import("./commands/watch");
        await watchCommand({ daemon: false });
      } else {
        const { startCommand } = await import("./commands/start");
        await startCommand({
          service: !!flags.service,
          ui: !!flags.ui,
          all: !!flags.all,
          port: flags.port ? parseInt(flags.port as string) : undefined,
        });
      }
      break;
    }
    case "stop": {
      const { stopCommand } = await import("./commands/stop");
      await stopCommand({
        watcher: !!flags.watcher,
        ui: !!flags.ui,
      });
      break;
    }
    case "restart": {
      const { restartCommand } = await import("./commands/start");
      await restartCommand({
        service: !!flags.service,
        ui: !!flags.ui,
        all: !!flags.all,
        port: flags.port ? parseInt(flags.port as string) : undefined,
      });
      break;
    }
    case "ingest": {
      const { ingestCommand } = await import("./commands/ingest");
      await ingestCommand();
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

    // ── Setup ──────────────────────────────────────────────────────────
    case "init": {
      const { initCommand } = await import("./commands/init");
      await initCommand({
        team: flags.team as string | undefined,
        json: !!flags.json,
        skills: !!flags.skills,
      });
      break;
    }

    // ── Connections ───────────────────────────────────────────────────────
    case "connect": {
      const { connectCommand } = await import("./commands/connect");
      const project = args[1] && !args[1].startsWith("--") ? args[1] : "";
      await connectCommand(project, {
        postgres: flags.postgres as string | undefined,
        s3: flags.s3 as string | undefined,
        webhook: flags.webhook as string | undefined,
        sink: flags.sink as string | undefined,
        team: flags.team as string | undefined,
        id: flags.id as string | undefined,
        name: flags.name as string | undefined,
        "team-id": flags["team-id"] as string | undefined,
        teamId: flags.teamId as string | undefined,
        region: flags.region as string | undefined,
        endpoint: flags.endpoint as string | undefined,
        "access-key-id": flags["access-key-id"] as string | undefined,
        accessKeyId: flags.accessKeyId as string | undefined,
        "secret-access-key": flags["secret-access-key"] as string | undefined,
        secretAccessKey: flags.secretAccessKey as string | undefined,
        prefix: flags.prefix as string | undefined,
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

    // ── Interactive / Foreground ────────────────────────────────────────
    case "ui": {
      if (flags.tui) {
        const { launchTui } = await import("./tui/app");
        await launchTui();
      } else {
        const subcommand = args[1];
        const port = flags.port ? parseInt(flags.port as string) : 4000;
        if (subcommand === "start") {
          const { startDetached } = await import("./api/server");
          await startDetached({ port });
        } else if (subcommand === "stop") {
          const { stopServer } = await import("./api/server");
          stopServer();
        } else if (subcommand === "status") {
          const { serverStatus } = await import("./api/server");
          serverStatus();
        } else {
          // Default: foreground mode
          const { startServer } = await import("./api/server");
          await startServer({
            port,
            dev: !!flags.dev,
            open: !flags["no-open"],
          });
        }
      }
      break;
    }

    // ── Data ───────────────────────────────────────────────────────────
    case "conversations":
    case "sessions": {
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
        adapter: flags.adapter as string | undefined,
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

    // ── Admin ──────────────────────────────────────────────────────────
    case "service": {
      const { serviceCommand } = await import("./commands/service");
      const action = args[1];
      await serviceCommand(action);
      break;
    }
    case "team-config": {
      const { teamConfigCommand } = await import("./commands/team-config");
      await teamConfigCommand({
        name: flags.name as string | undefined,
        type: flags.type as string | undefined,
        url: flags.url as string | undefined,
        connectionString: (flags["connection-string"] || flags.connectionString) as string | undefined,
        bucket: flags.bucket as string | undefined,
        region: flags.region as string | undefined,
        endpoint: flags.endpoint as string | undefined,
        accessKeyId: (flags["access-key-id"] || flags.accessKeyId) as string | undefined,
        secretAccessKey: (flags["secret-access-key"] || flags.secretAccessKey) as string | undefined,
        prefix: flags.prefix as string | undefined,
        teamId: (flags["team-id"] || flags.teamId) as string | undefined,
        headers: flags.headers as string | undefined,
      });
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
