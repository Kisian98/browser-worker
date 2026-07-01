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

- `package.json` with `npm test` and `npm start` scripts plus Playwright dependency.
- Node runtime expectation: Node `>=20`, with `.nvmrc` set to `20`.
- `.github/workflows/ci.yml` running the Node test suite on pull requests and pushes to `main`, including Playwright Chromium installation.
- `browser-capture.js` for isolated Playwright `capturePage` execution, redirect/final URL policy checks, HTML/text capture, screenshot capture, deterministic dialog/popup/download reporting, and cleanup.
- `response-envelope.js` for the implementation-spec aligned structured job response envelope.
- `url-policy.js` for pre-navigation URL/private-network policy.
- `artifacts.js` for artifact root-relative job paths, per-job directory creation, downloads directory creation, and JSON file writes.
- `server.js` with `/health` and `POST /v1/browser/jobs`.
- direct-run startup defaulting to `127.0.0.1:3080`, with explicit `BROWSER_WORKER_HOST` / `PORT` override.
- `capturePage` as the accepted phase-one action.
- structured `invalid_action` errors for unknown actions.
- structured `private_network_denied` errors for blocked private/internal targets.
- isolated `capturePage` jobs that launch Playwright, capture final URL/title/status, write screenshot/HTML/text artifacts when successful, report dialog/popup/download events, and persist `request.json` / `response.json`.
- blocked policy and capture-failure paths that defensively remove page/download artifacts before returning envelopes with null artifact paths.
- Node test-runner coverage for the envelope, service responses, listen config, action validation, URL policy, redirect/final URL policy re-checking, artifact persistence, isolated-session state verification, deterministic browser event reporting, and cleanup behavior.

Known intended longer-term flow:

```text
host wrapper -> sudo DOCKER_CONFIG=/DATA/docker-client docker compose run --rm browser-worker -> node worker.js/server.js -> Playwright opens Chromium -> structured JSON job response
```

## Quick local commands

```bash
npm test
npx playwright install chromium
PORT=3080 npm start
curl -sS http://127.0.0.1:3080/health
curl -sS -X POST http://127.0.0.1:3080/v1/browser/jobs -H 'content-type: application/json' -d '{"url":"https://example.com","action":"capturePage"}'
```

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

Add Docker runtime path verification from clean `main`.

After that:

1. design and implement explicit `storageState` mode;
2. only then consider named persistent profile support and broader bounded browser actions;
3. apply container hardening after the core acceptance path is proven.
