# Browser Worker Implementation Notes

Implementation has started from the approved small-service path. The first implemented runtime milestone is the structured response envelope plus a minimal HTTP service skeleton that exposes `/health` and `POST /v1/browser/jobs`.

Verified on 2026-06-28:

- `npm test` passes with 20 Node test-runner tests.
- `response-envelope.js` normalizes the implementation-spec top-level response shape, including `request`, `events`, and structured errors with `phase` / `retryable` metadata.
- `artifacts.js` creates artifact-root-relative job paths, deterministic job directories, downloads directories, and JSON file writes.
- `url-policy.js` validates absolute HTTP(S) URLs, blocks configured private/internal targets, rejects IPv4-mapped blocked IPv6 literals, and returns structured DNS-resolution failures before browser navigation.
- `server.js` returns structured envelopes for `capturePage` requests, invalid URLs, blocked private/internal targets, and invalid actions.
- Direct-run service defaults to `127.0.0.1:3080`, with explicit `BROWSER_WORKER_HOST` / `PORT` override.
- Unknown actions return structured `invalid_action` errors.
- Blocked targets return structured `private_network_denied` errors.
- Browser execution is not connected yet; successful `capturePage` responses include the warning `browser_execution_not_yet_connected`.

## Recommended HTTP JSON API contract

### `POST /v1/browser/jobs`

Request sketch:

```json
{
  "url": "https://example.com",
  "action": "capturePage",
  "session": { "mode": "isolated" },
  "capture": {
    "screenshot": true,
    "html": false,
    "text": true,
    "aria": true,
    "links": true,
    "forms": true
  },
  "timeouts": {
    "requestMs": 60000,
    "navigationMs": 30000,
    "actionMs": 10000
  }
}
```

Response envelope:

```json
{
  "ok": true,
  "jobId": "2026-...",
  "startedAt": "...",
  "endedAt": "...",
  "status": "completed",
  "page": {
    "requestedUrl": "...",
    "finalUrl": "...",
    "title": "...",
    "httpStatus": 200,
    "redirects": []
  },
  "signals": {
    "requiresLogin": false,
    "captchaDetected": false,
    "cookieBannerDetected": false,
    "blocked": false
  },
  "extraction": {
    "text": "...",
    "headings": [],
    "links": [],
    "forms": [],
    "ariaSnapshotPath": null
  },
  "artifacts": {
    "directory": "artifacts/jobs/<jobId>",
    "screenshot": "screenshot.png",
    "html": null,
    "downloads": []
  },
  "warnings": [],
  "errors": []
}
```

## Session modes

1. `isolated` — default. New browser context per job, no persisted cookies/state.
2. `storageState` — load/export named auth state file. Safer than whole profile persistence.
3. `persistentProfile` — later phase only. Requires named profiles, locking, cleanup, and policy.

## Artifact folder structure

Recommended:

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
└── sessions/
    └── <session-id>/
