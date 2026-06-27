# Browser Worker Implementation Spec

## Purpose

This note is the detailed implementation spine for the browser-worker rebuild. It turns the approved decisions into enough concrete guidance that an implementation pass should not have to guess the API, artifact layout, session behavior, reliability categories, or network safety policy.

The worker remains a browser surface. Hermes remains the planner/brain. The worker should execute bounded browser jobs, capture structured page state and artifacts, and return predictable JSON.

## Current source/runtime discovery

The earlier prep job looked for runtime files under `/DATA/browser-stack` and did not find them there. A later search found the old shell/demo runtime under:

```text
/opt/data/browser-stack/
├── worker.js
├── Dockerfile.worker
├── docker-compose.yml
├── browser-extract.mjs
├── package.json
└── README.md
```

A `browser-worker` wrapper was not found in `/opt/data/scripts`, `/usr/local/bin`, `/usr/bin`, `/DATA`, or `/opt/data/browser-stack`. A related wrapper exists at `/opt/data/scripts/browser-extract`, pointing to `/opt/data/browser-stack/browser-extract.mjs`.

What the recovered old runtime appears to be:

- `worker.js` is a one-shot CommonJS Playwright script.
- It accepts CLI/env inputs for `--url`, `--click`, `--screenshot`, and `--timeout`.
- It launches Chromium headless, navigates to one URL, optionally clicks one selector, optionally writes a screenshot under `/shots`, and prints JSON.
- `Dockerfile.worker` uses `mcr.microsoft.com/playwright:v1.60.0-jammy`, installs npm deps, copies smoke/extract scripts plus `worker.js`, and runs `node worker.js`.
- `docker-compose.yml` defines a `browser-worker` service, maps `./screenshots` to `/shots`, sets `WORKER_URL` and `SCREENSHOT_PATH`, and uses `entrypoint: ["node", "worker.js"]` with empty `command: []`.

Planning implication:

- The old files are useful reference material, not the source of truth for the rebuild.
- They confirm the shell/demo nature of the original build: one-shot CLI, basic extraction, click, screenshot boundary, no service API, no session model, no private-network policy, no structured failure taxonomy, and no full artifact/session layout.
- The rebuild should proceed from this implementation spec, while borrowing small proven details from the old runtime when useful: Playwright base image, `/shots`-style constrained screenshot boundary, simple deterministic click support, and CLI compatibility if cheap.

## Current approved decisions

### #3 Artifact layout

Status: directionally approved, but pinned for revisit before hardening.

The current layout is good enough for first implementation, but should be compared again against Browserless, Browserbase, and Playwright artifact/session patterns before implementation hardening freezes it.

### #5 Session model

Approved three-tier model:

1. `isolated` — default clean context.
2. `stateRestored` / `storageState` — explicit middle tier using saved state.
3. `persistentProfile` — explicit trusted named profile, first profile: `marketing-tools`.

### #6 Security sequencing

Approved split:

- Phase one includes the security baseline and boundary design.
- Full Docker/container hardening waits until the worker passes acceptance tests.

Phase one is therefore: secure-by-boundary, not fully locked down yet.

### #7 Old runtime / missing-file blocker

Approved: the old runtime has been found and inspected. It is not a blocker.

The expected files were not under `/DATA/browser-stack`; they were found under `/opt/data/browser-stack`. They confirm the original build was a one-shot shell/demo. The rebuild should proceed from this implementation spec, while treating the old runtime as reference material only.

Rules:

- Do not treat old shell/demo files as the source of truth.
- Do not claim compatibility with old behavior unless tested.
- Borrow useful proven details where appropriate: Playwright base image, constrained screenshot boundary, simple CSS-selector click support, and clean Compose entrypoint pattern.
- If old files are copied, moved, or replaced, document the migration step explicitly.
- Keep the planning/rebuild source of truth in the Projects Hub notes and `/DATA/browser-stack` specs.

## Implementation principles

- Keep the current one-shot runner until HTTP service acceptance tests pass.
- Do not create a parallel replacement without a rollback path.
- Keep the worker deterministic, not autonomous.
- Avoid arbitrary JavaScript/Playwright execution endpoints.
- Return structured JSON for every job, including failures.
- Keep artifacts on disk and return paths/metadata, not base64 blobs.
- Treat arbitrary browsing as untrusted.
- Do not mount Hermes secrets, Obsidian, Docker socket, SSH keys, or broad host paths.
- Block private-network browsing by default.

## HTTP API contract

### Base API shape

Phase one should use a small HTTP JSON API.

Required endpoints:

- `GET /health`
- `POST /v1/browser/jobs`

Optional later endpoints:

- `GET /v1/browser/jobs/:jobId`
- `GET /v1/browser/jobs/:jobId/artifacts`
- `POST /v1/sessions/storage-state/export`
- `POST /v1/sessions/storage-state/import`

