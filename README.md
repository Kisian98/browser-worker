# Browser Stack / Browser Worker

This project is being prepared for a future conversion from a one-shot Playwright CLI runner into a long-running HTTP JSON browser execution service for Hermes.

Hermes should remain the reasoning layer. The browser-worker should remain a constrained browser surface that executes requests, captures artifacts, and returns structured results.

## Current state

The original shell/demo runtime was found under `/opt/data/browser-stack`, not `/DATA/browser-stack`:

- `/opt/data/browser-stack/worker.js`
- `/opt/data/browser-stack/Dockerfile.worker`
- `/opt/data/browser-stack/docker-compose.yml`
- `/opt/data/browser-stack/browser-extract.mjs`

The current `/DATA/browser-stack` tree holds the planning/rebuild docs and the new minimal service skeleton. The old runtime is reference material for the rebuild, not the implementation source of truth.

Implementation has started. The current checked-in/runtime-visible pieces are:

- `package.json` with `npm test` and `npm start` scripts.
- `response-envelope.js` for a stable structured job response envelope.
- `server.js` with `/health` and `POST /v1/browser/jobs`.
- Node test-runner coverage for the envelope and service responses.

Known intended longer-term flow:

```text
host wrapper -> sudo DOCKER_CONFIG=/DATA/docker-client docker compose run --rm browser-worker -> node worker.js/server.js -> Playwright opens Chromium -> structured JSON job response
```

The current service does not yet launch Playwright. Successful capture requests deliberately include `browser_execution_not_yet_connected` so callers do not mistake the skeleton envelope for real browser capture.

## Documentation map

- `PROJECT_CONTEXT.md` — current/target state and constraints.
- `CURRENT_STATE_SNAPSHOT.md` — current starting-line snapshot: files, implemented skeleton, tests, old runtime, commands, risks, and open questions.
- `DECISIONS.md` — canonical decision log: approved decisions, pending human review, deferred revisits, and rejected approaches.
- `ACCEPTANCE_TESTS.md` — phase-one acceptance checklist and evidence requirements.
- `RISKS_AND_BUGS.md` — known risks/bugs/future issue checklist with severity, status, expected fixes, and evidence requirements.
- `AGENT_HANDOFF.md` — instructions for the next agent.
- `IMPLEMENTATION_NOTES.md` — recommended API, workflow, security, tests, and implementation order.
- `IMPLEMENTATION_APPROACH.md` — brick-by-brick implementation guardrails: vertical slices, TDD, branch/commit discipline, milestone definition of done.
- `IMPLEMENTATION_DEPENDENCY_MAP.md` — dependency order for slices and blockers requiring human input.
- `PHASE_ONE_SCOPE.md` — proposed phase-one includes/excludes and completion gate.
- `TODAY_GOALS_2026-06-27.md` — seven main goals for today before deeper implementation: decision log, acceptance tests, current-state snapshot, dependency map, targeted research, phase-one scope, reusable skill alignment.
- `BROWSER_WORKER_IMPLEMENTATION_SPEC.md` — detailed implementation spine for API contract, artifacts, sessions, network policy, reliability/error taxonomy, actions, and acceptance tests.
- `RESEARCH_NOTES.md` — public research findings and practical patterns.
- `TARGETED_RESEARCH_2026-06-27.md` — focused research on Playwright contexts/session state, Node SSRF/private-IP blocking, and traces/artifacts.
- `agent-runs/browser-worker-prep/FINAL_SUMMARY.md` — summary of this prep run.

## Hard rule

Do not edit runtime files until human approval:

- `worker.js`
- `Dockerfile.worker`
- `docker-compose.yml`
- `browser-worker`

## Recommended target

A local HTTP JSON API with:

- explicit job requests;
- isolated sessions by default;
- optional future storageState/session support;
- deterministic artifact directories;
- structured extraction suitable for AI agents;
- bounded timeouts and partial-failure envelopes;
- Docker/browser security hardening when changes are approved.

## Next Human Review

Before allowing implementation, review:

1. Why the expected runtime files were not visible in this prep run.
2. Whether the proposed API contract in `IMPLEMENTATION_NOTES.md` is acceptable.
3. Which port and network exposure are allowed.
4. Whether private-network browsing should be blocked by default.
5. Whether persistent sessions are in scope for phase one.
