# Browser Worker Acceptance Tests

Date created: 2026-06-27  
Last synced: 2026-07-09 for Docker runtime verification repair

This checklist defines what must be true before phase-one browser-worker implementation is considered real. It is intentionally evidence-based: a checkbox is not complete unless there is a command, output, artifact path, or source-grounded inspection proving it.

## Status meanings

- **Not started** — no implementation or verification yet.
- **Skeleton only** — structure exists, but real browser/service behavior is not connected.
- **Implemented, unverified** — code exists, but no reliable verification evidence yet.
- **Verified** — command/output/artifact proves the behavior.
- **Blocked / needs input** — cannot proceed without Kristian's decision or missing environment access.

## Current baseline

As of 2026-07-09:

- `/DATA/browser-stack` has a minimal Node HTTP service with isolated Playwright `capturePage` baseline.
- `GET /health` exists.
- `POST /v1/browser/jobs` exists.
- `response-envelope.js` exists.
- `browser-capture.js` exists.
- CI covers the Node test suite with real Playwright Chromium installation.
- Accepted public `capturePage` jobs launch Playwright, capture final URL/title/status, persist request/response JSON, and write screenshot, HTML, and text artifacts when successful.
- Accepted hostnames are resolved once per job and pinned into Chromium; cross-host redirects/resources, service workers, and WebSockets are denied under the current strict policy.
- Request bodies, browser-job duration, and process-level job concurrency are bounded.
- Blocked policy and capture-failure paths defensively remove screenshot, HTML, text, and download artifacts before returning envelopes with null artifact paths.
- Dialog, popup/new-tab, and download events are reported through structured capturePage output and covered by controlled fixture tests.
- Minimal Docker runtime verification is implemented with `Dockerfile`, `docker-compose.yml`, and `scripts/verify-docker-runtime.sh`; evidence is produced by the Docker runtime CI job or the same script on ZimaOS.
- Broader browser actions, `storageState`, persistent profiles, and container hardening are still intentionally not connected.

## Phase-one acceptance checklist

### A-001 — Test suite runs cleanly

**Status:** Verified in CI / local smoke evidence still useful  
**Requirement:** `npm test` passes from `/DATA/browser-stack`.  
**Verification command:**

```bash
npm test
```

**Acceptance evidence:** CI has passed for the implemented service and hardening slices. Docker runtime verification also runs `npm test` inside the container.

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

**Status:** Verified in automated tests  
**Requirement:** Invalid JSON returns HTTP 400 and a structured response envelope with `ok: false`, `status: failed`, and error code `invalid_json`.  
**Verification command:**

```bash
printf '{bad json' | curl -sS -i -X POST http://127.0.0.1:3080/v1/browser/jobs -H 'content-type: application/json' --data-binary @-
```

**Acceptance evidence:** Server tests cover invalid JSON. Hardening tests also cover the bounded request-body path and structured HTTP 413 `request_body_too_large` response.

### A-005 — Job endpoint rejects invalid URLs cleanly

**Status:** Verified in automated tests  
**Requirement:** Missing, relative, malformed, or non-HTTP(S) URLs return HTTP 400 and structured error code `invalid_url`.  
**Verification command:**

```bash
curl -sS -i -X POST http://127.0.0.1:3080/v1/browser/jobs -H 'content-type: application/json' -d '{"url":"file:///etc/passwd","action":"capturePage"}'
```

**Acceptance evidence:** URL-policy and server tests cover malformed and unsupported URLs.

### A-005b — Job endpoint rejects unknown actions cleanly

**Status:** Verified  
**Requirement:** Unknown actions return HTTP 400 and structured error code `invalid_action`; phase-one accepts `capturePage`.  
**Verification command:**

```bash
curl -sS -i -X POST http://127.0.0.1:3080/v1/browser/jobs -H 'content-type: application/json' -d '{"url":"https://example.com","action":"capture"}'
```

**Acceptance evidence:** Node tests verify old `capture` is rejected with `invalid_action`, while `capturePage` is accepted.

### A-006 — Private-network URL is blocked by default

