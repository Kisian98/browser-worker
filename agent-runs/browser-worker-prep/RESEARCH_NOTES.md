# Browser Worker Prep — Research Notes

## Scope
Preparation for the browser-worker project, focusing on a narrow, one-shot Playwright CLI runner that may later evolve into a long-running HTTP JSON service.

## Public-web findings

### Playwright reliability patterns
- Prefer Locator APIs and Playwright auto-waiting over manual sleeps or brittle `waitForSelector` usage.
- Let actions like `click()` and `fill()` rely on Playwright actionability checks.
- Prefer assertions and state checks that retry automatically instead of hard-coded delays.
- Use explicit navigation handling and wait for a page-specific readiness signal rather than assuming a universal “page loaded” state.

### Docker / container hardening patterns
- Run browser automation as a non-root user when possible.
- Avoid broad filesystem mounts; keep shared input/output folders narrow.
- Use resource limits and consider `no-new-privileges`, dropped Linux capabilities, and read-only filesystem where compatible.
- Keep Chromium/browser execution isolated from the main agent runtime and secrets.

### Reliability / operability patterns
- Make outputs structured and stable for downstream processing.
- Return final URL, title, page type or content type, extracted text, screenshot path, and errors.
- Keep timeouts explicit at the task boundary.
- Prefer bounded retries for transient network or navigation failures.

## Source URLs
- https://playwright.dev/docs/actionability
- https://playwright.dev/docs/navigations
- https://playwright.dev/docs/api/class-locator
- https://playwright.dev/docs/docker
- https://docs.browser-use.com/open-source/customize/agent/output-format

## Notes for this repo
- The current worker should stay a one-shot CLI runner until the next phase explicitly introduces an HTTP boundary.
- The browser worker must remain isolated from Hermes secrets, memories, and broad filesystem access.
- Structured JSON output is preferable to screenshots alone.
