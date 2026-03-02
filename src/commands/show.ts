import { loadConfig } from "../config";
import { Store } from "../store";
import { resolveSinksForCwd, findSinkById, allPostgresSinks } from "../sink-resolver";
import { PostgresSearcher } from "../sinks/postgres-search";
import type { RemoteSession, RemoteMessage } from "../sinks/postgres-search";

export async function showCommand(
  sessionId: string,
  opts: { json?: boolean; markdown?: boolean; sink?: string; allSinks?: boolean }
): Promise<void> {
  const config = await loadConfig();
  const store = new Store(config.store.dbPath);

  // Try local first
  const session = store.getSession(sessionId);
  if (session) {
    return showLocalSession(session.id, store, opts);
  }

  // Try partial match locally
  const all = store.listSessions({ limit: 1000 });
  const match = all.find((s) => s.id.startsWith(sessionId));
  if (match) {
    return showLocalSession(match.id, store, opts);
  }

  store.close();

  // Not found locally — try Postgres sinks
  let sinks;
  if (opts.sink) {
    const resolved = findSinkById(opts.sink, config);
    sinks = resolved ? [resolved] : [];
  } else if (opts.allSinks) {
    sinks = allPostgresSinks(config);
  } else {
    sinks = resolveSinksForCwd(process.cwd(), config);
    // If no route match, try all sinks as fallback for show
    if (sinks.length === 0) {
      sinks = allPostgresSinks(config);
    }
  }

  for (const sink of sinks) {
    const searcher = new PostgresSearcher({
      connectionString: sink.sinkConfig.connectionString!,
      schema: sink.sinkConfig.schema,
      table: sink.sinkConfig.table,
    });

    try {
      const remoteSession = await searcher.getSession(sessionId);
      if (remoteSession) {
        const messages = await searcher.getMessages(remoteSession.id);
        await searcher.close();
        showRemoteSession(remoteSession, messages, sink.sinkName, opts);
        return;
      }
    } catch {
      // Try next sink
    } finally {
      await searcher.close();
    }
  }

  console.error(`Session not found: ${sessionId}`);
  if (sinks.length > 0) {
    console.error(`  Searched ${sinks.length} Postgres sink(s)`);
  } else {
    console.error(`  No Postgres sinks configured. Try: --sink=<id> or --all-sinks`);
  }
  process.exit(1);
}

function showLocalSession(
  sessionId: string,
  store: Store,
  opts: { json?: boolean; markdown?: boolean }
): void {
  const session = store.getSession(sessionId)!;
  const messages = store.getMessages(sessionId);

  if (opts.json) {
    console.log(JSON.stringify({ session, messages }, null, 2));
  } else {
    printSession({
      name: session.name,
      adapterName: session.adapterName,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      messageCount: session.messageCount,
      totalTokens: session.totalTokens,
      estCost: session.estCost,
    }, messages.map((m) => ({
      role: m.role,
      timestamp: m.timestamp,
      model: m.model,
      content: m.content,
      toolUses: m.toolUses,
      thinkingBlocks: m.thinkingBlocks,
    })));
  }

  store.close();
}

function showRemoteSession(
  session: RemoteSession,
  messages: RemoteMessage[],
  sinkName: string,
  opts: { json?: boolean; markdown?: boolean }
): void {
  if (opts.json) {
    console.log(JSON.stringify({ session, messages, sink: sinkName }, null, 2));
    return;
  }

  console.log(`\x1b[2m  (from ${sinkName})\x1b[0m\n`);
  printSession({
    name: session.name,
    adapterName: session.adapterName,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    messageCount: session.messageCount,
    totalTokens: session.totalTokens,
    estCost: session.estCost,
    developerId: session.developerId,
  }, messages.map((m) => ({
    role: m.role,
    timestamp: m.timestamp,
    model: m.model,
    content: m.content,
    toolUses: m.toolUses,
    thinkingBlocks: m.thinkingBlocks,
  })));
}

function printSession(
  session: {
    name: string;
    adapterName: string;
    createdAt: string;
    updatedAt: string;
    messageCount: number;
    totalTokens: number;
    estCost: number;
    developerId?: string;
  },
  messages: Array<{
    role: string;
    timestamp: string;
    model: string;
    content: string;
    toolUses: any[];
    thinkingBlocks: any[];
  }>
): void {
  console.log(`# Session: ${session.name}\n`);
  console.log(`**Adapter**: ${session.adapterName}`);
  if (session.developerId) {
    console.log(`**Developer**: ${session.developerId}`);
  }
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
}
