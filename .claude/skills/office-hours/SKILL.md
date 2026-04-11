---
name: office-hours
description: Reframe a product or design problem through forcing questions. Use before brainstorm/plan when the problem itself is unclear, not just the solution. Good for "should we even do this?" questions.
argument-hint: "[idea, concern, or product question]"
---

# Office Hours: $ARGUMENTS

Stress-test the problem itself before exploring solutions. This is not brainstorming approaches — this is questioning whether the question is right.

## Process

### 1. Restate the Problem

In one sentence, what is the user actually trying to achieve? Not the technical ask — the outcome they want.

Then ask: "Is this the real problem, or a symptom of something else?"

### 2. Forcing Questions

Work through these six questions. Each one forces a different angle on the problem:

**Q1: Who benefits and how do they know?**
Jin serves developers who want visibility into their AI coding tool usage. But specifically — who is this change for? The individual developer? The team lead? Prismatic's analytics dashboard? The answer changes the design.

**Q2: What happens if we don't do this?**
What's the actual cost of the status quo? Is something broken, or is it just inelegant? If we skip this entirely, what's the worst case? Sometimes "do nothing" is the right answer.

**Q3: What's the simplest version that delivers 80% of the value?**
Strip away all the nice-to-haves. What's the smallest possible change that meaningfully improves things? Can we ship that first and learn from it?

**Q4: What are we assuming that might be wrong?**
Every design has hidden assumptions. Common Jin assumptions to challenge:
- "All adapters work the same way" (they don't — shared-DB vs file-per-session)
- "We need this data" (do we? who queries it?)
- "This should be in the daemon" (should it? could it be a one-shot command?)
- "Prismatic needs this" (have we verified with the actual analytics layer?)

**Q5: What would make this decision easy to reverse?**
If we're wrong, how expensive is the rollback? Design for reversibility. Prefer additive changes (new columns) over destructive ones (dropped tables). Prefer feature flags over hard migrations.

**Q6: What's the adjacent problem this creates?**
Every solution opens new questions. If we add `branch` to conversations, now we need branch detection in every adapter. If we add `labels`, now we need label management UI. Name the follow-on work honestly — is the total cost still worth it?

### 3. Pressure Test Against Jin's Reality

Cross-reference the idea against:
- **`docs/review/`** — Does this relate to a known bug or architecture issue? If so, the urgency is different than a net-new feature.
- **`docs/v2-roadmap.md`** — Is this already planned? In which phase? Would doing it now disrupt the sequence?
- **`docs/ontology.md`** — Does the v2 data model already accommodate this, or would it require schema changes?

### 4. Reframe

Based on the forcing questions, restate the problem in a sharper way. Often the reframed version is smaller, clearer, or reveals that the real problem is something adjacent.

Present:
```
Original framing: [what the user asked]
Reframed: [what the real problem is]
Recommendation: [proceed to /brainstorm | proceed to /plan | park it | do nothing]
```

### 5. Save (if substantial)

If the office hours session produced a meaningful reframe, save to `docs/brainstorms/` with:

```markdown
---
title: "Office Hours: [topic]"
date: [ISO date]
status: reframed
outcome: [proceed | parked | killed]
---

[Content from the session]
```

Not every office hours session needs saving. Quick "yes, proceed" conversations don't need a doc.
