# Browser Worker Prep — Project Context

## Intended project shape
- Current baseline: one-shot CLI Playwright runner.
- Future target: long-running HTTP JSON browser execution service.
- This prep pass must not change runtime files such as `worker.js`, `Dockerfile.worker`, `docker-compose.yml`, or `browser-worker`.

## Constraints observed from the prep brief
- Preparation only.
- Document the project under `agent-runs/browser-worker-prep`.
- Preserve the existing one-shot runner as the baseline until acceptance criteria exist for the service phase.
- Keep browser execution isolated from broader agent state and secrets.

## Reference handoff themes
- Keep the first pass minimal and smoke-testable.
- Use a narrow worker boundary with structured outputs.
- Prefer non-root browser execution and small mount surfaces.
- Do not turn the browser worker into a general-purpose shell or reasoning surface.

## Status of this prep run
- Public web research completed.
- Local project root `/DATA/browser-stack` was not present in this environment, so runtime files could not be inspected directly.
- Documentation files were created under the requested prep output folder.
