# Browser Worker Phase-One Scope

Date created: 2026-06-27

This note defines the proposed phase-one scope for the browser-worker rebuild. It separates what should be implemented now from what should be designed only, deferred, or explicitly rejected.

## Phase-one goal

Create a local/internal browser execution service that can accept one bounded capture job, load a public URL in an isolated Playwright context, write structured artifacts, and return a predictable JSON response envelope.

Phase one should prove the architecture is real without expanding into a general browser farm, autonomous agent, or broad remote-control surface.

## In scope for phase one

### Service foundation

- Node HTTP service.
- `GET /health` endpoint.
- `POST /v1/browser/jobs` endpoint.
- Synchronous job execution is acceptable.
- Stable response envelope for success and failure.
- Structured errors and warnings.

### Capture job

- One initial bounded action, preferably `capturePage` once naming is confirmed.
- Absolute HTTP(S) URL input.
- Isolated browser context by default.
- Bounded request/navigation/action/artifact timeouts.
- Basic redirect/final URL/status/title capture where available.

### Artifacts

- Deterministic job artifact directory.
- Persist submitted `request.json`.
- Persist returned `response.json`.
- Screenshot artifact when requested.
- HTML artifact when requested.
- Text extraction artifact when requested.
- Downloads directory shape, even if download handling is implemented in a later reliability slice.
- Response returns artifact paths/metadata, not base64 blobs.

### Security baseline

- Treat arbitrary browsing as untrusted.
- Isolated sessions by default.
- Private-network targets blocked by default.
- No Hermes secrets, Obsidian vaults, SSH keys, Docker socket, or broad host paths mounted into browser jobs.
- Service should bind localhost/internal-only unless broader exposure is explicitly approved.
- No external Playwright CDP/WebSocket/remote debugging exposure.
- Auth/session state separated from normal job artifacts.

### Verification

- Local `npm test` passing.
- Service start verified.
- Health endpoint verified.
- Public URL capture smoke test verified.
- Artifact files verified on disk.
- Private-network denial verified.
- Resource cleanup checked sufficiently for phase one.
- Old shell/demo runtime preserved until replacement acceptance tests pass.

## Design in phase one, implement later unless explicitly approved

### `storageState`

Design the directory layout and API expectations for saved auth/session state, but implement after isolated capture is working.

Reason: saved auth state is sensitive and should not be introduced before the basic worker lifecycle is reliable.

### Named persistent profile

Design around the first approved profile name:

```text
marketing-tools
```

Implementation should wait until isolated and `storageState` behavior are correct, unless Kristian explicitly pulls it into phase one.

### Reliability extras

Design now, implement in later slices as needed:

- dialogs;
- popups/new tabs;
- iframe-aware actions;
- downloads;
- cookie/consent policy;
- login/captcha/block detection beyond basic schema fields;
- traces.

Some of these may move into phase one if the acceptance checklist requires them before first useful operation.

## Explicitly out of scope for phase one

- Arbitrary JavaScript execution endpoint.
- Arbitrary Playwright command endpoint.
- Full interactive browser remote-control API.
- Public browser-farm exposure.
- Multi-user auth system.
- Queueing/concurrency system beyond basic one-job safety.
- Broad persistent profile management.
- Automatic browsing of private-network/internal resources.
- Exposing remote debugging/CDP externally.
- Treating old shell/demo runtime as production-ready.
- Rewriting or deleting old runtime before replacement acceptance tests pass.

## Scope decisions resolved on 2026-06-27

Kristian approved:

1. Repository target: private GitHub repo `Kisian98/browser-worker`; `/DATA/browser-stack` is now the local working tree tracking `origin/main`.
2. Service port/binding: port `3080` is approved if available; local bind test confirmed `127.0.0.1:3080` is available. Phase-one binding should be localhost/internal-only.
3. Action naming: Nix chooses `capturePage` as the stable phase-one action name.
4. Persistent profile timing: implement persistent profile after isolated sessions and `storageState` work.
5. Old runtime: keep `/opt/data/browser-stack` as fallback/reference in case the rebuild needs to restart.

## Remaining scope/input decisions

1. Git author identity for commits from this environment.
2. Whether Docker runtime work starts immediately after local service proof or after browser capture proof.

## Phase-one done means

Phase one is done only when the relevant acceptance tests are verified, not merely when files exist.

Minimum phase-one proof:

```text
npm test passes
service starts
/health works
private-network target is denied
https://example.com loads through isolated Playwright context
screenshot/text/html artifacts are written
response JSON points to the real artifacts
browser resources clean up
docker/container path works or is explicitly deferred
old shell/demo baseline remains preserved
```
