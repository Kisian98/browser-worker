# Browser Worker Implementation Dependency Map

Date created: 2026-06-27  
Last synced: 2026-06-29 after PR #14

This map shows the dependency order for implementation. It exists to keep the rebuild brick-by-brick and prevent later slices from being built on missing foundations.

## Core dependency chain

```text
project decisions
  -> phase-one scope
  -> acceptance tests
  -> implementation plan
  -> branch/repo setup
  -> service foundation
  -> response envelope
  -> validation + policy
  -> artifact layout/writer
  -> isolated browser execution
  -> capture/extraction
  -> cleanup/lifecycle
  -> isolated-session state verification
  -> Docker runtime path
  -> storageState
  -> persistent profiles
  -> hardening
```

## Must-come-before rules

### 1. Decisions before implementation plan

The implementation plan must depend on `DECISIONS.md`, not scattered chat memory.

Blocked by:

- unresolved repo/branch target;
- host port/network binding;
- action naming if API tests depend on it.

### 2. Acceptance tests before claiming implementation success

`ACCEPTANCE_TESTS.md` defines the evidence needed for phase one. Implementation can start before all tests are automated, but no milestone should be called done without verification evidence.

### 3. Response envelope before browser actions

The service should return stable JSON for both success and failure before real browser execution is connected.

Current state: implemented and tested for the phase-one `capturePage` surface.

Depends on:

- stable top-level response shape;
- structured errors;
- warnings array;
- artifact path fields.

### 4. Request validation before policy and navigation

Basic JSON, action, and URL validation must happen before browser work.

Current state: basic HTTP(S) URL validation and `capturePage` action validation exist.

Still needed before broader actions:

- capture option validation;
- timeout bounds;
- explicit session mode validation beyond the current isolated default.

### 5. URL/private-network policy before arbitrary navigation

The worker must not launch browser navigation to private/internal targets before URL policy exists.

Current state: pre-navigation URL/private-network policy exists, and Playwright document navigation plus final URL policy checks are wired into the isolated capture flow.

Depends on:

- hostname resolution strategy;
- IP classification;
- redirect handling policy;
- structured `private_network_denied` / `redirected_private_network_denied` errors.

### 6. Artifact directory creation before capture

The worker should create a deterministic job artifact directory before screenshot/text/HTML capture. That lets partial failures still leave request/response evidence while blocked or failed page artifacts are cleaned up when they should not be reported.

Depends on:

- job ID generation;
- configured artifact root;
- safe path construction;
- request/response persistence.

### 7. Isolated session before `storageState`

Implement and verify clean isolated contexts first. Do not start with auth reuse.

Depends on:

- Playwright dependency/runtime availability;
- browser launch configuration;
- context/page lifecycle cleanup;
- timeout handling;
- proof that separate isolated jobs do not share cookies, `localStorage`, or `sessionStorage`.

### 8. `storageState` before persistent profiles

Saved state files are the safer middle tier and should be implemented before durable full profiles.

Depends on:

- isolated session correctness;
- storage-state directory separation;
- explicit session-mode validation;
- no default auth reuse.

### 9. Persistent profiles after state and locking policy

Persistent named profiles are sensitive and must not arrive before the service has state segregation and concurrency/locking rules.

Depends on:

- approved named profile list, starting with `marketing-tools`;
- profile directory separation;
- explicit opt-in request shape;
- concurrency/lock policy;
- private-network and untrusted-site policy.

### 10. Docker runtime path after local service foundation

Do not harden or overcomplicate Docker before the service has a working local foundation and acceptance tests.

Depends on:

- local `npm test` passing;
- local service start;
- health check;
- basic public capture;
- artifact mount design;
- preserving `DOCKER_CONFIG=/DATA/docker-client` where relevant.

### 11. Full container hardening after acceptance tests

Full hardening should come after the core worker is working.

Depends on:

- passing core acceptance tests;
- known mounts;
- known browser launch needs;
- known service binding needs.

Potential later hardening:

- non-root runtime if not already safe;
- `cap_drop: [ALL]`;
- `security_opt: [no-new-privileges:true]`;
- seccomp tuning;
- restricted mounts;
- local/internal-only binding.

## Suggested vertical-slice order

Completed:

1. Safe direct-run binding default: `127.0.0.1` / port `3080`, with explicit `BROWSER_WORKER_HOST` override.
2. Action naming/validation: `capturePage` is the accepted phase-one action and unknown actions return structured `invalid_action` errors.
3. URL/private-network policy: requests are screened before browser navigation and blocked targets return structured `private_network_denied` errors.
4. Response-envelope contract: top-level shape now includes request/events and errors include `phase` / `retryable` metadata.
5. Artifact persistence foundation: accepted jobs create deterministic artifact directories and write `request.json` / `response.json`.
6. Isolated Playwright baseline: accepted `capturePage` jobs launch a fresh browser context, capture final URL/title/status, write a screenshot, and close browser resources on success/failure.
7. Redirect/final URL policy re-checking: document navigations and final URLs are checked before trusting broader capture output.
8. HTML/text artifacts: successful `capturePage` jobs write `page.html` and `text.txt`; failed/blocked paths remove page artifacts before returning null paths.

Next:

1. Verify isolated-session state behavior across separate jobs.
2. Add deterministic dialog/popup/download reporting.
3. Add Docker runtime path.
4. Add `storageState` mode.
5. Add named persistent profile support only after explicit approval.
6. Apply container hardening after acceptance tests pass.

## Blockers requiring Kristian input

- Whether Docker runtime work should start immediately after isolated-session verification or after additional reliability reporting.

## Resolved inputs from Kristian on 2026-06-27

- GitHub repository/remote target: `git@github.com:Kisian98/browser-worker.git`.
- Local working tree: `/DATA/browser-stack`, initialized on `main` tracking `origin/main`.
- Service port/binding: use port `3080` if available; `127.0.0.1:3080` availability verified; bind localhost/internal-only for phase one.
- Final action naming: `capturePage`.
- Persistent profile order: isolated -> `storageState` -> persistent profile.
- Old runtime: keep `/opt/data/browser-stack` as fallback/reference.
