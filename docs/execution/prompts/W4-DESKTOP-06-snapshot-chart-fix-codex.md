# W4-DESKTOP-06 Snapshot Chart Fix Worker

You are a worker on the Jin repo. You are not alone in the codebase: do not revert edits made by others. Keep changes narrow and typed.

## Goal

Fix the remaining Desktop Home chart issue after the React cutover:

- `TokenUsageChart` currently renders snapshot-derived aggregate data as a single day.
- With one x-coordinate, the stacked area path collapses into a vertical strip even though the panel has visible height.
- The chart should show a visible full-width graph/band for snapshot aggregate data without inventing a fake trend and without doubling totals in KPIs.
- Preserve the existing controlled sidebar `Cost (estimated)` popover behavior.

## Expected Approach

- Work primarily in `desktop/components/app-shell.tsx`.
- If `chart.source === "snapshot"` and there is exactly one `UsageDayBucket`, derive a display-only set of buckets for SVG geometry, e.g. a two-point constant band representing the same aggregate adapter distribution across the plot width.
- Keep KPI totals, callout values, and adapter totals based on the canonical snapshot bucket, not the duplicated display buckets.
- Avoid misleading labels. Prefer labels like `Snapshot` / `Current` or keep the callout as `Current snapshot`.
- Update `test/desktop-renderer.test.ts` so the snapshot-derived chart asserts it has more than one distinct x-coordinate in the area path and still reports the snapshot totals once.
- Do not introduce legacy HTML renderers or `dangerouslySetInnerHTML`.

## Validation

Run:

```bash
bun run desktop:typecheck
bun test test/desktop-renderer.test.ts test/desktop-shell-service.test.ts test/desktop-home-route.test.ts
bun run desktop:build
git diff --check
```

Final response must include:

- Files changed.
- Validation results.
- Any residual risk.
