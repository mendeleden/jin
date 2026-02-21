import { loadConfig } from "../config";
import { Store } from "../store";
import { mkdirSync, existsSync } from "fs";
import { join } from "path";

export async function exportCommand(opts: {
  format?: "json" | "markdown";
  output?: string;
  adapter?: string;
  since?: string;
  limit?: number;
}): Promise<void> {
  const config = await loadConfig();
  const store = new Store(config.store.dbPath);

  const format = opts.format || "json";
  const outputDir = opts.output || join(process.cwd(), "jin-export");

  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  let since: string | undefined;
  if (opts.since) {
    const match = opts.since.match(/^(\d+)(h|d|m|w)$/);
    if (match) {
      const ms = { h: 3600_000, d: 86400_000, m: 60_000, w: 604800_000 }[match[2]]!;
      since = new Date(Date.now() - parseInt(match[1]) * ms).toISOString();
    } else {
      since = opts.since;
    }
  }

  const sessions = store.listSessions({
    adapterId: opts.adapter,
    since,
    limit: opts.limit || 500,
  });

  console.log(`jin export — ${sessions.length} session(s) to ${outputDir}\n`);

  for (const session of sessions) {
    const messages = store.getMessages(session.id);
    const safeName = session.name
      .replace(/[^a-zA-Z0-9-_]/g, "-")
      .replace(/-+/g, "-")
      .slice(0, 50);
    const dateStr = session.updatedAt.slice(0, 10);

    if (format === "markdown") {
      const md = sessionToMarkdown(session, messages);
      const filename = `${safeName}-${dateStr}.md`;
      await Bun.write(join(outputDir, filename), md);
      console.log(`  [+] ${filename}`);
    } else {
      const data = { session, messages };
      const filename = `${safeName}-${dateStr}.json`;
      await Bun.write(join(outputDir, filename), JSON.stringify(data, null, 2));
      console.log(`  [+] ${filename}`);
    }
  }

  console.log(`\n  Exported ${sessions.length} session(s) to ${outputDir}`);
  store.close();
}

function sessionToMarkdown(
  session: { name: string; adapterName: string; createdAt: string; updatedAt: string; totalTokens: number; estCost: number; messageCount: number },
  messages: { role: string; content: string; timestamp: string; model: string; toolUses: { name: string }[]; thinkingBlocks: { content: string; tokenCount: number }[] }[]
): string {
  const lines: string[] = [];
  lines.push(`# Session: ${session.name}\n`);
  lines.push(`**Adapter**: ${session.adapterName}`);
  lines.push(`**Date**: ${session.createdAt.slice(0, 19)}`);
  lines.push(`**Duration**: ${session.updatedAt.slice(0, 19)}`);
  lines.push(`**Messages**: ${session.messageCount}`);
  lines.push(`**Tokens**: ${session.totalTokens}`);
  lines.push(`**Est. Cost**: $${session.estCost.toFixed(4)}`);
  lines.push(`\n---\n`);

  for (const msg of messages) {
    const time = msg.timestamp ? msg.timestamp.slice(11, 19) : "";
    if (msg.role === "user") {
      lines.push(`## User (${time})\n`);
    } else {
      lines.push(`## Assistant (${time})${msg.model ? ` — ${msg.model}` : ""}\n`);
    }

    for (const tb of msg.thinkingBlocks) {
      lines.push(`<details>`);
      lines.push(`<summary>Thinking (${tb.tokenCount} tokens)</summary>\n`);
      lines.push(tb.content);
      lines.push(`\n</details>\n`);
    }

    lines.push(msg.content);

    if (msg.toolUses.length > 0) {
      lines.push(`\n**Tools used:**`);
      for (const tu of msg.toolUses) {
        lines.push(`- \`${tu.name}\``);
      }
    }

    lines.push(`\n---\n`);
  }

  return lines.join("\n");
}
