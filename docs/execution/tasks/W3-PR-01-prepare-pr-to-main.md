# W3-PR-01: Prepare PR to main from Approved Baseline

## Role

Codex worker packet.

## Goal

Prepare a clean PR to `main` from the approved baseline at commit `3bed8dd`
without pulling in the canonical workspace's in-progress changes.

If GitHub auth permits, push the branch and open the PR. If auth fails, stop
after preparing the branch and PR body, and record the exact blocker.

## Baseline

- canonical repo: `/Users/edenmendel/Documents/GitHub/jin`
- approved PR baseline commit: `3bed8dd`
- clean worktree path: `/tmp/jin-w3-pr-01`
- PR branch: `codex/w3-pr-01-20260408`

## Includes

The PR should cover the approved baseline through `3bed8dd`, including:
- `W3-TEAM-01`
- `W3-RUNTIME-01`
- `W3-V2-01`
- `W3-RECOVERY-01`
- `W3-ADAPTER-05`
- `W3-PERF-01`

## Excludes

Do not include:
- in-progress `W3-ADAPTER-06`
- `W3-SERVICE-01`
- `W3-BIN-01`
- unapproved E2E or local smoke artifacts
- any canonical-workspace dirty files

## Read In Order

1. `/Users/edenmendel/Documents/GitHub/jin/docs/execution/00-global-rules.md`
2. `/Users/edenmendel/Documents/GitHub/jin/docs/execution/01-dispatch-protocol.md`
3. `/Users/edenmendel/Documents/GitHub/jin/docs/execution/05-live-control-plane.md`
4. `/Users/edenmendel/Documents/GitHub/jin/docs/execution/tasks/W3-PR-01-prepare-pr-to-main.md`

Then read the control plane:
- `/Users/edenmendel/Documents/GitHub/jin/.execution/program.md`
- `/Users/edenmendel/Documents/GitHub/jin/.execution/blueprints.md`
- `/Users/edenmendel/Documents/GitHub/jin/.execution/packets/W3-PERF-01.md`
- `/Users/edenmendel/Documents/GitHub/jin/.execution/reviews/2026-04-08-W3-PERF-01-codex-recheck.md`

## Worktree

- operate in `/tmp/jin-w3-pr-01`
- do not edit product code in the canonical workspace

## Owned Files In Canonical Repo

- `/Users/edenmendel/Documents/GitHub/jin/docs/execution/audits/2026-04-08-W3-PR-01-pr-prep.md`

## Deliverables

- clean worktree checked out at `3bed8dd`
- branch `codex/w3-pr-01-20260408`
- PR body draft written into the audit artifact
- if auth permits:
  - branch pushed to `origin`
  - PR opened against `main`
  - PR URL recorded in the audit artifact

## Suggested Commands

Within the worktree:

1. verify clean baseline:
   - `git status --short`
   - `git log --oneline -n 1`
2. inspect delta to `main`:
   - `git log --oneline origin/main..HEAD`
   - `git diff --stat origin/main...HEAD`
3. prepare a concise PR title and body based on the approved packets
4. if auth works:
   - `git push -u origin codex/w3-pr-01-20260408`
   - `gh pr create --base main --head codex/w3-pr-01-20260408 --title ... --body-file ...`

## Acceptance Checks

- PR branch is clean and based on `3bed8dd`
- PR body accurately describes included/excluded work
- if auth fails, the audit artifact records that exactly and stops there

## Stop And Escalate

Stop if:
- the clean worktree cannot be created from `3bed8dd`
- the branch contains unapproved changes
- push or PR creation is blocked by auth/network

## Completion Report

```md
Completed:
- ...

Files changed:
- ...

Tests run:
- ...

BP acceptance matrix:
- no product BP change; PR-prep packet only

V1 comparison:
- no prior v1 surface

BP alignment:
- no blueprint state change; PR-prep only

Risks / follow-ups:
- ...

Blocked / needs Codex:
- ...
```
