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

function usage(): void {
  console.log(`
  jin v${VERSION} — conversation data pipeline for agentic coding tools

  Setup:
    init [--team=<code>]               Detect tools, configure sinks
    setup                              Guided project → sink wiring
    setup-skills                       Register /jin in AI coding tools

  Connections:
    connect <project> --postgres=...   Connect project to a sink
    connect <project> --sink=<id>      Route project to existing sink
    connect <project> --team=<code>    Connect using team code
    connections                        List all project connections
    disconnect <project>               Remove a project connection

  Running:
    start [--service|--ui|--all]       Start watcher in background
    watch                              Watch + ingest (foreground)
    stop [--watcher|--ui]              Stop all running components
    restart                            Restart watcher
    status [--json|--short]            Status of all components

  Dashboard:
    ui [--port=4000]                   Web dashboard (foreground)
    ui start [--port=4000]             Start dashboard in background
    ui stop                            Stop background dashboard
    tui                                Terminal UI

  Data:
    list [--adapter=X] [--since=24h]   List sessions
    show <id> [--markdown]             Show session messages
    analyze [--adapter=X]              Token/cost analysis
    ingest                             One-shot ingest
    push [--endpoint=URL]              Push to sinks
    export [--format=json|md]          Export sessions

  Routing:
    route list                         Show sink routing rules
    route add --project=X --sink=Y     Route project to specific sink
    route remove <index>               Remove a routing rule

  Admin:
    service install|uninstall|status   OS service (systemd/launchd)
    team-config --type=<sink>          Generate team onboarding code
    update [--quiet]                   Self-update
    rollback                           Revert last update
    version                            Show version

  Quick start:  jin init && jin start && jin ui
  Config: ~/.config/jin/config.json
`);
}

async function main(): Promise<void> {
  switch (command) {
    // ── Lifecycle ──────────────────────────────────────────────────────
    case "start":
    case "up": {
      const { startCommand } = await import("./commands/start");
      await startCommand({
        service: !!flags.service,
        ui: !!flags.ui,
        all: !!flags.all,
        port: flags.port ? parseInt(flags.port as string) : undefined,
      });
      break;
    }
    case "stop":
    case "down": {
      const { stopCommand } = await import("./commands/stop");
      await stopCommand({
        watcher: !!flags.watcher,
        ui: !!flags.ui,
      });
      break;
    }
    case "restart":
    case "rs": {
      const { restartCommand } = await import("./commands/start");
      await restartCommand({
        service: !!flags.service,
        ui: !!flags.ui,
        all: !!flags.all,
        port: flags.port ? parseInt(flags.port as string) : undefined,
      });
      break;
    }
    case "status":
    case "s": {
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
      await initCommand({ team: flags.team as string | undefined, json: !!flags.json });
      break;
    }
    case "setup-skills": {
      const { setupSkillsCommand } = await import("./commands/setup-skills");
      await setupSkillsCommand();
      break;
    }
    case "setup": {
      const { setupCommand } = await import("./commands/setup");
      await setupCommand({ json: !!flags.json });
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
        "team-id": flags["team-id"] as string | undefined,
        teamId: flags.teamId as string | undefined,
        region: flags.region as string | undefined,
        endpoint: flags.endpoint as string | undefined,
        "access-key-id": flags["access-key-id"] as string | undefined,
        accessKeyId: flags.accessKeyId as string | undefined,
        "secret-access-key": flags["secret-access-key"] as string | undefined,
        secretAccessKey: flags.secretAccessKey as string | undefined,
        prefix: flags.prefix as string | undefined,
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
    case "watch": {
      const { watchCommand } = await import("./commands/watch");
      await watchCommand({ daemon: !!flags.daemon });
      break;
    }
    case "ui": {
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
      break;
    }
    case "tui": {
      const { launchTui } = await import("./tui/app");
      await launchTui();
      break;
    }

    // ── Data ───────────────────────────────────────────────────────────
    case "list":
    case "ls": {
      const { listCommand } = await import("./commands/list");
      await listCommand({
        adapter: flags.adapter as string | undefined,
        since: flags.since as string | undefined,
        limit: flags.limit ? parseInt(flags.limit as string) : undefined,
        json: !flags.table,
      });
      break;
    }
    case "show": {
      const { showCommand } = await import("./commands/show");
      const sessionId = args[1];
      if (!sessionId || sessionId.startsWith("--")) {
        console.error("Usage: jin show <session-id> [--markdown]");
        process.exit(1);
      }
      await showCommand(sessionId, {
        json: !flags.markdown,
        markdown: !!flags.markdown,
      });
      break;
    }
    case "analyze": {
      const { analyzeCommand } = await import("./commands/analyze");
      await analyzeCommand({
        adapter: flags.adapter as string | undefined,
        since: flags.since as string | undefined,
        json: !flags.table,
      });
      break;
    }
    case "ingest": {
      const { ingestCommand } = await import("./commands/ingest");
      await ingestCommand();
      break;
    }
    case "push": {
      const { pushCommand } = await import("./commands/push");
      await pushCommand({
        endpoint: flags.endpoint as string | undefined,
        batchSize: flags["batch-size"] ? parseInt(flags["batch-size"] as string) : undefined,
        since: flags.since as string | undefined,
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

    // ── Routing ────────────────────────────────────────────────────────
    case "route": {
      const { routeCommand } = await import("./commands/route");
      const subcommand = args[1];
      await routeCommand(subcommand, {
        project: flags.project as string | undefined,
        remote: flags.remote as string | undefined,
        directory: flags.directory as string | undefined,
        sink: flags.sink as string | undefined,
        index: args[2] ? parseInt(args[2]) : undefined,
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
      const { selfUpdate } = await import("./updater");
      const quiet = args.includes("--quiet") || args.includes("-q");
      await selfUpdate({ quiet });
      break;
    }
    case "rollback": {
      const { rollback } = await import("./updater");
      await rollback();
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
    case undefined:
      usage();
      break;
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
