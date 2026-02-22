import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import type { Store } from "../../store";

interface SessionsProps {
  store: Store;
  onSelect: (id: string) => void;
}

export default function Sessions({ store, onSelect }: SessionsProps) {
  const sessions = store.listSessions({ limit: 50 });
  const [cursor, setCursor] = useState(0);
  const [filter, setFilter] = useState("");
  const [filtering, setFiltering] = useState(false);

  const filtered = filter
    ? sessions.filter(
        (s) =>
          s.name.toLowerCase().includes(filter.toLowerCase()) ||
          s.adapterName.toLowerCase().includes(filter.toLowerCase())
      )
    : sessions;

  useInput((input, key) => {
    if (filtering) {
      if (key.return) {
        setFiltering(false);
      } else if (key.backspace || key.delete) {
        setFilter((f) => f.slice(0, -1));
      } else if (input && !key.ctrl) {
        setFilter((f) => f + input);
      }
      return;
    }

    if (input === "/" ) {
      setFiltering(true);
      return;
    }
    if (input === "j" || key.downArrow) {
      setCursor((c) => Math.min(c + 1, filtered.length - 1));
    }
    if (input === "k" || key.upArrow) {
      setCursor((c) => Math.max(c - 1, 0));
    }
    if (key.return && filtered[cursor]) {
      onSelect(filtered[cursor].id);
    }
  });

  // Display window (show ~20 items around cursor)
  const windowSize = 20;
  const start = Math.max(0, cursor - Math.floor(windowSize / 2));
  const visible = filtered.slice(start, start + windowSize);

  return (
    <Box flexDirection="column">
      <Box gap={1}>
        <Text bold>Sessions</Text>
        <Text dimColor>({filtered.length})</Text>
        <Text dimColor>j/k=navigate Enter=select /=filter</Text>
      </Box>

      {filtering && (
        <Box marginTop={1}>
          <Text color="yellow">/ </Text>
          <Text>{filter}</Text>
          <Text dimColor>█</Text>
        </Box>
      )}

      <Box flexDirection="column" marginTop={1}>
        {/* Header */}
        <Box>
          <Text dimColor>{"  "}</Text>
          <Text dimColor>{"Date".padEnd(12)}</Text>
          <Text dimColor>{"Tool".padEnd(14)}</Text>
          <Text dimColor>{"Name".padEnd(40)}</Text>
          <Text dimColor>{"Msgs".padStart(6)}</Text>
          <Text dimColor>{"Tokens".padStart(10)}</Text>
          <Text dimColor>{"Cost".padStart(10)}</Text>
        </Box>

        {visible.map((s, i) => {
          const idx = start + i;
          const isCursor = idx === cursor;
          return (
            <Box key={s.id}>
              <Text color={isCursor ? "blue" : undefined} bold={isCursor}>
                {isCursor ? "▸ " : "  "}
              </Text>
              <Text color={isCursor ? "white" : "gray"}>
                {(s.updatedAt || "").slice(0, 10).padEnd(12)}
              </Text>
              <Text color="cyan">
                {s.adapterName.padEnd(14)}
              </Text>
              <Text color={isCursor ? "white" : undefined}>
                {(s.name || s.id.slice(0, 20)).slice(0, 38).padEnd(40)}
              </Text>
              <Text>{String(s.messageCount).padStart(6)}</Text>
              <Text dimColor>{formatNum(s.totalTokens).padStart(10)}</Text>
              <Text color="yellow">{`$${s.estCost.toFixed(2)}`.padStart(10)}</Text>
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}

function formatNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}
