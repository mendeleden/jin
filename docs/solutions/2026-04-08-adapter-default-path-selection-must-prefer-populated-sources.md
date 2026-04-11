---
title: Adapter default path selection must prefer populated sources
date: 2026-04-08
tags: [adapter, config, pipeline, daemon]
related: [W3-ADAPTER-06, W3-PERF-02]
---

# Adapter default path selection must prefer populated sources

## Problem

The live Claude Code adapter was enabled, but the daemon did not ingest any
Claude Code sessions because the adapter selected the wrong default directory.

On the affected machine:

- `~/.config/claude/projects` existed but contained `0` JSONL files
- `~/.claude/projects` existed and contained `900` JSONL files

The adapter chose the XDG path solely because it existed:

- [src/adapters/claude-code.ts](/Users/edenmendel/Documents/GitHub/jin/src/adapters/claude-code.ts#L140)

That bug also exists on `main`.

## Solution

The immediate live workaround was to set:

```json
{
  "adapters": {
    "claude-code": {
      "enabled": true,
      "dataDir": "/Users/edenmendel/.claude/projects"
    }
  }
}
```

That confirmed the path-selection bug was real: once `dataDir` pointed at the
legacy directory, `claude-code` immediately appeared in runtime status.

## Key Insight

For adapters with multiple plausible default roots, `existsSync(path)` is not a
strong enough selection rule.

The correct selection rule is closer to:

- prefer a user-provided override first
- otherwise prefer the first path that contains parseable source data
- only fall back to a mere "exists" check when the source format makes that
  meaningful

This is a distinct bug class from parser correctness or RSS budgeting. An
adapter can be "enabled" yet silently ingest nothing because an empty preferred
path shadows the real populated path.

## Prevention

- Add default-path precedence tests that model:
  - empty preferred path
  - populated fallback path
  - both populated
  - user override
- Do not rely only on reference tests that inject `projectsDir` or `dataDir`,
  because those bypass default path selection entirely
- Review other fallback selectors for the same pattern, especially adapters that
  return the first existing candidate

## Related

- `main:src/adapters/claude-code.ts` carries the same bug
- `test/claude-code-reference-adapter.test.ts` primarily injects `projectsDir`,
  so it does not currently catch this default-path precedence failure
- `src/adapters/kiro.ts` has a similar "first existing candidate wins" shape
  that should be audited for stale-path shadowing

## Files Changed

- none yet; this note captures the live finding and the need for a dedicated
  adapter follow-on
