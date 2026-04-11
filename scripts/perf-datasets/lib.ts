import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "fs";
import { dirname, join, relative } from "path";
import { ClaudeCodeAdapter } from "../../src/adapters/claude-code";
import { CodexAdapter } from "../../src/adapters/codex";

export const DEFAULT_OUTPUT_ROOT = join(process.cwd(), "test", "perf-datasets", "generated");

export const SCALE_MULTIPLIERS = {
  "1x": 1,
  "10x": 10,
  "100x": 100,
} as const;

export const SCENARIOS = {
  "codex-heavy": {
    description: "Codex-only traces with compaction and spawned-child coverage.",
    codexTracesPerScaleUnit: 1,
    claudeProjectsPerScaleUnit: 0,
  },
  "claude-code-heavy": {
    description: "Claude Code-only projects with compaction and spawned-child coverage.",
    codexTracesPerScaleUnit: 0,
    claudeProjectsPerScaleUnit: 1,
  },
  "mixed-rich": {
    description: "Balanced Codex plus Claude Code dataset for mixed rich-adapter runs.",
    codexTracesPerScaleUnit: 1,
    claudeProjectsPerScaleUnit: 1,
  },
} as const;

export type ScaleTier = keyof typeof SCALE_MULTIPLIERS;
export type ScenarioName = keyof typeof SCENARIOS;
export type AdapterId = "claude-code" | "codex";
export type Relationship = "root" | "compacted" | "spawned" | "forked";

type GeneratedFile = {
  relativePath: string;
  contents: string;
};

export type ExpectedRef = {
  id: string;
  sourcePath: string;
  traceId: string;
  parentId: string;
  relationship: Relationship;
  forkPoint: number;
  messageCount: number;
  toolUseCount: number;
};

export type TraceExpectation = {
  traceId: string;
  rootId: string;
  compactedIds: string[];
  spawnedIds: string[];
};

export type AdapterManifest = {
  adapterId: AdapterId;
  expectedFiles: string[];
  expectedRefs: ExpectedRef[];
  relationshipsRetained: {
    roots: number;
    compacted: number;
    spawned: number;
    forked: number;
    tracesWithCompaction: number;
    tracesWithSpawnedChildren: number;
  };
  traces: TraceExpectation[];
};

export type DatasetManifest = {
  version: 1;
  seedSet: "w3-scale-01-v1";
  scenario: ScenarioName;
  scaleTier: ScaleTier;
  scaleUnits: number;
  adapters: AdapterManifest[];
  totals: {
    sourceFiles: number;
    refs: number;
    roots: number;
    compacted: number;
    spawned: number;
    forked: number;
  };
};

export type GenerationResult = {
  datasetRoot: string;
  manifestPath: string;
  manifest: DatasetManifest;
};

export type ValidationResult = {
  datasetRoot: string;
  manifestPath: string;
  manifest: DatasetManifest;
  rebuiltManifest: DatasetManifest;
  ok: boolean;
};

export function isScenarioName(value: string): value is ScenarioName {
  return value in SCENARIOS;
}

export function isScaleTier(value: string): value is ScaleTier {
  return value in SCALE_MULTIPLIERS;
}

export function listScenarioNames(): ScenarioName[] {
  return Object.keys(SCENARIOS).sort() as ScenarioName[];
}

export function listScaleTiers(): ScaleTier[] {
  return Object.keys(SCALE_MULTIPLIERS) as ScaleTier[];
}

export function datasetRootFor(
  scenario: ScenarioName,
  scaleTier: ScaleTier,
  outputRoot = DEFAULT_OUTPUT_ROOT,
): string {
  return join(outputRoot, scenario, scaleTier);
}

export function scenarioScaleCounts(scenario: ScenarioName, scaleTier: ScaleTier) {
  const scenarioDefinition = SCENARIOS[scenario];
  const scaleUnits = SCALE_MULTIPLIERS[scaleTier];
  const codexTraces = scenarioDefinition.codexTracesPerScaleUnit * scaleUnits;
  const claudeProjects = scenarioDefinition.claudeProjectsPerScaleUnit * scaleUnits;
  const sourceFiles = codexTraces * 2 + claudeProjects * 2;
  const refs = codexTraces * 3 + claudeProjects * 3;
  const roots = codexTraces + claudeProjects;
  const compacted = codexTraces + claudeProjects;
  const spawned = codexTraces + claudeProjects;
  return {
    scaleUnits,
    codexTraces,
    claudeProjects,
    sourceFiles,
    refs,
    roots,
    compacted,
    spawned,
  };
}

