import { existsSync, mkdirSync, mkdtempSync, readdirSync, statSync, writeFileSync } from "fs";
import { homedir, tmpdir } from "os";
import { basename, join, resolve } from "path";
import { ClaudeCodeAdapter } from "../../src/adapters/claude-code";
import { CodexAdapter } from "../../src/adapters/codex";
import { CursorAdapter } from "../../src/adapters/cursor";
import { getOverviewSummary } from "../../src/db/query-surface";
import { openStoreAtPath, type SqliteConversationStore } from "../../src/db/store";

const REPORT_SCHEMA_VERSION = 1;
const ISSUE_SAMPLE_LIMIT = 25;
const SUPPORTED_ADAPTER_IDS = ["cursor", "claude-code", "codex"] as const;

type SupportedAdapterId = (typeof SUPPORTED_ADAPTER_IDS)[number];

interface CliOptions {
  outputDir?: string;
  configDir?: string;
  adapters?: SupportedAdapterId[];
  cursorChatsDir?: string;
  cursorDbPath?: string;
  claudeProjectsDir?: string;
  codexHome?: string;
  json?: boolean;
}

interface ResolvedRunOptions {
  outputDir: string;
  configDir: string;
  adapters: SupportedAdapterId[];
  cursorChatsDir: string;
  cursorDbPath: string;
  claudeProjectsDir: string;
  codexHome: string;
  json: boolean;
}

interface SourceConversationCounts {
  conversationId: string;
  sourcePath: string;
  messageCount: number;
  toolCallCount: number;
}

interface StoreConversationRow {
  id: string;
  source_path: string;
  message_count: number;
  tool_count: number;
}

interface ReconciliationIssue {
  kind:
    | "duplicate-loaded-conversation-id"
    | "null-bundle"
    | "missing-store-conversation"
    | "unexpected-store-conversation"
    | "message-count-mismatch"
    | "tool-call-count-mismatch"
    | "source-path-mismatch";
  conversationId: string;
  sourcePath?: string;
  storeSourcePath?: string;
  sourceMessageCount?: number;
  storeMessageCount?: number;
  sourceToolCallCount?: number;
  storeToolCallCount?: number;
}

interface AdapterValidationResult {
  adapterId: SupportedAdapterId;
  adapterName: string;
  detected: boolean;
  watchPaths: string[];
  resolvedSources: Record<string, string>;
  sourceFilesTouched: number;
  refsDiscovered: number;
  bundlesLoaded: number;
  bundlesNull: number;
  uniqueConversationsLoaded: number;
  duplicateConversationIdsLoaded: number;
  sourceMessages: number;
  sourceToolCalls: number;
  writeAttempts: number;
  changedWrites: number;
  unchangedWrites: number;
  loadErrors: number;
  writeErrors: number;
  storeConversations: number;
  storeMessages: number;
  storeToolCalls: number;
  storeSyncRows: number;
  issuesByKind: Record<string, number>;
  issueCount: number;
  issueSamples: ReconciliationIssue[];
  errors: string[];
}

interface LiveValidationReport {
  schemaVersion: number;
  generatedAt: string;
  command: string[];
  outputDir: string;
  configDir: string;
  storePath: string;
  artifacts: {
    configPath: string;
    reportPath: string;
    reconciliationPath: string;
  };
  adapters: AdapterValidationResult[];
  storeOverview: ReturnType<typeof getOverviewSummary>;
  summary: {
    ok: boolean;
    adaptersValidated: number;
    adaptersWithIssues: SupportedAdapterId[];
    totalRefsDiscovered: number;
    totalUniqueConversationsLoaded: number;
    totalStoreConversations: number;
    totalStoreMessages: number;
    totalStoreToolCalls: number;
  };
}

