import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import type { Store } from "../../store";
import MessageView from "../components/MessageView";

interface DetailProps {
  store: Store;
  sessionId: string | null;
}

export default function Detail({ store, sessionId }: DetailProps) {
  const [scroll, setScroll] = useState(0);

  useInput((input, key) => {
    if (input === "j" || key.downArrow) {
      setScroll((s) => s + 1);
    }
    if (input === "k" || key.upArrow) {
      setScroll((s) => Math.max(0, s - 1));
    }
  });

  if (!sessionId) {
    return (
      <Box>
        <Text dimColor>No session selected. Press 2 to browse sessions.</Text>
      </Box>
    );
  }

  const session = store.getSession(sessionId);
  if (!session) {
    return (
      <Box>
        <Text color="red">Session not found: {sessionId}</Text>
      </Box>
    );
  }

  const messages = store.getMessages(sessionId);
  const tags = store.getSessionTags(sessionId);

  // Paginate messages
  const pageSize = 10;
  const visible = messages.slice(scroll, scroll + pageSize);

  return (
    <Box flexDirection="column">
      {/* Session header */}
      <Box flexDirection="column">
        <Text bold>{session.name || session.id.slice(0, 30)}</Text>
        <Box gap={1}>
          <Text color="cyan">{session.adapterName}</Text>
          <Text dimColor>│</Text>
          <Text>{session.messageCount} messages</Text>
          <Text dimColor>│</Text>
          <Text>{formatNum(session.totalTokens)} tokens</Text>
          <Text dimColor>│</Text>
          <Text color="yellow">${session.estCost.toFixed(2)}</Text>
          {tags.length > 0 && (
            <>
              <Text dimColor>│</Text>
              <Text color="magenta">{tags.map((t) => t.name).join(", ")}</Text>
            </>
          )}
        </Box>
      </Box>

      {/* Messages */}
      <Box flexDirection="column" marginTop={1}>
        <Text dimColor>
          Messages {scroll + 1}-{Math.min(scroll + pageSize, messages.length)} of {messages.length} (j/k=scroll, Esc=back)
        </Text>
        {visible.map((msg) => (
          <MessageView key={msg.id} message={msg} />
        ))}
      </Box>
    </Box>
  );
}

function formatNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}
