import { access } from 'node:fs/promises';

import { evaluateUrlPolicy } from './url-policy.js';

async function defaultLaunchBrowser() {
  const { chromium } = await import('playwright');
  return chromium.launch({ headless: true });
}

export async function fileExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function runIsolatedCapturePage({
  targetUrl,
  screenshotPath,
  launchBrowser = defaultLaunchBrowser,
  evaluatePolicy = evaluateUrlPolicy
}) {
  const browser = await launchBrowser();
  let context;
  let page;

  try {
    context = await browser.newContext();
    page = await context.newPage();
    const response = await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });
    const finalUrl = page.url();
    const finalUrlPolicy = finalUrl
      ? await evaluatePolicy({ url: finalUrl })
      : { ok: true };

    if (!finalUrlPolicy.ok) {
      const blockedByPrivateNetwork = finalUrlPolicy.error.code === 'private_network_denied';
      return {
        finalUrl,
        title: await page.title(),
        httpStatus: response?.status?.() ?? null,
        screenshotCreated: false,
        policyBlocked: true,
        policyError: {
          code: blockedByPrivateNetwork ? 'redirected_private_network_denied' : finalUrlPolicy.error.code,
          message: blockedByPrivateNetwork
            ? 'Final navigated URL was blocked by private-network policy.'
            : finalUrlPolicy.error.message,
          phase: 'postNavigationPolicy',
          retryable: false,
          detail: finalUrlPolicy.error.detail
        }
      };
    }

    await page.screenshot({ path: screenshotPath, fullPage: true });

    return {
      finalUrl,
      title: await page.title(),
      httpStatus: response?.status?.() ?? null,
      screenshotCreated: await fileExists(screenshotPath)
    };
  } finally {
    await page?.close?.();
    await context?.close?.();
    await browser?.close?.();
  }
}