Do not add MCP or public browser-farm APIs in phase one.

### `GET /health`

Purpose: allow Hermes and operators to verify the service is alive without launching a browser.

Response fields:

```json
{
  "ok": true,
  "service": "browser-worker",
  "version": "0.1.0",
  "status": "healthy",
  "time": "2026-06-26T00:00:00.000Z",
  "browser": {
    "engine": "chromium",
    "playwrightAvailable": true
  },
  "policy": {
    "privateNetworkDefault": "deny",
    "defaultSessionMode": "isolated"
  }
}
```

Health should not require internet access and should not create job artifacts.

### `POST /v1/browser/jobs`

Purpose: submit one bounded browser job and receive a structured response envelope.

The first implementation can run jobs synchronously: request comes in, worker runs one browser task, response returns when the task completes or fails. Async job polling can come later if needed.

#### Request envelope

```json
{
  "url": "https://example.com",
  "action": "capturePage",
  "session": {
    "mode": "isolated"
  },
  "capture": {
    "screenshot": true,
    "html": false,
    "text": true,
    "aria": true,
    "links": true,
    "forms": true,
    "buttons": true
  },
  "actions": [],
  "timeouts": {
    "requestMs": 60000,
    "navigationMs": 30000,
    "actionMs": 10000,
    "artifactMs": 10000
  },
  "policy": {
    "privateNetwork": "deny",
    "consent": "detectOnly",
    "downloads": "allow",
    "popups": "record",
    "dialogs": "dismiss"
  }
}
```

Required request fields:

- `url`: absolute `http` or `https` URL.
- `action`: phase-one allowed action, initially `capturePage`.

Optional request fields:

- `session`: session mode and identifiers.
- `capture`: requested extraction/artifact options.
- `actions`: deterministic browser actions for multi-step jobs.
- `timeouts`: bounded timeouts.
- `policy`: job-specific behavior policy, constrained by service defaults.

### Allowed action names

Use explicit action names rather than vague verbs.

Phase-one action:

- `capturePage` — navigate to a URL, collect structured page state and artifacts.

Early follow-up actions:

- `click` — click a selector or role target.
- `type` — type into a selector or role target.
- `scroll` — scroll page or element.
- `wait` — wait for selector, URL, load state, or fixed bounded duration.
- `reload` — reload current page.
- `goBack` — browser back.
- `selectOption` — choose from a select field.
- `press` — press a safe keyboard key, e.g. Enter/Escape/Tab.

Later / careful actions:

- `uploadFile` — only if an approved upload mount exists.
- `download` — really a capture policy around download events, not a freeform action.
- `extract` — extract after actions without re-navigation.

Do not add:

- arbitrary JavaScript execution
- arbitrary Playwright script execution
- autonomous natural-language action execution inside the worker

Hermes can plan; the worker executes explicit actions.

## Response envelope

Every response should use the same top-level shape, including failures.

```json
{
  "ok": true,
  "jobId": "job-2026-06-26T00-00-00-000Z-abcd1234",
  "startedAt": "2026-06-26T00:00:00.000Z",
  "endedAt": "2026-06-26T00:00:02.000Z",
  "durationMs": 2000,
  "status": "completed",
  "request": {
    "action": "capturePage",
    "sessionMode": "isolated"
  },
  "page": {
    "requestedUrl": "https://example.com",
    "finalUrl": "https://example.com/",
    "title": "Example Domain",
    "httpStatus": 200,
    "redirects": [],
    "contentType": "text/html"
  },
  "signals": {
    "requiresLogin": false,
    "captchaDetected": false,
    "cookieBannerDetected": false,
    "blocked": false,
    "privateNetworkDenied": false
  },
  "extraction": {
    "text": "...",
    "textLength": 1234,
    "headings": [],
    "links": [],
    "forms": [],
    "buttons": [],
    "ariaSnapshotPath": "artifacts/jobs/<jobId>/aria.yaml"
  },
  "artifacts": {
    "directory": "artifacts/jobs/<jobId>",
    "request": "request.json",
    "response": "response.json",
    "screenshot": "screenshot.png",
    "html": null,
    "text": "text.txt",
    "trace": null,
    "downloads": []
  },
  "events": {
    "dialogs": [],
    "popups": [],
    "downloads": [],
    "console": [],
    "pageErrors": []
  },
  "warnings": [],
  "errors": []
}
```

Allowed `status` values:

- `completed` — requested job completed.
- `partial` — job partly completed; some artifacts/extraction exist, but a non-fatal error happened.
- `failed` — job failed and did not complete useful capture.
- `blocked` — policy denied the job before navigation or during redirect.
- `timeout` — bounded timeout fired.

### Error object

