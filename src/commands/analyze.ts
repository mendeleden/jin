import { openStoreAtPath } from "../db/store";
import {
  analyzeByAdapter,
  analyzeByModel,
  getOverviewSummary,
} from "../db/query-surface";
import { getRuntimePaths } from "../daemon/runtime-state";

export async function analyzeCommand(opts: {
  harness?: string;
  since?: string;
  json?: boolean;
}): Promise<void> {
  const store = openStoreAtPath(getRuntimePaths().storePath);

  try {
    const summary = getOverviewSummary(store.database);
    const adapterSummary = analyzeByAdapter(store.database);
    const modelSummary = analyzeByModel(store.database);

    const byHarness = Object.fromEntries(
      Object.entries(adapterSummary).map(([id, stats]) => [
        id,
        {
          sessions: stats.conversations,
          messages: stats.messages,
          tokens: stats.tokens,
          displayTokens: stats.displayTokens,
          cacheTokens: stats.cacheTokens,
          cost: stats.cost,
        },
      ]),
    );

    const analysis = {
      summary: {
        totalSessions: summary.conversations,
        totalMessages: summary.messages,
        totalTokens: summary.tokens,
        displayTokens: summary.displayTokens,
        cacheTokens: summary.cacheTokens,
        totalCost: summary.cost,
      },
      byHarness,
      byAdapter: byHarness,
      byModel: modelSummary,
    };

    if (opts.json) {
      console.log(JSON.stringify(analysis, null, 2));
      return;
    }

    console.log("\n  === Jin Analysis ===\n");
    console.log(`  Total Sessions:  ${analysis.summary.totalSessions}`);
    console.log(`  Total Messages:  ${analysis.summary.totalMessages}`);
    console.log(`  Total Tokens:    ${analysis.summary.totalTokens.toLocaleString()}`);
    console.log(`  Display Tokens:  ${analysis.summary.displayTokens.toLocaleString()}`);
    console.log(`  Cache Tokens:    ${analysis.summary.cacheTokens.toLocaleString()}`);
    console.log(`  Total Cost:      $${analysis.summary.totalCost.toFixed(2)}`);

    console.log("\n  --- By Harness ---\n");
    console.log(
      "  " +
        "Harness".padEnd(16) +
        "Sessions".padEnd(10) +
        "Messages".padEnd(10) +
        "Billed".padEnd(14) +
        "Display".padEnd(14) +
        "Cache".padEnd(14) +
        "Cost",
    );
    console.log("  " + "-".repeat(88));
    for (const [id, data] of Object.entries(analysis.byHarness)) {
      console.log(
        "  " +
          id.padEnd(16) +
          String(data.sessions).padEnd(10) +
          String(data.messages).padEnd(10) +
          data.tokens.toLocaleString().padEnd(14) +
          data.displayTokens.toLocaleString().padEnd(14) +
          data.cacheTokens.toLocaleString().padEnd(14) +
          `$${data.cost.toFixed(2)}`,
      );
    }

    console.log("\n  --- By Model ---\n");
    console.log(
      "  " +
        "Model".padEnd(36) +
        "Messages".padEnd(10) +
        "Input".padEnd(14) +
        "Output",
    );
    console.log("  " + "-".repeat(75));
    for (const [model, data] of Object.entries(analysis.byModel)) {
      console.log(
        "  " +
          model.slice(0, 34).padEnd(36) +
          String(data.messages).padEnd(10) +
          data.inputTokens.toLocaleString().padEnd(14) +
          data.outputTokens.toLocaleString(),
      );
    }
  } finally {
    store.close();
  }
}