**Status:** Verified for initial targets, pinned navigation, and intercepted subresources  
**Requirement:** Requests for localhost, loopback, RFC1918/private ranges, link-local, metadata IPs, Docker/internal networks, and private-resolving hostnames are denied. Accepted hostnames are resolved once and the approved address is reused by both policy evaluation and Chromium. Every HTTP(S) request is intercepted; cross-host redirects and resources are denied.  
**Verification commands:**

```bash
curl -sS -i -X POST http://127.0.0.1:3080/v1/browser/jobs -H 'content-type: application/json' -d '{"url":"http://127.0.0.1:80","action":"capturePage"}'
curl -sS -i -X POST http://127.0.0.1:3080/v1/browser/jobs -H 'content-type: application/json' -d '{"url":"http://192.168.1.1/","action":"capturePage"}'
curl -sS -i -X POST http://127.0.0.1:3080/v1/browser/jobs -H 'content-type: application/json' -d '{"url":"http://169.254.169.254/","action":"capturePage"}'
```

**Acceptance evidence:**

- unit tests cover malformed/non-HTTP URLs, loopback, `0.0.0.0`, RFC1918/private, metadata, IPv6 loopback/unique-local, IPv4-mapped blocked targets, DNS-resolution failure handling, and hostnames resolving to blocked IPs;
- server tests cover loopback rejection with structured `private_network_denied`;
- hardening tests cover pinned-address reuse, Chromium resolver rules, cross-host denial, private subresource blocking, service-worker blocking, and WebSocket blocking;
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

- server tests cover accepted `capturePage` response shape with screenshot, HTML, and text path reporting only after files exist;
- earlier local smoke evidence returned `ok: true`, `finalUrl: https://example.com/`, title `Example Domain`, HTTP status `200`, and screenshot output under the job directory;
- Docker runtime verification posts `capturePage` for `https://example.com` from the containerized service and checks the structured response.

### A-008 — Screenshot artifact is written

**Status:** Verified for isolated `capturePage` baseline  
**Requirement:** A capture job writes a screenshot under that job's artifact directory when screenshot capture succeeds.  
**Acceptance evidence:**

- server tests verify screenshot paths are reported only after files exist;
- browser-capture tests verify screenshot creation on successful capture;
- Docker runtime verification checks that `screenshot.png` exists and is non-empty under the mounted artifact root.

### A-009 — HTML and text artifacts are written

**Status:** Implemented and covered by tests / runtime smoke evidence still useful  
**Requirement:** A successful capture job writes `page.html` and `text.txt` under that job's artifact directory.  
**Acceptance evidence:**

- browser-capture tests verify `page.content()` is written to `page.html` and visible body text is written to `text.txt`;
- server tests verify HTML/text paths are reported only when files exist and partial files are cleaned on failure or policy block;
- Docker runtime verification checks that `page.html` and `text.txt` exist and are non-empty under the mounted artifact root.

### A-010 — Request and response JSON are persisted

**Status:** Verified for accepted jobs and failure/blocked paths  
**Requirement:** Each accepted job writes `request.json` and `response.json` into the job artifact directory.  
**Acceptance evidence:** Server tests verify both JSON files and their contents. Docker runtime verification also checks both files under the mounted artifact root.

### A-011 — Response envelope points to correct artifact paths

**Status:** Verified for accepted jobs  
**Requirement:** JSON responses include deterministic artifact directory/path metadata matching the files written on disk.  
**Acceptance evidence:** Server tests verify job-relative request, response, screenshot, HTML, text, and download paths. Docker runtime verification repeats the filesystem path check against the host-mounted artifact directory.

### A-012 — Browser resources are cleaned up after each job

**Status:** Verified for isolated Playwright baseline  
**Requirement:** Browser contexts/pages/processes do not leak across completed isolated jobs.  
**Acceptance evidence:** Dedicated browser-capture tests verify page, context, and browser close behavior on success and failure. Job deadlines abort captures and trigger cleanup.

### A-013 — Dialogs are handled deterministically

**Status:** Verified  
**Requirement:** Alert/confirm/prompt dialogs do not hang jobs; default policy dismisses or records them.  
**Acceptance evidence:** Controlled fixture tests dismiss and report dialogs in `events.dialogs`.

### A-014 — Downloads are captured under job artifacts

