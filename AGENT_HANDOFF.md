# Browser Worker Agent Handoff

## Mission

Prepare documentation and research for converting the existing one-shot Playwright CLI runner into a long-running HTTP JSON browser execution service for Hermes. Preparation only: no runtime implementation yet.

## Non-negotiable constraints

Do not modify:

- `worker.js`
- `Dockerfile.worker`
- `docker-compose.yml`
- `browser-worker`

Preserve Docker invocation semantics where relevant:

```bash
sudo DOCKER_CONFIG=/DATA/docker-client docker compose run --rm browser-worker
```

Do not change Docker, Compose, Playwright, ports, mounts, or runtime behavior before human approval.

## Current blocker

In this prep environment the expected runtime files were not visible under `/DATA/browser-stack`. Do not infer code details. Re-run inspection when those files are available.

## Recommended next agent steps after human approval

1. Re-inspect runtime files and update `PROJECT_CONTEXT.md` with actual snippets.
2. Confirm API contract and security scope with human.
3. Add acceptance tests/documented curl examples before changing runtime behavior.
4. Implement the smallest HTTP service wrapper around current one-job behavior.
5. Add artifact paths and structured output envelope.
6. Add reliability handling: timeouts, dialogs, popups/new tabs, downloads, frame metadata, error categories.
7. Add security controls: URL allow/deny policy, private-network blocking if required, non-root/seccomp Docker hardening.

## Definition of ready for implementation

Not ready until the missing runtime files are visible and reviewed. Research and target architecture are ready; code change scope is not.
