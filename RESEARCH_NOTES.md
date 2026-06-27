# Browser Worker Research Notes

## Similar projects and architecture patterns

### Playwright official docs — core automation and agent positioning
Source: https://playwright.dev

What it is about: Playwright provides browser automation for Chromium, Firefox, and WebKit, with auto-waiting, locators, tracing, and newer agent-oriented tooling.

Useful for this project:
- Use Playwright directly in the browser-worker; keep Hermes as orchestrator.
- Prefer Playwright's native waiting and locator/action primitives over hand-rolled sleeps.
- Return structured facts and artifacts so Hermes can reason without owning browser runtime state.

What not to copy:
- Do not turn this into a full Playwright Test project unless tests are being added separately.

### Browserless-style architecture
Sources:
- https://docs.browserless.io/baas/advanced-configurations/playwright-customizations
- https://www.morphllm.com/browserless-api

What it is about: Browserless exposes managed browsers through WebSocket/CDP connections and task-shaped HTTP endpoints for screenshots, PDFs, scraping, content extraction, and sessions.

Useful for this project:
- Good separation: browser runtime service exposes an API; callers submit jobs.
- Support both simple task endpoints and lower-level browser/session concepts only if needed.
- Treat screenshot/PDF/content extraction as first-class job types.
- Context options such as viewport, geolocation, proxy, headers, and stealth-like settings should be explicit request parameters, not hidden globals.

What not to copy:
- Do not build a generic public browser farm.
- Avoid remote debugging/WebSocket exposure in phase one; an HTTP JSON API is simpler and safer for Hermes.

### Browserbase-style managed browser pattern
Source: https://www.browserbase.com/ (general public product pattern)

What it is about: Hosted browser sessions for automation and AI agents, with session lifecycle, artifacts, debugging, and persistence features.

Useful for this project:
- Session lifecycle should be explicit: create/use/close or one-shot job.
- Artifacts and logs are part of the API, not afterthoughts.
- Persistent contexts are powerful but require policy and cleanup.

What not to copy:
- Do not add cloud-style multi-tenant complexity locally unless there will actually be multiple tenants.

### Playwright storage state and profiles
Sources:
- https://playwright.dev/docs/api/class-browsercontext
- https://playwright.dev/mcp/configuration/user-profile

What it is about: Playwright supports browser contexts, `storageState`, persistent profiles/user data dirs, cookies/localStorage/session state, permissions, routing, and context-level timeouts.

Useful for this project:
- Default should be isolated ephemeral context per job.
- Add optional `storageState` import/export for auth reuse without whole-profile persistence.
- Add persistent profiles only after naming, storage, cleanup, and security boundaries are decided.
- Store auth state separately from screenshots and logs.

What not to copy:
- Do not silently persist every browsing session. That creates privacy, state-leak, and debugging problems.

## Reliability, extraction, and security patterns

### Timeouts
Source: https://playwright.dev/docs/test-timeouts and BrowserContext API docs.

Useful pattern:
- Have request-level timeout, navigation timeout, action timeout, and artifact timeout.
- Return which timeout fired and what was completed before failure.
- Avoid infinite waits for `networkidle`; prefer explicit wait conditions and bounded fallbacks.

### Dialogs and alerts
Source: https://playwright.dev/docs/dialogs

Useful pattern:
- Register a dialog handler early.
- Default policy should dismiss dialogs unless request asks to accept/prompt.
- Record dialog type/message/action in output.

### Popups/new tabs
Sources: Playwright Page/BrowserContext event docs and practical guides.

Useful pattern:
- Listen for `context.on('page')` and/or use `page.waitForEvent('popup')` around actions that may open tabs.
- Capture resulting pages in the output envelope: URL, title, close status, chosen active page.
- Policy should decide whether to follow popup, close it, or include it as secondary artifact.

### Frames and iframes
Useful pattern:
- Record frame tree: URL, name, whether cross-origin, visible text summary if accessible.
- Use Playwright `frameLocator`/frame APIs for targeted actions.
- Avoid pretending iframe content is part of the main DOM if access fails.

### Downloads
Useful pattern:
- Enable download handling intentionally.
- Save downloads into the job artifact directory.
- Return suggested filename, saved path, MIME if known, and size.

### Consent/cookie banners
Useful pattern:
- Detect common consent overlays by role/text heuristics and visible blocking overlays.
- Do not blindly click every button named “Accept” unless request policy allows it.
- Record banner detection and action taken.

### Login-required detection
Useful pattern:
- Detect login pages by URL patterns, password fields, auth walls, 401/403 responses, and text like “sign in”.
- Return `requires_login: true` with evidence instead of treating the page as a successful capture.

### Captcha/block detection
Useful pattern:
- Detect common captcha providers and challenge pages.
- Return `blocked: true` / `captcha_detected: true` with evidence.
- Do not attempt captcha bypass by default.

### Structured extraction and ARIA snapshots
Source: https://playwright.dev/docs/aria-snapshots

What it is about: ARIA snapshots represent the accessibility tree in YAML-like structure with roles, names, attributes, and text.

Useful for this project:
- Accessibility snapshots are token-efficient for AI agents compared with raw HTML.
- Use a structured capture bundle: title, URL, status, text summary, selected links, headings, forms, buttons, screenshots, optional HTML, optional ARIA/accessibility snapshot.

What not to copy:
- ARIA snapshot testing is not the same as extraction. Use the concept, not the test assertion workflow.

### Docker hardening for browser containers
Source: https://playwright.dev/docs/docker

Official guidance highlights:
- Playwright Docker images include browser system dependencies.
- The docs warn the image is not recommended for visiting untrusted websites without care.
- For scraping/crawling untrusted sites, create a separate user and use the recommended seccomp profile.
- Running as root is more acceptable only for trusted sites/code.

Useful for this project:
- Phase one should at least document whether target browsing is trusted or untrusted.
- Prefer non-root browser execution, seccomp, least writable mounts, and artifact-only host writes.
- Consider private-network restrictions so arbitrary web pages cannot probe LAN/internal services.

What not to copy:
- Do not weaken sandboxing with broad privileges unless there is a measured reason.