```json
{
  "code": "private_network_denied",
  "message": "URL resolves to a private network address and policy.privateNetwork is deny",
  "phase": "urlPolicy",
  "retryable": false,
  "detail": {
    "url": "http://192.168.1.1",
    "resolvedAddress": "192.168.1.1"
  }
}
```

Required error fields:

- `code`
- `message`
- `phase`
- `retryable`

Optional:

- `detail`

Warnings can be strings at first, but should become structured objects if they grow important. Use warnings for non-fatal issues, for example screenshot failure when text extraction succeeded.

## Artifact layout

Current recommended layout:

```text
/DATA/browser-stack/artifacts/
├── jobs/
│   └── <job-id>/
│       ├── request.json
│       ├── response.json
│       ├── screenshot.png
│       ├── page.html
│       ├── aria.yaml
│       ├── text.txt
│       ├── trace.zip
│       └── downloads/
├── storage-state/
│   └── <state-name>.json
└── profiles/
    └── marketing-tools/
```

This layout is approved for first implementation but remains pinned for revisit before hardening.

Artifact rules:

- Every job gets one job directory.
- Always write `request.json` and `response.json` when possible.
- Write artifacts only under the approved artifact root.
- Do not write screenshots/downloads into arbitrary caller-provided paths.
- Downloads go under the job’s `downloads/` directory.
- Auth/session state lives outside job artifacts.
- Persistent profiles live under `profiles/<profile-name>/`, not under per-job artifacts.
- `storageState` files live under `storage-state/`, not under screenshots/downloads.
- Do not put secrets in logs or general job artifacts.

Response paths should be relative to the configured artifact root unless there is a strong reason to return absolute paths.

Artifact retention is not fully decided yet. First implementation should avoid deleting artifacts automatically unless explicitly requested.

## Session implementation details

### `isolated`

Request:

```json
{
  "session": { "mode": "isolated" }
}
```

Behavior:

- Create a fresh browser context per job.
- Do not load saved auth state.
- Do not persist cookies/local storage after the job.
- Close context after job.
- Default for public/untrusted browsing.

### `stateRestored` / `storageState`

Request:

```json
{
  "session": {
    "mode": "stateRestored",
    "storageState": "client-a"
  }
}
```

Behavior:

- Validate state name against safe filename rules.
- Load `/DATA/browser-stack/artifacts/storage-state/client-a.json`.
- Create a fresh context using that storage state.
- Optionally export updated state if request explicitly asks for it.

Optional export shape:

```json
{
  "session": {
    "mode": "stateRestored",
    "storageState": "client-a",
    "saveState": true
  }
}
```

Caveats:

- `storageState` is explicit state injection, not a blank isolated session.
- It is not a full profile replacement.
- It may not preserve all `sessionStorage` or extension/profile behavior.
- Treat state files as sensitive.

### `persistentProfile`

Request:

```json
{
  "session": {
    "mode": "persistentProfile",
    "profile": "marketing-tools"
  }
}
```

Behavior:

- Only approved named profiles are allowed.
- Phase-one approved profile: `marketing-tools`.
- Profile directory: `/DATA/browser-stack/artifacts/profiles/marketing-tools/` or a later approved equivalent.
- Use Playwright persistent context semantics.
- Lock profile during use to avoid concurrent corruption.
- Do not use this mode for arbitrary public/untrusted browsing.

If profile is already locked/in use, return structured error `profile_locked`.

Every response should identify the effective session mode.

## Network and private-access policy

Default: deny private-network browsing.

Blocked by default:

- `localhost`
- `127.0.0.0/8`
- `::1`
- RFC1918 IPv4: `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`
- link-local, including `169.254.0.0/16`
- Docker/internal bridge ranges
- metadata services, especially `169.254.169.254`
- hostnames that resolve to blocked ranges

URL validation order:

1. Parse URL.
2. Require `http` or `https`.
3. Normalize hostname.
4. Reject obvious localhost/private literals.
5. Resolve DNS.
6. Reject resolved private/link-local/metadata/internal addresses.
7. Create browser context only after policy passes.

During navigation:

- Re-check final URL after redirects.
- If redirect target is private/blocked, abort if possible and return `private_network_denied` with redirect evidence.

Implementation needs to guard against public hostnames resolving to private IPs, redirects to private IPs, IPv6 localhost/private forms, integer/hex/octal IP tricks where practical, and basic DNS rebinding by checking before navigation and after redirects.

If private access is ever needed, make it explicit and guarded by service config, not just request body.

## Reliability and error taxonomy

### Timeout categories

Separate timeouts:

- `requestMs` — whole job wall-clock budget.
- `navigationMs` — page navigation and initial load.
- `actionMs` — each browser action.
- `artifactMs` — screenshot/html/trace/download save operations.

Timeout error codes:

- `request_timeout`
- `navigation_timeout`
- `action_timeout`
- `artifact_timeout`

