# Review Prompt - W4-CONFIG-01

Review the implementation of `docs/execution/tasks/W4-CONFIG-01-daemon-reload-control.md`.

Use a code-review mindset. Findings first, ordered by severity, with file and line references.

## Required Read Order

1. `docs/execution/00-global-rules.md`
2. `docs/execution/01-dispatch-protocol.md`
3. `docs/execution/tasks/W4-CONFIG-01-daemon-reload-control.md`
4. `docs/ontology.md`
5. `docs/blueprint/BP-07-process-lifecycle.md`
6. `docs/blueprint/BP-08-routing-and-config.md`
7. Changed files in the implementation

## Review Questions

- Does the command path persist config before daemon notification?
- Does reload go through the daemon local API and existing auth?
- Does the daemon delegate to the coordinator reload work item?
- Does file watching remain a fallback rather than the only apply mechanism?
- Are daemon-unavailable and notification-failure cases clear to users?
- Are secrets excluded from any new response or logs?
- Are tests sufficient for command path, local API auth, and fallback behavior?
- Does the implementation violate BP-07, BP-08, or ontology language?

## Output

Return findings first. Then include open questions, tests reviewed, BP acceptance matrix result, and V1 comparison.
