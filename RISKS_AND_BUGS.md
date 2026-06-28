# Browser Worker Risks and Bugs

Date created: 2026-06-27

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
- `npm test` passes: 6 tests, 0 failures.
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
- `npm test` passes: 7 tests, 0 failures.

---

### RB-003 — Private-network policy exists, but redirect enforcement still needs to be wired into real navigation

**Status:** Watching  
**Severity:** High  
**Area:** security / URL policy  
**Observed in:** `url-policy.js`, `server.js`, `ACCEPTANCE_TESTS.md`

**What we know:**

The worker now evaluates URL/private-network policy before the skeleton capture path accepts a request. Current policy:

- validates absolute HTTP(S) URLs;
- blocks localhost and loopback;
- blocks RFC1918/private IPv4 ranges;
- blocks link-local and metadata IPs;
- blocks selected IPv6 loopback/unique-local/link-local/multicast ranges;
- blocks hostnames that resolve to blocked IPs;
- returns structured `private_network_denied` errors.

**What remains:**

Once real Playwright navigation exists, redirect targets and navigation-time URL changes must also be checked so a public-looking start URL cannot bounce into a blocked/private destination.

**Acceptance evidence:**

- Unit tests cover representative private/special IP and hostname cases.
- HTTP endpoint test covers loopback rejection.
- Runtime smoke check shows loopback request returns structured `private_network_denied` before browser execution.
- Future redirect-to-private test still needed before real browser navigation is connected.

---

### RB-004 — Browser execution is intentionally not connected

**Status:** Watching  
**Severity:** Medium  
**Area:** implementation state / false-confidence risk  
**Observed in:** `server.js`, `IMPLEMENTATION_NOTES.md`, `CURRENT_STATE_SNAPSHOT.md`

**What we know:**

Current successful job responses include:

```text
browser_execution_not_yet_connected
```

No Playwright browser launch, navigation, screenshot, extraction, or artifact writing exists yet.

**Why it matters:**

This is fine for the skeleton, but it must stay visible so nobody mistakes the service skeleton for a working browser worker.

**Expected fix:**

Keep the warning until real Playwright execution and artifact writing exist. Remove only when acceptance tests prove real capture behavior.

**Acceptance evidence:**

- Public URL capture loads through Playwright.
- Response no longer includes `browser_execution_not_yet_connected` for implemented capture path.
- Screenshot/text/HTML artifacts verified.

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

## Resolved issues

### RB-001 — Direct-run localhost binding

Resolved on 2026-06-27 by defaulting direct-run startup to `127.0.0.1:3080` with explicit `BROWSER_WORKER_HOST` override.

### RB-002 — Action naming and validation

Resolved on 2026-06-27 by migrating the accepted action to `capturePage` and returning structured `invalid_action` errors for unknown actions.

### RB-006 — Handoff stale blocker wording

Resolved on 2026-06-27 by rewriting `AGENT_HANDOFF.md` to match current repo/runtime state.

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
