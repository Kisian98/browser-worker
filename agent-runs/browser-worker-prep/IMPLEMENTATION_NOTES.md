# Browser Worker Prep — Implementation Notes

## Preparation summary
This run did not modify runtime code. It produced documentation artifacts to support the next implementation phase.

## Recommended implementation direction
- Keep the first implementation change small.
- Improve the worker contract before expanding features.
- Favor typed/structured output over ad hoc console text.
- If an HTTP service is introduced, keep the CLI wrapper available until the service is proven.

## Reliability recommendations
- Use Playwright Locator APIs with built-in auto-waiting.
- Avoid fixed sleeps except as last-resort debugging aids.
- Make navigation completion and extraction readiness explicit in the worker.
- Add bounded retries only for transient failures.

## Security recommendations
- Use a dedicated browser container boundary.
- Run as non-root where possible.
- Avoid mounting broad host paths or any sensitive Hermes state.
- Do not expose a shell or arbitrary command execution through the browser worker.
