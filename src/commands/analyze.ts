import { loadConfig } from "../config";
import { Store } from "../store";

export async function analyzeCommand(opts: {
  adapter?: string;
  since?: string;
  json?: boolean;
}): Promise<void> {
  const config = await loadConfig();
  const store = new Store(config.store.dbPath);

  const byAdapter = store.analyzeByAdapter();
  const byModel = store.analyzeByModel();
  const totalSessions = store.sessionCount();
  const totalMessages = store.messageCount();

  const analysis = {
    summary: {
      totalSessions,
      totalMessages,
      totalTokens: Object.values(byAdapter).reduce((s, a) => s + a.tokens, 0),
      totalCost: Object.values(byAdapter).reduce((s, a) => s + a.cost, 0),
    },
    byAdapter,
    byModel,
  };

  if (opts.json !== false) {
    console.log(JSON.stringify(analysis, null, 2));
  } else {
    console.log("\n  === Jin Analysis ===\n");
    console.log(`  Total Sessions:  ${totalSessions}`);
    console.log(`  Total Messages:  ${totalMessages}`);
    console.log(`  Total Tokens:    ${analysis.summary.totalTokens.toLocaleString()}`);
    console.log(`  Total Cost:      $${analysis.summary.totalCost.toFixed(2)}`);

    console.log("\n  --- By Adapter ---\n");
    console.log(
      "  " +
        "Adapter".padEnd(16) +
        "Sessions".padEnd(10) +
        "Messages".padEnd(10) +
        "Tokens".padEnd(14) +
        "Cost"
    );
    console.log("  " + "-".repeat(60));
    for (const [id, data] of Object.entries(byAdapter)) {
      console.log(
        "  " +
          id.padEnd(16) +
          String(data.sessions).padEnd(10) +
          String(data.messages).padEnd(10) +
          data.tokens.toLocaleString().padEnd(14) +
          `$${data.cost.toFixed(2)}`
      );
    }

    console.log("\n  --- By Model ---\n");
    console.log(
      "  " +
        "Model".padEnd(36) +
        "Messages".padEnd(10) +
        "Input".padEnd(14) +
        "Output"
    );
    console.log("  " + "-".repeat(75));
    for (const [model, data] of Object.entries(byModel)) {
      console.log(
        "  " +
          model.slice(0, 34).padEnd(36) +
          String(data.messages).padEnd(10) +
          data.inputTokens.toLocaleString().padEnd(14) +
          data.outputTokens.toLocaleString()
      );
    }
  }

  store.close();
}
