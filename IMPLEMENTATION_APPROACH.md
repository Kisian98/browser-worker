# Browser Worker Implementation Approach

Date: 2026-06-27

This note defines how implementation should start once planning is complete. It is a process guardrail for the browser-worker rebuild: do not turn the project into an unstructured pile of scripts. Build it brick by brick, with clear milestones, smaller goals, tests, and verification evidence.

## Core principle

Build the browser-worker as a real software service, not as ad-hoc automation.

The browser-worker is a constrained browser execution surface. Hermes/Nix remains the reasoning layer. The worker should expose typed, inspectable, bounded behavior over HTTP JSON, execute browser tasks through Playwright, write artifacts, and return structured evidence.

## Implementation posture

Use this sequence:

1. Planning docs become the implementation baseline.
2. Create or update a detailed implementation plan before runtime edits.
3. Work on a branch, not directly on `main`.
4. Implement in small vertical slices.
5. Use TDD for production behavior wherever practical.
6. Commit after meaningful, verified milestones.
7. Do not call a milestone done until it has real test or runtime evidence.

## Brick-by-brick milestone model

Each milestone should be small, reviewable, and independently useful.

A milestone should include:

- the spec/doc section it implements;
- the exact files it changes;
- tests or smoke checks written before/alongside the code;
- expected artifact behavior, if relevant;
- verification commands and real output;
- rollback/fallback notes if it touches runtime behavior.

Avoid building broad half-finished layers. Prefer one complete path at a time.

## Vertical slices

Use vertical slices rather than layer-first development.

A vertical slice means one complete feature path through the service, for example:

```text
HTTP request -> validation -> session/context behavior -> browser/action behavior -> artifacts -> response envelope -> tests/smoke verification
```

Recommended early slice order:

1. Service foundation and verification commands.
2. Health endpoint.
3. Standard response envelope.
4. Job request validation.
5. Artifact directory creation and request/response persistence.
6. Isolated Playwright browser launch.
7. `goto` / page navigation with bounded timeout.
8. `capture_page` screenshot/text/html/metadata artifacts.
9. Structured extraction and signals.
10. Session cleanup and resource lifecycle.
11. `storageState` support.
12. Named persistent profile support, explicitly opt-in only.
13. URL/private-network policy enforcement.
14. Docker/runtime hardening.

This order can change if the implementation plan gives a better dependency order, but each step should remain a coherent slice.

## TDD standard

For production behavior, use RED-GREEN-REFACTOR:

1. Write a failing test first.
2. Run it and confirm it fails for the expected reason.
3. Write the smallest code that passes.
4. Run the focused test and the broader suite.
5. Refactor only while tests stay green.

Pure unit tests are best for:

- response envelopes;
- request validation;
- URL/private-network policy;
- artifact path generation;
- error taxonomy;
- session registry logic;
- configuration loading.

Integration/smoke tests are acceptable for browser behavior where unit tests become artificial. Even there, the milestone must have a real verification command: container starts, browser launches, URL loads, artifacts are written, and the response envelope contains correct paths/signals.

## Branch and commit discipline

Implementation should happen on a feature branch, for example:

```text
feature/browser-worker-service-foundation
```

Use small commits by milestone. Example commit shapes:

```text
docs: add browser-worker implementation plan
test: define artifact directory contract
feat: persist browser job artifacts
test: cover isolated session creation
feat: launch isolated playwright context
```

Do not mix unrelated architecture, formatting, and behavior changes in one commit.

## External guidance folded into this project

General software guidance supports this approach:

- Vertical Slice Architecture: build a complete end-to-end feature path instead of disconnected layers.
- TDD: prove behavior with a failing test before implementation where practical.
- Implementation planning: define slice boundaries, acceptance criteria, and verification before coding.
- Playwright authentication/session guidance: saved auth state is sensitive and must be segregated from normal artifacts.
- Agentic browser automation guidance: prefer structured snapshots, deterministic actions, traces/artifacts, and observable execution over screenshot-only results.

These guides validate the project direction, but the local project docs remain the source of truth.

## Security and session defaults

Keep these defaults unless a later approved plan changes them:

- isolated sessions by default;
- saved `storageState` only by explicit request;
- named persistent profiles only by explicit request;
- persistent profile phase-one name: `marketing-tools`;
- private-network browsing blocked by default;
- no broad arbitrary JavaScript/Playwright execution endpoint in phase one;
- profile data, storage state, downloads, traces, and run artifacts stay segregated.

## Definition of done for an implementation milestone

A milestone is done only when:

- the relevant docs/spec section is satisfied or updated;
- tests for the behavior exist where practical;
- focused tests pass;
- the broader test command passes;
- any browser behavior has been exercised against a real URL or a controlled local fixture;
- artifacts are written to the expected location when applicable;
- structured errors/warnings are returned for known failure cases;
- the old shell/demo path remains preserved as reference/fallback until replacement acceptance tests pass.

## Hard stop conditions

Stop and return to planning/review if:

- implementation would require changing the approved session/security policy;
- a milestone needs private-network access that was not explicitly approved;
- the worker starts becoming a planner/agent rather than a deterministic executor;
- persistent auth/profile state would be mixed with normal run artifacts;
- tests cannot be written because the interface is unclear;
- the code path works only by manual luck and cannot be verified repeatably.

## Practical summary

Yes: build this tool brick by brick.

The intended development rhythm is:

```text
plan -> branch -> failing test -> minimal implementation -> verification -> commit -> next vertical slice
```

No unstructured repo edits. No broad rewrites without acceptance tests. No calling skeleton code "working" until real execution proves it.
