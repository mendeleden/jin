# Adapter Memory Contract Audit — 2026-04-07

**Packet:** `W3-ADAPTER-05`
**Scope:** `src/pipeline/ingest.ts`, all active adapters under `src/adapters/*.ts`, and focused adapter/pipeline tests under `test/`
**Related:** `W3-PERF-01`, `W3-RECOVERY-01`, `docs/solutions/2026-04-08-adapter-memory-contract-gap.md`, `docs/execution/audits/2026-04-07-v2-runtime-bug-audit.md`

## Verdict

The Codex RSS failure points to a **broader blueprint/review gap**, not a
uniform adapter bug class.

- `W3-PERF-01` fixed a real Codex implementation bug: the runtime now narrows
  Codex ingest to one ref per batch and forces reclamation between refs
  (`src/pipeline/ingest.ts:47-49`, `src/pipeline/ingest.ts:124-140`,
  `test/pipeline-spec-gap-closure.test.ts:109-146`).
- The broader gap was that BP-02/BP-04 said "discover is cheap, load is
  expensive" without distinguishing:
  - acceptable bounded structural scans that only compute refs
  - simple one-file/one-ref adapters that reparse locally
  - unsafe discovery-phase full-bundle retention across many sources
- After the audit, only **Claude Code** clearly needs a follow-on code packet.
  The simple file-backed adapters are a documentation/review-gap class, not the
  same retention hazard as the pre-fix Codex path.

## Adapter Classification

| Adapter | Classification | Why |
|---|---|---|
| `codex` | `safe` | `findChanged()` scans one file at a time into `refIds`, clears removed file caches, and forces reclamation after each file; `loadConversation()` builds a one-file model cache instead of retaining many files (`src/adapters/codex.ts:119-152`, `src/adapters/codex.ts:844-1051`). The pipeline still applies packet-local protection with Codex batch size `1` plus explicit GC (`src/pipeline/ingest.ts:47-49`, `src/pipeline/ingest.ts:124-140`). Covered by focused contract and pipeline tests (`test/codex-reference-adapter.test.ts:20-148`, `test/pipeline-spec-gap-closure.test.ts:109-146`). |
| `claude-code` | `follow-on packet needed` | `findChanged()` forces `getFileModel(filePath, true)` for every changed file, and `getFileModel()` persists `FileModel` objects with full `bundles` in `parsedFileCache`; `loadConversation()` then serves clones from that cache (`src/adapters/claude-code.ts:206-281`, `src/adapters/claude-code.ts:501-642`). Parent resolution can also pull parent bundles into memory during discovery/load (`src/adapters/claude-code.ts:912-989`). Tests prove deterministic behavior but do not bound memory (`test/claude-code-reference-adapter.test.ts:21-150`). Recommended follow-on: a Claude Code discover/load memory-split hardening packet. |
| `cursor` | `safe` | Discovery uses signatures over Layer 1 snapshot metadata and Layer 3 file stats/meta, while `loadConversation()` reopens the DB and reads full bubble/blob content per ref (`src/adapters/cursor.ts:104-139`, `src/adapters/cursor.ts:220-336`, `src/adapters/cursor.ts:420-760`). No long-lived full-bundle cache spans many refs. Covered by shared-DB change-detection and load tests (`test/cursor-adapter.test.ts:35-210`). |
| `amp` | `blueprint/doc gap only` | `findChanged()` calls `buildRef()`, which fully parses the file to derive the ID, and `loadConversation()` reparses the same file (`src/adapters/amp.ts:61-90`, `src/adapters/amp.ts:145-176`). One source yields one root ref and nothing is cached across files, so this is a bounded local reparse rather than a retention hazard. Exercised by the bulk-port harness (`test/simple-adapters-bulk-port.test.ts:36-340`). |
| `gemini-cli` | `blueprint/doc gap only` | Same pattern as `amp`: discovery parses the source to build a single ref, then load reparses it (`src/adapters/gemini-cli.ts:48-77`, `src/adapters/gemini-cli.ts:160-190`). Safe only under an explicit one-source/one-ref exception. Covered by the bulk-port harness (`test/simple-adapters-bulk-port.test.ts:36-340`). |
| `opencode` | `blueprint/doc gap only` | Discovery parses the `.json` or `.jsonl` session to derive the ref, then load reparses the same source (`src/adapters/opencode.ts:57-86`, `src/adapters/opencode.ts:168-230`). No multi-source retention, but the blueprint previously did not say this bounded duplicate parse was an allowed exception. Covered by the bulk-port harness (`test/simple-adapters-bulk-port.test.ts:36-340`). |
| `pi` | `blueprint/doc gap only` | Discovery parses the JSONL file to derive the root ID and load reparses it (`src/adapters/pi.ts:48-77`, `src/adapters/pi.ts:149-162`). One file maps to one ref with no retained bundle cache. Covered by the bulk-port harness (`test/simple-adapters-bulk-port.test.ts:36-340`). |
| `piagent` | `blueprint/doc gap only` | Same bounded one-file/one-ref reparse pattern as `pi` (`src/adapters/piagent.ts:48-77`, `src/adapters/piagent.ts:149-162`). Covered by the bulk-port harness (`test/simple-adapters-bulk-port.test.ts:36-340`). |
| `kiro` | `safe` | Discovery reads lightweight row locators and signatures from the shared SQLite store, caches only locator metadata, and load reads messages only for the requested ref (`src/adapters/kiro.ts:87-124`, `src/adapters/kiro.ts:211-334`). No discovery-phase full-bundle retention. Covered by the bulk-port harness (`test/simple-adapters-bulk-port.test.ts:207-340`). |
| `warp` | `safe` | Discovery groups queries into lightweight locators by working directory and signature; load fetches message rows for the requested locator (`src/adapters/warp.ts:91-128`, `src/adapters/warp.ts:215-304`). No retained full-bundle cache across many refs. Covered by the bulk-port harness (`test/simple-adapters-bulk-port.test.ts:267-340`). |

