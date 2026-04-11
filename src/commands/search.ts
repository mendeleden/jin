import { configDir } from "../config";
import { getStore } from "../db/store";
import { parseSinceInput } from "../db/query-surface";

export async function searchCommand(query: string, opts: {
  adapter?: string;
  since?: string;
  local?: boolean;
  sink?: string;
  allSinks?: boolean;
  limit?: number;
  json?: boolean;
}): Promise<void> {
  const limit = opts.limit || 20;
  const since = opts.since ? parseSinceInput(opts.since) : undefined;
  const store = getStore(configDir());
  const results = store.searchMessages({
    query,
    adapterId: opts.adapter,
    since,
    limit,
  });

  if (opts.json) {
    console.log(JSON.stringify(results, null, 2));
    return;
  }

  if (results.length === 0) {
    console.log(`\n  0 results for "${query}"\n`);
    return;
  }

  console.log(`\n  ${results.length} result(s) for "${query}"\n`);
  formatResults(results);
}

function formatResults(results: Array<{
  conversationId: string;
  adapterId: string;
  timestamp: string;
  snippet: string;
  conversationName: string;
}>): void {
  const byConversation = new Map<string, typeof results[0]>();
  for (const r of results) {
    if (!byConversation.has(r.conversationId)) {
      byConversation.set(r.conversationId, r);
    }
  }

  let i = 1;
  for (const [, r] of byConversation) {
    const date = r.timestamp ? r.timestamp.slice(0, 10) : "";
    const header = `${r.adapterId}${date ? `, ${date}` : ""}`;

    const snippet = r.snippet
      .replace(/>>>/g, "\x1b[1m")
      .replace(/<<</g, "\x1b[0m")
      .replace(/\n/g, " ");

    console.log(`    ${i}. ${r.conversationId.slice(0, 8)} (${header})`);
    console.log(`       "${snippet}"`);
    if (r.conversationName) {
      console.log(`       Conversation: ${r.conversationName}`);
    }
    console.log();
    i++;
  }
}
