import { loadConfig } from "../config";
import { Store } from "../store";

export async function showCommand(
  sessionId: string,
  opts: { json?: boolean; markdown?: boolean }
): Promise<void> {
  const config = await loadConfig();
  const store = new Store(config.store.dbPath);

  const session = store.getSession(sessionId);
  if (!session) {
    // Try partial match
    const all = store.listSessions({ limit: 1000 });
    const match = all.find((s) => s.id.startsWith(sessionId));
    if (!match) {
      console.error(`Session not found: ${sessionId}`);
      store.close();
      process.exit(1);
    }
    return showSession(match.id, store, opts);
  }

  return showSession(sessionId, store, opts);
}

function showSession(
  sessionId: string,
  store: Store,
  opts: { json?: boolean; markdown?: boolean }
): void {
  const session = store.getSession(sessionId)!;
  const messages = store.getMessages(sessionId);

  if (opts.markdown) {
    // Markdown output
    console.log(`# Session: ${session.name}\n`);
    console.log(`**Adapter**: ${session.adapterName}`);
    console.log(`**Created**: ${session.createdAt}`);
    console.log(`**Updated**: ${session.updatedAt}`);
    console.log(`**Messages**: ${session.messageCount}`);
    console.log(`**Tokens**: ${session.totalTokens}`);
    console.log(`**Est. Cost**: $${session.estCost.toFixed(4)}`);
    console.log(`\n---\n`);

    for (const msg of messages) {
      const time = msg.timestamp ? msg.timestamp.slice(11, 19) : "";
      const header =
        msg.role === "user"
          ? `## User (${time})`
          : `## Assistant (${time})${msg.model ? ` — ${msg.model}` : ""}`;

      console.log(`${header}\n`);

      if (msg.thinkingBlocks.length > 0) {
        for (const tb of msg.thinkingBlocks) {
          console.log(`<details>\n<summary>Thinking (${tb.tokenCount} tokens)</summary>\n`);
          console.log(tb.content);
          console.log(`\n</details>\n`);
        }
      }

      console.log(msg.content);

      if (msg.toolUses.length > 0) {
        console.log(`\n**Tools used:**`);
        for (const tu of msg.toolUses) {
          console.log(`- \`${tu.name}\``);
        }
      }

      console.log(`\n---\n`);
    }
  } else {
    // JSON output (default)
    console.log(
      JSON.stringify(
        {
          session,
          messages,
        },
        null,
        2
      )
    );
  }

  store.close();
}
