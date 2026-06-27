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
- direct-run startup defaulting to `127.0.0.1:3080`, with explicit `BROWSER_WORKER_HOST` / `PORT` override.
- `capturePage` as the accepted phase-one action.
- structured `invalid_action` errors for unknown actions.
- Node test-runner coverage for the envelope, service responses, listen config, and action validation.

Known intended longer-term flow:

```text
host wrapper -> sudo DOCKER_CONFIG=/DATA/docker-client docker compose run --rm browser-worker -> node worker.js/server.js -> Playwright opens Chromium -> structured JSON job response
```

The current service does not yet launch Playwright. Successful `capturePage` requests deliberately include `browser_execution_not_yet_connected` so callers do not mistake the skeleton envelope for real browser capture.

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

## Implementation guardrails

- Keep old `/opt/data/browser-stack` runtime files as fallback/reference until the replacement service passes acceptance tests.
- Do not treat the old shell/demo runtime as the rebuild source of truth.
- Keep implementation in small reviewed branches with tests and documentation updates.
- Update the Projects Hub vault after every merged PR.

## Next implementation step

Build the URL/private-network policy module before any real browser navigation:

1. parse and validate HTTP(S) URLs;
2. resolve hostnames;
3. classify returned IPs;
4. deny loopback, RFC1918/private, link-local, metadata, Docker/internal, multicast/special-use ranges as appropriate;
5. return structured policy errors such as `private_network_denied`.
