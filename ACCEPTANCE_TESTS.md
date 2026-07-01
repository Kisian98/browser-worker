# Browser Worker Acceptance Tests

Date created: 2026-06-27  
Last synced: 2026-06-29 after PR #14

This checklist defines what must be true before phase-one browser-worker implementation is considered real. It is intentionally evidence-based: a checkbox is not complete unless there is a command, output, artifact path, or source-grounded inspection proving it.

## Status meanings

- **Not started** — no implementation or verification yet.
- **Skeleton only** — structure exists, but real browser/service behavior is not connected.
- **Implemented, unverified** — code exists, but no reliable verification evidence yet.
- **Verified** — command/output/artifact proves the behavior.
- **Blocked / needs input** — cannot proceed without Kristian's decision or missing environment access.

## Current baseline

As of 2026-06-29:

- `/DATA/browser-stack` has a minimal Node HTTP service with isolated Playwright `capturePage` baseline.
- `GET /health` exists.
- `POST /v1/browser/jobs` exists.
- `response-envelope.js` exists.
- `browser-capture.js` exists.
- CI passed on PR #14 before merge.
- Accepted public `capturePage` jobs now launch Playwright, capture final URL/title/status, persist request/response JSON, and write screenshot, HTML, and text artifacts when successful.
- Redirect and final URL policy re-checking is wired into the isolated capture flow.
- Blocked policy and capture-failure paths defensively remove screenshot, HTML, and text artifacts before returning envelopes with null artifact paths.
- Dialog, popup/new-tab, and download events are now reported through structured capturePage output and covered by controlled fixture tests.
- Broader browser actions, `storageState`, and persistent profiles are still intentionally not connected.

## Phase-one acceptance checklist

### A-001 — Test suite runs cleanly

**Status:** Verified in CI for PR #14 / local smoke evidence still useful  
**Requirement:** `npm test` passes from `/DATA/browser-stack`.  
**Verification command:**

```bash
npm test
```

**Acceptance evidence:** CI passed on the PR #14 head before merge. Local command output remains useful for environment-specific verification.

### A-002 — Service starts locally

**Status:** Skeleton only  
**Requirement:** The service starts with the documented start command and listens on the configured local/internal port.  
**Verification command:**

```bash
PORT=3080 npm start
```

**Acceptance evidence required:** Startup log plus successful health check.

### A-003 — Health endpoint responds without launching browser

**Status:** Skeleton only  
**Requirement:** `GET /health` returns JSON with `ok: true`, service name, version, and healthy status.  
**Verification command:**

```bash
curl -sS http://127.0.0.1:3080/health
```

**Acceptance evidence required:** JSON response with `ok: true` and `service: browser-worker`.

### A-004 — Job endpoint rejects invalid JSON cleanly

**Status:** Skeleton only  
**Requirement:** Invalid JSON returns HTTP 400 and a structured response envelope with `ok: false`, `status: failed`, and error code `invalid_json`.  
**Verification command:**

```bash
printf '{bad json' | curl -sS -i -X POST http://127.0.0.1:3080/v1/browser/jobs -H 'content-type: application/json' --data-binary @-
```

**Acceptance evidence required:** HTTP 400 and structured error envelope.

### A-005 — Job endpoint rejects invalid URLs cleanly

**Status:** Skeleton only  
**Requirement:** Missing, relative, malformed, or non-HTTP(S) URLs return HTTP 400 and structured error code `invalid_url`.  
**Verification command:**

```bash
curl -sS -i -X POST http://127.0.0.1:3080/v1/browser/jobs -H 'content-type: application/json' -d '{"url":"file:///etc/passwd","action":"capturePage"}'
```

**Acceptance evidence required:** HTTP 400 and structured `invalid_url` envelope.

### A-005b — Job endpoint rejects unknown actions cleanly

**Status:** Verified for skeleton  
**Requirement:** Unknown actions return HTTP 400 and structured error code `invalid_action`; phase-one accepts `capturePage`.  
**Verification command:**

```bash
curl -sS -i -X POST http://127.0.0.1:3080/v1/browser/jobs -H 'content-type: application/json' -d '{"url":"https://example.com","action":"capture"}'
```

**Acceptance evidence:** Node tests verify old `capture` is rejected with `invalid_action`, while `capturePage` is accepted.

### A-006 — Private-network URL is blocked by default