export async function runLiveValidation(
  options: CliOptions = {},
): Promise<LiveValidationReport> {
  const resolved = resolveRunOptions(options);
  ensureDirectory(resolved.outputDir);
  ensureDirectory(resolved.configDir);

  const configPath = join(resolved.configDir, "config.json");
  const reportPath = join(resolved.outputDir, "report.json");
  const reconciliationPath = join(resolved.outputDir, "reconciliation.json");
  const storePath = join(resolved.configDir, "store.db");

  writeDisposableConfig(configPath, resolved);

  const store = openStoreAtPath(storePath);
  try {
    const adapters: AdapterValidationResult[] = [];

    for (const adapterId of resolved.adapters) {
      adapters.push(await validateAdapter(adapterId, resolved, store));
    }

    const storeOverview = getOverviewSummary(store.database);
    const adaptersWithIssues = adapters
      .filter(
        (adapter) =>
          !adapter.detected || adapter.errors.length > 0 || adapter.issueCount > 0,
      )
      .map((adapter) => adapter.adapterId);

    const report: LiveValidationReport = {
      schemaVersion: REPORT_SCHEMA_VERSION,
      generatedAt: new Date().toISOString(),
      command: process.argv,
      outputDir: resolved.outputDir,
      configDir: resolved.configDir,
      storePath,
      artifacts: {
        configPath,
        reportPath,
        reconciliationPath,
      },
      adapters,
      storeOverview,
      summary: {
        ok: adaptersWithIssues.length === 0,
        adaptersValidated: adapters.length,
        adaptersWithIssues,
        totalRefsDiscovered: adapters.reduce(
          (sum, adapter) => sum + adapter.refsDiscovered,
          0,
        ),
        totalUniqueConversationsLoaded: adapters.reduce(
          (sum, adapter) => sum + adapter.uniqueConversationsLoaded,
          0,
        ),
        totalStoreConversations: storeOverview.conversations,
        totalStoreMessages: storeOverview.messages,
        totalStoreToolCalls: storeOverview.toolCalls,
      },
    };

    writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    writeFileSync(
      reconciliationPath,
      `${JSON.stringify({ adapters: report.adapters }, null, 2)}\n`,
      "utf8",
    );

    return report;
  } finally {
    store.close();
  }
}

