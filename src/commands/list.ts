import { configDir } from "../config";
import { getStore } from "../db/store";
import { listConversations, parseSinceInput } from "../db/query-surface";

export async function listCommand(opts: {
  adapter?: string;
  since?: string;
  limit?: number;
  json?: boolean;
}): Promise<void> {
  const store = getStore(configDir());

  let since: string | undefined;
  if (opts.since) {
    since = parseSinceInput(opts.since);
  }

  const conversations = listConversations(store.database, {
    adapterId: opts.adapter,
    since,
    limit: opts.limit || 50,
  });

  if (opts.json) {
    console.log(JSON.stringify(conversations, null, 2));
  } else {
    console.log(`\n  ${conversations.length} conversation(s)\n`);
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
    for (const conversation of conversations) {
      console.log(
        "  " +
          conversation.id.slice(0, 10).padEnd(12) +
          conversation.adapterId.padEnd(14) +
          String(conversation.messageCount).padEnd(10) +
          String(conversation.inputTokens + conversation.outputTokens).padEnd(10) +
          `$${conversation.estCost.toFixed(2)}`.padEnd(8) +
          conversation.endedAt.slice(0, 19).padEnd(22) +
          conversation.name.slice(0, 50)
      );
    }
  }
}
