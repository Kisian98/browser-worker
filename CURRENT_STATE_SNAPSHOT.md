# Browser Worker Current State Snapshot

Date created: 2026-06-27

This snapshot records the project state before deeper implementation work. It is the starting line for the brick-by-brick rebuild.

## Project root

Current rebuild/planning root:

```text
/DATA/browser-stack
```

Old shell/demo runtime root:

```text
/opt/data/browser-stack
```

## Current project files observed

Top-level current files under `/DATA/browser-stack`:

```text
ACCEPTANCE_TESTS.md
AGENT_HANDOFF.md
BROWSER_WORKER_IMPLEMENTATION_SPEC.md
CURRENT_STATE_SNAPSHOT.md
DECISIONS.md
IMPLEMENTATION_APPROACH.md
IMPLEMENTATION_NOTES.md
PROJECT_CONTEXT.md
README.md
RESEARCH_NOTES.md
TODAY_GOALS_2026-06-27.md
package.json
response-envelope.js
server.js
test/response-envelope.test.js
test/server.test.js
agent-runs/browser-worker-prep/...
```

## Runtime/code state

The current rebuild has a minimal Node service skeleton:

- `package.json`
  - project name: `browser-worker`
  - version: `0.1.0`
  - module type: `module`
  - scripts:
    - `npm test` -> `node --test`
    - `npm start` -> `node server.js`
  - no dependencies currently declared

- `response-envelope.js`
  - exports `createResponseEnvelope(...)`
  - normalizes top-level response shape:
    - `ok`
    - `jobId`
    - `startedAt`
    - `endedAt`
    - `durationMs`
    - `status`
    - `page`
    - `signals`
    - `extraction`
    - `artifacts`
    - `warnings`
    - `errors`
  - provides defaults for page/signals/extraction/artifacts
  - normalizes structured errors

- `server.js`
  - exports `createServer()`
  - `GET /health` returns minimal healthy JSON
  - `POST /v1/browser/jobs` reads JSON, validates URL, and returns a structured envelope
  - valid capture responses currently include warning `browser_execution_not_yet_connected`
  - does not launch Playwright yet
  - does not create artifact directories yet
  - starts on `PORT` or `3080`, binding `0.0.0.0` when run directly

## Tests currently present

- `test/response-envelope.test.js`
  - success envelope shape/defaults
  - failed envelope with normalized errors

- `test/server.test.js`
  - invalid URL produces structured failure envelope
  - capture request produces structured envelope

## Verified command output

Command run from `/DATA/browser-stack` on 2026-06-27:

```bash
npm test
```

Result:

```text
> browser-worker@0.1.0 test
> node --test

TAP version 13
# Subtest: createResponseEnvelope returns a completed success envelope with stable top-level shape
ok 1 - createResponseEnvelope returns a completed success envelope with stable top-level shape
# Subtest: createResponseEnvelope returns a failed envelope with normalized structured errors
ok 2 - createResponseEnvelope returns a failed envelope with normalized structured errors
# Subtest: POST /v1/browser/jobs returns structured envelope for invalid URL errors
ok 3 - POST /v1/browser/jobs returns structured envelope for invalid URL errors
# Subtest: POST /v1/browser/jobs returns structured envelope for capture requests
ok 4 - POST /v1/browser/jobs returns structured envelope for capture requests
1..4
# tests 4
# suites 0
# pass 4
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 168.744946
```

## Git/repository state

Resolved on 2026-06-27:

- Remote repository: `git@github.com:Kisian98/browser-worker.git`
- GitHub SSH access verified.
- Remote `main` exists and initially contained `LICENSE`.
- `/DATA/browser-stack` has been initialized as a git working tree on `main`, tracking `origin/main`.
- Working branch created: `feature/browser-worker-service-foundation`.
- Current blocker before committing: git author name/email for this environment.

Command checks:

```bash
git ls-remote git@github.com:Kisian98/browser-worker.git HEAD
git ls-remote --heads git@github.com:Kisian98/browser-worker.git
git status --short --branch
```

Observed:

```text
2ef0b3f877f8a4918b7b45875f693f135067f244 HEAD
2ef0b3f877f8a4918b7b45875f693f135067f244 refs/heads/main
## main...origin/main
```

## Port/binding state

Kristian approved port `3080` if available. A local bind test on 2026-06-27 confirmed:

```text
port_3080_available_on_127.0.0.1=yes
```

Phase-one service binding should be localhost/internal-only. Current `server.js` direct-run binding to `0.0.0.0` remains a known fix-before-runtime item.

## Old shell/demo runtime state

Old runtime found under `/opt/data/browser-stack` includes at least:

```text
/opt/data/browser-stack/worker.js
/opt/data/browser-stack/docker-compose.yml
/opt/data/browser-stack/Dockerfile.worker
/opt/data/browser-stack/README.md
/opt/data/browser-stack/browser-extract.mjs
/opt/data/browser-stack/package.template.json
/opt/data/browser-stack/package.json
/opt/data/browser-stack/stagehand-smoke-template.mjs
/opt/data/browser-stack/.playwright/...
```

Role: reference/fallback only. It should not be treated as the rebuild source of truth.

## What is intentionally not connected yet

- Playwright browser launch from the HTTP service.
- Real navigation/capture behavior.
- Screenshot/HTML/text artifact writing.
- Request/response persistence under job artifact directories.
- URL/private-network deny policy.
- Session registry or lifecycle management.
- `storageState` support.
- Persistent profile support.
- Docker/Compose service path for the rebuild.
- Container hardening.

## Known commands

Current local commands:

```bash
cd /DATA/browser-stack
npm test
PORT=3080 npm start
```

Known legacy/environment-specific Docker command shape to preserve where relevant:

```bash
sudo DOCKER_CONFIG=/DATA/docker-client docker compose run --rm browser-worker
```

## Open environment/project questions

- Which GitHub repository/remote should own `/DATA/browser-stack`?
- Should `/DATA/browser-stack` be initialized as a new repo, connected to an existing repo, or copied into another project root?
- Which branch naming convention should be used for implementation?
- Which host port should expose the HTTP service?
- Should direct service binding remain localhost/internal-only in phase one? Current default: yes.
- Should initial job action naming standardize on `capturePage` rather than existing skeleton tests using `capture`?
- Is persistent profile support part of phase one implementation or only phase-one design?

## Current risk notes

- `server.js` currently binds to `0.0.0.0` when started directly. This may conflict with the intended local/internal-only default and should be addressed before broader runtime use.
- Tests currently use `action: 'capture'`, while `BROWSER_WORKER_IMPLEMENTATION_SPEC.md` prefers `capturePage`; this naming should be reconciled before freezing the API.
- `AGENT_HANDOFF.md` still says runtime files were not visible under `/DATA/browser-stack`; later docs clarify they were found under `/opt/data/browser-stack`. The handoff may need a cleanup/update pass.
