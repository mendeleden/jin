import React from "react";
import { Box, Text } from "ink";
import type { Store } from "../../store";
import StatBox from "../components/StatBox";

export default function Overview({ store }: { store: Store }) {
  const sessions = store.sessionCount();
  const messages = store.messageCount();
  const artifacts = store.artifactCount();
  const byAdapter = store.analyzeByAdapter();

  let totalTokens = 0;
  let totalCost = 0;
  for (const stats of Object.values(byAdapter)) {
    totalTokens += stats.tokens;
    totalCost += stats.cost;
  }

  const projects = store.listProjects().length;
  const recent = store.listSessions({ limit: 5 });

  return (
    <Box flexDirection="column">
      <Text bold>Overview</Text>
      <Box marginTop={1} gap={2}>
        <StatBox label="Sessions" value={sessions} />
        <StatBox label="Messages" value={messages} />
        <StatBox label="Tokens" value={formatNum(totalTokens)} />
        <StatBox label="Cost" value={`$${totalCost.toFixed(2)}`} />
        <StatBox label="Projects" value={projects} />
        <StatBox label="Artifacts" value={artifacts} />
      </Box>

      {/* Adapter breakdown */}
      <Box flexDirection="column" marginTop={1}>
        <Text bold dimColor>By Tool</Text>
        {Object.entries(byAdapter).map(([adapter, stats]) => (
          <Box key={adapter} gap={1}>
            <Text color="cyan">{adapter.padEnd(14)}</Text>
            <Text>{String(stats.sessions).padStart(5)} sessions</Text>
            <Text dimColor>{formatNum(stats.tokens).padStart(8)} tokens</Text>
            <Text color="yellow">${stats.cost.toFixed(2).padStart(8)}</Text>
          </Box>
        ))}
      </Box>

      {/* Recent sessions */}
      <Box flexDirection="column" marginTop={1}>
        <Text bold dimColor>Recent Sessions</Text>
        {recent.map((s) => (
          <Box key={s.id} gap={1}>
            <Text dimColor>{(s.updatedAt || "").slice(0, 10)}</Text>
            <Text color="blue">{s.adapterName.padEnd(12)}</Text>
            <Text>{(s.name || s.id.slice(0, 20)).slice(0, 50)}</Text>
            <Text dimColor>{formatNum(s.totalTokens)} tok</Text>
          </Box>
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
