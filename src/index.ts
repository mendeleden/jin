#!/usr/bin/env bun

import { VERSION } from "./updater";

const args = process.argv.slice(2);
const command = args[0];

function parseFlags(args: string[]): Record<string, string | boolean> {
  const flags: Record<string, string | boolean> = {};
  for (const arg of args) {
    if (arg.startsWith("--")) {
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

const flags = parseFlags(args.slice(1));

const COMMAND_HELP: Record<string, string> = {
  search: `
  Full-text search across team conversations

  USAGE
    jin search "query" [flags]

  FLAGS
    --adapter=<id>     Filter by adapter (e.g. claude-code, codex, gemini-cli)
    --since=<duration> Only search recent conversations (e.g. 7d, 24h, 2w)
    --limit=<n>        Max results (default: 20)
    --json             Output as JSON
    --local            Search local SQLite (FTS5) instead of Postgres
    --sink=<id>        Search a specific Postgres sink by ID
    --all-sinks        Search all configured Postgres sinks

  EXAMPLES
    $ jin search "authentication flow"
    $ jin search "N+1 query" --all-sinks --limit=5
    $ jin search "migration" --adapter=claude-code --since=30d
    $ jin search "deploy" --local --json
`,
  sessions: `
  List recent sessions across all tools

  USAGE
    jin sessions [flags]

  FLAGS
    --adapter=<id>     Filter by adapter (e.g. claude-code, codex)
    --since=<duration> Only show recent sessions (e.g. 24h, 7d, 2w)
    --limit=<n>        Max results (default: 50)
    --json             Output as JSON

  EXAMPLES
    $ jin sessions --since=7d
    $ jin sessions --adapter=claude-code --json
`,
  show: `
  Show session messages

  USAGE
    jin show <session-id> [flags]

  FLAGS
    --json             Output as JSON

  EXAMPLES
    $ jin show abc12345
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
  Wire a project to a sink

  USAGE
    jin connect [project] [flags]

  FLAGS
    --postgres=<url>   Connect to a Postgres sink
    --s3=<url>         Connect to an S3 sink
    --webhook=<url>    Connect to a webhook sink
    --sink=<id>        Use an existing sink by ID
    --remote=<url>     Match by git remote URL
    --directory=<path> Match by directory path
    --json             Output as JSON

  EXAMPLES
    $ jin connect myproject --postgres=postgresql://...
    $ jin connect --remote=github.com/org/repo --sink=pg-team
`,
  export: `
  Export sessions to files

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
  Detect tools, ingest sessions, and register skills

  USAGE
    jin init [flags]

  FLAGS
    --team=<code>      Join a team (base64 config code)
    --skills           Install jin as a skill/command in detected coding tools
    --json             Output as JSON

  EXAMPLES
    $ jin init
    $ jin init --team=<code> --skills
`,
  start: `
  Start the watcher daemon

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
  Show status of all components

  USAGE
    jin status [flags]

  FLAGS
    --json             Output as JSON
    --short            Compact one-line output

  EXAMPLES
    $ jin status
    $ jin status --json
`,
};

function usage(): void {
  console.log(`
  jin v${VERSION} — conversation data pipeline for agentic coding tools

  Getting started:
    jin init [--team=<code>] [--skills]  Detect tools, ingest, register skills
    jin connect [project]                Interactive project → sink wiring
    jin start                            Start watcher in background

  Team one-liner:
    jin init --team=<code> && jin start

  Connections:
    connect <project> --postgres=...     Connect project to a sink
    connect --remote=<url> --sink=<id>   Connect by git remote
    connect --directory=<path> --sink=   Connect by directory path
    connections                          List all connections & sinks
    disconnect <project>                 Remove a project connection
    team-config --type=<sink>            Generate team onboarding code

  Running:
    start [--service|--ui|--all]         Start watcher in background
    start --foreground                   Watch + ingest (foreground)
    stop [--watcher|--ui]                Stop all running components
    restart                              Restart watcher
    status [--json|--short]              Status of all components

  Dashboard:
    ui [--port=4000]                     Web dashboard (foreground)
    ui start/stop/status                 Background dashboard management
    ui --tui                             Terminal UI

  Data:
    sessions [--adapter=X] [--since=24h] List sessions (--json for JSON)
    search "query" [--since=7d]          Full-text search across conversations
    show <id> [--json]                   Show session messages
    stats [--adapter=X] [--since=24h]    Token/cost analysis (--json for JSON)
    export [--format=json|md]            Export sessions to files

  Admin:
    service install|uninstall|status     OS service (systemd/launchd)
    update [--quiet|--rollback]          Self-update or rollback
    version                              Show version

  Quick start:  jin init && jin connect && jin start
  Config: ~/.config/jin/config.json
  Help:   jin help <command> for details (e.g. jin help search)
`);
}

async function main(): Promise<void> {
  // Any command with --help or -h shows per-command help
  if ((flags.help || args.includes("-h")) && command && COMMAND_HELP[command]) {
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
        directory: flags.directory as string | undefined,
        json: !!flags.json,
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
      });
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
        console.error('Usage: jin search "query" [--adapter=X] [--since=7d] [--local] [--sink=<id>]');
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
      if (!sessionId || sessionId.startsWith("--")) {
        console.error("Usage: jin show <session-id> [--json]");
        process.exit(1);
      }
      await showCommand(sessionId, {
        json: !!flags.json,
        markdown: !flags.json,
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
