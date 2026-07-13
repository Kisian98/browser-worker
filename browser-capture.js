import net from 'node:net';
import path from 'node:path';
import { access, mkdir, writeFile } from 'node:fs/promises';

import { createPinnedUrlPolicy } from './url-policy.js';

function formatResolverAddress(address) {
  return net.isIP(address) === 6 ? `[${address}]` : address;
}

export function buildHostResolverRules({ targetUrl, resolvedAddresses = [] }) {
  const url = new URL(targetUrl);
  const host = url.hostname.startsWith('[') && url.hostname.endsWith(']')
    ? url.hostname.slice(1, -1)
    : url.hostname;
  const address = resolvedAddresses[0];

  if (net.isIP(host)) {
    return 'MAP * ~NOTFOUND';
  }
  if (!address) {
    throw new Error('A validated address is required for DNS-pinned capture.');
  }

  return `MAP ${host} ${formatResolverAddress(address)}, MAP * ~NOTFOUND`;
}

async function defaultLaunchBrowser({ hostResolverRules }) {
  const { chromium } = await import('playwright');
  return chromium.launch({
    headless: true,
    args: [`--host-resolver-rules=${hostResolverRules}`]
  });
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

function abortError(reason) {
  const error = reason instanceof Error ? reason : new Error('Capture aborted.');
  error.code ??= 'capture_aborted';
  return error;
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw abortError(signal.reason);
}

function pushWarningOnce(warnings, warning) {
  if (!warnings.includes(warning)) warnings.push(warning);
}

export async function runIsolatedCapturePage({
  targetUrl,
  resolvedAddresses,
  categoryPolicyBundle = null,
  screenshotPath,
  htmlPath,
  textPath,
  downloadsDirectory,
  downloadsPath,
  downloadsRelativePath,
  signal,
  timeoutMs = 30_000,
  launchBrowser = defaultLaunchBrowser,
  evaluatePolicy
}) {
  const hostResolverRules = resolvedAddresses?.length
    ? buildHostResolverRules({ targetUrl, resolvedAddresses })
    : 'MAP * ~NOTFOUND';
  const pinnedPolicy = evaluatePolicy ?? createPinnedUrlPolicy({
    targetUrl,
    resolvedAddresses,
    categoryPolicyBundle
  });
  let browser;
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
        pushWarningOnce(warnings, 'popup_close_failed');
      });
    })());
  }

  const safeClose = async (resource) => {
    try {
      await resource?.close?.();
    } catch {
      // Best-effort cleanup; preserve the original capture result/error.
    }
  };
  const closeResources = async () => {
    await safeClose(page);
    await safeClose(context);
    await safeClose(browser);
  };
  const onAbort = () => {
    void closeResources();
  };
  signal?.addEventListener('abort', onAbort, { once: true });

  try {
    throwIfAborted(signal);
    browser = await launchBrowser({
      targetUrl,
      resolvedAddresses,
      hostResolverRules,
      signal
    });
    throwIfAborted(signal);

    if (downloadDirectory) {
      await mkdir(downloadDirectory, { recursive: true });
    }

    const contextOptions = {
      acceptDownloads: true,
      downloadsPath: downloadDirectory ?? undefined
    };
    if (resolvedAddresses?.length) {
      contextOptions.serviceWorkers = 'block';
    }
    context = await browser.newContext(contextOptions);

    page = await context.newPage();
    page.setDefaultTimeout?.(timeoutMs);
    page.setDefaultNavigationTimeout?.(timeoutMs);

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
        pushWarningOnce(warnings, 'dialog_dismiss_failed');
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
        pushWarningOnce(warnings, 'download_directory_unavailable');
      } else if (safeFilename && safeFilename !== suggestedFilename) {
        pushWarningOnce(warnings, 'download_filename_sanitized');
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
          pushWarningOnce(warnings, 'download_save_failed');
          event.path = null;
          event.relativePath = null;
        }));
      }
    });

    if (page.routeWebSocket) {
      await page.routeWebSocket('**/*', async (webSocketRoute) => {
        pushWarningOnce(warnings, 'websocket_request_blocked');
        await webSocketRoute.close({
          code: 1008,
          reason: 'WebSocket connections are disabled by capture policy.'
        });
      });
    }

    await page.route('**/*', async (route) => {
      const request = route.request();
      const requestUrl = request.url();
      let parsedUrl;

      try {
        parsedUrl = new URL(requestUrl);
      } catch {
        await route.abort();
        pushWarningOnce(warnings, 'invalid_subresource_url_blocked');
        return;
      }

      if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
        await route.continue();
        return;
      }

      const requestPolicy = await pinnedPolicy({ url: requestUrl });
      if (!requestPolicy.ok) {
        const isDocumentNavigation = request.resourceType() === 'document' && request.isNavigationRequest();
        if (isDocumentNavigation) {
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
        } else {
          pushWarningOnce(warnings, 'subresource_request_blocked');
        }
        await route.abort();
        return;
      }

      await route.continue();
    });

    let response;
    try {
      throwIfAborted(signal);
      response = await page.goto(targetUrl, {
        waitUntil: 'domcontentloaded',
        timeout: timeoutMs
      });
      throwIfAborted(signal);
    } catch (error) {
      if (!blockedNavigation) {
        throwIfAborted(signal);
        throw error;
      }
    }

    await settleEventTasks();
    throwIfAborted(signal);

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
      ? await pinnedPolicy({ url: finalUrl })
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

    throwIfAborted(signal);
    const html = await page.content();
    await writeFile(htmlPath, html, 'utf8');

    const text = await page.locator('body').evaluate((body) => {
      const value = body?.innerText ?? '';
      return value.trim();
    }).catch(() => '');
    await writeFile(textPath, text, 'utf8');

    throwIfAborted(signal);
    await page.screenshot({ path: screenshotPath, fullPage: true, timeout: timeoutMs });
    throwIfAborted(signal);

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
    signal?.removeEventListener('abort', onAbort);
    await closeResources();
  }
}
