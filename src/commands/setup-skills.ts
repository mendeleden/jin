// Register jin as a custom command/skill in supported coding tools.

import { existsSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const HOME = homedir();

const CLAUDE_SKILL = `---
name: jin
description: Query jin conversation data — sessions, costs, tool usage across all AI coding tools.
argument-hint: [command]
allowed-tools: Bash(jin *)
---

Run jin with the provided arguments and report the results.

Run \`jin help <command>\` to see all flags for any command.

Available commands:
- \`jin sessions\` — list recent sessions across all tools
- \`jin search "query"\` — search conversation content across team
- \`jin stats\` — token/cost breakdown by tool and model
- \`jin show <id>\` — show a session's messages
- \`jin status\` — daemon and ingestion status

\`\`\`bash
jin $ARGUMENTS
\`\`\`
`;

const GEMINI_COMMAND = `description = "Query jin conversation data — sessions, costs, tool usage across all AI coding tools."

prompt = """
Run jin with the user's arguments and report the results clearly.

Run \`jin help <command>\` for full options on any command.
Available commands: sessions, search "query", stats, show <id>, status

!{jin {{args}}}
"""
`;

const CODEX_AGENTS_SNIPPET = `## jin — conversation data pipeline

When the user asks about coding session history, token usage, costs, or conversation data:
- Run \`jin sessions\` to show recent sessions
- Run \`jin search "query"\` to search conversation content across team
- Run \`jin stats\` to show cost/token breakdown
- Run \`jin show <session-id>\` to show a specific session
- Run \`jin status\` to check daemon status
`;

interface SkillResult {
  tool: string;
  path: string;
  status: "installed" | "exists" | "skipped";
}

export async function setupSkillsCommand(): Promise<void> {
  const results: SkillResult[] = [];

  // Claude Code
  const claudeSkillDir = join(HOME, ".claude", "skills", "jin");
  const claudeSkillPath = join(claudeSkillDir, "SKILL.md");
  if (existsSync(join(HOME, ".claude"))) {
    if (existsSync(claudeSkillPath)) {
      results.push({ tool: "Claude Code", path: claudeSkillPath, status: "exists" });
    } else {
      mkdirSync(claudeSkillDir, { recursive: true });
      writeFileSync(claudeSkillPath, CLAUDE_SKILL);
      results.push({ tool: "Claude Code", path: claudeSkillPath, status: "installed" });
    }
  } else {
    results.push({ tool: "Claude Code", path: claudeSkillPath, status: "skipped" });
  }

  // Gemini CLI
  const geminiCmdDir = join(HOME, ".gemini", "commands");
  const geminiCmdPath = join(geminiCmdDir, "jin.toml");
  if (existsSync(join(HOME, ".gemini"))) {
    if (existsSync(geminiCmdPath)) {
      results.push({ tool: "Gemini CLI", path: geminiCmdPath, status: "exists" });
    } else {
      mkdirSync(geminiCmdDir, { recursive: true });
      writeFileSync(geminiCmdPath, GEMINI_COMMAND);
      results.push({ tool: "Gemini CLI", path: geminiCmdPath, status: "installed" });
    }
  } else {
    results.push({ tool: "Gemini CLI", path: geminiCmdPath, status: "skipped" });
  }

  // Codex — append to AGENTS.md if it exists, or create it
  const codexAgentsPath = join(HOME, ".codex", "AGENTS.md");
  if (existsSync(join(HOME, ".codex"))) {
    try {
      if (existsSync(codexAgentsPath)) {
        const existing = await Bun.file(codexAgentsPath).text();
        if (existing.includes("jin")) {
          results.push({ tool: "Codex", path: codexAgentsPath, status: "exists" });
        } else {
          writeFileSync(codexAgentsPath, existing + "\n" + CODEX_AGENTS_SNIPPET);
          results.push({ tool: "Codex", path: codexAgentsPath, status: "installed" });
        }
      } else {
        writeFileSync(codexAgentsPath, CODEX_AGENTS_SNIPPET);
        results.push({ tool: "Codex", path: codexAgentsPath, status: "installed" });
      }
    } catch {
      results.push({ tool: "Codex", path: codexAgentsPath, status: "skipped" });
    }
  } else {
    results.push({ tool: "Codex", path: codexAgentsPath, status: "skipped" });
  }

  // Output
  console.log("");
  for (const r of results) {
    const icon = r.status === "installed" ? "\x1b[32m+\x1b[0m"
      : r.status === "exists" ? "\x1b[33m~\x1b[0m"
      : "\x1b[2m-\x1b[0m";
    const label = r.status === "installed" ? "installed"
      : r.status === "exists" ? "already exists"
      : "not detected";
    console.log(`  ${icon} ${r.tool}  \x1b[2m${label}\x1b[0m`);
  }

  const installed = results.filter(r => r.status === "installed");
  if (installed.length > 0) {
    console.log(`\n  Use \x1b[1m/jin\x1b[0m in Claude Code or Gemini CLI to query your session data.`);
  }
  console.log("");
}
