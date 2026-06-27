# Browser Worker Project Context

## Current purpose

This project is intended to become a browser surface for Hermes: Hermes remains the planner/brain, while the browser-worker executes browser actions, captures artifacts, and returns structured JSON.

## Known intended current flow

The user-provided known flow is:

```text
host wrapper -> sudo DOCKER_CONFIG=/DATA/docker-client docker compose run --rm browser-worker -> node worker.js -> Playwright opens Chromium -> one job -> exits
```

`DOCKER_CONFIG=/DATA/docker-client` must be preserved anywhere Docker commands are documented or automated.

## Inspection result for this prep run

The original shell/demo runtime was later found under `/opt/data/browser-stack`, not `/DATA/browser-stack`:

- `/opt/data/browser-stack/worker.js`
- `/opt/data/browser-stack/Dockerfile.worker`
- `/opt/data/browser-stack/docker-compose.yml`
- `/opt/data/browser-stack/browser-extract.mjs`
- `/opt/data/scripts/browser-extract`

A `browser-worker` wrapper was not found in the searched locations. The recovered files show a one-shot CLI Playwright shell/demo, not the target service. They are useful reference material for launch flags, screenshot boundary, simple click behavior, and previous local staging context, but the approved rebuild spec is now the source of truth.

Current rebuild/runtime-visible files under `/DATA/browser-stack` include:

- `/DATA/browser-stack/package.json`
- `/DATA/browser-stack/response-envelope.js`
- `/DATA/browser-stack/server.js`
- `/DATA/browser-stack/test/response-envelope.test.js`
- `/DATA/browser-stack/test/server.test.js`

The service currently exposes `/health` and `POST /v1/browser/jobs`, and `npm test` verifies the structured response envelope. Browser execution is intentionally not connected yet.

## Current file structure observed

```text
/DATA/browser-stack/
├── package.json
├── response-envelope.js
├── server.js
├── test/
│   ├── response-envelope.test.js
│   └── server.test.js
├── AGENT_HANDOFF.md
├── IMPLEMENTATION_NOTES.md
├── PROJECT_CONTEXT.md
├── README.md
├── RESEARCH_NOTES.md
└── agent-runs/
    └── browser-worker-prep/
        ├── 01-project-documentation.md
        ├── 02-similar-project-research.md
        ├── 03-reliability-security-extraction.md
        ├── 04-merge-documentation.md
        ├── AGENT_HANDOFF.md
        ├── FINAL_SUMMARY.md
        ├── IMPLEMENTATION_NOTES.md
        ├── PROJECT_CONTEXT.md
        ├── RESEARCH_NOTES.md
        └── logs/
```

## Runtime files that must not be changed yet

Do not modify these files during preparation or before human approval:

- `worker.js`
- `Dockerfile.worker`
- `docker-compose.yml`
- `browser-worker`

They may be inspected and quoted in small snippets once present.

## Target architecture

Future target: a long-running HTTP JSON browser execution service.

Recommended shape:

- One containerized service owns Playwright browser execution.
- Hermes sends JSON jobs over HTTP.
- Browser-worker returns a structured JSON envelope with status, navigation data, extracted content, artifacts, warnings, and errors.
- Artifacts are written under a predictable mounted directory, not embedded as huge base64 blobs by default.
- Session behavior is explicit: isolated ephemeral contexts by default, opt-in reusable sessions, and carefully controlled persistent profiles.

## Missing before implementation

Before code changes, a human should confirm:

1. The real runtime files are present and match the known flow.
2. Which host port the HTTP service should use.
3. Whether the worker may access arbitrary public internet only, or also private LAN resources.
4. Which session modes are allowed.
5. Whether authenticated/persistent browser profiles are in scope for phase one.
