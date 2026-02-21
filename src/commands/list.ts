import { loadConfig } from "../config";
import { Store } from "../store";

export async function listCommand(opts: {
  adapter?: string;
  since?: string;
  limit?: number;
  json?: boolean;
}): Promise<void> {
  const config = await loadConfig();
  const store = new Store(config.store.dbPath);

  let since: string | undefined;
  if (opts.since) {
    since = parseSince(opts.since);
  }

  const sessions = store.listSessions({
    adapterId: opts.adapter,
    since,
    limit: opts.limit || 50,
  });

  if (opts.json !== false) {
    // Default to JSON output
    console.log(JSON.stringify(sessions, null, 2));
  } else {
    // Table format
    console.log(`\n  ${sessions.length} session(s)\n`);
    console.log(
      "  " +
        "ID".padEnd(12) +
        "Adapter".padEnd(14) +
        "Messages".padEnd(10) +
        "Tokens".padEnd(10) +
        "Cost".padEnd(8) +
        "Updated".padEnd(22) +
        "Name"
    );
    console.log("  " + "-".repeat(100));
    for (const s of sessions) {
      console.log(
        "  " +
          s.id.slice(0, 10).padEnd(12) +
          s.adapterId.padEnd(14) +
          String(s.messageCount).padEnd(10) +
          String(s.totalTokens).padEnd(10) +
          `$${s.estCost.toFixed(2)}`.padEnd(8) +
          s.updatedAt.slice(0, 19).padEnd(22) +
          s.name.slice(0, 50)
      );
    }
  }

  store.close();
}

function parseSince(input: string): string {
  const match = input.match(/^(\d+)(h|d|m|w)$/);
  if (!match) return input; // Assume ISO date

  const [, num, unit] = match;
  const ms = {
    h: 3600_000,
    d: 86400_000,
    m: 60_000,
    w: 604800_000,
  }[unit]!;

  return new Date(Date.now() - parseInt(num) * ms).toISOString();
}
