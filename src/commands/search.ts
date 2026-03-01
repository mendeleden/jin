import { loadConfig } from "../config";
import { Store } from "../store";
import { resolveSinksForCwd, findSinkById, allPostgresSinks } from "../sink-resolver";
import { PostgresSearcher } from "../sinks/postgres-search";
import type { PostgresSearchResult } from "../sinks/postgres-search";

export async function searchCommand(query: string, opts: {
  adapter?: string;
  since?: string;
  local?: boolean;
  sink?: string;
  allSinks?: boolean;
  limit?: number;
  json?: boolean;
}): Promise<void> {
  const config = await loadConfig();
  const limit = opts.limit || 20;
  const since = opts.since ? parseSince(opts.since) : undefined;

  // ── Local mode: SQLite FTS5 ───────────────────────────────────────────
  if (opts.local) {
    const store = new Store(config.store.dbPath);
    const results = store.searchMessages({
      query,
      adapterId: opts.adapter,
      since,
      limit,
    });
    store.close();

    if (opts.json) {
      console.log(JSON.stringify(results, null, 2));
      return;
    }

    if (results.length === 0) {
      console.log(`\n  0 results for "${query}" (local)\n`);
      return;
    }

    console.log(`\n  ${results.length} result(s) for "${query}" (local)\n`);
    formatResults(results);
    return;
  }

  // ── Remote mode: Postgres FTS ─────────────────────────────────────────
  let sinks;
  if (opts.sink) {
    const resolved = findSinkById(opts.sink, config);
    if (!resolved) {
      console.error(`  No Postgres sink found with id "${opts.sink}"`);
      console.error(`  Available sinks: ${config.sinks.filter(s => s.type === "postgres").map(s => s.id || s.name || "postgres").join(", ") || "(none)"}`);
      process.exit(1);
    }
    sinks = [resolved];
  } else if (opts.allSinks) {
    sinks = allPostgresSinks(config);
  } else {
    sinks = resolveSinksForCwd(process.cwd(), config);
  }

  if (sinks.length === 0) {
    console.error("  No Postgres sinks found for current project.");
    console.error("  Try: --sink=<id>, --all-sinks, or --local");
    process.exit(1);
  }

  let allResults: (PostgresSearchResult & { sinkName: string })[] = [];

  for (const sink of sinks) {
    const searcher = new PostgresSearcher({
      connectionString: sink.sinkConfig.connectionString!,
      schema: sink.sinkConfig.schema,
      table: sink.sinkConfig.table,
    });

    try {
      await searcher.ensureSearchSchema();
      await searcher.backfillTsvector();
      const results = await searcher.search({
        query,
        adapterId: opts.adapter,
        since,
        limit,
      });
      for (const r of results) {
        allResults.push({ ...r, sinkName: sink.sinkName });
      }
    } catch (err) {
      console.error(`  Error searching ${sink.sinkName}: ${err}`);
    } finally {
      await searcher.close();
    }
  }

  // Sort by rank descending, take top N
  allResults.sort((a, b) => b.rank - a.rank);
  allResults = allResults.slice(0, limit);

  if (opts.json) {
    console.log(JSON.stringify(allResults, null, 2));
    return;
  }

  const sinkLabel = sinks.length === 1 ? sinks[0].sinkName : `${sinks.length} sinks`;
  if (allResults.length === 0) {
    console.log(`\n  0 results for "${query}" in ${sinkLabel}\n`);
    return;
  }

  console.log(`\n  ${allResults.length} result(s) for "${query}" in ${sinkLabel}\n`);
  formatResults(allResults);
}

function formatResults(results: Array<{
  sessionId: string;
  adapterId: string;
  developerId?: string;
  createdAt: string;
  snippet: string;
  sessionName: string;
}>): void {
  // Group by session, show best snippet per session
  const bySession = new Map<string, typeof results[0]>();
  for (const r of results) {
    if (!bySession.has(r.sessionId)) {
      bySession.set(r.sessionId, r);
    }
  }

  let i = 1;
  for (const [, r] of bySession) {
    const dateStr = r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt || "");
    const date = dateStr ? dateStr.slice(0, 10) : "";
    const dev = r.developerId ? `, ${r.developerId}` : "";
    const header = `${r.adapterId}${dev}${date ? `, ${date}` : ""}`;

    // Replace >>> / <<< markers with ANSI bold
    const snippet = r.snippet
      .replace(/>>>/g, "\x1b[1m")
      .replace(/<<</g, "\x1b[0m")
      .replace(/\n/g, " ");

    console.log(`    ${i}. ${r.sessionId.slice(0, 8)} (${header})`);
    console.log(`       "${snippet}"`);
    if (r.sessionName) {
      console.log(`       Session: ${r.sessionName}`);
    }
    console.log();
    i++;
  }
}

function parseSince(input: string): string {
  const match = input.match(/^(\d+)(h|d|m|w)$/);
  if (!match) return input;
  const [, num, unit] = match;
  const ms = { h: 3600_000, d: 86400_000, m: 60_000, w: 604800_000 }[unit]!;
  return new Date(Date.now() - parseInt(num) * ms).toISOString();
}
