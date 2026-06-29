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
  let blockedNavigation = null;

  try {
    context = await browser.newContext();
    page = await context.newPage();
    await page.route('**/*', async (route) => {
      const request = route.request();
      const isDocumentNavigation = request.resourceType() === 'document' && request.isNavigationRequest();

      if (!isDocumentNavigation) {
        await route.continue();
        return;
      }

      const requestUrl = request.url();
      const requestPolicy = requestUrl
        ? await evaluatePolicy({ url: requestUrl })
        : { ok: true };

      if (!requestPolicy.ok) {
        const blockedByPrivateNetwork = requestPolicy.error.code === 'private_network_denied';
        blockedNavigation = {
          finalUrl: requestUrl,
          screenshotCreated: false,
          policyBlocked: true,
          policyError: {
            code: blockedByPrivateNetwork ? 'redirected_private_network_denied' : requestPolicy.error.code,
            message: blockedByPrivateNetwork
              ? 'Redirected navigation URL was blocked by private-network policy.'
              : requestPolicy.error.message,
            phase: 'postNavigationPolicy',
            retryable: false,
            detail: requestPolicy.error.detail
          }
        };
        await route.abort();
        return;
      }

      await route.continue();
    });

    let response;
    try {
      response = await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });
    } catch (error) {
      if (!blockedNavigation) {
        throw error;
      }
    }

    if (blockedNavigation) {
      return {
        ...blockedNavigation,
        title: await page.title().catch(() => null),
        httpStatus: response?.status?.() ?? null
      };
    }

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
