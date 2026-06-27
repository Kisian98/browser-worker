# Browser Worker Decision Log

Date created: 2026-06-27

This is the canonical project decision log for the browser-worker rebuild. Keep it short, source-grounded, and current. Its job is to prevent repeated debate, accidental scope creep, and implementation drift.

## Status meanings

- **Approved** — accepted as current project direction.
- **Pending human review** — must be confirmed before implementation depends on it.
- **Deferred / pinned revisit** — intentionally postponed, but must be revisited before hardening or broad rollout.
- **Rejected** — explicitly not part of the plan unless reopened.

## Approved decisions

### D-001 — Worker role: deterministic browser execution surface

**Status:** Approved  
**Decision:** The browser-worker is a constrained browser execution surface. Hermes/Nix remains the reasoning/planning layer.  
**Rationale:** Keeps responsibility boundaries clean and avoids building a second autonomous agent inside the browser service.  
**Implications:** Prefer typed HTTP JSON jobs, structured responses, deterministic actions, and observable artifacts. Do not push planning/reasoning into the worker.

### D-002 — Target architecture: local HTTP JSON service

**Status:** Approved  
**Decision:** Rebuild toward a long-running HTTP JSON browser execution service.  
**Rationale:** A service boundary is cleaner than repeatedly invoking one-shot scripts once sessions, artifacts, policy, and reliability handling matter.  
**Implications:** Phase one centers on `GET /health` and `POST /v1/browser/jobs` rather than a broad browser-farm API.

### D-003 — Old shell/demo runtime is reference material, not source of truth

**Status:** Approved  
**Decision:** The old one-shot runtime found under `/opt/data/browser-stack` is preserved as reference/fallback material. The rebuild source of truth lives under `/DATA/browser-stack`.  
**Rationale:** The old runtime confirms useful details, but it is a shell/demo rather than the desired service architecture.  
**Implications:** Do not mutate old demo files as if they are production. Do not delete or replace the baseline until replacement acceptance tests pass.

### D-004 — Preserve Docker invocation semantics where documented

**Status:** Approved  
**Decision:** Preserve the known Docker invocation semantics where relevant:

```bash
sudo DOCKER_CONFIG=/DATA/docker-client docker compose run --rm browser-worker
```

**Rationale:** The project has environment-specific Docker client configuration that must not be lost.  
**Implications:** Any future Docker/Compose docs or scripts must include `DOCKER_CONFIG=/DATA/docker-client` unless a later verified change replaces this requirement.

### D-005 — Session model has three tiers

**Status:** Approved  
**Decision:** The session model is three-tier:

1. `isolated` — default clean browser context.
2. `storageState` / state-restored — explicit saved auth/session state file.
3. `persistentProfile` — explicit named trusted profile, with first phase-one profile name `marketing-tools`.

**Rationale:** Balances reproducibility, authenticated convenience, and profile safety.  
**Implications:** Isolated remains default. Persistent profiles require explicit opt-in and must not be mixed with normal run artifacts.

### D-006 — Private-network browsing blocked by default

**Status:** Approved  
**Decision:** Private-network access is blocked by default for browser jobs.  
**Rationale:** Kristian prefers direct non-browser access for internal/private resources instead of using the browser-worker as a path into private networks.  
**Implications:** URL policy must deny localhost/loopback, RFC1918/private ranges, link-local, Docker/internal networks, metadata IPs, and internal hostnames resolving private unless explicitly allowed later.

### D-007 — Security sequencing: boundary baseline first, hardening later

**Status:** Approved  
**Decision:** Phase one includes security baseline and boundary design. Full Docker/container hardening is deferred until after core HTTP worker acceptance tests pass.  
**Rationale:** Avoids prematurely hardening an unproven skeleton while still preventing unsafe architecture.  
**Implications:** Do URL policy, mount boundaries, secret isolation, local/internal binding, and structured security errors early. Defer deeper container hardening such as seccomp/capability tuning until the service works.

### D-008 — Artifacts stay on disk; responses return paths/metadata

**Status:** Approved  
**Decision:** Artifacts should be written under predictable project directories and referenced by path/metadata in JSON responses. Do not embed large binary artifacts in response JSON by default.  
**Rationale:** Keeps responses small, inspectable, and suitable for repeated automation.  
**Implications:** Screenshots, HTML, text, ARIA snapshots, traces, downloads, request JSON, and response JSON need deterministic locations.

### D-009 — Implementation proceeds brick by brick

**Status:** Approved  
**Decision:** Implementation uses planning baseline -> branch -> failing test where practical -> minimal implementation -> verification -> commit -> next vertical slice.  
**Rationale:** Prevents unstructured repo edits and makes progress reviewable.  
**Implications:** Each milestone needs acceptance/verification evidence before it is considered done.

### D-010 — No arbitrary JavaScript/Playwright execution endpoint in phase one

**Status:** Approved  
**Decision:** Phase one should avoid broad arbitrary JS or arbitrary Playwright execution endpoints.  
**Rationale:** Such endpoints blur the service boundary, increase security risk, and turn the worker into a general remote-control surface too early.  
**Implications:** Use bounded task-shaped actions first, starting with capture/navigation behavior.