Timeout responses should include what was completed before timeout.

### Dialogs

Register dialog handler before navigation.

Default policy: dismiss.

Record type, message, default value if present, and action taken.

### Popups/new tabs

Listen for new pages/popups.

Default policy: record, do not automatically follow unless request action expects it.

Record popup URL, title if available, opener action if known, and whether closed or left open during job.

### Downloads

Enable download handling intentionally.

Default policy: allow downloads only into job `downloads/` directory.

Record suggested filename, saved relative path, size if known, and failure reason if save failed.

### Frames / iframes

Capture frame metadata: URL, name, parent URL if useful, accessible/inaccessible status, and visible text summary if accessible.

Do not pretend inaccessible cross-origin iframe content was extracted.

### Login-required detection

Evidence heuristics:

- password inputs
- forms with login/sign-in labels
- URL contains login/signin/auth/session
- HTTP 401/403
- visible text requiring sign-in
- known auth-wall patterns

Set `requiresLogin: true` with evidence.

### Captcha/block detection

Evidence heuristics:

- common captcha providers
- challenge text
- blocked/forbidden page content
- Cloudflare/browser-check style pages
- suspicious 403/429 responses

Set `captchaDetected: true` or `blocked: true`.

Do not add captcha solving or stealth bypass in phase one.

### Partial failure policy

If navigation succeeds and some artifacts fail, return `status: "partial"`, not total failure.

Example: title/text extracted, screenshot failed, response includes warning `screenshot_failed`.

## First-class browser actions

### Action object shape

```json
{
  "type": "click",
  "target": {
    "selector": "a.more-info"
  },
  "timeoutMs": 10000,
  "after": {
    "waitFor": "loadState",
    "state": "domcontentloaded"
  }
}
```

Target options:

- `selector` — CSS selector, deterministic first pass.
- `role` + `name` — later, Playwright locator by role.
- `text` — later, use carefully because text matching can be ambiguous.

Phase one should prefer selectors for deterministic behavior.

### Click

- Validate target exists.
- Click first matching selector unless `strict: true` requires exactly one.
- Wait according to `after` policy.
- Record action result and final URL.

Errors:

- `selector_not_found`
- `selector_not_visible`
- `click_timeout`
- `navigation_after_click_timeout`

### Type

Validate target exists and is editable. Fill or type depending on `mode`.

Errors:

- `selector_not_found`
- `target_not_editable`
- `type_timeout`

### Scroll

Allowed directions: `up`, `down`.

Allowed amounts: `page`, `halfPage`, or pixel number.

### Wait

Allowed wait types:

- `selector`
- `url`
- `loadState`
- bounded `durationMs`

Do not allow unbounded waits.

### Reload / goBack

These are straightforward browser navigation actions but should still return action logs and respect navigation timeout.

### Action log

Every job with actions should include an action log with index, type, ok, startedAt, endedAt, result, and errors.

## Acceptance tests required before implementation is called usable

Minimum acceptance tests:

1. `/health` returns service metadata without launching browser.
2. Invalid URL returns structured `invalid_url` before browser launch.
3. Private URL returns structured `private_network_denied` before browser launch.
4. `capturePage` on `https://example.com` returns final URL, title, headings/text, links, and artifact metadata.
5. Screenshot writes under job artifact directory.
6. Response JSON is written under job artifact directory.
7. Timeout fixture returns `navigation_timeout` or `request_timeout` without hanging.
8. Dialog fixture records/dismisses dialog.
9. Popup fixture records popup metadata.
10. Download fixture saves file under downloads artifact folder.
11. Login-required fixture sets `requiresLogin` with evidence.
12. Captcha/block fixture sets `captchaDetected` or `blocked` without bypassing.
13. `isolated` session leaves no persisted state.
14. `stateRestored` loads a known storageState file.
15. `persistentProfile` rejects unknown profile names and locks approved profile while in use.

## Open questions before next build pass

These are still open or only partially settled:

1. Exact HTTP bind address and port.
2. Whether `POST /v1/browser/jobs` remains synchronous for phase one or gets async polling early.
3. Whether artifact paths in API responses should be relative or absolute; current recommendation is relative.
4. Exact artifact retention/cleanup policy.
5. Whether #3 artifact layout needs changes after the pinned comparison pass.
6. Whether first implementation should support only `capturePage` or also deterministic `click` immediately.
7. How Hermes will invoke the service in practice: direct curl/HTTP helper, local wrapper, or later tool integration.

## Current next implementation step

Before more runtime code:

1. Reconcile this spec with `IMPLEMENTATION_NOTES.md`.
2. Close the HTTP protocol/bind-port decision.
3. Revisit artifact layout #3 enough to avoid building obviously wrong paths.
4. Add tests for URL policy and response envelope.
5. Then connect real Playwright capture behind the existing service skeleton.
