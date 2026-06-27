# Browser Worker Goals for Today

Date: 2026-06-27

These are the seven main goals for today before deeper implementation work begins. The purpose is to strengthen project knowledge, reduce ambiguity, and make sure the browser-worker rebuild starts from a clean software-development structure rather than ad-hoc repo edits.

## 1. Create a project decision log

**Status:** Completed — `DECISIONS.md` created and linked from `README.md`.

Create `DECISIONS.md` as the canonical place for project decisions.

It should track:

- approved decisions;
- pending human-review decisions;
- deferred / pinned revisits;
- rejected approaches;
- rationale for important choices.

This prevents the project from re-litigating already-set choices and helps future implementation stay aligned.

## 2. Create an acceptance-test checklist

**Status:** Completed — `ACCEPTANCE_TESTS.md` created and linked from `README.md`.

Create `ACCEPTANCE_TESTS.md` to define what must be true before phase-one implementation is called real.

It should cover at least:

- service starts in container;
- `/health` returns OK;
- isolated session can load a public URL such as `https://example.com`;
- screenshot artifact is written;
- text/HTML extraction artifacts are written where applicable;
- response JSON points to correct artifact paths;
- invalid URL fails cleanly;
- private-network URL is blocked by default;
- browser resources are cleaned up after a job;
- old shell/demo path remains preserved until replacement acceptance tests pass.

## 3. Create a current-state snapshot

**Status:** Completed — `CURRENT_STATE_SNAPSHOT.md` created and linked from `README.md`.

Create `CURRENT_STATE_SNAPSHOT.md` to establish the starting line before implementation.

It should record:

- exact current project files;
- what is implemented versus still skeleton;
- currently passing tests and commands;
- what is intentionally not connected yet;
- old runtime location and role;
- known run/build/test commands;
- unresolved environment questions.

## 4. Create an implementation dependency map

**Status:** Completed — `IMPLEMENTATION_DEPENDENCY_MAP.md` created and linked from `README.md`.

Create or fold into an existing note a simple dependency map showing what must come before what.

Expected ordering principles:

- response envelope before browser actions;
- artifacts before capture;
- URL/private-network policy before arbitrary navigation;
- isolated sessions before `storageState`;
- `storageState` before persistent profiles;
- runtime/container verification before calling the service usable.

## 5. Do targeted research on three risk areas

**Status:** Completed — `TARGETED_RESEARCH_2026-06-27.md` created and linked from `README.md`.

Bolster knowledge with focused research, not broad wandering.

Research areas:

1. Playwright browser context/session lifecycle best practices.
2. Network/private-IP blocking in Node services.
3. Artifact, trace, and evidence strategy for browser automation services.

Save findings into `RESEARCH_NOTES.md` or a dedicated source note with URLs and practical takeaways.

## 6. Clarify phase-one scope

**Status:** Completed — `PHASE_ONE_SCOPE.md` created and linked from `README.md`.

Record what phase one includes and excludes.

Suggested phase-one includes:

- HTTP service;
- health endpoint;
- one capture job endpoint;
- isolated sessions;
- URL/private-network policy;
- screenshot/text/HTML artifacts;
- structured response envelope;
- Docker run path.

Suggested phase-one excludes:

- arbitrary JavaScript execution;
- full interactive browser control;
- multi-user auth system;
- broad persistent profile management;
- queueing/concurrency beyond basic safety;
- remote public exposure.

## 7. Keep the reusable browser-service skill aligned

**Status:** Completed — `browser-execution-services` skill patched with DNS/IP/redirect-aware private-network blocking guidance.

If today reveals reusable workflow lessons, update the browser execution/service skill rather than leaving the knowledge only in this project.

Specifically preserve lessons about:

- brick-by-brick implementation;
- vertical slices;
- TDD where practical;
- preserving old shell/demo baseline until acceptance tests pass;
- artifact/session separation;
- keeping the browser-worker deterministic rather than agentic.

## Working rhythm

Today's rhythm should be:

```text
inspect -> document -> verify -> update source of truth -> next goal
```

Do not start broad runtime implementation until these seven goals have either been completed or explicitly deferred.