async function validateAdapter(
  adapterId: SupportedAdapterId,
  options: ResolvedRunOptions,
  store: SqliteConversationStore,
): Promise<AdapterValidationResult> {
  const adapter = createAdapter(adapterId, options);
  const resolvedSources = describeAdapterSources(adapterId, options);
  const watchPaths = adapter.watchPaths().map((pathValue) => resolve(pathValue));
  const errors: string[] = [];
  let detected = false;
  let refs: Array<{ id: string; sourcePath: string }> = [];

  try {
    detected = await adapter.detect();
  } catch (error) {
    errors.push(`detect failed: ${formatError(error)}`);
  }

  if (detected) {
    try {
      refs = (await adapter.findChanged({ kind: "startup-scan" })).map((ref) => ({
        id: ref.id,
        sourcePath: resolve(ref.sourcePath),
      }));
    } catch (error) {
      errors.push(`findChanged failed: ${formatError(error)}`);
    }
  }

  const uniqueSourceFiles = new Set(refs.map((ref) => ref.sourcePath));
  const sourceConversations = new Map<string, SourceConversationCounts>();
  const duplicateConversationIds = new Set<string>();
  const nullBundleRefs: Array<{ conversationId: string; sourcePath: string }> = [];
  let bundlesLoaded = 0;
  let bundlesNull = 0;
  let sourceMessages = 0;
  let sourceToolCalls = 0;
  let writeAttempts = 0;
  let changedWrites = 0;
  let unchangedWrites = 0;
  let loadErrors = 0;
  let writeErrors = 0;

  for (const ref of refs) {
    try {
      const bundle = await adapter.loadConversation({
        id: ref.id,
        sourcePath: ref.sourcePath,
        adapterId,
      });

      if (!bundle) {
        bundlesNull += 1;
        nullBundleRefs.push({
          conversationId: ref.id,
          sourcePath: ref.sourcePath,
        });
        continue;
      }

      bundlesLoaded += 1;
      const counts = countBundle(bundle);

      if (sourceConversations.has(bundle.conversation.id)) {
        duplicateConversationIds.add(bundle.conversation.id);
      }

      sourceConversations.set(bundle.conversation.id, {
        conversationId: bundle.conversation.id,
        sourcePath: resolve(bundle.conversation.sourcePath),
        messageCount: counts.messageCount,
        toolCallCount: counts.toolCallCount,
      });

      try {
        const writeResult = store.writeBundle(bundle);
        writeAttempts += 1;
        if (writeResult.changed) {
          changedWrites += 1;
        } else {
          unchangedWrites += 1;
        }
      } catch (error) {
        writeErrors += 1;
        errors.push(
          `writeBundle failed for ${bundle.conversation.id}: ${formatError(error)}`,
        );
      }
    } catch (error) {
      loadErrors += 1;
      errors.push(`loadConversation failed for ${ref.id}: ${formatError(error)}`);
    }
  }

  for (const counts of sourceConversations.values()) {
    sourceMessages += counts.messageCount;
    sourceToolCalls += counts.toolCallCount;
  }

  const storeRows = queryStoreConversationRows(store, adapterId);
  const storeSyncRows = queryStoreSyncRows(store, adapterId);
  const reconciliation = reconcileStore(
    sourceConversations,
    duplicateConversationIds,
    nullBundleRefs,
    storeRows,
  );

  return {
    adapterId,
    adapterName: adapter.name,
    detected,
    watchPaths,
    resolvedSources,
    sourceFilesTouched: uniqueSourceFiles.size,
    refsDiscovered: refs.length,
    bundlesLoaded,
    bundlesNull,
    uniqueConversationsLoaded: sourceConversations.size,
    duplicateConversationIdsLoaded: duplicateConversationIds.size,
    sourceMessages,
    sourceToolCalls,
    writeAttempts,
    changedWrites,
    unchangedWrites,
    loadErrors,
    writeErrors,
    storeConversations: storeRows.length,
    storeMessages: storeRows.reduce((sum, row) => sum + row.message_count, 0),
    storeToolCalls: storeRows.reduce((sum, row) => sum + row.tool_count, 0),
    storeSyncRows,
    issuesByKind: reconciliation.issuesByKind,
    issueCount: reconciliation.issueCount,
    issueSamples: reconciliation.issueSamples,
    errors,
  };
}

function createAdapter(
  adapterId: SupportedAdapterId,
  options: ResolvedRunOptions,
):
  | ClaudeCodeAdapter
  | CodexAdapter
  | CursorAdapter {
  switch (adapterId) {
    case "cursor":
      return new CursorAdapter({
        chatsDir: options.cursorChatsDir,
        globalStorageDbPath: options.cursorDbPath,
      });
    case "claude-code":
      return new ClaudeCodeAdapter({
        projectsDir: options.claudeProjectsDir,
      });
    case "codex":
      return new CodexAdapter(options.codexHome);
  }
}

function describeAdapterSources(
  adapterId: SupportedAdapterId,
  options: ResolvedRunOptions,
): Record<string, string> {
  switch (adapterId) {
    case "cursor":
      return {
        chatsDir: options.cursorChatsDir,
        globalStorageDbPath: options.cursorDbPath,
      };
    case "claude-code":
      return {
        projectsDir: options.claudeProjectsDir,
      };
    case "codex":
      return {
        codexHome: options.codexHome,
        sessionsDir: join(options.codexHome, "sessions"),
        archivedSessionsDir: join(options.codexHome, "archived_sessions"),
      };
  }
}

function queryStoreConversationRows(
  store: SqliteConversationStore,
  adapterId: SupportedAdapterId,
): StoreConversationRow[] {
  return store.database
    .query(
      `SELECT id, source_path, message_count, tool_count
       FROM conversations
       WHERE adapter_id = ?
       ORDER BY id ASC`,
    )
    .all(adapterId) as StoreConversationRow[];
}

