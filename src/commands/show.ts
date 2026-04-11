import { configDir } from "../config";
import {
  buildConversationTree,
  findConversationMatches,
  getTraceConversations,
  type ConversationTreeNode,
} from "../db/query-surface";
import { getStore } from "../db/store";
import type { Conversation, Message } from "../contracts/conversations";

export async function showCommand(
  conversationId: string,
  opts: {
    json?: boolean;
    markdown?: boolean;
    trace?: boolean;
    tree?: boolean;
    sink?: string;
    allSinks?: boolean;
  },
): Promise<void> {
  const store = getStore(configDir());
  const matches = findConversationMatches(store.database, conversationId, 10);
  const exactMatch = matches.find((match) => match.id === conversationId) ?? null;
  const conversation = exactMatch ?? (matches.length === 1 ? matches[0] : null);

  if (!conversation) {
    if (matches.length > 1) {
      console.error(`Conversation id is ambiguous: ${conversationId}`);
      console.error("  Matches:");
      for (const match of matches) {
        console.error(`  - ${match.id} (${match.adapterId}) ${match.name}`);
      }
    } else {
      console.error(`Conversation not found: ${conversationId}`);
    }
    process.exit(1);
  }

  if (opts.tree) {
    return showConversationTree(store, conversation, opts);
  }

  if (opts.trace) {
    return showConversationTrace(store, conversation, opts);
  }

  const messages = store.getMessages(conversation.id);
  if (opts.json) {
    console.log(JSON.stringify({
      view: "conversation",
      conversation,
      messages,
    }, null, 2));
    return;
  }

  printConversation(conversation, messages);
}

function showConversationTrace(
  store: ReturnType<typeof getStore>,
  conversation: Conversation,
  opts: { json?: boolean; markdown?: boolean },
): void {
  const conversations = getTraceConversations(store.database, conversation.traceId);
  const tree = buildConversationTree(conversations);

  if (opts.json) {
    console.log(JSON.stringify({
      view: "trace",
      traceId: conversation.traceId,
      rootId: tree?.conversation.id ?? conversation.traceId,
      conversations: conversations.map((entry) => ({
        conversation: entry,
        messages: store.getMessages(entry.id),
      })),
      tree,
    }, null, 2));
    return;
  }

  console.log(`# Trace: ${conversation.traceId}\n`);
  if (!tree) {
    printConversation(conversation, store.getMessages(conversation.id));
    return;
  }

  renderTraceNode(store, tree, 0, new Set<string>());
}

function showConversationTree(
  store: ReturnType<typeof getStore>,
  conversation: Conversation,
  opts: { json?: boolean; markdown?: boolean },
): void {
  const conversations = getTraceConversations(store.database, conversation.traceId);
  const tree = buildConversationTree(conversations);

  if (opts.json) {
    console.log(JSON.stringify({
      view: "tree",
      traceId: conversation.traceId,
      tree,
    }, null, 2));
    return;
  }

  console.log(`# Conversation Tree: ${conversation.traceId}\n`);
  if (!tree) {
    console.log("(empty)");
    return;
  }

  printTreeRoot(tree);
}

