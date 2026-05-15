---
title: Isolate Bun module mock tests
date: 2026-05-14
tags: [testing, bun, ci, integration]
related: [W4-CONFIG-01]
---

# Isolate Bun Module Mock Tests

## Problem

Raw `bun test` runs every test file in one Bun test process. Jin has several
focused command/lifecycle tests that use top-level `mock.module()` with partial
module replacements. Those replacements are process-global, so unrelated test
files can import stale partial mocks and fail for reasons unrelated to product
behavior.

The same raw run also pulled the local Postgres persona test into the unit
surface. That test requires a Docker-backed database on `localhost:5444`, so it
should be an explicit integration gate rather than an accidental unit-test side
effect.

## Solution

Add an isolated test runner at `scripts/test.ts`:

- `bun run test` runs every non-integration `.test.ts` file in its own Bun
  process.
- `bun run test:integration` starts the Docker Postgres service, runs the
  persona Postgres test, and tears the service down.
- `bun run test:all` runs the isolated unit suite plus the Docker-backed
  integration suite.

The leaking mock-heavy files also restore mocks at suite end, and the runtime
cutover updater mock now exports `VERSION` so any accidental overlap is less
fragile.

## Key Insight

For Bun, top-level `mock.module()` is not a file-local isolation boundary.
Tests that mock command/runtime modules should either run in separate processes
or avoid partial module mocks. Process isolation is the least surprising default
for Jin because many tests intentionally mock singleton runtime modules.

## Prevention

Use `bun run test` for local unit validation instead of raw `bun test`. Use
`bun run test:integration` when validating the Postgres persona path. If a new
test adds top-level module mocks, make sure it passes through the isolated
runner and does not rely on global ordering with other files.

## Related

- `W4-CONFIG-01` config mutation and push cutover validation

## Files Changed

- `scripts/test.ts`
- `package.json`
- `test/*` mock-heavy command/runtime tests
