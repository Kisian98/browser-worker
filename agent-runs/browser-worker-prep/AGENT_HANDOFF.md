# Browser Worker Prep — Agent Handoff

## What to do next
1. Verify that the actual project root exists at `/DATA/browser-stack` in the target environment.
2. Inspect runtime files before editing anything.
3. Compare the current implementation against the intended one-shot CLI baseline.
4. Only after inspection, decide whether to implement the next phase: a narrow HTTP JSON boundary.

## Guardrails
- Do not edit runtime files during prep.
- Do not replace the one-shot CLI runner yet.
- Keep browser access isolated from Hermes secrets, memory, and unrelated filesystem mounts.
- Prefer structured JSON output and explicit timeouts.

## Suggested acceptance criteria for the next implementation phase
- Existing CLI runner still works.
- A single browser task can return structured JSON reliably.
- Browser launch is non-root or otherwise hardened where compatible.
- Shared filesystem surface is narrow and documented.
- Timeouts, errors, and screenshots are reported consistently.