function printConversation(
  conversation: Conversation,
  messages: Message[],
): void {
  console.log(`# Conversation: ${conversation.name}\n`);
  console.log(`**ID**: ${conversation.id}`);
  console.log(`**Trace**: ${conversation.traceId}`);
  console.log(`**Relationship**: ${conversation.relationship}`);
  if (conversation.parentId) {
    console.log(`**Parent**: ${conversation.parentId}`);
  }
  console.log(`**Adapter**: ${conversation.adapterId}`);
  console.log(`**Started**: ${conversation.startedAt}`);
  console.log(`**Ended**: ${conversation.endedAt}`);
  console.log(`**Messages**: ${conversation.messageCount}`);
  console.log(`**Tools**: ${conversation.toolCount}`);
  console.log(`**Tokens**: ${conversation.inputTokens + conversation.outputTokens}`);
  console.log(`**Est. Cost**: $${conversation.estCost.toFixed(4)}`);
  console.log(`\n---\n`);

  for (const msg of messages) {
    const time = msg.timestamp ? msg.timestamp.slice(11, 19) : "";
    const header =
      msg.role === "user"
        ? `## User (${time})`
        : `## Assistant (${time})${msg.model ? ` — ${msg.model}` : ""}`;

    console.log(`${header}\n`);

    if (msg.thinkingContent) {
      console.log(`<details>\n<summary>Thinking (${msg.thinkingTokens} tokens)</summary>\n`);
      console.log(msg.thinkingContent);
      console.log(`\n</details>\n`);
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

function renderTraceNode(
  store: ReturnType<typeof getStore>,
  node: ConversationTreeNode,
  depth: number,
  renderedCompactions: Set<string>,
): void {
  const indent = "  ".repeat(depth);
  if (renderedCompactions.has(node.conversation.id)) {
    return;
  }

  renderedCompactions.add(node.conversation.id);

  const compactedChildren = node.children.filter(
    (child) => child.conversation.relationship === "compacted",
  );
  const spawnedChildren = node.children.filter(
    (child) => child.conversation.relationship !== "compacted",
  );
  const messages = store.getMessages(node.conversation.id);

  console.log(`${indent}## ${node.conversation.name || node.conversation.id}`);
  console.log(`${indent}- id: ${node.conversation.id}`);
  console.log(`${indent}- relationship: ${node.conversation.relationship}`);
  if (node.conversation.parentId) {
    console.log(`${indent}- parent: ${node.conversation.parentId}`);
  }
  console.log("");

  const emittedChildren = new Set<string>();
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    printIndentedMessage(indent, message);

    const currentTurn = message.turn;
    const nextTurn = messages[index + 1]?.turn;
    if (nextTurn !== currentTurn) {
      for (const child of spawnedChildren) {
        if (emittedChildren.has(child.conversation.id)) {
          continue;
        }

        if (child.conversation.forkPoint === currentTurn) {
          console.log(`${indent}> Spawned at turn ${currentTurn}`);
          renderTraceNode(store, child, depth + 1, renderedCompactions);
          emittedChildren.add(child.conversation.id);
        }
      }
    }
  }

  for (const child of spawnedChildren) {
    if (emittedChildren.has(child.conversation.id)) {
      continue;
    }

    console.log(
      `${indent}> ${child.conversation.relationship} conversation` +
        (child.conversation.forkPoint >= 0
          ? ` (turn ${child.conversation.forkPoint})`
          : ""),
    );
    renderTraceNode(store, child, depth + 1, renderedCompactions);
  }

  for (const compactedChild of compactedChildren) {
    console.log(`${indent}--- compacted continuation ---\n`);
    renderTraceNode(store, compactedChild, depth, renderedCompactions);
  }
}

function printIndentedMessage(indent: string, message: Message): void {
  const time = message.timestamp ? message.timestamp.slice(11, 19) : "";
  const roleLabel =
    message.role === "user"
      ? "User"
      : message.role === "assistant"
        ? "Assistant"
        : "System";

  console.log(
    `${indent}${roleLabel} (${time})` +
      (message.model ? ` — ${message.model}` : ""),
  );
  if (message.thinkingContent) {
    console.log(
      `${indent}  [thinking: ${message.thinkingTokens} tokens]`,
    );
  }
  console.log(`${indent}  ${message.content}`);
  if (message.toolUses.length > 0) {
    console.log(
      `${indent}  tools: ${message.toolUses.map((tool) => tool.name).join(", ")}`,
    );
  }
  console.log("");
}

function printTreeRoot(node: ConversationTreeNode): void {
  const forkSuffix =
    node.conversation.forkPoint >= 0
      ? ` @ turn ${node.conversation.forkPoint}`
      : "";
  console.log(
    `${node.conversation.id} ` +
      `[${node.conversation.relationship}${forkSuffix}] ${node.conversation.name}`,
  );

  node.children.forEach((child, index) => {
    printTreeNode(child, "", index === node.children.length - 1);
  });
}

function printTreeNode(
  node: ConversationTreeNode,
  prefix: string,
  isLast: boolean,
): void {
  const connector = isLast ? "\\- " : "|- ";
  const forkSuffix =
    node.conversation.forkPoint >= 0
      ? ` @ turn ${node.conversation.forkPoint}`
      : "";
  console.log(
    `${prefix}${connector}${node.conversation.id} ` +
      `[${node.conversation.relationship}${forkSuffix}] ${node.conversation.name}`,
  );

  const childPrefix = prefix + (isLast ? "   " : "|  ");
  node.children.forEach((child, index) => {
    printTreeNode(child, childPrefix, index === node.children.length - 1);
  });
}
