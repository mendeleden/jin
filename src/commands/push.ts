import { loadConfig } from "../config";
import { Store } from "../store";
import { createSink } from "../sinks/registry";
import type { Sink, PushPayload } from "../sinks/types";

export async function pushCommand(opts: {
  endpoint?: string;
  batchSize?: number;
  since?: string;
  sinkType?: string;
}): Promise<void> {
  const config = await loadConfig();
  const store = new Store(config.store.dbPath);

  // Determine which sinks to push to
  const sinks: Sink[] = [];

  // Use configured sinks
  if (config.sinks.length > 0) {
    for (const sinkConfig of config.sinks) {
      try {
        sinks.push(createSink(sinkConfig));
      } catch (err) {
        console.error(`  Error creating sink "${sinkConfig.type}": ${err}`);
      }
    }
  }

  // Override with CLI flags for ad-hoc webhook push
  if (opts.endpoint) {
    sinks.push(
      createSink({
        type: "webhook",
        url: opts.endpoint,
        batchSize: opts.batchSize,
        teamId: config.team?.teamId,
        developerId: config.team?.developerId,
      })
    );
  }

  // Legacy: fall back to config.push
  if (sinks.length === 0 && config.push?.endpoint) {
    sinks.push(
      createSink({
        type: "webhook",
        url: config.push.endpoint,
        headers: config.push.headers,
        batchSize: config.push.batchSize,
        teamId: config.team?.teamId,
        developerId: config.team?.developerId,
      })
    );
  }

  if (sinks.length === 0) {
    console.error(
      "  No sinks configured. Use:\n" +
      "    jin init --team=<code>       Connect to team infra\n" +
      "    jin push --endpoint=URL      Ad-hoc webhook push\n" +
      "    jin team-config              Generate a team code"
    );
    store.close();
    process.exit(1);
  }

  console.log(`jin push — sending to ${sinks.length} sink(s)\n`);

  // Health check all sinks first
  for (const sink of sinks) {
    const health = await sink.healthCheck();
    if (health.ok) {
      console.log(`  [ok] ${sink.name} — connected`);
    } else {
      console.log(`  [!]  ${sink.name} — ${health.error}`);
    }
  }
  console.log("");

  // Gather unpushed sessions
  // For now, get all sessions (proper cursor tracking per-sink can come later)
  const batchSize = opts.batchSize || 50;
  const sessions = store.listSessions({ limit: batchSize });

  if (sessions.length === 0) {
    console.log("  No sessions to push. Run `jin watch` to ingest first.");
    store.close();
    return;
  }

  // Build payloads
  const payloads: PushPayload[] = sessions.map((session) => ({
    session,
    messages: store.getMessages(session.id),
  }));

  console.log(`  Pushing ${payloads.length} session(s)...\n`);

  // Push to all sinks
  for (const sink of sinks) {
    const result = await sink.push(payloads);
    console.log(
      `  ${sink.name}: ${result.pushed} pushed, ${result.failed} failed`
    );
    if (result.errors.length > 0) {
      for (const err of result.errors.slice(0, 5)) {
        console.log(`    Error: ${err}`);
      }
    }
    await sink.close();
  }

  console.log("\n  Done.");
  store.close();
}
