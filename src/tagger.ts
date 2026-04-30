// Auto-tagger: derives projects, tags, and tool usage stats from session data.
// Runs after each ingest cycle to enrich the store with grouping metadata.

import { createHash } from "crypto";
import { execSync } from "child_process";
import type { Store } from "./store";
import type { Session, Message } from "./adapters/types";

/** Extract a project ID from a working directory path */
function projectIdFromCwd(cwd: string): string {
  // Normalize: strip trailing slashes, resolve home
  const normalized = cwd.replace(/\/+$/, "");
  return createHash("sha256").update(normalized).digest("hex").slice(0, 12);
}

/** Extract a human-friendly project name from a cwd */
function projectNameFromCwd(cwd: string): string {
  const parts = cwd.replace(/\/+$/, "").split("/");
  // Use the last directory component
  return parts[parts.length - 1] || cwd;
}

/** Detect git remote origin URL from a directory (returns undefined if not a git repo) */
function gitRemoteFromCwd(cwd: string): string | undefined {
  try {
    return execSync("git remote get-url origin", { cwd, timeout: 3000, stdio: ["pipe", "pipe", "pipe"], windowsHide: true })
      .toString()
      .trim() || undefined;
  } catch {
    return undefined;
  }
}

/** Detect current git branch from a directory */
function gitBranchFromCwd(cwd: string): string | undefined {
  try {
    return execSync("git rev-parse --abbrev-ref HEAD", { cwd, timeout: 3000, stdio: ["pipe", "pipe", "pipe"], windowsHide: true })
      .toString()
      .trim() || undefined;
  } catch {
    return undefined;
  }
}

/** Detect primary language from file paths mentioned in tool uses */
function detectLanguage(messages: Message[]): string | undefined {
  const extCounts: Record<string, number> = {};
  for (const msg of messages) {
    for (const tool of msg.toolUses) {
      // Look at file paths in tool inputs (Read, Edit, Write tools)
      const input = tool.input || "";
      const matches = input.match(/["\s/][\w\-./]+\.(ts|js|py|go|rs|java|rb|cpp|c|swift|kt|php|css|html|vue|svelte|tsx|jsx)/g);
      if (matches) {
        for (const m of matches) {
          const ext = m.split(".").pop()!;
          extCounts[ext] = (extCounts[ext] || 0) + 1;
        }
      }
    }
  }
  if (Object.keys(extCounts).length === 0) return undefined;

  const langMap: Record<string, string> = {
    ts: "TypeScript", tsx: "TypeScript", js: "JavaScript", jsx: "JavaScript",
    py: "Python", go: "Go", rs: "Rust", java: "Java", rb: "Ruby",
    cpp: "C++", c: "C", swift: "Swift", kt: "Kotlin", php: "PHP",
    css: "CSS", html: "HTML", vue: "Vue", svelte: "Svelte",
  };

  const top = Object.entries(extCounts).sort((a, b) => b[1] - a[1])[0];
  return langMap[top[0]] || top[0];
}

/** Compute tool usage stats from messages */
function computeToolUsage(messages: Message[]): Map<string, { calls: number; inputChars: number; outputChars: number }> {
  const usage = new Map<string, { calls: number; inputChars: number; outputChars: number }>();
  for (const msg of messages) {
    for (const tool of msg.toolUses) {
      const name = tool.name || "unknown";
      const existing = usage.get(name) || { calls: 0, inputChars: 0, outputChars: 0 };
      existing.calls++;
      existing.inputChars += (tool.input || "").length;
      existing.outputChars += (tool.output || "").length;
      usage.set(name, existing);
    }
  }
  return usage;
}

/** Tag colors by category */
const TAG_COLORS: Record<string, string> = {
  tool: "#6366f1",      // indigo
  model: "#8b5cf6",     // violet
  project: "#06b6d4",   // cyan
  language: "#10b981",  // emerald
  branch: "#f59e0b",    // amber
  status: "#ef4444",    // red
  custom: "#64748b",    // slate
};

/** Auto-tag and enrich a session after ingest */
export function autoTagSession(
  store: Store,
  session: Session,
  messages: Message[]
): void {
  // --- 1. Project linkage ---
  const cwd = (session.metadata?.cwd as string) || "";
  if (cwd) {
    const projId = projectIdFromCwd(cwd);
    const projName = projectNameFromCwd(cwd);
    store.upsertProject({
      id: projId,
      name: projName,
      directory: cwd,
      gitRemote: gitRemoteFromCwd(cwd),
      gitBranch: gitBranchFromCwd(cwd),
      language: detectLanguage(messages),
    });
    store.linkSessionToProject(session.id, projId);

    // Tag: project name
    const projTagId = store.ensureTag(projName, "project", TAG_COLORS.project);
    store.tagSession(session.id, projTagId);
  }

  // --- 2. Tool tag ---
  const toolTagId = store.ensureTag(session.adapterName, "tool", TAG_COLORS.tool);
  store.tagSession(session.id, toolTagId);

  // --- 3. Model tags ---
  const models = new Set<string>();
  for (const msg of messages) {
    if (msg.model) {
      // Normalize model names to families
      const family = normalizeModelFamily(msg.model);
      models.add(family);
    }
  }
  for (const model of models) {
    const modelTagId = store.ensureTag(model, "model", TAG_COLORS.model);
    store.tagSession(session.id, modelTagId);
  }

  // --- 4. Language tag ---
  const lang = detectLanguage(messages);
  if (lang) {
    const langTagId = store.ensureTag(lang, "language", TAG_COLORS.language);
    store.tagSession(session.id, langTagId);
  }

  // --- 5. Status tags ---
  if (session.isSubAgent) {
    const subTagId = store.ensureTag("sub-agent", "status", TAG_COLORS.status);
    store.tagSession(session.id, subTagId);
  }
  if (session.isCompacted) {
    const compactTagId = store.ensureTag("compacted", "status", "#f97316");
    store.tagSession(session.id, compactTagId);
  }
  if (session.estCost > 1.0) {
    const highCostTagId = store.ensureTag("high-cost", "status", "#dc2626");
    store.tagSession(session.id, highCostTagId);
  }

  // --- 6. Tool usage stats ---
  const toolUsage = computeToolUsage(messages);
  for (const [toolName, stats] of toolUsage) {
    store.upsertToolUsage(session.id, toolName, stats.calls, stats.inputChars, stats.outputChars);
  }
}

/** Normalize a model ID to a human-friendly family name */
function normalizeModelFamily(model: string): string {
  const m = model.toLowerCase();
  if (m.includes("opus")) return "Claude Opus";
  if (m.includes("sonnet")) return "Claude Sonnet";
  if (m.includes("haiku")) return "Claude Haiku";
  if (m.includes("gpt-4o") || m.includes("gpt4o")) return "GPT-4o";
  if (m.includes("gpt-4")) return "GPT-4";
  if (m.includes("o3")) return "o3";
  if (m.includes("o1")) return "o1";
  if (m.includes("gemini") && m.includes("flash")) return "Gemini Flash";
  if (m.includes("gemini") && m.includes("pro")) return "Gemini Pro";
  if (m.includes("gemini")) return "Gemini";
  if (m.includes("codex")) return "Codex";
  return model.split("/").pop() || model;
}

/** Batch re-tag all sessions (for initial setup or schema migration) */
export function retagAll(store: Store): void {
  const sessions = store.listSessions();
  for (const session of sessions) {
    const messages = store.getMessages(session.id);
    autoTagSession(store, session, messages);
  }
  store.refreshProjectStats();
}
