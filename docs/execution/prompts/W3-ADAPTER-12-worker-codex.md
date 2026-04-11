Work in `/Users/edenmendel/Documents/GitHub/jin`.

Use session name `codex-WORKER-cursor-followup`.

You are not alone in the shared canonical workspace. Other workers may still
touch nearby files. Stay strictly inside this packet's owned files and do not
revert anyone else's edits.

Read in order:
1. `docs/execution/00-global-rules.md`
2. `docs/execution/01-dispatch-protocol.md`
3. `docs/execution/04-frozen-contract-surface.md`
4. `docs/execution/05-live-control-plane.md`
5. `docs/execution/tasks/W3-ADAPTER-12-cursor-tool-stitching-and-layer1-metadata-followup.md`

Then read the shared control plane first:
- `.execution/program.md`
- `.execution/packets/W3-VALIDATE-01.md`
- `.execution/packets/W3-ADAPTER-10.md`
- `.execution/packets/W3-ADAPTER-12.md`

Before coding, create or update your heartbeat at
`.execution/agents/codex-WORKER-cursor-followup.md` with:
- preferred session name: `codex-WORKER-cursor-followup`
- packet id: `W3-ADAPTER-12`
- branch / worktree / container: `feat/rewrite-ontology` / `canonical repo workspace` / `local`
- status: `in_progress`

Then execute the packet exactly.

Current live facts:
- Codex has already confirmed the current `src/adapters/cursor.ts` still has
  the same reverse-walk tool-result matcher that can collapse repeated
  same-name Layer 3 tools onto the last tool use
- Layer 1 `cwd` still only checks generic path keys and does not read
  `workspaceUris`
- Layer 1 assistant bubbles still hardcode `thinkingContent: ""`
- `docs/adapters/cursor/index.md` is still materially stale and claims the
  adapter is Layer 3-only

Constraints:
- only edit packet-owned files
- do not edit pipeline/store/sink/runtime files
- use the current local Cursor dataset for any real-data validation you need

Deliverables:
- confirmed/stale triage of the report items
- Cursor adapter fix(es) for the confirmed adapter-local issues
- focused regression tests
- doc refresh for the owned stale Cursor surfaces
- packet-local audit
- completion report in the packet format