```

Do not put large binary artifacts directly in the JSON response by default. Return paths and metadata.

## Page capture workflow

1. Validate request and URL policy.
2. Create job directory.
3. Create context according to session mode.
4. Register handlers early: dialogs, downloads, page/popup events, console/pageerror if desired.
5. Navigate with bounded timeout.
6. Detect redirects and final status.
7. Apply optional consent policy.
8. Detect login/captcha/block states.
9. Capture screenshot and structured extraction.
10. Write response JSON and artifacts.
11. Close context/browser resources predictably.

## Reliability requirements

- Separate request, navigation, and action timeouts.
- Always return a structured envelope, even on partial failure.
- Record timeout category and completed artifact paths.
- Handle dialogs deterministically.
- Track popups/new tabs rather than losing them.
- Save downloads under job artifacts.
- Include enough evidence for `requiresLogin`, `captchaDetected`, and `blocked` flags.

## Security requirements

Security sequencing decision (#6): first implementation must include the security baseline / boundary design, but full Docker hardening is deferred until after the core HTTP worker passes acceptance tests.

### Phase-one security baseline

Required in the first implementation phase:

- Treat arbitrary browsing as untrusted.
- Bind the service to localhost or an explicitly internal-only network surface unless broader exposure is deliberately approved.
- Do not expose Playwright CDP/WebSocket/remote debugging externally in phase one.
- Do not mount Hermes secrets, Obsidian vaults, SSH keys, API credential directories, the Docker socket, or broad host paths.
- Restrict writable mounts to artifacts, downloads, session state, and approved named persistent profiles.
- Keep isolated sessions as the default.
- Treat `storageState` as an explicit state-restored mode, not as the default and not as a full persistent-profile replacement.
- Treat persistent profiles as explicit named trusted-tool profiles; phase-one persistent profile name is `marketing-tools`.
- Block private-network access by default unless explicitly allowed: localhost/loopback, RFC1918 ranges, link-local, Docker bridge/internal networks, metadata IPs, and internal hostnames that resolve private.
- Validate requested URLs before launching browser work when possible.
- Return structured errors for invalid/blocked targets, including private-network-denied cases.
- Keep auth/session state separate from general artifacts.
- Avoid passing general host environment variables or Hermes secrets into browser jobs.

### Deferred full Docker hardening

Defer until the core capture/action/session loop works and acceptance tests pass:

- non-root runtime changes, if not already safe in the base image
- seccomp profile tuning
- `cap_drop: [ALL]`
- `security_opt: [no-new-privileges:true]`
- read-only root filesystem
- tmpfs tuning
- stricter resource limits
- shared-memory tuning
- deeper Compose/Dockerfile lockdown

Rationale: these changes are important, but can break Playwright/Chromium launch, sandboxing, downloads, screenshots, profile paths, traces, shared memory, or writable caches. Apply them one at a time after the service has a known-good behavior baseline.

Preserve `DOCKER_CONFIG=/DATA/docker-client` for host Docker calls.

## What not to add yet

- No generic browser farm.
- No captcha solving.
- No stealth bypass package by default.
- No unbounded persistent profiles.
- No remote debugging socket exposed to LAN.
- No runtime file edits until the current project is re-inspected.

## Recommended implementation order

1. Restore/confirm current runtime files and exact behavior.
2. Add documentation-backed acceptance tests for current one-shot behavior.
3. Add a minimal HTTP wrapper that performs one capture job and exits cleanly per request or runs as a simple service.
4. Add structured response envelope and artifact directories.
5. Add reliability handlers.
6. Add session modes, starting with isolated only.
7. Add Docker hardening and network policy after behavior is stable, while keeping the phase-one security baseline in place from the start.

## Acceptance tests

- Health endpoint returns service metadata.
- Capture `https://example.com` returns title, final URL, status, screenshot path, text snippet.
- Invalid URL returns validation error without launching browser.
- Timeout URL returns structured timeout error.
- Alert/dialog page returns dialog evidence and does not hang.
- Popup page records secondary page.
- Download page saves file under artifacts.
- Login-required fixture is flagged.
- Captcha/block fixture is flagged, not bypassed.
- Artifact files exist and match response paths.

## Risks and unresolved questions

- Runtime files missing in prep environment; actual code may differ from known state.
- Port selection for HTTP service is not approved.
- Phase-one security baseline is approved: local/internal-only exposure, narrow mounts, no secrets/Docker socket/Obsidian, private-network blocked by default, isolated session default, explicit state modes.
- Strict Docker hardening is deliberately deferred until after acceptance tests pass, then applied one reversible change at a time.

## Next Human Review

Before allowing code changes, review and approve/reject:

1. Whether `/DATA/browser-stack` contains the expected runtime files again.
2. The proposed HTTP API envelope.
3. Default session mode: isolated only for phase one.
4. Artifact directory layout.
5. The exact HTTP port / bind address.

Already approved:

- #5 session model: isolated, state-restored (`storageState`), persistent-profile (`marketing-tools`).
- #6 security sequencing: include the phase-one security baseline immediately; defer strict Docker hardening until after core service acceptance tests pass.
- #7 old runtime / missing-file blocker: recovered `/opt/data/browser-stack` shell/demo files are reference material only; proceed from the approved rebuild spec.
