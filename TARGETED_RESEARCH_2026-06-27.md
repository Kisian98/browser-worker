# Browser Worker Targeted Research — 2026-06-27

This note captures focused research for today's goal 5. It is intentionally practical: each section ends with implications for the browser-worker implementation.

## 1. Playwright browser context/session lifecycle

Sources:

- Playwright Authentication docs: https://playwright.dev/docs/auth
- Playwright BrowserContext API docs: https://playwright.dev/docs/api/class-browsercontext

Key findings:

- Playwright's core isolation primitive is the browser context.
- `browser.newContext()` creates isolated, non-persistent contexts.
- Non-persistent contexts do not write browsing data to disk.
- The standard lifecycle is:

```js
const context = await browser.newContext();
const page = await context.newPage();
await page.goto('https://example.com');
await context.close();
```

- Saved authentication/session state is handled through `storageState`.
- Playwright recommends storing auth state under a separate auth directory such as `playwright/.auth` and adding it to `.gitignore`.
- Playwright warns that storage state files can contain sensitive cookies/headers and can impersonate the account.
- For authentication flows, Playwright recommends waiting for final redirected URL or a post-login UI element before saving state, because cookies may be set over several redirects.

Implications for browser-worker:

- The implementation order is right: isolated context first, `storageState` later, persistent profile last.
- Isolated jobs should create a fresh context and always close it in a `finally` path.
- `storageState` files must live outside normal per-run artifacts and must not be committed.
- Persistent profiles are more sensitive than `storageState` and should remain explicit/named.
- For future login-state capture, the worker must not save state immediately after clicking login; it needs a clear success condition or operator-confirmed moment.

## 2. Network/private-IP blocking and SSRF-style protections in Node

Sources:

- OWASP SSRF Prevention in Node.js: https://owasp.org/www-community/pages/controls/SSRF_Prevention_in_Nodejs
- Node/security ecosystem warnings around private-IP validation bypasses and CVE-2024-29415 in the `ip` package surfaced in search results.

Key findings:

- URL string checks and regex checks are not enough.
- The WHATWG `URL` API should be used for parsing/normalization.
- Allowed protocols should be restricted to `http` and `https`.
- Hostnames must be resolved and resulting IPs classified.
- Redirect chains must also be validated; an initially public URL can redirect to localhost/private targets.
- DNS rebinding is a known risk: a hostname can resolve differently later.
- Some Node IP helper packages have had private/public classification bypasses, so blindly trusting a third-party `isPrivate` helper is risky.
- Timeouts and safe HTTP/browser navigation behavior are part of the defense, not optional polish.

Implications for browser-worker:

- Keep protocol validation, but extend it into a dedicated URL policy module.
- Deny at least:
  - localhost/loopback;
  - RFC1918 ranges;
  - link-local;
  - cloud metadata IPs such as `169.254.169.254`;
  - Docker/internal bridge ranges;
  - hostnames that resolve to private/unsafe IPs.
- Re-check redirects during browser navigation, not just the initial URL.
- Add tests for weird URL forms, not only obvious `127.0.0.1` examples.
- Avoid relying on one unreviewed npm package for IP safety; if a dependency is used, wrap it with our own tests and explicit range fixtures.

## 3. Artifact, trace, and evidence strategy

Sources:

- Playwright Trace Viewer docs: https://playwright.dev/docs/trace-viewer

Key findings:

- Playwright traces can include actions, DOM snapshots, screenshots, console output, network activity, metadata, and attachments.
- Traces can be opened locally with:

```bash
npx playwright show-trace path/to/trace.zip
```

- For Playwright scripts outside the Playwright test runner, tracing can be controlled through `browserContext.tracing`:

```js
await context.tracing.start({ screenshots: true, snapshots: true });
// create/navigate page
await context.tracing.stop({ path: 'trace.zip' });
```

- Traces are valuable debugging artifacts, but they can contain sensitive page data.

Implications for browser-worker:

- Per-run artifacts should include optional traces, especially for failures or debug mode.
- Trace files should live under a dedicated trace/artifact location and be referenced by path in the response.
- Do not enable heavy tracing blindly for every normal job unless storage size and sensitivity are acceptable.
- A good phase-one default may be screenshots/text/html always when requested, with traces retained on failure or when `capture.trace`/debug mode is explicitly requested.
- Structured response metadata should make it easy to find the trace, screenshot, HTML, text, and response JSON for the same job.

## Project-level conclusions

The current project direction is reinforced:

1. Isolated contexts first.
2. Saved auth state is sensitive and must be segregated.
3. Persistent profiles should be explicit, named, and later than `storageState`.
4. Private-network blocking needs DNS/IP/redirect-aware policy, not simple string checks.
5. Artifacts should be structured, path-based, and per-job.
6. Traces are valuable but sensitive and should be opt-in or failure-focused.
7. The worker should stay deterministic and evidence-producing rather than agentic.