## Newly approved decisions from Kristian on 2026-06-27

### D-011 — GitHub repository target

**Status:** Approved  
**Decision:** `/DATA/browser-stack` should become the working tree for the private GitHub repository `Kisian98/browser-worker`.  
**Verification:** SSH access to `git@github.com:Kisian98/browser-worker.git` works. Remote `main` exists and currently contains `LICENSE`.  
**Implications:** Local `/DATA/browser-stack` has been initialized as a git repo, tracking `origin/main`. Future implementation should use a feature branch from `main`.

### D-012 — Service port and binding

**Status:** Approved  
**Decision:** Use port `3080` if available, with localhost/internal-only binding for phase one.  
**Verification:** A local bind test confirmed `127.0.0.1:3080` was available on 2026-06-27.  
**Implications:** Current `server.js` direct-run binding to `0.0.0.0` should be changed before runtime use so phase one does not expose the service broadly by accident.

### D-013 — Phase-one action name

**Status:** Approved  
**Decision:** Use `capturePage` as the stable phase-one action name.  
**Rationale:** It is explicit, matches the detailed implementation spec, and leaves room for later actions such as `goto`, `click`, or `extractPage`.  
**Implications:** Existing skeleton tests using `capture` should be migrated to `capturePage` when action validation is implemented.

### D-014 — Persistent profile timing

**Status:** Approved  
**Decision:** Implement named persistent profile support only after isolated sessions and `storageState` work.  
**Rationale:** Persistent profiles are more sensitive and should come after the safer session primitives are correct.  
**Implications:** Phase one may design persistent profile policy and directories, but implementation sequence is isolated -> `storageState` -> persistent profile.

### D-015 — Old runtime fallback retention

**Status:** Approved  
**Decision:** Keep the old `/opt/data/browser-stack` shell/demo runtime as a fallback, especially in case the rebuild needs to start over.  
**Rationale:** The old runtime is not production-ready, but it is useful fallback/reference material.  
**Implications:** Do not delete, overwrite, or migrate it destructively. Any future migration must be explicit and reversible.

### D-016 — Git author identity for Nix commits

**Status:** Approved  
**Decision:** Commits authored by Nix use `Nix <nix-assistant@agentmail.to>`.  
**Rationale:** Keeps Nix-authored work identifiable and connected to the AgentMail address.  
**Implications:** Use repo-local git config for this project unless a future project overrides it.

### D-017 — Repository visibility

**Status:** Approved / verified  
**Decision:** `Kisian98/browser-worker` should be private.  
**Verification:** After Kristian changed/check-corrected visibility, unauthenticated GitHub API and HTML requests returned `404`, while authenticated SSH git access still worked.  
**Implications:** Treat public visibility as a regression/security issue if it appears again.

## Pending human review

_No pending human-review decisions at this layer right now._

## Deferred / pinned revisits

### R-001 — Artifact layout hardening revisit

**Status:** Deferred / pinned revisit  
**Decision:** Current artifact layout is good enough for first implementation, but must be revisited before hardening freezes it.  
**Rationale:** Need one more comparison against Browserless, Browserbase, and Playwright artifact/session patterns.  
**Current direction:** Separate run artifacts, profiles, storage state, downloads, traces, and logs.

### R-002 — Full Docker/container hardening

**Status:** Deferred / pinned revisit  
**Decision:** Full hardening waits until the core capture/action/session loop works and acceptance tests pass.  
**Potential hardening:** non-root runtime, `cap_drop`, `no-new-privileges`, seccomp tuning, restricted mounts, restricted network exposure.

### R-003 — Async job polling and job history endpoints

**Status:** Deferred / pinned revisit  
**Decision:** Phase one can run jobs synchronously. Async job polling and history endpoints can come later if needed.  
**Rationale:** A synchronous first pass reduces moving parts and makes acceptance testing simpler.

## Rejected approaches

### X-001 — Treating the old shell/demo runtime as production-ready

**Status:** Rejected  
**Reason:** It is a one-shot CLI runner with no service API, no full session model, no private-network policy, and no structured reliability taxonomy.

### X-002 — Building a second autonomous agent inside the worker

**Status:** Rejected  
**Reason:** The worker should execute typed browser tasks and return evidence. Reasoning belongs in Hermes/Nix.

### X-003 — Screenshot-only output as the main result

**Status:** Rejected  
**Reason:** Screenshots alone are insufficient for agent workflows. Responses need structured extraction, page metadata, signals, errors, warnings, and artifact paths.

### X-004 — Mixing persistent profile/auth state with normal run artifacts

**Status:** Rejected  
**Reason:** Persistent profiles and saved auth state are sensitive and must be segregated from per-run artifacts/downloads/traces.

## Maintenance rules

- Add a decision when it changes implementation behavior, scope, security, artifact layout, or session policy.
- Keep decisions concise and link to detailed specs instead of duplicating entire design docs.
- If an implementation reality contradicts this log, stop and update the decision status before continuing.
- Do not silently convert pending or deferred decisions into implementation defaults without review.
