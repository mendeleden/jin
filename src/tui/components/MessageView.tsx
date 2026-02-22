import React from "react";
import { Box, Text } from "ink";
import type { Message } from "../../adapters/types";

interface MessageViewProps {
  message: Message;
}

export default function MessageView({ message: msg }: MessageViewProps) {
  const roleColor =
    msg.role === "user" ? "blue" : msg.role === "assistant" ? "green" : "gray";

  // Truncate content for terminal display
  const maxLen = 300;
  const content = msg.content.length > maxLen
    ? msg.content.slice(0, maxLen) + "…"
    : msg.content;

  return (
    <Box flexDirection="column" marginTop={1}>
      <Box gap={1}>
        <Text color={roleColor} bold>[{msg.role}]</Text>
        {msg.model && <Text dimColor>{msg.model}</Text>}
        {(msg.inputTokens > 0 || msg.outputTokens > 0) && (
          <Text dimColor>
            ({formatNum(msg.inputTokens)}→{formatNum(msg.outputTokens)})
          </Text>
        )}
      </Box>

      {/* Thinking blocks */}
      {msg.thinkingBlocks.length > 0 && (
        <Text color="magenta" dimColor>
          [thinking: {msg.thinkingBlocks.reduce((a, b) => a + b.tokenCount, 0)} tokens]
        </Text>
      )}

      {/* Content */}
      {content && <Text wrap="wrap">{content}</Text>}

      {/* Tool uses */}
      {msg.toolUses.length > 0 && (
        <Box flexDirection="column">
          {msg.toolUses.slice(0, 5).map((tu) => (
            <Text key={tu.id} color="yellow" dimColor>
              ⚡ {tu.name}
            </Text>
          ))}
          {msg.toolUses.length > 5 && (
            <Text dimColor>  ... +{msg.toolUses.length - 5} more tools</Text>
          )}
        </Box>
      )}
    </Box>
  );
}

function formatNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}
