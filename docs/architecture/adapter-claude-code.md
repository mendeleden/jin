# Claude Code adapter (end-to-end)

**Module:** `src/adapters/claude-code.ts`  
**Contract:** `Adapter` in `src/adapters/types.ts` (`detect`, `sessions`, `messages`, `watchPaths`, optional `artifacts`).

## Data roots on disk

| Role | Path |
|------|------|
| Session JSONL (primary) | `~/.config/claude/projects` if present, else `~/.claude/projects` |
| Global Claude tree | `~/.claude` |

**Layout:**

- `<projectsDir>/<projectSlug>/*.jsonl` (including `agent-*.jsonl`).
- Subagents: `<projectsDir>/<projectSlug>/<session-uuid>/subagents/agent-*.jsonl`; parent session id is the folder name above `subagents`.

## `detect()`

True if `projectsDir` exists and some subdirectory contains at least one `*.jsonl`.

## `sessions()`

Walks project folders, uses **`addSessionFromFile`** per JSONL:

- **File cache** keyed by path: reuse metadata when `size` + `mtimeMs` unchanged.
- **Incremental read** when the file grew (tail append).
- **Full parse** for new or truncated files.
- Builds `Session` with `id`, `name`, `adapterId` / `adapterName`, timestamps, `sourcePath`, `isSubAgent`, `parentSessionId`, `isCompacted`, `metadata` (e.g. `cwd`, `slug`, `fileSize`).

## Session ID shape

1. Prefer **`sessionId`** from JSONL lines when present.
2. Fallback: **`basename(filePath, ".jsonl")`** if no line supplied `sessionId`.

**Lookup by id (`findSessionFile`):** scans candidate files; first line JSON must satisfy `sessionId === id` or `uuid === id`.

## `messages(sessionId, sourcePath?)`

- If `sourcePath` exists, parse that file.
- Else resolve via `findSessionFile`, then **`parseMessages`**.

**`RawLine` schema** (per line): `type`, `subtype`, `uuid`, `sessionId`, `timestamp`, optional `message` with `role`, `content`, `usage`, etc.

**`parseMessages` mapping (simplified):**

- `type === "summary"` with summary text → system message, `recordType: "summary"`.
- `type === "system"` → system message; compact metadata for `compact_boundary`, etc.
- `user` / `assistant` with `message` → normal turns; `recordType` from `raw.type`.
- **Content:** string or **content blocks** — text joined, `thinking` → `thinkingBlocks`, `tool_use` / `tool_result` wired with refs.

## `newMessages(sessionId, sourcePath, afterIndex)`

Re-parses the full file and **slices** after `afterIndex` — not part of the `Adapter` interface but used by the watcher for **delta inserts** when `existingCount > 0`.

## `watchPaths()`

Returns a **single** root: `projectsDir` if it exists, for **recursive** `fs.watch`. Avoids registering every subfolder (which previously caused duplicate events).

```309:315:src/adapters/claude-code.ts
  watchPaths(): string[] {
    // Return only the top-level projects directory with recursive watch.
    // Previously returned every subdirectory, causing overlapping watchers
    // that fired 3-6x per file change (each with recursive:true).
    if (!existsSync(this.projectsDir)) return [];
    return [this.projectsDir];
  }
```

## `artifacts()`

Scans `~/.claude`, `~/.claude.json`, and per-project `memory/` under `projectsDir` for `.md`, `.json`, `.jsonl` (size-capped). Produces `ContextArtifact` rows with hashed ids and scopes (`global`, `project`, etc.). Used by **`ingestCommand`**, not the watcher’s `ingestAdapter` path.

## Files

- `src/adapters/claude-code.ts` — implementation
- `src/adapters/types.ts` — shared `Adapter`, `Session`, `Message`, `ContextArtifact` types