**Status:** Verified for pre-navigation request policy and implemented for redirect/final URL re-checking  
**Requirement:** Requests for localhost, loopback, RFC1918/private ranges, link-local, metadata IPs, Docker/internal networks, and private-resolving hostnames are denied before browser navigation. Redirected document navigations and final URLs are also checked before capture output is trusted.  
**Verification commands:**

```bash
curl -sS -i -X POST http://127.0.0.1:3080/v1/browser/jobs -H 'content-type: application/json' -d '{"url":"http://127.0.0.1:80","action":"capturePage"}'
curl -sS -i -X POST http://127.0.0.1:3080/v1/browser/jobs -H 'content-type: application/json' -d '{"url":"http://192.168.1.1/","action":"capturePage"}'
curl -sS -i -X POST http://127.0.0.1:3080/v1/browser/jobs -H 'content-type: application/json' -d '{"url":"http://169.254.169.254/","action":"capturePage"}'
```

**Acceptance evidence:**

- unit tests cover malformed/non-HTTP URLs, loopback, `0.0.0.0`, RFC1918/private, metadata, IPv6 loopback/unique-local, IPv4-mapped blocked targets, DNS-resolution failure handling, and hostnames resolving to blocked IPs;
- server test covers loopback rejection with structured `private_network_denied`;
- browser-capture tests cover redirected private document navigation being aborted before screenshot capture;
- server tests cover blocked policy responses cleaning page artifacts and persisting structured blocked envelopes.

### A-007 — Public URL capture loads a real page

**Status:** Verified for isolated `capturePage` baseline  
**Requirement:** An isolated session can load a public URL such as `https://example.com`.  
**Verification command:**

```bash
curl -sS -X POST http://127.0.0.1:3080/v1/browser/jobs -H 'content-type: application/json' -d '{"url":"https://example.com","action":"capturePage","session":{"mode":"isolated"}}'
```

**Acceptance evidence:**

- server test covers accepted `capturePage` response shape with screenshot, HTML, and text path reporting only after files exist;
- earlier local smoke test against `https://example.com` returned `ok: true`, `finalUrl: https://example.com/`, title `Example Domain`, HTTP status `200`, screenshot path under `jobs/<jobId>/screenshot.png`, and no `browser_execution_not_yet_connected` warning.

### A-008 — Screenshot artifact is written

**Status:** Verified for isolated `capturePage` baseline  
**Requirement:** A capture job writes a screenshot under that job's artifact directory when screenshot capture succeeds.  
**Acceptance evidence:**

- server test injects a capture implementation that writes a screenshot file, verifies `artifacts.screenshot` is non-null, and verifies the screenshot file exists on disk;
- browser-capture test verifies screenshot creation on successful capture;
- local smoke test produced a screenshot at `jobs/<jobId>/screenshot.png` with non-zero size (`17117` bytes).

### A-009 — HTML and text artifacts are written

**Status:** Implemented and covered by tests / runtime smoke evidence still useful  
**Requirement:** A successful capture job writes `page.html` and `text.txt` under that job's artifact directory.  
**Acceptance evidence:**

- `browser-capture` test verifies `page.content()` is written to `page.html` and visible body text is written to `text.txt` on successful capture;
- server test verifies `artifacts.html` and `artifacts.text` are reported only when the files exist;
- server tests verify failed and blocked jobs clean partial HTML/text artifacts before returning null paths.

### A-010 — Request and response JSON are persisted

**Status:** Verified for accepted jobs and failure/blocked paths  
**Requirement:** Each accepted job writes `request.json` and `response.json` into the job artifact directory.  
**Acceptance evidence:** Server tests create a temporary artifact root, submit valid `capturePage` requests, verify both files exist as valid JSON, check `request.json` equals the submitted request, and check `response.json` equals the returned envelope.

### A-011 — Response envelope points to correct artifact paths

**Status:** Verified for accepted jobs  
**Requirement:** JSON responses include deterministic artifact directory/path metadata matching the files written on disk.  
**Acceptance evidence:** Server tests verify `artifacts.directory` is `jobs/<jobId>`, `artifacts.request` and `artifacts.response` point under that directory, the job directory exists, `downloads/` exists under the job directory, and screenshot/HTML/text paths are only non-null when the files exist.

### A-012 — Browser resources are cleaned up after each job

**Status:** Verified for isolated Playwright baseline  
**Requirement:** Browser contexts/pages/processes do not leak across completed isolated jobs.  
**Acceptance evidence:** Dedicated `browser-capture` unit tests verify page, context, and browser `close()` are called on both success and failure paths.

