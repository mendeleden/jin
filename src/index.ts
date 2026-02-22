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

  Usage:
    jin init [--team=<code>]         Detect tools, connect to team infra
    jin watch [--daemon]             Watch + ingest + sync to sinks
    jin status                       Show daemon status + stats
    jin stop                         Stop the background daemon
    jin service install|uninstall|status
                                     OS service (survives reboot)
    jin list  [--adapter=X] [--since=24h] [--limit=50]
                                     List ingested sessions
    jin show  <session-id> [--markdown]
                                     Show a session's messages
    jin analyze [--adapter=X]        Token/cost analysis
    jin ingest                       One-shot ingest from all detected tools
    jin push  [--endpoint=URL]       Push sessions to configured sinks
    jin export [--format=json|markdown] [--output=dir]
                                     Export sessions to files
    jin team-config --type=<sink> ... Generate team onboarding code
    jin setup-skills                  Register /jin in Claude Code, Gemini CLI, Codex
    jin update                       Self-update to latest version
    jin version                      Show version
    jin ui                           Launch local web dashboard

  Sinks (output destinations):
    webhook    — POST to any HTTP endpoint
    postgres   — Insert into PostgreSQL (Neon, Supabase, self-hosted)
    s3         — Upload to S3, R2, MinIO, GCS

  Adapters (input sources):
    claude-code, cursor, codex, warp, gemini-cli,
    kiro, amp, opencode, pi, piagent

  Team setup:
    1. Team lead runs:  jin team-config --type=postgres --connection-string=... --team-id=myteam
    2. Outputs a code:  eyJzaW5rIjoicG9zdGdyZXMiLC4uLn0=
    3. Devs run:        jin init --team=eyJzaW5rIjoicG9zdGdyZXMiLC4uLn0=
    4. Then:            jin watch

  Config: ~/.config/jin/config.json
`);
}

async function main(): Promise<void> {
  switch (command) {
    case "init": {
      const { initCommand } = await import("./commands/init");
      await initCommand({ team: flags.team as string | undefined, json: !!flags.json });
      break;
    }
    case "watch": {
      const { watchCommand } = await import("./commands/watch");
      await watchCommand({ daemon: !!flags.daemon });
      break;
    }
    case "list": {
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
    case "status": {
      const { statusCommand } = await import("./commands/status");
      await statusCommand();
      break;
    }
    case "stop": {
      const { stopCommand } = await import("./commands/stop");
      await stopCommand();
      break;
    }
    case "service": {
      const { serviceCommand } = await import("./commands/service");
      const action = args[1];
      await serviceCommand(action);
      break;
    }
    case "setup-skills": {
      const { setupSkillsCommand } = await import("./commands/setup-skills");
      await setupSkillsCommand();
      break;
    }
    case "update": {
      const { selfUpdate } = await import("./updater");
      await selfUpdate();
      break;
    }
    case "version":
    case "--version":
    case "-v":
      console.log(`jin ${VERSION}`);
      break;
    case "ui": {
      console.log("  Web dashboard coming soon. For now, use `jin list` and `jin analyze`.");
      break;
    }
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