function queryStoreSyncRows(
  store: SqliteConversationStore,
  adapterId: SupportedAdapterId,
): number {
  const row = store.database
    .query(
      `SELECT COUNT(*) AS count
       FROM conversations c
       JOIN _jin_sync s ON s.conversation_id = c.id
       WHERE c.adapter_id = ?`,
    )
    .get(adapterId) as { count: number } | null;

  return row?.count ?? 0;
}

function reconcileStore(
  sourceConversations: Map<string, SourceConversationCounts>,
  duplicateConversationIds: Set<string>,
  nullBundleRefs: Array<{ conversationId: string; sourcePath: string }>,
  storeRows: StoreConversationRow[],
): {
  issuesByKind: Record<string, number>;
  issueCount: number;
  issueSamples: ReconciliationIssue[];
} {
  const issuesByKind: Record<string, number> = {};
  const issueSamples: ReconciliationIssue[] = [];
  const storeById = new Map(storeRows.map((row) => [row.id, row]));

  const pushIssue = (issue: ReconciliationIssue) => {
    issuesByKind[issue.kind] = (issuesByKind[issue.kind] ?? 0) + 1;
    if (issueSamples.length < ISSUE_SAMPLE_LIMIT) {
      issueSamples.push(issue);
    }
  };

  for (const conversationId of duplicateConversationIds) {
    const source = sourceConversations.get(conversationId);
    pushIssue({
      kind: "duplicate-loaded-conversation-id",
      conversationId,
      sourcePath: source?.sourcePath,
      sourceMessageCount: source?.messageCount,
      sourceToolCallCount: source?.toolCallCount,
    });
  }

  for (const ref of nullBundleRefs) {
    pushIssue({
      kind: "null-bundle",
      conversationId: ref.conversationId,
      sourcePath: ref.sourcePath,
    });
  }

  for (const [conversationId, source] of sourceConversations.entries()) {
    const storeRow = storeById.get(conversationId);
    if (!storeRow) {
      pushIssue({
        kind: "missing-store-conversation",
        conversationId,
        sourcePath: source.sourcePath,
        sourceMessageCount: source.messageCount,
        sourceToolCallCount: source.toolCallCount,
      });
      continue;
    }

    if (resolve(storeRow.source_path) !== resolve(source.sourcePath)) {
      pushIssue({
        kind: "source-path-mismatch",
        conversationId,
        sourcePath: source.sourcePath,
        storeSourcePath: storeRow.source_path,
      });
    }

    if (storeRow.message_count !== source.messageCount) {
      pushIssue({
        kind: "message-count-mismatch",
        conversationId,
        sourcePath: source.sourcePath,
        sourceMessageCount: source.messageCount,
        storeMessageCount: storeRow.message_count,
      });
    }

    if (storeRow.tool_count !== source.toolCallCount) {
      pushIssue({
        kind: "tool-call-count-mismatch",
        conversationId,
        sourcePath: source.sourcePath,
        sourceToolCallCount: source.toolCallCount,
        storeToolCallCount: storeRow.tool_count,
      });
    }
  }

  for (const row of storeRows) {
    if (sourceConversations.has(row.id)) {
      continue;
    }

    pushIssue({
      kind: "unexpected-store-conversation",
      conversationId: row.id,
      storeSourcePath: row.source_path,
      storeMessageCount: row.message_count,
      storeToolCallCount: row.tool_count,
    });
  }

  const issueCount = Object.values(issuesByKind).reduce((sum, count) => sum + count, 0);

  return {
    issuesByKind,
    issueCount,
    issueSamples,
  };
}

function countBundle(bundle: {
  messages: Array<{ toolUses?: Array<unknown> }>;
}): { messageCount: number; toolCallCount: number } {
  return {
    messageCount: bundle.messages.length,
    toolCallCount: bundle.messages.reduce(
      (sum, message) => sum + (message.toolUses?.length ?? 0),
      0,
    ),
  };
}

