# Run 1 — Make the project understandable

Scope: inspect `/DATA/browser-stack`, preserve runtime behavior, document current state for humans and future agents.

Hard boundary: do not modify `worker.js`, `Dockerfile.worker`, `docker-compose.yml`, or `browser-worker`.

Expected outputs:
- `/DATA/browser-stack/PROJECT_CONTEXT.md`
- `/DATA/browser-stack/AGENT_HANDOFF.md`
- supporting notes in this run directory

Inspection result in this environment: the expected runtime files were not present at `/DATA/browser-stack` during this prep run. The existing files were documentation under `agent-runs/browser-worker-prep`. This is recorded as a blocker; implementation must not proceed until the real project files are visible and re-inspected.
