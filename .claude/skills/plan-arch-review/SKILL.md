---
name: plan-arch-review
description: Architecture review of a plan — is this the right way to build it? Evaluates technical approach, risk, v2 compliance, and implementation sequence. Run after /plan-product-review.
argument-hint: "[plan name or path]"
---

# Architecture Review: $ARGUMENTS

Evaluate a plan from the technical/architecture lens. The product review said *what* to build — this validates *how*.

## Process

### 1. Load the Plan

Find the plan in `docs/plans/`. Read it fully. Also read the product review output if it exists.

### 2. Deep Research

Before evaluating, understand the current state. Launch parallel research:

- **Read all files** the plan proposes to modify — understand current implementation
- **Check review findings**: `docs/review/architecture.md` — does this plan address or conflict with known ARCH-* issues?
- **Check ontology**: `docs/ontology.md` — does the approach comply with v2 data model?
- **Check existing solutions**: `docs/solutions/` — has a related approach been tried before?

### 3. Six Evaluation Dimensions

Score each 1-5:

#### v2 Compliance

- Does this align with the v2 ontology? (Conversation not Session, tool_calls table, git_remote not projects, etc.)
- Does it use PRAGMA user_version migrations (not ad-hoc schema checks)?
- Does it respect the Postgres no-DDL contract?
- Are new types using discriminated unions where appropriate?
- **Score**: [1-5]

#### Dependency Order

- Does the implementation sequence respect dependencies? (Can't modify adapters before types exist)
- Does it match the roadmap phase ordering?
- Are there implicit dependencies the plan doesn't mention? (e.g., needs config changes before store changes)
- **Score**: [1-5]

#### Risk Assessment

- What's the worst-case failure mode? Data loss? Silent corruption? Crash?
- Is the plan reversible? Can we `git revert` without leaving the database in a broken state?
- Does it touch cross-cutting concerns? (e.g., changing the Adapter interface affects all 10 adapters)
- **Score**: [1-5]

#### Simplicity

- Is this the simplest approach that works? Could we do less?
- Does it introduce new abstractions? Are they justified?
- Does it increase or decrease the codebase size?
- Would the simplicity reviewer approve?
- **Score**: [1-5]

#### Test Coverage

- Does the plan include a testing strategy?
- Are the critical paths covered? (Happy path + error cases + edge cases)
- Can the changes be validated with `bun test` + `bun run typecheck`, or do they need manual verification?
- **Score**: [1-5]

#### Migration Safety (if applicable)

- Does this change the SQLite schema? Is migration handled?
- Does this affect push behavior? Could sinks receive bad data?
- Does this change ID generation? Could it break push log history?
- If not applicable, score 5 (no risk).
- **Score**: [1-5]

### 4. Architecture Concerns

List specific technical issues found during review:

```
### Concerns

1. **[P1 — must fix]**: [description] — [file:line or plan section]
2. **[P2 — should fix]**: [description]
3. **[P3 — consider]**: [description]
```

### 5. Decision

| Total Score | Decision |
|-------------|----------|
| 24-30 | **Approved** — proceed to `/work` |
| 18-23 | **Conditional** — fix concerns, re-review if P1s exist |
| 12-17 | **Redesign** — approach needs significant rework |
| 6-11 | **Reject** — fundamentally wrong approach |

### 6. Report

```
## Architecture Review: [plan title]

| Dimension | Score | Key Concern |
|-----------|-------|-------------|
| v2 Compliance | [N]/5 | [one-line] |
| Dependency Order | [N]/5 | [one-line] |
| Risk | [N]/5 | [one-line] |
| Simplicity | [N]/5 | [one-line] |
| Test Coverage | [N]/5 | [one-line] |
| Migration Safety | [N]/5 | [one-line] |
| **Total** | **[N]/30** | |

**Decision**: [Approved | Conditional | Redesign | Reject]

**P1 Concerns** (must fix before proceeding):
1. [concern]

**Suggested Changes**:
1. [specific change to the plan]
```

Present to user. If conditional with P1 concerns, the plan must be updated before `/work` begins.