function writeDisposableConfig(
  configPath: string,
  options: ResolvedRunOptions,
): void {
  const config = {
    adapters: {
      cursor: {
        enabled: options.adapters.includes("cursor"),
        allowProtectedSource: true,
      },
      "claude-code": {
        enabled: options.adapters.includes("claude-code"),
        dataDir: options.claudeProjectsDir,
      },
      codex: {
        enabled: options.adapters.includes("codex"),
        dataDir: options.codexHome,
      },
      warp: { enabled: false },
      "gemini-cli": { enabled: false },
      kiro: { enabled: false },
      amp: { enabled: false },
      opencode: { enabled: false },
      pi: { enabled: false },
      piagent: { enabled: false },
    },
    sinks: [],
    routes: [],
    watch: {
      pollIntervalMs: 0,
    },
    liveValidation: {
      cursorChatsDir: options.cursorChatsDir,
      cursorDbPath: options.cursorDbPath,
      claudeProjectsDir: options.claudeProjectsDir,
      codexHome: options.codexHome,
    },
  };

  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

function resolveRunOptions(options: CliOptions): ResolvedRunOptions {
  const outputDir =
    options.outputDir && options.outputDir.trim().length > 0
      ? resolve(options.outputDir)
      : mkdtempSync(join(tmpdir(), "jin-live-validation-"));
  const configDir =
    options.configDir && options.configDir.trim().length > 0
      ? resolve(options.configDir)
      : join(outputDir, "config");
  const adapters =
    options.adapters && options.adapters.length > 0
      ? options.adapters
      : [...SUPPORTED_ADAPTER_IDS];

  return {
    outputDir,
    configDir,
    adapters,
    cursorChatsDir: resolve(
      options.cursorChatsDir ?? join(homedir(), ".cursor", "chats"),
    ),
    cursorDbPath: resolve(
      options.cursorDbPath ?? defaultCursorDbPath(process.platform),
    ),
    claudeProjectsDir: resolveClaudeProjectsDir(options.claudeProjectsDir),
    codexHome: resolve(
      options.codexHome ?? process.env.CODEX_HOME ?? join(homedir(), ".codex"),
    ),
    json: options.json ?? true,
  };
}

export function resolveClaudeProjectsDir(
  override?: string,
  input: { homeDir?: string; platform?: NodeJS.Platform } = {},
): string {
  const homeDir = input.homeDir ?? homedir();
  const platform = input.platform ?? process.platform;

  if (override && override.trim().length > 0) {
    return resolve(override);
  }

  const candidates = claudeProjectsDirCandidates(homeDir, platform);

  for (const candidate of candidates) {
    if (hasJsonlSource(candidate)) {
      return candidate;
    }
  }

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return candidates[0] ?? resolve(homeDir, ".claude", "projects");
}

function claudeProjectsDirCandidates(
  homeDir: string,
  platform: NodeJS.Platform,
): string[] {
  if (platform === "win32") {
    const appDataDir =
      process.env.APPDATA ?? join(homeDir, "AppData", "Roaming");
    return dedupeResolvedPaths([
      join(appDataDir, "Claude", "projects"),
      join(homeDir, ".claude", "projects"),
      join(homeDir, ".config", "claude", "projects"),
    ]);
  }

  return dedupeResolvedPaths([
    join(homeDir, ".claude", "projects"),
    join(homeDir, ".config", "claude", "projects"),
  ]);
}

function defaultCursorDbPath(platform: NodeJS.Platform): string {
  const home = homedir();
  if (platform === "darwin") {
    return join(
      home,
      "Library",
      "Application Support",
      "Cursor",
      "User",
      "globalStorage",
      "state.vscdb",
    );
  }

  if (platform === "win32") {
    return join(
      process.env.APPDATA ?? join(home, "AppData", "Roaming"),
      "Cursor",
      "User",
      "globalStorage",
      "state.vscdb",
    );
  }

  return join(
    home,
    ".config",
    "Cursor",
    "User",
    "globalStorage",
    "state.vscdb",
  );
}

function hasJsonlSource(rootDir: string): boolean {
  if (!existsSync(rootDir)) {
    return false;
  }

  const stack = [resolve(rootDir)];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) {
      continue;
    }

    let stats;
    try {
      stats = statSync(current);
    } catch {
      continue;
    }

    if (stats.isFile()) {
      if (current.endsWith(".jsonl")) {
        return true;
      }
      continue;
    }

    try {
      for (const entry of readdirSync(current)) {
        stack.push(join(current, entry));
      }
    } catch {
      continue;
    }
  }

  return false;
}