export async function generateDataset(options: {
  scenario: ScenarioName;
  scaleTier: ScaleTier;
  outputRoot?: string;
}): Promise<GenerationResult> {
  const outputRoot = options.outputRoot ?? DEFAULT_OUTPUT_ROOT;
  const datasetRoot = datasetRootFor(options.scenario, options.scaleTier, outputRoot);
  const counts = scenarioScaleCounts(options.scenario, options.scaleTier);

  rmSync(datasetRoot, { recursive: true, force: true });
  mkdirSync(datasetRoot, { recursive: true });

  const generatedFiles = [
    ...generateCodexFiles(counts.codexTraces),
    ...generateClaudeFiles(counts.claudeProjects),
  ].sort((left, right) => left.relativePath.localeCompare(right.relativePath));

  for (const file of generatedFiles) {
    const fullPath = join(datasetRoot, file.relativePath);
    mkdirSync(dirname(fullPath), { recursive: true });
    writeFileSync(fullPath, ensureTrailingNewline(file.contents), "utf8");
  }

  const manifest = await collectDatasetManifest(datasetRoot, options.scenario, options.scaleTier);
  const manifestPath = join(datasetRoot, "manifest.json");
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  return {
    datasetRoot,
    manifestPath,
    manifest,
  };
}

export async function validateDataset(datasetRoot: string): Promise<ValidationResult> {
  const manifestPath = join(datasetRoot, "manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as DatasetManifest;
  const rebuiltManifest = await collectDatasetManifest(
    datasetRoot,
    manifest.scenario,
    manifest.scaleTier,
  );

  return {
    datasetRoot,
    manifestPath,
    manifest,
    rebuiltManifest,
    ok: JSON.stringify(manifest) === JSON.stringify(rebuiltManifest),
  };
}

export function cleanDatasets(options: {
  outputRoot?: string;
  scenario?: ScenarioName;
  scaleTier?: ScaleTier;
  all?: boolean;
}): string[] {
  const outputRoot = options.outputRoot ?? DEFAULT_OUTPUT_ROOT;
  const removed: string[] = [];

  if (options.all) {
    rmSync(outputRoot, { recursive: true, force: true });
    removed.push(outputRoot);
    return removed;
  }

  if (options.scenario && options.scaleTier) {
    const target = datasetRootFor(options.scenario, options.scaleTier, outputRoot);
    rmSync(target, { recursive: true, force: true });
    removed.push(target);
    pruneEmptyParents(target, outputRoot);
    return removed;
  }

  if (options.scenario) {
    const target = join(outputRoot, options.scenario);
    rmSync(target, { recursive: true, force: true });
    removed.push(target);
    pruneEmptyParents(target, outputRoot);
    return removed;
  }

  return removed;
}

async function collectDatasetManifest(
  datasetRoot: string,
  scenario: ScenarioName,
  scaleTier: ScaleTier,
): Promise<DatasetManifest> {
  const adapterManifests = (
    await Promise.all([
      collectCodexManifest(datasetRoot),
      collectClaudeManifest(datasetRoot),
    ])
  )
    .filter((manifest): manifest is AdapterManifest => manifest !== null)
    .sort((left, right) => left.adapterId.localeCompare(right.adapterId));

  const totals = adapterManifests.reduce(
    (summary, adapterManifest) => ({
      sourceFiles: summary.sourceFiles + adapterManifest.expectedFiles.length,
      refs: summary.refs + adapterManifest.expectedRefs.length,
      roots: summary.roots + adapterManifest.relationshipsRetained.roots,
      compacted: summary.compacted + adapterManifest.relationshipsRetained.compacted,
      spawned: summary.spawned + adapterManifest.relationshipsRetained.spawned,
      forked: summary.forked + adapterManifest.relationshipsRetained.forked,
    }),
    {
      sourceFiles: 0,
      refs: 0,
      roots: 0,
      compacted: 0,
      spawned: 0,
      forked: 0,
    },
  );

  return {
    version: 1,
    seedSet: "w3-scale-01-v1",
    scenario,
    scaleTier,
    scaleUnits: SCALE_MULTIPLIERS[scaleTier],
    adapters: adapterManifests,
    totals,
  };
}

async function collectCodexManifest(datasetRoot: string): Promise<AdapterManifest | null> {
  const codexHome = join(datasetRoot, "home", ".codex");
  const sessionsDir = join(codexHome, "sessions");
  if (!existsSync(sessionsDir)) {
    return null;
  }

  const adapter = new CodexAdapter(codexHome);
  const refs = sortRefs(await adapter.findChanged({ kind: "startup-scan" }));
  const files = walkFiles(sessionsDir)
    .filter((path) => path.endsWith(".jsonl"))
    .map((path) => relative(datasetRoot, path))
    .sort();

  return buildAdapterManifest("codex", datasetRoot, refs, async (ref) => adapter.loadConversation(ref), files);
}

async function collectClaudeManifest(datasetRoot: string): Promise<AdapterManifest | null> {
  const projectsDir = join(datasetRoot, "home", ".config", "claude", "projects");
  if (!existsSync(projectsDir)) {
    return null;
  }

  const claudeDir = join(datasetRoot, "home", ".claude");
  const adapter = new ClaudeCodeAdapter({ projectsDir, claudeDir });
  const refs = sortRefs(await adapter.findChanged({ kind: "startup-scan" }));
  const files = walkFiles(projectsDir)
    .filter((path) => path.endsWith(".jsonl"))
    .map((path) => relative(datasetRoot, path))
    .sort();

  return buildAdapterManifest(
    "claude-code",
    datasetRoot,
    refs,
    async (ref) => adapter.loadConversation(ref),
    files,
  );
}

async function buildAdapterManifest(
  adapterId: AdapterId,
  datasetRoot: string,
  refs: Array<{ id: string; sourcePath: string; adapterId: string }>,
  loadBundle: (
    ref: { id: string; sourcePath: string; adapterId: string },
  ) => Promise<
    | {
        conversation: {
          id: string;
          traceId: string;
          parentId: string;
          relationship: Relationship;
          forkPoint: number;
        };
        messages: Array<{
          toolUses: unknown[];
        }>;
      }
    | null
  >,
  files: string[],
): Promise<AdapterManifest> {
  const expectedRefs: ExpectedRef[] = [];
  const traceMap = new Map<string, TraceExpectation>();
  let roots = 0;
  let compacted = 0;
  let spawned = 0;
  let forked = 0;

  for (const ref of refs) {
    const bundle = await loadBundle(ref);
    if (!bundle) {
      throw new Error(`Expected ${adapterId} bundle for ${ref.id}`);
    }

    const relativeSourcePath = relative(datasetRoot, ref.sourcePath);
    const toolUseCount = bundle.messages.reduce(
      (count, message) => count + message.toolUses.length,
      0,
    );

    expectedRefs.push({
      id: bundle.conversation.id,
      sourcePath: relativeSourcePath,
      traceId: bundle.conversation.traceId,
      parentId: bundle.conversation.parentId,
      relationship: bundle.conversation.relationship,
      forkPoint: bundle.conversation.forkPoint,
      messageCount: bundle.messages.length,
      toolUseCount,
    });

    const trace = traceMap.get(bundle.conversation.traceId) ?? {
      traceId: bundle.conversation.traceId,
      rootId: "",
      compactedIds: [],
      spawnedIds: [],
    };

    if (bundle.conversation.relationship === "root") {
      roots += 1;
      trace.rootId = bundle.conversation.id;
    } else if (bundle.conversation.relationship === "compacted") {
      compacted += 1;
      trace.compactedIds.push(bundle.conversation.id);
    } else if (bundle.conversation.relationship === "spawned") {
      spawned += 1;
      trace.spawnedIds.push(bundle.conversation.id);
    } else {
      forked += 1;
    }

    traceMap.set(bundle.conversation.traceId, trace);
  }

  const traces = [...traceMap.values()].sort((left, right) => left.traceId.localeCompare(right.traceId));
  for (const trace of traces) {
    trace.compactedIds.sort();
    trace.spawnedIds.sort();
  }

  return {
    adapterId,
    expectedFiles: files,
    expectedRefs: expectedRefs.sort(compareExpectedRefs),
    relationshipsRetained: {
      roots,
      compacted,
      spawned,
      forked,
      tracesWithCompaction: traces.filter((trace) => trace.compactedIds.length > 0).length,
      tracesWithSpawnedChildren: traces.filter((trace) => trace.spawnedIds.length > 0).length,
    },
    traces,
  };
}

function generateCodexFiles(traceCount: number): GeneratedFile[] {
  const files: GeneratedFile[] = [];

  for (let index = 1; index <= traceCount; index += 1) {
    const rootId = `codex-parent-${pad(index, 4)}`;
    const childId = `codex-child-${pad(index, 4)}`;
    const dir = join("home", ".codex", "sessions", "2026", "04", "08");
    files.push({
      relativePath: join(dir, `${rootId}.jsonl`),
      contents: buildCodexParentTrace(index, rootId, childId),
    });
    files.push({
      relativePath: join(dir, `${childId}.jsonl`),
      contents: buildCodexChildTrace(index, rootId, childId),
    });
  }

  return files;
}

function generateClaudeFiles(projectCount: number): GeneratedFile[] {
  const files: GeneratedFile[] = [];
  if (projectCount === 0) {
    return files;
  }

  files.push({
    relativePath: join("home", ".claude", ".gitkeep"),
    contents: "",
  });

  for (let index = 1; index <= projectCount; index += 1) {
    const projectSlug = `project-${pad(index, 4)}`;
    const parentId = makeUuid("11111111-1111-4111-8111", index);
    const childId = makeUuid("22222222-2222-4222-8222", index);
    const projectDir = join("home", ".config", "claude", "projects", projectSlug);
    files.push({
      relativePath: join(projectDir, `${parentId}.jsonl`),
      contents: buildClaudeParentTrace(index, parentId, childId),
    });
    files.push({
      relativePath: join(projectDir, parentId, "subagents", `agent-${childId}.jsonl`),
      contents: buildClaudeChildTrace(index, childId),
    });
  }

  return files;
}

function buildCodexParentTrace(index: number, rootId: string, childId: string): string {
  const baseIso = makeIsoTimestamp(index, 0);
  return [
    jsonLine({
      timestamp: baseIso,
      type: "session_meta",
      payload: {
        id: rootId,
        timestamp: baseIso,
        cwd: `/tmp/jin-scale/codex-${pad(index, 4)}`,
        originator: "Codex Desktop",
        source: "vscode",
        git: {
          branch: "feat/rewrite-ontology",
          repository_url: "https://github.com/example/jin.git",
        },
      },
    }),
    jsonLine({
      timestamp: makeIsoTimestamp(index, 1),
      type: "turn_context",
      payload: {
        turn_id: `${rootId}-turn-1`,
        cwd: `/tmp/jin-scale/codex-${pad(index, 4)}`,
        model: "gpt-5.4",
      },
    }),
    jsonLine({
      timestamp: makeIsoTimestamp(index, 2),
      type: "response_item",
      payload: {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: `Investigate scale trace ${index}` }],
      },
    }),
    jsonLine({
      timestamp: makeIsoTimestamp(index, 3),
      type: "response_item",
      payload: {
        type: "message",
        role: "assistant",
        model: "gpt-5.4",
        content: [{ type: "output_text", text: `Starting trace ${index}.` }],
      },
    }),
    jsonLine({
      timestamp: makeIsoTimestamp(index, 4),
      type: "compacted",
      payload: {
        replacement_history: [
          {
            type: "message",
            role: "user",
            content: [{ type: "input_text", text: `Compacted summary for trace ${index}` }],
          },
          {
            type: "compaction",
            encrypted_content: `gAAAAA-codex-${pad(index, 4)}`,
          },
        ],
      },
    }),
    jsonLine({
      timestamp: makeIsoTimestamp(index, 5),
      type: "turn_context",
      payload: {
        turn_id: `${rootId}-turn-2`,
        cwd: `/tmp/jin-scale/codex-${pad(index, 4)}`,
        model: "gpt-5.4",
      },
    }),
    jsonLine({
      timestamp: makeIsoTimestamp(index, 6),
      type: "response_item",
      payload: {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: `Apply the patch and delegate validation for trace ${index}` }],
      },
    }),
    jsonLine({
      timestamp: makeIsoTimestamp(index, 7),
      type: "response_item",
      payload: {
        type: "function_call",
        id: `${rootId}-spawn-call`,
        call_id: `${rootId}-spawn`,
        name: "spawn_agent",
        arguments: JSON.stringify({
          agent_type: "default",
          message: `Validate Codex trace ${index}`,
        }),
      },
    }),
    jsonLine({
      timestamp: makeIsoTimestamp(index, 8),
      type: "response_item",
      payload: {
        type: "function_call_output",
        call_id: `${rootId}-spawn`,
        output: JSON.stringify({
          agent_id: childId,
          nickname: `Verifier-${pad(index, 4)}`,
        }),
      },
    }),
    jsonLine({
      timestamp: makeIsoTimestamp(index, 9),
      type: "response_item",
      payload: {
        type: "custom_tool_call",
        call_id: `${rootId}-patch`,
        name: "apply_patch",
        input: `*** Begin Patch\\n*** Add File: note-${pad(index, 4)}.txt\\n+patched ${index}\\n*** End Patch`,
      },
    }),
    jsonLine({
      timestamp: makeIsoTimestamp(index, 10),
      type: "response_item",
      payload: {
        type: "custom_tool_call_output",
        call_id: `${rootId}-patch`,
        output: JSON.stringify({
          exit_code: 0,
          duration_seconds: 1.25,
          output: `Applied trace ${index}`,
        }),
      },
    }),
    jsonLine({
      timestamp: makeIsoTimestamp(index, 11),
      type: "event_msg",
      payload: {
        type: "token_count",
        info: {
          last_token_usage: {
            input_tokens: 240 + index,
            output_tokens: 60 + index,
            cached_input_tokens: 20,
            reasoning_output_tokens: 11,
          },
        },
      },
    }),
    jsonLine({
      timestamp: makeIsoTimestamp(index, 12),
      type: "response_item",
      payload: {
        type: "reasoning",
        summary: [],
        encrypted_content: `gAAAAA-reasoning-${pad(index, 4)}`,
      },
    }),
    jsonLine({
      timestamp: makeIsoTimestamp(index, 13),
      type: "response_item",
      payload: {
        type: "message",
        role: "assistant",
        model: "gpt-5.4",
        content: [{ type: "output_text", text: `Trace ${index} patch applied and delegated.` }],
      },
    }),
  ].join("\n");
}