## Cross-Adapter Findings

### 1. Codex was both a real bug and a review-gap signal

Codex was the only adapter whose current implementation needed an actual packet
fix. The pipeline still contains adapter-specific mitigation for that path
(`src/pipeline/ingest.ts:47-49`, `src/pipeline/ingest.ts:124-140`).

But the bug also exposed that the blueprint never said which of these were
acceptable:

- discovery scans that compute ref IDs and immediately release source data
- one-file/one-ref adapters that locally reparse because no cheaper ID source
  exists
- discovery implementations that retain full parsed bundles across many sources

Without that distinction, the same review language could describe both Codex
after the fix and Claude Code before a fix.

### 2. The only remaining adapter-side memory hazard is Claude Code

Claude Code currently inverts the intended cost split:

- discovery builds full `bundles` for each changed file
- those bundles stay resident in `parsedFileCache`
- load is largely a clone/read from that retained cache

That is exactly the pattern the hardened blueprint now marks as out of
contract for rich adapters.

### 3. The simple file adapters are a bounded exception, not a rich-adapter model

`amp`, `gemini-cli`, `opencode`, `pi`, and `piagent` all reparse in discovery
and load, but they share three properties that keep them out of the Codex /
Claude Code hazard class:

- one source file yields one root ref
- no discovery-phase cache retains full bundles across files
- no single file fans out many refs that need sibling reuse

That behavior still needed to be documented explicitly so future reviews do not
confuse "bounded duplicate parse" with "unsafe retained parse".

## Recommended Follow-On

Create a narrow follow-on packet for **Claude Code discover/load memory
hardening**.

Suggested scope:
- move `findChanged()` toward ref/index-only discovery
- stop retaining full `bundles` for many files in `parsedFileCache`
- allow, at most, source-local reuse with explicit eviction
- add one representative memory validation on a multi-file dataset

No other adapter currently needs a code-rewrite packet from this audit alone.

## Reusable Review Checklist

Future adapter packets should answer these questions directly in the handoff or
review artifact:

1. What state does `findChanged()` persist between calls: stats, offsets,
   signatures, ref IDs, parent maps, or full parsed bundles?
2. Does discovery inspect only metadata/indexes, or does it structurally scan
   source content? If it scans, what is the reclamation point?
3. Can one source unit emit multiple refs? If yes, where is sibling-ref reuse
   bounded and where is the source released?
4. Does `loadConversation()` reparse source that discovery already touched? If
   yes, why is that duplicate work acceptable?
5. Can timeout wrappers, promise helpers, or caches pin successful large
   results longer than the pipeline/store boundary needs them?

This checklist is the prevention artifact from `W3-ADAPTER-05`.
