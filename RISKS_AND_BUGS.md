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

## Open / active checklist

### RB-001 — Direct-run service currently binds `0.0.0.0`

**Status:** Open  
**Severity:** High  
**Area:** network exposure / service runtime  
**Observed in:** `server.js`

**What we know:**

`server.js` currently starts the HTTP service with:

```js
createServer().listen(port, '0.0.0.0', () => {
  console.log(`browser-worker listening on ${port}`);
});
```

Kristian approved port `3080` if available, with phase-one binding localhost/internal-only.

**Why it matters:**

Binding to `0.0.0.0` can expose the service more broadly than intended, depending on container/network configuration. That conflicts with the current phase-one security posture.

**Expected fix:**

Add explicit host binding configuration, defaulting to `127.0.0.1` or an approved internal-only address. Tests should verify the default host value and documented startup behavior.

**Acceptance evidence:**

- Source shows safe default binding.
- Runtime check confirms service is listening only on approved interface.
- `ACCEPTANCE_TESTS.md` A-022 satisfied.

---

### RB-002 — Action naming mismatch: skeleton uses `capture`, spec chooses `capturePage`

**Status:** Open  
**Severity:** Medium  
**Area:** API contract / tests  
**Observed in:** `test/server.test.js`, `BROWSER_WORKER_IMPLEMENTATION_SPEC.md`, `DECISIONS.md`

**What we know:**

Existing skeleton tests currently submit:

```json
{"url":"https://example.com","action":"capture"}
```

The approved stable action name is now:

```text
capturePage
```

**Why it matters:**

If not reconciled early, docs/tests/implementation may drift and clients may depend on the wrong action name.

**Expected fix:**

When action validation is added, update tests and docs to use `capturePage`. Optionally reject unknown actions with a structured `invalid_action` error.

**Acceptance evidence:**

- Tests use `capturePage`.
- API validation accepts `capturePage`.
- Unknown action returns structured error.

---

### RB-003 — Private-network blocking is not implemented yet

**Status:** Open  
**Severity:** High  
**Area:** security / URL policy  
**Observed in:** `server.js`, `ACCEPTANCE_TESTS.md`, `TARGETED_RESEARCH_2026-06-27.md`

**What we know:**

Current URL validation only checks whether URLs are absolute HTTP(S). It does not yet deny localhost, private IP ranges, metadata IPs, Docker/internal ranges, or private-resolving hostnames.

**Why it matters:**

The browser-worker must not become a browser path into private/internal network resources. Kristian prefers direct non-browser access for private data when needed.

**Expected fix:**

Create a URL policy module that:

- parses URLs with the WHATWG `URL` API;
- allows only `http` and `https`;
- resolves hostnames;
- classifies all returned IPs;
- denies loopback, RFC1918, link-local, metadata, Docker/internal, multicast/special-use ranges as appropriate;
- validates redirects during browser navigation;
- returns structured policy errors such as `private_network_denied`.

**Acceptance evidence:**

- Unit tests for representative private/special IP and hostname cases.
- Redirect-to-private test or controlled fixture.
- `ACCEPTANCE_TESTS.md` A-006 satisfied.

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

### RB-006 — `AGENT_HANDOFF.md` contains stale blocker wording

**Status:** Open  
**Severity:** Low  
**Area:** documentation consistency  
**Observed in:** `AGENT_HANDOFF.md`

**What we know:**

`AGENT_HANDOFF.md` still says runtime files were not visible under `/DATA/browser-stack` and that implementation is not ready until missing runtime files are visible. Later docs clarify the old runtime was found under `/opt/data/browser-stack` and is no longer a blocker.

**Why it matters:**

A future agent may read the handoff and think a resolved blocker is still active.

**Expected fix:**

Update the handoff to reflect the current state:

- old runtime found under `/opt/data/browser-stack`;
- old runtime is fallback/reference;
- `/DATA/browser-stack` is now the GitHub working tree;
- implementation foundation branch exists.

**Acceptance evidence:**

- Handoff wording matches `CURRENT_STATE_SNAPSHOT.md` and `DECISIONS.md`.

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

_No resolved risks/bugs yet._

## Maintenance rules

- Add a new entry when a risk, bug, mismatch, or future issue is discovered.
- Link to specific files and acceptance tests when possible.
- Keep current status honest; do not mark resolved without evidence.
- If a risk affects implementation order, also update `IMPLEMENTATION_DEPENDENCY_MAP.md` or `DECISIONS.md` as appropriate.
- If a risk becomes a concrete implementation task, reference it from the implementation plan.
