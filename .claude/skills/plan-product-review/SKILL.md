---
name: plan-product-review
description: Strategic review of a plan — is this the right thing to build? Evaluates scope, user value, timing, and opportunity cost. Run on plans before /plan-arch-review.
argument-hint: "[plan name or path]"
---

# Product Review: $ARGUMENTS

Evaluate a plan from the product/strategic lens. This is not about *how* to build it — it's about *whether* to build it, *how much* to build, and *when*.

## Process

### 1. Load the Plan

Find the plan in `docs/plans/`. Read it fully.

### 2. Four Evaluation Modes

Score each dimension 1-5 and provide reasoning:

#### Scope Check (Is this the right size?)

- Is this trying to do too much at once? Should it be split?
- Is it too small to matter? Would a slightly larger scope deliver disproportionately more value?
- Does the scope match the roadmap phase? (e.g., don't solve Phase 4 problems in Phase 0)
- **Score**: [1-5] — 1 = wildly wrong scope, 5 = perfectly scoped

#### Value Check (Does anyone care?)

- Who benefits from this change? Individual developer? Team lead? Prismatic analytics?
- How would they know it worked? What's the observable improvement?
- Is this solving a real problem (from `docs/review/bugs.md` or user reports) or a theoretical one?
- **Score**: [1-5] — 1 = no clear beneficiary, 5 = obvious high-impact

#### Timing Check (Is now the right time?)

- Does this depend on other work that hasn't been done yet?
- Does other work depend on this? (Is it blocking?)
- Is there a reason to do this now vs later? (Urgency, dependencies, learning that informs later phases)
- Cross-reference `docs/v2-roadmap.md` for phase ordering.
- **Score**: [1-5] — 1 = clearly wrong time, 5 = exactly the right moment

#### Cost Check (What are we giving up?)

- What else could we work on instead? Is this the highest-leverage use of time?
- Does this create follow-on work? (New columns = new adapter extraction = new tests)
- Is this reversible if it turns out to be wrong?
- **Score**: [1-5] — 1 = massive hidden cost, 5 = low cost with clear payoff

### 3. Decision

Based on the four scores:

| Total Score | Decision |
|-------------|----------|
| 16-20 | **Proceed** — move to `/plan-arch-review` |
| 12-15 | **Conditional** — address noted concerns, then proceed |
| 8-11 | **Revise** — scope or timing needs significant rework |
| 4-7 | **Park** — not the right thing or not the right time |

### 4. Recommendations

```
## Product Review: [plan title]

| Dimension | Score | Key Concern |
|-----------|-------|-------------|
| Scope | [N]/5 | [one-line] |
| Value | [N]/5 | [one-line] |
| Timing | [N]/5 | [one-line] |
| Cost | [N]/5 | [one-line] |
| **Total** | **[N]/20** | |

**Decision**: [Proceed | Conditional | Revise | Park]

**Conditions** (if conditional):
1. [What must change before proceeding]

**Alternative** (if revise/park):
- [What to do instead]
```

Present to user for decision. Don't auto-proceed — this is a human judgment gate.