function buildCodexChildTrace(index: number, rootId: string, childId: string): string {
  return [
    jsonLine({
      timestamp: makeIsoTimestamp(index, 20),
      type: "session_meta",
      payload: {
        id: childId,
        timestamp: makeIsoTimestamp(index, 20),
        cwd: `/tmp/jin-scale/codex-${pad(index, 4)}`,
        source: {
          subagent: {
            thread_spawn: {
              parent_thread_id: rootId,
              depth: 1,
              agent_nickname: `Verifier-${pad(index, 4)}`,
              agent_role: "reviewer",
            },
          },
        },
        forked_from_id: rootId,
      },
    }),
    jsonLine({
      timestamp: makeIsoTimestamp(index, 21),
      type: "turn_context",
      payload: {
        turn_id: `${childId}-turn-1`,
        cwd: `/tmp/jin-scale/codex-${pad(index, 4)}`,
        model: "gpt-5.4-mini",
      },
    }),
    jsonLine({
      timestamp: makeIsoTimestamp(index, 22),
      type: "response_item",
      payload: {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: `Verify trace ${index}` }],
      },
    }),
    jsonLine({
      timestamp: makeIsoTimestamp(index, 23),
      type: "response_item",
      payload: {
        type: "function_call",
        call_id: `${childId}-exec`,
        name: "exec_command",
        arguments: JSON.stringify({ cmd: "bun test test/perf-datasets/scale-datasets.test.ts" }),
      },
    }),
    jsonLine({
      timestamp: makeIsoTimestamp(index, 24),
      type: "response_item",
      payload: {
        type: "function_call_output",
        call_id: `${childId}-exec`,
        output: `trace ${index} validated`,
      },
    }),
    jsonLine({
      timestamp: makeIsoTimestamp(index, 25),
      type: "response_item",
      payload: {
        type: "message",
        role: "assistant",
        model: "gpt-5.4-mini",
        content: [{ type: "output_text", text: `Trace ${index} looks correct.` }],
      },
    }),
  ].join("\n");
}

