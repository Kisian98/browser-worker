# Browser Worker Agent Handoff

Updated: 2026-06-28

## Mission

Continue the browser-worker rebuild as a real software project: Hermes/Nix remains the reasoning layer, while browser-worker becomes a constrained HTTP JSON browser execution service that runs bounded Playwright jobs, captures artifacts, and returns structured evidence.

## Current repository state

- GitHub repo: `git@github.com:Kisian98/browser-worker.git`
- Visibility: private, verified after an accidental/public-state concern by unauthenticated checks returning 404.
- Default branch: `main`
- Foundation PR: merged and closed as PR #1.
- Local project root: `/DATA/browser-stack`
- Old shell/demo fallback root: `/opt/data/browser-stack`

## Current implementation state

The repo contains a small tested Node service skeleton plus extensive foundation docs.

Implemented skeleton:

- `package.json`
  - `npm test` -> `node --test`
  - `npm start` -> `node server.js`
  - `engines.node >=20`
- `response-envelope.js`
  - stable structured JSON response envelope aligned with the implementation-spec top-level contract
  - includes `request`, `page`, `signals`, `extraction`, `artifacts`, `events`, `warnings`, and normalized structured `errors`
  - default error metadata includes `phase` and `retryable`
- `url-policy.js`
  - pre-navigation URL/private-network policy
  - structured `invalid_url` / `private_network_denied` errors
- `artifacts.js`
  - artifact-root-relative path planning
  - per-job directory creation
  - `downloads/` directory creation
  - formatted JSON file writes
- `browser-capture.js`
  - isolated Playwright `capturePage` runner
  - browser/context/page cleanup on success and failure
  - screenshot write + existence check
- `server.js`
  - `GET /health`
  - `POST /v1/browser/jobs`
  - JSON parsing, action validation, URL/private-network policy, isolated capture execution, and artifact persistence
- tests:
  - response envelope tests
  - server endpoint tests
  - URL policy tests
- repo hygiene:
  - `.gitignore`
  - `.nvmrc`
  - GitHub Actions CI for `npm test`

Not implemented yet:

- HTML/text extraction and artifact writing
- redirect-to-private enforcement after real navigation/redirect chains
- session lifecycle beyond isolated per-job contexts
- `storageState`
- persistent profile support
- Dockerized rebuild runtime
- container hardening

## Non-negotiable constraints

- Keep browser-worker deterministic. Do not turn it into a second autonomous agent.
- Keep the old `/opt/data/browser-stack` shell/demo runtime as fallback/reference. Do not delete or destructively migrate it.
- Preserve Docker config semantics where relevant:

```bash
sudo DOCKER_CONFIG=/DATA/docker-client docker compose run --rm browser-worker
```

- Isolated sessions are default.
- Private-network browsing is blocked by default.
- URL/private-network policy must be implemented before real browser navigation.
- `storageState` comes after isolated sessions work.
- Persistent named profile support comes after isolated + `storageState` work.
- First named persistent profile, when implemented, is `marketing-tools`.
- Use `capturePage` as the phase-one action name.
- Bind phase-one service localhost/internal-only; port `3080` is approved if available.
- Git author for Nix's commits: `Nix <nix-assistant@agentmail.to>`.

## Documentation map for re-entry

Read these first:

1. `README.md` — project map.
2. `CURRENT_STATE_SNAPSHOT.md` — where the project stands now.
3. `DECISIONS.md` — approved decisions and deferred revisits.
4. `RISKS_AND_BUGS.md` — active risks/bugs/future issue checklist.
5. `ACCEPTANCE_TESTS.md` — what proves phase one is real.
6. `IMPLEMENTATION_DEPENDENCY_MAP.md` — dependency order and blockers.
7. `PHASE_ONE_SCOPE.md` — phase-one includes/excludes.
8. `IMPLEMENTATION_APPROACH.md` — brick-by-brick development standard.
9. `BROWSER_WORKER_IMPLEMENTATION_SPEC.md` — detailed API/session/artifact/security spec.

## Current known risks to address early

See `RISKS_AND_BUGS.md`. Highest-priority early risks:

1. Redirect-to-private enforcement still needs to be wired into real browser navigation before final navigation state is trusted.
2. Decide whether future `agent-runs/` logs should stay tracked or be ignored after curated summaries.

## Recommended next implementation steps

1. Create the next implementation branch from `main`.
2. Write real HTML/text artifacts behind the existing isolated capture path.
3. Re-check URL policy after redirects/final navigation state before trusting broader capture output.
4. Add richer extraction metadata/signals only after the redirect boundary is covered.

## Verification baseline

Current baseline test command:

```bash
cd /DATA/browser-stack
npm test
```

Expected current result: 24 tests pass, 0 fail.
