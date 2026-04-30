---
title: Windows service task identity must match runtime scope
date: 2026-04-30
tags: [daemon, windows, service, lifecycle, config]
related: [PR-45, BP-08, BP-07]
---

# Windows service task identity must match runtime scope

## Problem

Jin's Windows service install path moved to a per-user limited Scheduled Task
principal, but the task identity stayed as a bare machine-global `jin` task
name. That created a scope mismatch:

- install intent was per-user
- service object identity stayed effectively global
- runtime ownership and updater control still resolved by `TaskName 'jin'`

This makes lifecycle actions ambiguous and fragile once service ownership is not
truly machine-global.

## Solution

Use a product-scoped, user-scoped Scheduled Task identity and route every
Windows service control path through the same canonical identity.

Jin now uses:

- task path: `\\Jin\\`
- task name: `jin-agent-<sid>`

The same identity is used for:

- install and uninstall
- status and active-service detection
- service stop during lifecycle control
- updater service restart/detection

## Key Insight

On Windows, a per-user principal does not make the Scheduled Task identity
per-user. The task object itself must encode the ownership boundary. If runtime
scope is per-user, task identity must also be per-user.

## Prevention

- Treat service identity as a shared lifecycle primitive, not a string literal
  embedded independently in install, status, stop, and updater code.
- Add focused tests around Windows runtime-owner detection whenever Scheduled
  Task lookups change.
- Review service-manager changes against the runtime-ownership blueprint, not
  just the install path.

## Related

- PR `#45` durable follow-up over the original no-admin Windows service install
- `docs/blueprint/BP-08-routing-and-config.md`
- `docs/blueprint/mermaid/bp-07-runtime-ownership-and-startup.mmd`

## Files Changed

- `src/windows-task.ts`
- `src/commands/service.ts`
- `src/daemon/runtime-state.ts`
- `src/daemon/process-state.ts`
- `src/updater.ts`
- `test/runtime-state-local-owner.test.ts`
