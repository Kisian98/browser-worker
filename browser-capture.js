import path from 'node:path';
import { access, mkdir, writeFile } from 'node:fs/promises';

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

function sanitizeDownloadFilename(value) {
  if (typeof value !== 'string') return null;

  const trimmed = value.trim();
  if (!trimmed) return null;

  const basename = path.basename(trimmed);
  const sanitized = basename.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_');
  return sanitized === '' || sanitized === '.' || sanitized === '..' ? null : sanitized;
}

function buildDownloadTargetPath(downloadsDirectory, suggestedFilename, usedDownloadFilenames) {
  const safeFilename = sanitizeDownloadFilename(suggestedFilename);
  if (!downloadsDirectory || !safeFilename) {
    return { safeFilename, targetPath: null };
  }

  const ext = path.extname(safeFilename);
  const baseName = ext ? safeFilename.slice(0, -ext.length) : safeFilename;
  let candidateFilename = safeFilename;
  let counter = 2;

  while (usedDownloadFilenames.has(candidateFilename)) {
    candidateFilename = `${baseName}-${counter}${ext}`;
    counter += 1;
  }

  const targetPath = path.join(downloadsDirectory, candidateFilename);
  const relativeTarget = path.relative(downloadsDirectory, targetPath);
  if (relativeTarget.startsWith('..') || path.isAbsolute(relativeTarget)) {
    return { safeFilename: candidateFilename, targetPath: null };
  }

  usedDownloadFilenames.add(candidateFilename);
  return { safeFilename: candidateFilename, targetPath };
}

export async function runIsolatedCapturePage({
  targetUrl,
  screenshotPath,
  htmlPath,
  textPath,
  downloadsDirectory,
  downloadsPath,
  downloadsRelativePath,
  launchBrowser = defaultLaunchBrowser,
  evaluatePolicy = evaluateUrlPolicy
}) {
  const browser = await launchBrowser();
  let context;
  let page;
  let blockedNavigation = null;
  const events = { dialogs: [], popups: [], downloads: [] };
  const warnings = [];
  const downloadDirectory = downloadsDirectory ?? downloadsPath ?? null;
  const popupPages = new WeakSet();
  const eventTasks = [];
  const usedDownloadFilenames = new Set();

  function trackEventTask(task) {
    eventTasks.push(task.catch(() => {}));
    return task;
  }

  async function settleEventTasks() {
    if (eventTasks.length === 0) return;
    await Promise.allSettled(eventTasks.splice(0));
  }

  function recordPopup(popupPage) {
    if (!popupPage || popupPages.has(popupPage)) return;

    popupPages.add(popupPage);
    const event = {
      url: popupPage.url?.() ?? null,
      title: null
    };
    events.popups.push(event);

    trackEventTask((async () => {
      event.title = await popupPage.title?.().catch(() => null);
      await popupPage.close?.().catch(() => {
        warnings.push('popup_close_failed');
      });
    })());
  }

  try {
    if (downloadDirectory) {
      await mkdir(downloadDirectory, { recursive: true });
    }

    context = await browser.newContext({
      acceptDownloads: true,
      downloadsPath: downloadDirectory ?? undefined
    });

    page = await context.newPage();
    context.on?.('page', (popupPage) => {
      if (popupPage === page) return;
      recordPopup(popupPage);
    });
    page.on?.('dialog', (dialog) => {
      events.dialogs.push({
        type: dialog.type(),
        message: dialog.message(),
        defaultValue: dialog.defaultValue?.() ?? null
      });
      trackEventTask(dialog.dismiss().catch(() => {
        warnings.push('dialog_dismiss_failed');
      }));
    });
    page.on?.('popup', recordPopup);
    page.on?.('download', (download) => {
      const suggestedFilename = download.suggestedFilename?.() ?? null;
      const { safeFilename, targetPath } = buildDownloadTargetPath(downloadDirectory, suggestedFilename, usedDownloadFilenames);
      const relativePath = safeFilename && downloadsRelativePath
        ? path.posix.join(downloadsRelativePath, safeFilename)
        : null;

      if (!downloadDirectory) {
        warnings.push('download_directory_unavailable');
      } else if (safeFilename && safeFilename !== suggestedFilename) {
        warnings.push('download_filename_sanitized');
      }

      const event = {
        suggestedFilename,
        savedFilename: safeFilename,
        path: targetPath,
        relativePath,
        url: download.url?.() ?? null
      };
      events.downloads.push(event);

      if (targetPath) {
        trackEventTask(download.saveAs(targetPath).catch(() => {
          warnings.push('download_save_failed');
          event.path = null;
          event.relativePath = null;
        }));
      }
    });

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

    await settleEventTasks();

    if (blockedNavigation) {
      return {
        ...blockedNavigation,
        title: await page.title().catch(() => null),
        httpStatus: response?.status?.() ?? null,
        downloadArtifacts: events.downloads
          .map((downloadEvent) => downloadEvent.relativePath ?? downloadEvent.path)
          .filter((downloadPath) => typeof downloadPath === 'string'),
        events,
        warnings
      };
    }

    const finalUrl = page.url();
    const finalUrlPolicy = finalUrl
      ? await evaluatePolicy({ url: finalUrl })
      : { ok: true };

    if (!finalUrlPolicy.ok) {
      return {
        finalUrl,
        title: await page.title(),
        httpStatus: response?.status?.() ?? null,
        screenshotCreated: false,
        policyBlocked: true,
        policyError: finalUrlPolicy.error,
        downloadArtifacts: events.downloads
          .map((downloadEvent) => downloadEvent.relativePath ?? downloadEvent.path)
          .filter((downloadPath) => typeof downloadPath === 'string'),
        events,
        warnings
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
      downloadArtifacts: events.downloads
        .map((downloadEvent) => downloadEvent.relativePath ?? downloadEvent.path)
        .filter((downloadPath) => typeof downloadPath === 'string'),
      events,
      warnings
    };
  } finally {
    await page?.close?.();
    await context?.close?.();
    await browser?.close?.();
  }
}