**Status:** Verified  
**Requirement:** Downloads triggered during a job are saved under the job's `downloads/` artifact subdirectory and reported in the response.  
**Acceptance evidence:** Controlled fixture tests sanitize filenames, save downloads, report paths, handle duplicates, and clean failed-job artifacts.

### A-015 — Popups/new tabs are recorded or controlled

**Status:** Verified  
**Requirement:** Popup/new-tab behavior is recorded, blocked, or folded into structured output according to policy.  
**Acceptance evidence:** Controlled fixture tests record popup URL/title without misclassifying or closing the primary capture page.

### A-016 — Login/captcha/block signals are represented

**Status:** Not started  
**Requirement:** The response envelope includes structured signals for likely login requirement, captcha, cookie/banner, and blocked states.  
**Acceptance evidence required:** At minimum, schema tests; later, fixture or public-page smoke examples.

### A-017 — Isolated session does not persist cookies/state by default

**Status:** Verified for real-browser fixture  
**Requirement:** Two isolated jobs do not share cookies/localStorage/sessionStorage.  
**Acceptance evidence:** A controlled real-browser fixture runs two captures against the same local origin and proves job 2 cannot read state written by job 1.

### A-018 — `storageState` mode is explicit and segregated

**Status:** Not started / later phase candidate  
**Requirement:** Saved auth/session state is used only when explicitly requested and stored separately from per-run artifacts.  
**Acceptance evidence required:** Export/import smoke test plus filesystem path check.

### A-019 — Named persistent profile is explicit and locked down

**Status:** Not started / later phase candidate  
**Requirement:** Persistent profile use requires an explicit approved name; profile data is segregated from run artifacts and not used for untrusted broad browsing.  
**Acceptance evidence required:** Explicit profile request works; default jobs do not use it; concurrent access policy is defined.

### A-020 — Old shell/demo baseline remains preserved

**Status:** Skeleton only  
**Requirement:** Existing old runtime under `/opt/data/browser-stack` remains untouched until replacement service passes acceptance tests.  
**Acceptance evidence required:** File inventory before/after implementation shows old baseline still present or migration explicitly documented.

### A-021 — Docker/container run path works

**Status:** Implemented, unverified until Docker runtime script or CI job passes  
**Requirement:** The service builds/runs through the approved Docker/Compose path using the environment-specific Docker config where relevant. The Playwright package and Docker image use the same exact version.  
**Verification commands:**

```bash
bash scripts/verify-docker-runtime.sh
sudo DOCKER_CONFIG=/DATA/docker-client bash scripts/verify-docker-runtime.sh
```

**Acceptance evidence required:** Successful script output showing image build, `npm test` inside the container, service start, host health check, public `capturePage`, and artifact mount verification.

The script verifies:

- Docker image build succeeds;
- `npm test` passes inside the container;
- service starts with Compose;
- `GET /health` returns `ok: true`, `service: browser-worker`, and `status: healthy`;
- `POST /v1/browser/jobs` can run `capturePage` against `https://example.com` through the containerized service;
- `request.json`, `response.json`, `screenshot.png`, `page.html`, `text.txt`, and `downloads/` exist under the host-mounted artifact path.

### A-022 — Service is not publicly exposed by accident

**Status:** Verified for direct-run default; Docker localhost publish verification added  
**Requirement:** Phase-one service binds only to localhost or an explicitly approved internal-only network surface.  
**Acceptance evidence:**

- `server.js` defaults to `127.0.0.1` via `getListenConfig()`;
- explicit override requires `BROWSER_WORKER_HOST`;
- tests cover default host/port and explicit override;
- `docker-compose.yml` publishes `127.0.0.1:3080:3080` by default while setting `BROWSER_WORKER_HOST=0.0.0.0` only inside the container so the host-local mapping works.

**Remaining note:** Docker/container binding is fully verified once the Docker runtime script or CI job passes.

## Phase-one completion gate

Phase one is not complete until all required phase-one items above are either:

1. **Verified**, with evidence recorded; or
2. explicitly marked **Deferred** with Kristian's approval and a clear reason.

Minimum phase-one gate should include A-001 through A-012, A-017, A-020, A-021, and A-022. Items A-013 through A-016 may be implemented as reliability hardening slices if phase-one scope allows, but should at least have schema/policy coverage before broad use.
