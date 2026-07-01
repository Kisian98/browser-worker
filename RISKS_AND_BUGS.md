# Browser Worker Risks and Bugs

Date created: 2026-06-27  
Last synced: 2026-06-29 after PR #14

This is the canonical checklist for known risks, bugs, hazards, and future issue candidates discovered during planning or implementation. Keep this practical: each entry should preserve what we know, why it matters, current status, and the expected resolution path.

## Status meanings

- **Open** — known issue/risk that still needs action.
- **Watching** — acceptable for now, but must be revisited before a later milestone.
- **Blocked** — cannot resolve until a dependency or human decision is available.
- **Resolved** — fixed or deliberately closed, with evidence.
- **Deferred** — intentionally postponed with a clear revisit point.

## Severity meanings

- **High** — can create security exposure, data leakage, architectural drift, or false confidence.
- **Medium** — can cause implementation friction, test gaps, operational confusion, or future rework.
- **Low** — documentation cleanup, naming polish, or small maintainability concern.

## Checklist

### RB-001 — Direct-run service previously bound `0.0.0.0`

**Status:** Resolved  
**Severity:** High  
**Area:** network exposure / service runtime  
**Observed in:** `server.js`

**What we know:**

`server.js` previously started the HTTP service with an explicit `0.0.0.0` bind. Kristian approved port `3080` if available, with phase-one binding localhost/internal-only.

**Resolution:**

Implemented `getListenConfig()` in `server.js` with safe defaults:

```text
host: 127.0.0.1
port: 3080
```

Explicit override remains available through:

```text
BROWSER_WORKER_HOST
PORT
```

**Acceptance evidence:**

- RED test initially failed because `getListenConfig` did not exist.
- Added tests for default localhost/port and explicit override.
- Runtime smoke check: `curl http://127.0.0.1:3080/health` returns healthy JSON.

---

### RB-002 — Action naming mismatch resolved: use `capturePage`

**Status:** Resolved  
**Severity:** Medium  
**Area:** API contract / tests  
**Observed in:** `test/server.test.js`, `BROWSER_WORKER_IMPLEMENTATION_SPEC.md`, `DECISIONS.md`

**What we know:**

The skeleton originally accepted the old action name:

```json
{"url":"https://example.com","action":"capture"}
```

The approved stable action name is:

```text
capturePage
```

**Resolution:**

- Updated endpoint tests to use `capturePage`.
- Added explicit action validation in `server.js`.
- Unknown actions now return structured `invalid_action` errors with HTTP 400.
- The old `capture` action is rejected.

**Acceptance evidence:**

- Tests use `capturePage`.
- API validation accepts `capturePage`.
- Unknown action returns structured `invalid_action` error.

---

### RB-003 — Private-network policy must cover redirects/final URLs

**Status:** Resolved for isolated `capturePage` / Watching for future broader actions  
**Severity:** High  
**Area:** security / URL policy  
**Observed in:** `url-policy.js`, `browser-capture.js`, `server.js`, `ACCEPTANCE_TESTS.md`

**What we know:**

The worker evaluates URL/private-network policy before accepted jobs launch browser navigation. It also checks document navigation requests and final URLs during isolated `capturePage` execution, so a public-looking start URL cannot redirect the capture path into a blocked private/internal target.

Current policy:

- validates absolute HTTP(S) URLs;
- blocks localhost and loopback;
- blocks RFC1918/private IPv4 ranges;
- blocks link-local and metadata IPs;
- blocks selected IPv6 loopback/unique-local/link-local/multicast ranges;
- blocks hostnames that resolve to blocked IPs;
- returns structured `private_network_denied` errors for pre-navigation policy failures;
- returns structured `redirected_private_network_denied` errors for redirected/final navigation policy failures.

**Remaining watch point:**

If broader browser actions are added later, those actions must reuse the same policy gates for every new document navigation surface. Do not assume the `capturePage` policy wiring automatically covers future action types.

**Acceptance evidence:**

- Unit tests cover representative private/special IP and hostname cases, including `0.0.0.0`, IPv4-mapped IPv6 blocked targets, and DNS-resolution failure handling.
- HTTP endpoint test covers loopback rejection before browser execution.
- Browser-capture tests cover redirected private document navigation being aborted before screenshot capture.
- Server tests cover blocked policy envelopes and defensive page artifact cleanup.

---

### RB-004 — Browser execution baseline could be mistaken for a fuller worker

**Status:** Watching  
**Severity:** Medium  
**Area:** implementation state / false-confidence risk  
**Observed in:** `server.js`, `browser-capture.js`, `IMPLEMENTATION_NOTES.md`, `CURRENT_STATE_SNAPSHOT.md`

**What we know:**

Accepted `capturePage` jobs now launch isolated Playwright, capture final URL/title/HTTP status, write screenshot, HTML, and text artifacts when successful, and persist `request.json` / `response.json`. Accepted capture failures return structured `capture_failed` data and remove page artifacts that should not be reported.

**Why it matters:**

