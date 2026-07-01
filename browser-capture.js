import path from 'node:path';
import { access, writeFile } from 'node:fs/promises';

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

function safeString(value) {
  return typeof value === 'string' ? value : '';
}

function safeDownloadFilename(value, fallback) {
  const baseName = path.basename(safeString(value)).replaceAll(/[\\/:*?"<>|]/g, '_');
  return baseName || fallback;
}

function makeEventState({ downloadsPath, downloadsRelativePath }) {
  const events = {
    dialogs: [],
    popups: [],
    downloads: []
  };
  const downloadArtifacts = [];
  const pending = [];

  return {
    events,
    downloadArtifacts,
    pending,
    addPending(promise) {
      pending.push(promise.catch((error) => {
        events.pageErrors ??= [];
        events.pageErrors.push({
          message: error.message ?? String(error),
          phase: 'eventReporting'
        });
      }));
    },
    async flush() {
      await Promise.allSettled(pending);
    },
    recordDownloadArtifact(filename) {
      if (!downloadsRelativePath) return null;
      const relativePath = path.posix.join(downloadsRelativePath, filename);
      downloadArtifacts.push(relativePath);
      return relativePath;
    },
    downloadsPath
  };
}

function attachEventReporting(page, eventState) {
  page.on?.('dialog', (dialog) => {
    const event = {
      type: safeString(dialog.type?.()),
      message: safeString(dialog.message?.()),
      defaultValue: safeString(dialog.defaultValue?.()),
      handled: 'dismissed'
    };
    eventState.events.dialogs.push(event);
    eventState.addPending(dialog.dismiss().catch(async () => {
      event.handled = 'accept_failed';
      await dialog.accept?.();
    }));
  });

  page.on?.('popup', (popup) => {
    const event = {
      url: null,
      title: null,
      closed: false
    };
    eventState.events.popups.push(event);
    eventState.addPending((async () => {
      await popup.waitForLoadState?.('domcontentloaded', { timeout: 1000 }).catch(() => {});
      event.url = safeString(popup.url?.()) || null;
      event.title = safeString(await popup.title?.().catch(() => null)) || null;
      await popup.close?.().catch(() => {});
      event.closed = true;
    })());
  });

  page.on?.('download', (download) => {
    const event = {
      suggestedFilename: null,
      path: null,
      saved: false
    };
    eventState.events.downloads.push(event);
    eventState.addPending((async () => {
      const index = eventState.events.downloads.length;
      const filename = safeDownloadFilename(await download.suggestedFilename?.(), `download-${index}`);
      const targetPath = path.join(eventState.downloadsPath, filename);
      await download.saveAs(targetPath);
      event.suggestedFilename = filename;
      event.path = eventState.recordDownloadArtifact(filename);
      event.saved = true;
    })());
  });
}

export async function runIsolatedCapturePage({
  targetUrl,
  screenshotPath,
  htmlPath,
  textPath,
  downloadsPath,
  downloadsRelativePath,
  launchBrowser = defaultLaunchBrowser,
  evaluatePolicy = evaluateUrlPolicy
}) {
  const browser = await launchBrowser();
  let context;
  let page;
  let blockedNavigation = null;
  const eventState = makeEventState({ downloadsPath, downloadsRelativePath });

  try {
    context = await browser.newContext({ acceptDownloads: true });
    page = await context.newPage();
    attachEventReporting(page, eventState);

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

    await page.waitForTimeout?.(250).catch(() => {});
    await eventState.flush();

    if (blockedNavigation) {
      return {
        ...blockedNavigation,
        title: await page.title().catch(() => null),
        httpStatus: response?.status?.() ?? null,
        events: eventState.events,
        downloadArtifacts: eventState.downloadArtifacts
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
        },
        events: eventState.events,
        downloadArtifacts: eventState.downloadArtifacts
      };
    }

    const html = await page.content();
    await writeFile(htmlPath, html, 'utf8');

    const text = await page.locator('body').evaluate((body) => {
      const value = body?.innerText ?? '';
      return value.trim();
    }).catch(() => '');
    await writeFile(textPath, text, 'utf8');

    await page.screenshot({ path: screenshotPath, fullPage: true });

    return {
      finalUrl,
      title: await page.title(),
      httpStatus: response?.status?.() ?? null,
      htmlCreated: await fileExists(htmlPath),
      textCreated: await fileExists(textPath),
      screenshotCreated: await fileExists(screenshotPath),
      events: eventState.events,
      downloadArtifacts: eventState.downloadArtifacts
    };
  } finally {
    await page?.close?.();
    await context?.close?.();
    await browser?.close?.();
  }
}