### A-013 — Dialogs are handled deterministically

**Status:** Verified  
**Requirement:** Alert/confirm/prompt dialogs do not hang jobs; default policy dismisses or records them.  
**Acceptance evidence:** Controlled fixture test in `test/browser-capture.test.js` emits a dialog event, `runIsolatedCapturePage` dismisses it, and the job completes with the dialog reported in `events.dialogs`.

### A-014 — Downloads are captured under job artifacts

**Status:** Verified  
**Requirement:** Downloads triggered during a job are saved under the job's `downloads/` artifact subdirectory and reported in the response.  
**Acceptance evidence:** Controlled fixture test in `test/browser-capture.test.js` emits a download event, `runIsolatedCapturePage` sanitizes the suggested filename, saves the file under the job downloads directory, and reports the saved path via `events.downloads` and `artifacts.downloads`.

### A-015 — Popups/new tabs are recorded or controlled

**Status:** Verified  
**Requirement:** Popup/new-tab behavior is not silently lost; it is recorded, blocked, or folded into structured output according to policy.  
**Acceptance evidence:** Controlled fixture test in `test/browser-capture.test.js` emits a popup event, `runIsolatedCapturePage` records the popup URL/title, and the job completes without leaking browser pages.

### A-016 — Login/captcha/block signals are represented

**Status:** Not started  
**Requirement:** The response envelope includes structured signals for likely login requirement, captcha, cookie/banner, and blocked states.  
**Acceptance evidence required:** At minimum, schema tests; later, fixture or public-page smoke examples.

### A-017 — Isolated session does not persist cookies/state by default

**Status:** Verified for controlled isolated fixture  
**Requirement:** Two isolated jobs do not share cookies/localStorage/sessionStorage.  
**Acceptance evidence:** `test/browser-capture.test.js` runs a controlled real-browser fixture through `runIsolatedCapturePage` twice against the same local origin, sets cookie/localStorage/sessionStorage in job 1, and verifies job 2 does not read those values.

### A-018 — `storageState` mode is explicit and segregated

**Status:** Not started / later phase candidate  
**Requirement:** Saved auth/session state is used only when explicitly requested and stored separately from per-run artifacts.  
**Acceptance evidence required:** Export/import smoke test plus filesystem path check.

### A-019 — Named persistent profile is explicit and locked down

**Status:** Not started / later phase candidate  
**Requirement:** Persistent profile use requires an explicit approved name such as `marketing-tools`; profile data is segregated from run artifacts and not used for untrusted broad browsing.  
**Acceptance evidence required:** Explicit profile request works; default jobs do not use it; concurrent access policy is defined.

### A-020 — Old shell/demo baseline remains preserved

**Status:** Skeleton only  
**Requirement:** Existing old runtime under `/opt/data/browser-stack` remains untouched until replacement service passes acceptance tests.  
**Acceptance evidence required:** File inventory before/after implementation shows old baseline still present or migration explicitly documented.

### A-021 — Docker/container run path works

**Status:** Not started  
**Requirement:** The service builds/runs through the approved Docker/Compose path using the environment-specific Docker config where relevant.  
**Verification command shape:**

```bash
sudo DOCKER_CONFIG=/DATA/docker-client docker compose up --build
```

**Acceptance evidence required:** Build/start output, health check from host, and artifact mount verification.

### A-022 — Service is not publicly exposed by accident

**Status:** Verified for direct-run default  
**Requirement:** Phase-one service binds only to localhost or an explicitly approved internal-only network surface.  
**Acceptance evidence:**

- `server.js` now defaults to `127.0.0.1` via `getListenConfig()`.
- Explicit override requires `BROWSER_WORKER_HOST`.
- Tests cover default host/port and explicit override.
- Runtime smoke check on 2026-06-27: `curl http://127.0.0.1:3080/health` returned healthy JSON.

**Remaining note:** Docker/container binding still needs separate verification when the Docker runtime path is implemented.

## Phase-one completion gate

Phase one is not complete until all required phase-one items above are either:

1. **Verified**, with evidence recorded; or
2. explicitly marked **Deferred** with Kristian's approval and a clear reason.

Minimum phase-one gate should include A-001 through A-012, A-017, A-020, A-021, and A-022. Items A-013 through A-016 may be implemented as reliability hardening slices if phase-one scope allows, but should at least have schema/policy coverage before broad use.