function buildClaudeParentTrace(index: number, parentId: string, childId: string): string {
  return [
    jsonLine({
      parentUuid: null,
      isSidechain: false,
      cwd: `/tmp/jin-scale/claude-${pad(index, 4)}`,
      sessionId: parentId,
      gitBranch: "",
      type: "user",
      message: {
        role: "user",
        content: `Root task ${index}: inspect the logs and summarize the result.`,
      },
      uuid: `${parentId}-user-1`,
      timestamp: makeIsoTimestamp(index, 30),
    }),
    jsonLine({
      parentUuid: `${parentId}-user-1`,
      isSidechain: false,
      cwd: `/tmp/jin-scale/claude-${pad(index, 4)}`,
      sessionId: parentId,
      gitBranch: "",
      type: "assistant",
      message: {
        role: "assistant",
        model: "claude-opus-4-5-20251101",
        content: [
          {
            type: "thinking",
            thinking: `Plan trace ${index} before using tools.`,
          },
        ],
        usage: {
          input_tokens: 10 + index,
          output_tokens: 3,
          cache_creation_input_tokens: 4,
          cache_read_input_tokens: 2,
        },
      },
      uuid: `${parentId}-assistant-thinking`,
      timestamp: makeIsoTimestamp(index, 31),
    }),
    jsonLine({
      parentUuid: `${parentId}-assistant-thinking`,
      isSidechain: false,
      cwd: `/tmp/jin-scale/claude-${pad(index, 4)}`,
      sessionId: parentId,
      gitBranch: "",
      type: "assistant",
      message: {
        role: "assistant",
        model: "claude-opus-4-5-20251101",
        content: [
          {
            type: "text",
            text: `I'll ask a sub-agent to inspect logs for trace ${index}.`,
          },
          {
            type: "tool_use",
            id: `${parentId}-tool-task-1`,
            name: "Task",
            input: {
              subagent_session_id: childId,
              prompt: `Inspect trace ${index} logs and report back.`,
            },
          },
        ],
        usage: {
          input_tokens: 12,
          output_tokens: 8,
          cache_creation_input_tokens: 1,
          cache_read_input_tokens: 0,
        },
      },
      uuid: `${parentId}-assistant-task`,
      timestamp: makeIsoTimestamp(index, 32),
    }),
    jsonLine({
      parentUuid: `${parentId}-assistant-task`,
      isSidechain: false,
      cwd: `/tmp/jin-scale/claude-${pad(index, 4)}`,
      sessionId: parentId,
      gitBranch: "",
      type: "user",
      message: {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: `${parentId}-tool-task-1`,
            content: [
              {
                type: "text",
                text: `Spawned child ${childId} for trace ${index}.`,
              },
            ],
            is_error: false,
          },
        ],
      },
      uuid: `${parentId}-tool-result`,
      timestamp: makeIsoTimestamp(index, 33),
    }),
    jsonLine({
      type: "system",
      subtype: "compact_boundary",
      sessionId: parentId,
      cwd: `/tmp/jin-scale/claude-${pad(index, 4)}`,
      uuid: `${parentId}-boundary-1`,
      timestamp: makeIsoTimestamp(index, 34),
      compactMetadata: {
        trigger: "manual",
        preTokens: 2048 + index,
      },
    }),
    jsonLine({
      type: "summary",
      sessionId: parentId,
      cwd: `/tmp/jin-scale/claude-${pad(index, 4)}`,
      uuid: `${parentId}-summary-1`,
      timestamp: makeIsoTimestamp(index, 35),
      summary: `Summary of earlier work for trace ${index}`,
    }),
    jsonLine({
      parentUuid: `${parentId}-summary-1`,
      isSidechain: false,
      cwd: `/tmp/jin-scale/claude-${pad(index, 4)}`,
      sessionId: parentId,
      gitBranch: "",
      type: "user",
      message: {
        role: "user",
        content: `Continue after compaction for trace ${index}.`,
      },
      uuid: `${parentId}-user-2`,
      timestamp: makeIsoTimestamp(index, 36),
    }),
    jsonLine({
      parentUuid: `${parentId}-user-2`,
      isSidechain: false,
      cwd: `/tmp/jin-scale/claude-${pad(index, 4)}`,
      sessionId: parentId,
      gitBranch: "",
      type: "assistant",
      message: {
        role: "assistant",
        model: "claude-opus-4-5-20251101",
        content: [
          {
            type: "text",
            text: `Post-compaction answer for trace ${index}.`,
          },
        ],
        usage: {
          input_tokens: 6,
          output_tokens: 7,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 1,
        },
      },
      uuid: `${parentId}-assistant-2`,
      timestamp: makeIsoTimestamp(index, 37),
    }),
  ].join("\n");
}

