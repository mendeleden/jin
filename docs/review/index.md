# Code Review Index

v2 design review findings, split by category. 34 questions total.

| Document | Count | Description |
|----------|------:|-------------|
| [bugs.md](bugs.md) | 7 | Confirmed broken behavior |
| [dead-code.md](dead-code.md) | 9 | Unused code — ~785 lines removable |
| [architecture.md](architecture.md) | 13 | Structural issues, responsibility confusion |
| [design-decisions.md](design-decisions.md) | 11 | v2 choices (10 decided, 1 pending) |
| [knowledge.md](knowledge.md) | 6 | How things work — reference, no action |

## Priority Order

1. **BUG-1** (Q15): Route matching doesn't glob — highest impact
2. **BUG-2** (Q32): Shared-DB stat cache — affects 3 adapters
3. **ARCH-7** (Q25): PID file scattering — root cause of lifecycle confusion
4. **ARCH-11** (Q33): watch.ts 8 jobs — blocks all other cleanup
5. Everything else follows from the roadmap phases

## Cross-Reference: Q# → Category

| Q | Category | ID |
|---|----------|----|
| Q1 | Architecture | ARCH-1 |
| Q2 | Knowledge | KB-1 |
| Q3 | Design Decision | DEC-1 |
| Q4 | Dead Code | DEAD-1 |
| Q5 | Dead Code | DEAD-2 |
| Q6 | Bug | BUG-6 |
| Q7 | Design Decision | DEC-9 |
| Q8 | Dead Code | DEAD-3 |
| Q9 | Architecture | ARCH-2 |
| Q10 | Architecture | ARCH-3 |
| Q11 | Bug + Architecture | BUG-3, ARCH-4 |
| Q12 | Dead Code | DEAD-4 |
| Q13 | Dead Code | DEAD-5 |
| Q14 | Design Decision | DEC-2 |
| Q15 | Bug + Design Decision | BUG-1, DEC-1, DEC-3 |
| Q16 | Design Decision | PENDING-1 |
| Q17 | Knowledge | KB-2 |
| Q18 | Architecture | ARCH-6 |
| Q19 | Architecture | ARCH-5 |
| Q20 | Design Decision | DEC-4 |
| Q21 | Design Decision | DEC-5 |
| Q22 | Knowledge | KB-3 |
| Q23 | Design Decision | DEC-6 |
| Q24 | Bug | BUG-5 |
| Q25 | Architecture + Dead Code | ARCH-7, DEAD-8, DEAD-9 |
| Q26 | Design Decision | DEC-7 |
| Q27 | Architecture | ARCH-8 |
| Q28 | Knowledge + Design Decision | KB-4, DEC-10 |
| Q29 | Bug | BUG-7 |
| Q30 | Architecture | ARCH-9 |
| Q31 | Bug + Architecture | BUG-4, ARCH-10 |
| Q32 | Bug | BUG-2 |
| Q33 | Knowledge + Architecture | KB-5, ARCH-11 |
| Q34 | Architecture | ARCH-12, ARCH-13 |
