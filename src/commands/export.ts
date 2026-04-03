import { configDir } from "../config";
import { getStore } from "../db/store";
import { listConversations, parseSinceInput } from "../db/query-surface";
import type { Conversation, Message } from "../contracts/conversations";
import { mkdirSync, existsSync } from "fs";
import { join } from "path";

export async function exportCommand(opts: {
  format?: "json" | "markdown";
  output?: string;
  adapter?: string;
  since?: string;
  limit?: number;
}): Promise<void> {
  const store = getStore(configDir());

  const format = opts.format || "json";
  const outputDir = opts.output || join(process.cwd(), "jin-export");

  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  let since: string | undefined;
  if (opts.since) {
    since = parseSinceInput(opts.since);
  }

  const conversations = listConversations(store.database, {
    adapterId: opts.adapter,
    since,
    limit: opts.limit || 500,
  });

  console.log(`jin export — ${conversations.length} conversation(s) to ${outputDir}\n`);

  for (const conversation of conversations) {
    const messages = store.getMessages(conversation.id);
    const safeName = conversation.name
      .replace(/[^a-zA-Z0-9-_]/g, "-")
      .replace(/-+/g, "-")
      .slice(0, 50);
    const dateStr = (conversation.endedAt || conversation.startedAt).slice(0, 10);
    const fileStem = `${dateStr}-${safeName || "conversation"}-${conversation.id.slice(0, 8)}`;

    if (format === "markdown") {
      const md = conversationToMarkdown(conversation, messages);
      const filename = `${fileStem}.md`;
      await Bun.write(join(outputDir, filename), md);
      console.log(`  [+] ${filename}`);
    } else {
      const data = { conversation, messages };
      const filename = `${fileStem}.json`;
      await Bun.write(join(outputDir, filename), JSON.stringify(data, null, 2));
      console.log(`  [+] ${filename}`);
    }
  }

  console.log(`\n  Exported ${conversations.length} conversation(s) to ${outputDir}`);
}

function conversationToMarkdown(
  conversation: Conversation,
  messages: Message[],
): string {
  const lines: string[] = [];
  lines.push(`# Conversation: ${conversation.name}\n`);
  lines.push(`**Adapter**: ${conversation.adapterId}`);
  lines.push(`**Started**: ${conversation.startedAt.slice(0, 19)}`);
  lines.push(`**Ended**: ${conversation.endedAt.slice(0, 19)}`);
  lines.push(`**Relationship**: ${conversation.relationship}`);
  lines.push(`**Messages**: ${conversation.messageCount}`);
  lines.push(`**Tokens**: ${conversation.inputTokens + conversation.outputTokens}`);
  lines.push(`**Est. Cost**: $${conversation.estCost.toFixed(4)}`);
  lines.push(`\n---\n`);

  for (const msg of messages) {
    const time = msg.timestamp ? msg.timestamp.slice(11, 19) : "";
    if (msg.role === "user") {
      lines.push(`## User (${time})\n`);
    } else {
      lines.push(`## Assistant (${time})${msg.model ? ` — ${msg.model}` : ""}\n`);
    }

    if (msg.thinkingContent) {
      lines.push(`<details>`);
      lines.push(`<summary>Thinking (${msg.thinkingTokens} tokens)</summary>\n`);
      lines.push(msg.thinkingContent);
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