function buildClaudeChildTrace(index: number, childId: string): string {
  return [
    jsonLine({
      parentUuid: null,
      isSidechain: false,
      cwd: `/tmp/jin-scale/claude-${pad(index, 4)}`,
      sessionId: childId,
      gitBranch: "",
      type: "user",
      message: {
        role: "user",
        content: `Inspect logs for trace ${index}.`,
      },
      uuid: `${childId}-user-1`,
      timestamp: makeIsoTimestamp(index, 38),
    }),
    jsonLine({
      parentUuid: `${childId}-user-1`,
      isSidechain: false,
      cwd: `/tmp/jin-scale/claude-${pad(index, 4)}`,
      sessionId: childId,
      gitBranch: "",
      type: "assistant",
      message: {
        role: "assistant",
        model: "claude-opus-4-5-20251101",
        content: [
          {
            type: "text",
            text: `Trace ${index} logs show no persistent failure.`,
          },
        ],
        usage: {
          input_tokens: 8,
          output_tokens: 9,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
        },
      },
      uuid: `${childId}-assistant-1`,
      timestamp: makeIsoTimestamp(index, 39),
    }),
  ].join("\n");
}

function walkFiles(root: string): string[] {
  const files: string[] = [];
  if (!existsSync(root)) {
    return files;
  }

  for (const entry of readdirSync(root).sort()) {
    const fullPath = join(root, entry);
    const stats = statSync(fullPath);
    if (stats.isDirectory()) {
      files.push(...walkFiles(fullPath));
      continue;
    }
    files.push(fullPath);
  }

  return files;
}

