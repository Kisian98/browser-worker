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
IMPLEMENTATION_DEPENDENCY_MAP.md
IMPLEMENTATION_NOTES.md
PHASE_ONE_SCOPE.md
PROJECT_CONTEXT.md
README.md
RESEARCH_NOTES.md
RISKS_AND_BUGS.md
TARGETED_RESEARCH_2026-06-27.md
TODAY_GOALS_2026-06-27.md
package.json
artifacts.js
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
  - engines:
    - `node >=20`
  - no runtime dependencies currently declared

- `response-envelope.js`
  - exports `createResponseEnvelope(...)`
  - normalizes implementation-spec top-level response shape:
    - `ok`
    - `jobId`
    - `startedAt`
    - `endedAt`
    - `durationMs`
    - `status`
    - `request`
    - `page`
    - `signals`
    - `extraction`
    - `artifacts`
    - `events`
    - `warnings`
    - `errors`
  - provides defaults for request/page/signals/extraction/artifacts/events
  - normalizes structured errors with `phase`, `retryable`, and `detail` fields

- `server.js`
  - exports `createServer()`
  - exports `getListenConfig()`
  - `GET /health` returns minimal healthy JSON
  - `POST /v1/browser/jobs` reads JSON, validates action, evaluates URL/private-network policy, writes `request.json` / `response.json`, and returns a structured envelope
  - valid capture responses currently include warning `browser_execution_not_yet_connected`
  - does not launch Playwright yet
  - creates deterministic per-job artifact directories under the configured artifact root
  - starts on `PORT` or `3080`, binding `127.0.0.1` by default
  - explicit host override available through `BROWSER_WORKER_HOST`
  - explicit artifact root override available through `BROWSER_WORKER_ARTIFACT_ROOT`

- `artifacts.js`
  - exports helpers for artifact-root-relative job paths
  - creates per-job directories and `downloads/` directories
  - writes formatted JSON files

- `url-policy.js`
  - exports `evaluateUrlPolicy(...)`
  - validates absolute HTTP(S) URLs
  - blocks localhost, loopback, RFC1918/private IPv4, link-local, metadata, selected special-use IPv4 ranges, IPv6 loopback/unique-local/link-local/multicast ranges
  - blocks hostnames that resolve to blocked IPs
  - returns structured `invalid_url` and `private_network_denied` errors

## Tests currently present

- `test/response-envelope.test.js`
  - spec-aligned success envelope shape/defaults
  - failed envelope with normalized errors
  - default `phase` / `retryable` metadata for underspecified errors

- `test/server.test.js`
  - listen config defaults and overrides, including artifact root
  - invalid URL produces structured failure envelope
  - private-network target produces structured `private_network_denied` envelope
  - `capturePage` request produces structured envelope
  - accepted job creates artifact directory and persists `request.json` / `response.json`
  - unsupported requested session mode still reports effective `isolated`
  - unknown action produces structured `invalid_action` failure envelope

- `test/url-policy.test.js`
  - malformed and non-HTTP URL rejection
  - localhost / loopback / unspecified-IPv4 blocking
  - metadata and RFC1918/private blocking
  - IPv6 loopback / unique-local / IPv4-mapped blocked-target rejection
  - structured DNS-resolution failure handling
  - blocked-hostname resolution
  - public target acceptance

## Verified command output

Command run from `/DATA/browser-stack` on 2026-06-28 after the artifact-directory/persistence slice:

```bash
npm test
```

Result:

```text
# tests 20
# pass 20
# fail 0
```

Runtime smoke checks:

```bash
PORT=3080 npm start
curl -sS -X POST http://127.0.0.1:3080/v1/browser/jobs -H 'content-type: application/json' -d '{"url":"http://127.0.0.1:80/","action":"capturePage"}'
curl -sS -X POST http://127.0.0.1:3080/v1/browser/jobs -H 'content-type: application/json' -d '{"url":"https://example.com","action":"capturePage"}'
```

Result:

- loopback target returned structured `private_network_denied`
- public `https://example.com` target still returned a successful skeleton envelope with `browser_execution_not_yet_connected`

## Git/repository state

Resolved on 2026-06-27:

- Remote repository: `git@github.com:Kisian98/browser-worker.git`
- GitHub SSH access verified.
- Repository visibility: private. Verified after a visibility concern by unauthenticated GitHub API and HTML checks returning `404`, while authenticated SSH `git ls-remote` still works.
- Default branch: `main`.
- Foundation PR #1 was merged and closed.
- `/DATA/browser-stack` is the local working tree.
- Local `main` was fast-forwarded to the merged foundation state.
- A follow-up documentation branch was created: `docs/update-current-state-2026-06-27`.
- Git author for Nix's commits: `Nix <nix-assistant@agentmail.to>`.

Command checks:

```bash
git fetch --prune origin
git status --short --branch
git ls-remote git@github.com:Kisian98/browser-worker.git HEAD
curl -sS -o /dev/null -w 'http_code=%{http_code}\n' https://github.com/Kisian98/browser-worker
```

Observed after repo privacy update:

```text
Unauthenticated GitHub API: 404 Not Found
Unauthenticated GitHub HTML: 404
Authenticated SSH git check: 6d67c29a847cb002f2c37985c24c3e1701314463 HEAD
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

## Resolved environment/project questions

- Repository/remote: `git@github.com:Kisian98/browser-worker.git`.
- Repository visibility: private, verified.
- Local root: `/DATA/browser-stack`.
- Default branch: `main`.
- Foundation PR #1 merged and closed.
- Feature branch `feature/browser-worker-service-foundation` was deleted from remote after merge.
- Service port: `3080` approved if available; availability checked on `127.0.0.1`.
- Service binding: localhost/internal-only for phase one.
- Initial action name: `capturePage`.
- Persistent profile timing: after isolated sessions and `storageState` work.
- Old runtime policy: keep `/opt/data/browser-stack` as fallback/reference.

## Remaining environment/project questions

- Whether Docker runtime work starts immediately after local service proof or after browser capture proof.
- Whether future `agent-runs/` logs should remain tracked, be ignored, or be reduced to curated summaries.

## Current risk notes

- Redirect-to-private enforcement still needs to be wired into real browser navigation before Playwright capture is connected.
- Browser execution is intentionally not connected yet; keep `browser_execution_not_yet_connected` visible until real capture works.
- Decide whether future `agent-runs/` logs should remain tracked, be ignored, or be reduced to curated summaries.