The service is now a real narrow capture baseline, but it still should not be mistaken for a general browser worker. It does not yet support broader actions, deterministic dialog/popup/download reporting, `storageState`, persistent profiles, or Docker runtime verification.

**Expected next fix:**

Verify isolated-session state behavior before adding any saved state or profile reuse.

**Acceptance evidence:**

- Public URL capture loads through Playwright.
- Accepted capture response includes real final URL/title/HTTP status.
- Screenshot, HTML, and text artifacts are reported only when files exist.
- Accepted capture failures return structured `capture_failed` data, clean page artifacts, and persist `response.json`.
- Blocked redirected/final URL paths clean page artifacts and return structured blocked envelopes.

---

### RB-005 — Artifact layout is directionally approved but pinned for revisit

**Status:** Deferred  
**Severity:** Medium  
**Area:** artifacts / storage layout  
**Observed in:** `DECISIONS.md`, `BROWSER_WORKER_IMPLEMENTATION_SPEC.md`, `IMPLEMENTATION_NOTES.md`

**What we know:**

Current direction separates job artifacts, profiles, storage state, downloads, traces, and logs. It is good enough for first implementation, but pinned for a hardening revisit.

**Why it matters:**

Artifact layout becomes expensive to change once code, tests, and operator habits depend on it.

**Expected fix:**

Before hardening freezes layout, compare against Browserless, Browserbase, and Playwright artifact/session patterns one more time.

**Acceptance evidence:**

- Revisit completed and recorded.
- Final artifact layout reflected in docs/tests/code.

---

### RB-006 — `AGENT_HANDOFF.md` contained stale blocker wording

**Status:** Resolved  
**Severity:** Low  
**Area:** documentation consistency  
**Observed in:** `AGENT_HANDOFF.md`

**What we know:**

`AGENT_HANDOFF.md` previously said runtime files were not visible under `/DATA/browser-stack` and that implementation was not ready until missing runtime files were visible. Later docs clarified the old runtime was found under `/opt/data/browser-stack` and is no longer a blocker.

**Resolution:**

Updated `AGENT_HANDOFF.md` on 2026-06-27 to reflect:

- old runtime found under `/opt/data/browser-stack`;
- old runtime is fallback/reference;
- `/DATA/browser-stack` is the GitHub working tree;
- foundation PR #1 merged;
- repository is private;
- current next implementation steps.

**Acceptance evidence:**

- Handoff wording now matches `CURRENT_STATE_SNAPSHOT.md` and `DECISIONS.md`.

---

### RB-007 — GitHub PR/API operations still lack `gh` authentication

**Status:** Watching  
**Severity:** Low  
**Area:** repository workflow  
**Observed in:** environment setup

**What we know:**

SSH repo access works for clone/pull/push. `gh` CLI is installed but not authenticated for API actions.

**Why it matters:**

Normal repo work works. But direct PR creation, issue creation, CI inspection through `gh`, and PR comments will need GitHub API auth later.

**Expected fix:**

Only configure `gh` auth when PR/API operations are actually needed.

**Acceptance evidence:**

- `gh auth status` succeeds, if/when configured.

---

### RB-008 — `/DATA/browser-stack` now tracks Git, but agent-run logs are committed

**Status:** Watching  
**Severity:** Low  
**Area:** repo hygiene  
**Observed in:** initial foundation commit

**What we know:**

The foundation commit includes `agent-runs/browser-worker-prep/logs/...` and prep notes. These are useful provenance, but future run logs may become noisy or sensitive.

**Why it matters:**

Agent logs can clutter repository history or accidentally preserve environment details that should stay local.

**Expected fix:**

Decide whether future `agent-runs/` logs should remain tracked, be pruned before merge, or be covered by `.gitignore` with only curated summaries kept.

**Acceptance evidence:**

- Repo hygiene decision recorded.
- `.gitignore` updated if needed.

---

### RB-009 — Repository visibility appeared public

**Status:** Resolved  
**Severity:** High  
**Area:** repository visibility / privacy

**What happened:**

Kristian created the repo intending it to be private, but it appeared public after the foundation PR was merged. Nix verified via unauthenticated GitHub API that the repo was public at that moment:

```text
private: False
visibility: public
```

**Resolution:**

Kristian corrected the repository visibility. Nix re-checked:

```text
GitHub API unauthenticated: 404 Not Found
GitHub HTML unauthenticated: 404
Authenticated SSH git check: HEAD returned normally
```

This is the expected behavior for a private repo that Nix can access over SSH.

**Follow-up:**

Treat public visibility as a regression if it ever appears again.

## Maintenance rules

- Add a new entry when a risk, bug, mismatch, or future issue is discovered.
- Link to specific files and acceptance tests when possible.
- Keep current status honest; do not mark resolved without evidence.
- If a risk affects implementation order, also update `IMPLEMENTATION_DEPENDENCY_MAP.md` or `DECISIONS.md` as appropriate.
- If a risk becomes a concrete implementation task, reference it from the implementation plan.