function sortRefs(
  refs: Array<{ id: string; sourcePath: string; adapterId: string }>,
): Array<{ id: string; sourcePath: string; adapterId: string }> {
  return [...refs].sort((left, right) => {
    const pathCompare = left.sourcePath.localeCompare(right.sourcePath);
    return pathCompare !== 0 ? pathCompare : left.id.localeCompare(right.id);
  });
}

function compareExpectedRefs(left: ExpectedRef, right: ExpectedRef): number {
  const pathCompare = left.sourcePath.localeCompare(right.sourcePath);
  return pathCompare !== 0 ? pathCompare : left.id.localeCompare(right.id);
}

function ensureTrailingNewline(contents: string): string {
  return contents.endsWith("\n") ? contents : `${contents}\n`;
}

function pruneEmptyParents(target: string, stopAt: string): void {
  let current = dirname(target);
  while (current.startsWith(stopAt) && current !== stopAt) {
    if (!existsSync(current)) {
      current = dirname(current);
      continue;
    }
    if (readdirSync(current).length > 0) {
      return;
    }
    rmSync(current, { recursive: true, force: true });
    current = dirname(current);
  }
}

function jsonLine(value: Record<string, unknown>): string {
  return JSON.stringify(value);
}

function makeIsoTimestamp(index: number, offsetSeconds: number): string {
  const baseMs = Date.UTC(2026, 3, 8, 12, 0, 0);
  const totalSeconds = (index - 1) * 60 + offsetSeconds;
  return new Date(baseMs + totalSeconds * 1000).toISOString();
}

function makeUuid(prefix: string, index: number): string {
  return `${prefix}-${String(index).padStart(12, "0")}`;
}

function pad(value: number, width: number): string {
  return String(value).padStart(width, "0");
}