function dedupeResolvedPaths(paths: string[]): string[] {
  return [...new Set(paths.map((pathValue) => resolve(pathValue)))];
}

function ensureDirectory(pathValue: string): void {
  if (!existsSync(pathValue)) {
    mkdirSync(pathValue, { recursive: true });
  }
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

export function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {};

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }

    if (arg === "--output-dir") {
      options.outputDir = argv[index + 1];
      index += 1;
      continue;
    }

    if (arg.startsWith("--output-dir=")) {
      options.outputDir = arg.slice("--output-dir=".length);
      continue;
    }

    if (arg === "--config-dir") {
      options.configDir = argv[index + 1];
      index += 1;
      continue;
    }

    if (arg.startsWith("--config-dir=")) {
      options.configDir = arg.slice("--config-dir=".length);
      continue;
    }

    if (arg === "--adapters") {
      options.adapters = parseAdapterList(argv[index + 1]);
      index += 1;
      continue;
    }

    if (arg.startsWith("--adapters=")) {
      options.adapters = parseAdapterList(arg.slice("--adapters=".length));
      continue;
    }

    if (arg === "--cursor-chats-dir") {
      options.cursorChatsDir = argv[index + 1];
      index += 1;
      continue;
    }

    if (arg.startsWith("--cursor-chats-dir=")) {
      options.cursorChatsDir = arg.slice("--cursor-chats-dir=".length);
      continue;
    }

    if (arg === "--cursor-db-path") {
      options.cursorDbPath = argv[index + 1];
      index += 1;
      continue;
    }

    if (arg.startsWith("--cursor-db-path=")) {
      options.cursorDbPath = arg.slice("--cursor-db-path=".length);
      continue;
    }

    if (arg === "--claude-projects-dir") {
      options.claudeProjectsDir = argv[index + 1];
      index += 1;
      continue;
    }

    if (arg.startsWith("--claude-projects-dir=")) {
      options.claudeProjectsDir = arg.slice("--claude-projects-dir=".length);
      continue;
    }

    if (arg === "--codex-home") {
      options.codexHome = argv[index + 1];
      index += 1;
      continue;
    }

    if (arg.startsWith("--codex-home=")) {
      options.codexHome = arg.slice("--codex-home=".length);
      continue;
    }

    if (arg === "--no-json") {
      options.json = false;
      continue;
    }
  }

  return options;
}

function parseAdapterList(raw: string | undefined): SupportedAdapterId[] {
  const parsed = (raw ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter((value): value is SupportedAdapterId =>
      SUPPORTED_ADAPTER_IDS.includes(value as SupportedAdapterId),
    );

  return parsed.length > 0 ? parsed : [...SUPPORTED_ADAPTER_IDS];
}

function printHelp(): void {
  process.stdout.write(
    [
      "Usage: bun scripts/live-validation/run.ts [options]",
      "",
      "Options:",
      "  --output-dir <path>         Write report.json, reconciliation.json, and config/store artifacts here",
      "  --config-dir <path>         Override the disposable config directory (default: <output-dir>/config)",
      "  --adapters <csv>            Limit to cursor,claude-code,codex",
      "  --cursor-chats-dir <path>   Override Cursor chats root",
      "  --cursor-db-path <path>     Override Cursor globalStorage SQLite path",
      "  --claude-projects-dir <path> Override Claude Code projects root",
      "  --codex-home <path>         Override Codex home",
      "  --no-json                   Do not print the final report JSON to stdout",
      "  --help                      Show this message",
      "",
    ].join("\n"),
  );
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const report = await runLiveValidation(options);

  if (options.json !== false) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  }

  process.exit(report.summary.ok ? 0 : 1);
}

if (import.meta.main) {
  await main();
}
