# Code Quality Audit — 2026-03-29

## Scope
Full codebase review across 72 TypeScript files for typos, spelling errors, syntax issues, and misleading labels.

## Areas Reviewed
- `src/adapters/` (12 files)
- `src/commands/` (16 files)
- `src/sinks/` (6 files)
- `src/` root (13 files)
- `test/`, `src/api/`, `src/tui/`, config files (25 files)

## Findings

### Fixed

1. **Unused import in `src/adapters/amp.ts`**
   - `ToolUse` type was imported but never referenced
   - Tool call objects used inline literals matching the shape structurally
   - Fix: Removed unused import

2. **Misleading label in `src/commands/export.ts` (line ~75)**
   - The markdown export labeled `updatedAt` as "Duration" — `updatedAt` is a datetime, not a duration
   - `show.ts` correctly labeled the same field as "Updated"
   - Fix: Changed label from "Duration" to "Updated"

### Observations (not bugs, tracked separately)

- **Dead code**: `getExt()` function in `watch.ts` (lines 554-558) defined but never called. Already tracked in code review findings.
- **Code duplication**: `parseSince()` function duplicated identically in 3 files (`export.ts`, `list.ts`, `search.ts`). Candidate for extraction to a shared utility.
- **Ambiguous time unit**: `parseSince` uses `m` for minutes, which could be confused with months. Consistent across all copies but worth noting.

## Overall Assessment

The codebase is in excellent shape — 72 files reviewed with only 2 minor issues found. No syntax errors, no misspelled variable names, no broken string literals.

## Recommendations for Preventing Future Issues

### 1. Enable stricter TypeScript lint rules
Add `@typescript-eslint/no-unused-imports` (or the Biome equivalent) to catch unused imports at build time. This would have caught the `ToolUse` import in `amp.ts` automatically.

### 2. Extract shared utilities
The `parseSince()` duplication across 3 files increases the surface for drift. Extract to `src/utils/time.ts` or similar so changes propagate automatically.

### 3. Label consistency checks in templates
When multiple commands render the same field (e.g., `updatedAt`), use a shared formatter or constant for the label string. This prevents the "Duration" vs "Updated" inconsistency.

### 4. Pre-commit type checking
Ensure `bun run typecheck` (tsc --noEmit) runs in CI and ideally as a pre-commit hook. This catches unused imports and type errors before they land.

### 5. Periodic automated audits
Run a quarterly code quality sweep (like this one) to catch issues that slip through automated tooling — misleading labels, dead code, naming inconsistencies.

---

*Audit performed by 5 parallel review agents covering adapters, commands, sinks, core, and tests.*
