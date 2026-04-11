Work in `/Users/edenmendel/Documents/GitHub/jin`.

Use session name `codex-WORKER-cursor-live-layer3`.

You are not alone in the shared canonical workspace. Other workers may still
touch nearby files. Stay strictly inside this packet's owned files and do not
revert anyone else's edits.

Read in order:
1. `docs/execution/00-global-rules.md`
2. `docs/execution/01-dispatch-protocol.md`
3. `docs/execution/04-frozen-contract-surface.md`
4. `docs/execution/05-live-control-plane.md`
5. `docs/execution/tasks/W3-ADAPTER-10-cursor-live-layer3-decode-and-revalidation.md`

Then read the shared control plane first:
- `.execution/program.md`
- `.execution/packets/W2-ADAPTER-03.md`
- `.execution/packets/W3-VALIDATE-01.md`
- `.execution/packets/W3-ADAPTER-09.md`
- `.execution/packets/W3-ADAPTER-10.md`

Before coding, create or update your heartbeat at
`.execution/agents/codex-WORKER-cursor-live-layer3.md` with:
- preferred session name: `codex-WORKER-cursor-live-layer3`
- packet id: `W3-ADAPTER-10`
- branch / worktree / container: `feat/rewrite-ontology` / `canonical repo workspace` / `local`
- status: `in_progress`

Then execute the packet exactly.

Current live facts:
- `W3-VALIDATE-01` found `6` Cursor refs, `0` bundles loaded, and `6`
  null bundles on the real local dataset
- direct local probes still show
  `~/Library/Application Support/Cursor/User/globalStorage/state.vscdb`
  fails `bun:sqlite` readonly open with `unable to open database file`
- live layer3 `~/.cursor/chats/**/store.db` files are readable
- the first sampled live layer3 `blobs.data` rows are binary /
  protobuf-framed, while the current layer3 reader only handles JSON parses

Constraints:
- only edit packet-owned files
- do not edit `src/contracts/**`, `src/pipeline/**`, or `src/sinks/**`
- use the real local Cursor dataset as validation input if needed

Deliverables:
- Cursor live layer3 decode fix if adapter-local
- honest handling of the layer1 DB-open degraded path
- focused regression tests
- Cursor-only live validation rerun
- durable audit artifact
- completion report in the packet format
