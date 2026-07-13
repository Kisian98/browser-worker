import { rm } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import { createJobArtifacts, prepareJobArtifacts, writeJsonFile } from './artifacts.js';
import { runIsolatedCapturePage, fileExists } from './browser-capture.js';
import { loadCategoryPolicyBundle, makePolicyBundleUnavailableError } from './category-policy.js';
import { createResponseEnvelope } from './response-envelope.js';
import { createPinnedUrlPolicy, evaluateUrlPolicy } from './url-policy.js';

const DEFAULT_MAX_REQUEST_BODY_BYTES = 64 * 1024;
const DEFAULT_JOB_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_CONCURRENT_JOBS = 2;

function nowIso() {
  return new Date().toISOString();
}

function makeJobId() {
  return `job-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`;
}

function writeJson(res, statusCode, body) {
  const payload = JSON.stringify(body, null, 2);
  res.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload)
  });
  res.end(payload);
}

async function writePolicyBundleUnavailableEnvelope(res, {
  jobId,
  startedAt,
  requestedUrl,
  requestSummary,
  policyError
}) {
  const endedAt = nowIso();
  const envelope = createResponseEnvelope({
    ok: false,
    jobId,
    startedAt,
    endedAt,
    status: 'blocked',
    request: requestSummary,
    page: { requestedUrl, finalUrl: null },
    signals: {
      blocked: true,
      policyBundleUnavailable: true
    },
    errors: [policyError]
  });
  return writeJson(res, 400, envelope);
}

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function requestBodyTooLargeError(maxBytes) {
  const error = new Error(`Request body exceeds the ${maxBytes}-byte limit.`);
  error.code = 'request_body_too_large';
  error.maxBytes = maxBytes;
  return error;
}

async function readJson(req, { maxBytes }) {
  const declaredLength = Number(req.headers['content-length']);
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw requestBodyTooLargeError(maxBytes);
  }

  const chunks = [];
  let totalBytes = 0;
  for await (const chunk of req) {
    totalBytes += chunk.length;
    if (totalBytes > maxBytes) {
      throw requestBodyTooLargeError(maxBytes);
    }
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks, totalBytes).toString('utf8'));
}

function validateAction(value) {
  if (value !== 'capturePage') {
    return { ok: false, message: 'Action must be capturePage' };
  }
  return { ok: true, action: value };
}

async function removeFileIfPresent(path) {
  await rm(path, { force: true });
}

async function removeDirectoryIfPresent(path) {
  await rm(path, { recursive: true, force: true });
}

async function removeArtifactFiles(jobArtifacts) {
  await Promise.all([
    removeFileIfPresent(jobArtifacts.absolute.screenshot),
    removeFileIfPresent(jobArtifacts.absolute.html),
    removeFileIfPresent(jobArtifacts.absolute.text),
    removeDirectoryIfPresent(jobArtifacts.absolute.downloads)
  ]);
}

function normalizePostNavigationPolicyError(policyError) {
  const blockedByPrivateNetwork = policyError?.code === 'private_network_denied'
    || policyError?.code === 'redirected_private_network_denied';

  return {
    code: blockedByPrivateNetwork ? 'redirected_private_network_denied' : policyError.code,
    message: policyError.code === 'private_network_denied'
      ? 'Final navigated URL was blocked by private-network policy.'
      : policyError.message,
    phase: policyError.phase ?? 'postNavigationPolicy',
    retryable: false,
    detail: policyError.detail
  };
}

function relativizeDownloadPath(downloadPath, jobArtifacts) {
  if (typeof downloadPath !== 'string') return null;
  if (!path.isAbsolute(downloadPath)) {
    const normalizedRelativePath = downloadPath.split(path.sep).join(path.posix.sep);
    const normalizedWithinArtifacts = path.posix.normalize(normalizedRelativePath);
    const relativeFromDownloads = path.posix.relative(jobArtifacts.relative.downloads, normalizedWithinArtifacts);

    if (normalizedWithinArtifacts === jobArtifacts.relative.downloads
      || (!relativeFromDownloads.startsWith('..') && !path.posix.isAbsolute(relativeFromDownloads))) {
      return normalizedWithinArtifacts;
    }

    if (!normalizedWithinArtifacts.includes('/')) {
      return path.posix.join(jobArtifacts.relative.downloads, normalizedWithinArtifacts);
    }

    return null;
  }
  if (downloadPath.startsWith(`${jobArtifacts.relative.downloads}/`) || downloadPath === jobArtifacts.relative.downloads) {
    return downloadPath;
  }

  const relativeFromDownloads = path.relative(jobArtifacts.absolute.downloads, downloadPath);
  if (relativeFromDownloads.startsWith('..') || path.isAbsolute(relativeFromDownloads)) {
    return null;
  }

  return path.posix.join(jobArtifacts.relative.downloads, relativeFromDownloads.split(path.sep).join(path.posix.sep));
}

function normalizeCaptureEvents(events, jobArtifacts) {
  const downloads = Array.isArray(events?.downloads)
    ? events.downloads.map((downloadEvent) => ({
      ...downloadEvent,
      path: relativizeDownloadPath(downloadEvent.path, jobArtifacts) ?? downloadEvent.relativePath ?? null
    }))
    : undefined;

  return downloads ? { ...events, downloads } : events;
}

async function writeBlockedPolicyEnvelope(res, {
  jobArtifacts,
  jobId,
  startedAt,
  requestSummary,
  requestedUrl,
  policyError,
  events = {},
  warnings = [],
  downloadArtifacts = []
}) {
  await removeArtifactFiles(jobArtifacts);

  const normalizedPolicyError = normalizePostNavigationPolicyError(policyError);
  const blockedByPrivateNetwork = normalizedPolicyError.code === 'redirected_private_network_denied';
  const blockedByCategory = normalizedPolicyError.code === 'category_policy_denied';
  const blockedByPolicy = blockedByPrivateNetwork || blockedByCategory;
  const endedAt = nowIso();
  const envelope = createResponseEnvelope({
    ok: false,
    jobId,
    startedAt,
    endedAt,
    status: blockedByPolicy ? 'blocked' : 'failed',
    request: requestSummary,
    page: {
      requestedUrl,
      finalUrl: null
    },
    signals: {
      blocked: blockedByPolicy,
      privateNetworkDenied: blockedByPrivateNetwork,
      categoryPolicyDenied: blockedByCategory
    },
    artifacts: {
      directory: jobArtifacts.relative.directory,
      request: jobArtifacts.relative.request,
      response: jobArtifacts.relative.response,
      screenshot: null,
      html: null,
      text: null,
      downloads: []
    },
    events,
    warnings,
    errors: [normalizedPolicyError]
  });
  await writeJsonFile(jobArtifacts.absolute.response, envelope);
  return writeJson(res, 200, envelope);
}

function timeoutError(timeoutMs) {
  const error = new Error(`Browser job exceeded the ${timeoutMs}ms deadline.`);
  error.code = 'job_timed_out';
  error.timeoutMs = timeoutMs;
  return error;
}

async function captureWithDeadline(capturePage, options, timeoutMs) {
  const controller = new AbortController();
  let timeoutId;
  const capturePromise = Promise.resolve().then(() => capturePage({
    ...options,
    signal: controller.signal,
    timeoutMs
  }));
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      const error = timeoutError(timeoutMs);
      controller.abort(error);
      reject(error);
    }, timeoutMs);
    timeoutId.unref?.();
  });

  try {
    return await Promise.race([capturePromise, timeoutPromise]);
  } finally {
    clearTimeout(timeoutId);
  }
}

async function handleBrowserJob(req, res, {
  artifactRoot,
  capturePage,
  maxRequestBodyBytes,
  jobTimeoutMs,
  getCategoryPolicyBundle,
  policyBundlePath = null
}) {
  const jobId = makeJobId();
  const startedAt = nowIso();
  let requestBody;

  try {
    requestBody = await readJson(req, { maxBytes: maxRequestBodyBytes });
  } catch (error) {
    const endedAt = nowIso();
    const tooLarge = error.code === 'request_body_too_large';
    return writeJson(res, tooLarge ? 413 : 400, createResponseEnvelope({
      ok: false,
      jobId,
      startedAt,
      endedAt,
      status: 'failed',
      errors: [{
        code: tooLarge ? 'request_body_too_large' : 'invalid_json',
        message: error.message,
        phase: 'requestParsing',
        retryable: false,
        detail: tooLarge ? { maxBytes: error.maxBytes } : null
      }]
    }));
  }

  const requestedAction = requestBody?.action ?? null;
  const effectiveSessionMode = 'isolated';
  const requestedUrl = requestBody?.url ?? null;
  const requestSummary = { action: requestedAction, sessionMode: effectiveSessionMode };

  let categoryPolicyBundleResult;
  try {
    categoryPolicyBundleResult = await getCategoryPolicyBundle();
  } catch (error) {
    categoryPolicyBundleResult = { ok: false, error };
  }

  if (!categoryPolicyBundleResult?.ok) {
    return writePolicyBundleUnavailableEnvelope(res, {
      jobId,
      startedAt,
      requestedUrl,
      requestSummary,
      policyError: makePolicyBundleUnavailableError({
        path: policyBundlePath,
        reason: categoryPolicyBundleResult?.error?.message ?? 'Unable to load configured category policy bundle.'
      })
    });
  }

  const categoryPolicyBundle = categoryPolicyBundleResult.bundle;
  const urlPolicy = await evaluateUrlPolicy({
    url: requestedUrl,
    categoryPolicyBundle
  });
  if (!urlPolicy.ok) {
    const endedAt = nowIso();
    const blockedByPolicy = urlPolicy.error.code === 'private_network_denied'
      || urlPolicy.error.code === 'category_policy_denied';
    return writeJson(res, 400, createResponseEnvelope({
      ok: false,
      jobId,
      startedAt,
      endedAt,
      status: blockedByPolicy ? 'blocked' : 'failed',
      request: requestSummary,
      page: { requestedUrl },
      signals: {
        blocked: blockedByPolicy,
        privateNetworkDenied: urlPolicy.error.code === 'private_network_denied',
        categoryPolicyDenied: urlPolicy.error.code === 'category_policy_denied'
      },
      errors: [urlPolicy.error]
    }));
  }

  const actionValidation = validateAction(requestedAction);
  if (!actionValidation.ok) {
    const endedAt = nowIso();
    return writeJson(res, 400, createResponseEnvelope({
      ok: false,
      jobId,
      startedAt,
      endedAt,
      status: 'failed',
      request: requestSummary,
      page: { requestedUrl },
      errors: [{
        code: 'invalid_action',
        message: actionValidation.message,
        phase: 'requestValidation',
        retryable: false,
        detail: { field: 'action', allowed: ['capturePage'] }
      }]
    }));
  }

  const pinnedPolicy = createPinnedUrlPolicy({
    targetUrl: urlPolicy.url.toString(),
    resolvedAddresses: urlPolicy.resolvedAddresses,
    categoryPolicyBundle
  });
  const jobArtifacts = createJobArtifacts({ artifactRoot, jobId });
  await prepareJobArtifacts(jobArtifacts);
  await writeJsonFile(jobArtifacts.absolute.request, requestBody);

  let captureResult;
  try {
    captureResult = await captureWithDeadline(capturePage, {
      targetUrl: urlPolicy.url.toString(),
      resolvedAddresses: urlPolicy.resolvedAddresses,
      categoryPolicyBundle,
      screenshotPath: jobArtifacts.absolute.screenshot,
      htmlPath: jobArtifacts.absolute.html,
      textPath: jobArtifacts.absolute.text,
      downloadsDirectory: jobArtifacts.absolute.downloads,
      downloadsRelativePath: jobArtifacts.relative.downloads
    }, jobTimeoutMs);
  } catch (error) {
    await removeArtifactFiles(jobArtifacts);
    const screenshotCreated = await fileExists(jobArtifacts.absolute.screenshot);
    const endedAt = nowIso();
    const timedOut = error.code === 'job_timed_out';
    const envelope = createResponseEnvelope({
      ok: false,
      jobId,
      startedAt,
      endedAt,
      status: 'failed',
      request: requestSummary,
      page: {
        requestedUrl,
        finalUrl: null
      },
      artifacts: {
        directory: jobArtifacts.relative.directory,
        request: jobArtifacts.relative.request,
        response: jobArtifacts.relative.response,
        screenshot: screenshotCreated ? jobArtifacts.relative.screenshot : null,
        html: null,
        text: null,
        downloads: []
      },
      errors: [{
        code: timedOut ? 'job_timed_out' : 'capture_failed',
        message: timedOut
          ? `Browser job exceeded the ${jobTimeoutMs}ms deadline.`
          : 'Page capture failed before a browser result could be returned.',
        phase: 'capture',
        retryable: true,
        detail: timedOut ? { timeoutMs: jobTimeoutMs } : null
      }]
    });
    await writeJsonFile(jobArtifacts.absolute.response, envelope);
    return writeJson(res, 200, envelope);
  }

  const screenshotCreated = captureResult.screenshotCreated && await fileExists(jobArtifacts.absolute.screenshot);

  if (captureResult.policyBlocked) {
    return writeBlockedPolicyEnvelope(res, {
      jobArtifacts,
      jobId,
      startedAt,
      requestSummary,
      requestedUrl,
      policyError: captureResult.policyError,
      events: normalizeCaptureEvents(captureResult.events, jobArtifacts),
      warnings: captureResult.warnings,
      downloadArtifacts: (captureResult.downloadArtifacts ?? [])
        .map((downloadPath) => relativizeDownloadPath(downloadPath, jobArtifacts))
        .filter((downloadPath) => typeof downloadPath === 'string')
    });
  }

  const finalUrlPolicy = captureResult.finalUrl
    ? await pinnedPolicy({ url: captureResult.finalUrl })
    : { ok: true };

  if (!finalUrlPolicy.ok) {
    return writeBlockedPolicyEnvelope(res, {
      jobArtifacts,
      jobId,
      startedAt,
      requestSummary,
      requestedUrl,
      policyError: finalUrlPolicy.error,
      events: normalizeCaptureEvents(captureResult.events, jobArtifacts),
      warnings: captureResult.warnings,
      downloadArtifacts: (captureResult.downloadArtifacts ?? [])
        .map((downloadPath) => relativizeDownloadPath(downloadPath, jobArtifacts))
        .filter((downloadPath) => typeof downloadPath === 'string')
    });
  }

  const endedAt = nowIso();
  const warnings = [...(captureResult.warnings ?? [])];
  const normalizedEvents = normalizeCaptureEvents(captureResult.events ?? {}, jobArtifacts);
  const downloadArtifacts = (captureResult.downloadArtifacts ?? [])
    .map((downloadPath) => relativizeDownloadPath(downloadPath, jobArtifacts))
    .filter((downloadPath) => typeof downloadPath === 'string');
  const envelope = createResponseEnvelope({
    jobId,
    startedAt,
    endedAt,
    request: requestSummary,
    page: {
      requestedUrl,
      finalUrl: captureResult.finalUrl,
      title: captureResult.title,
      httpStatus: captureResult.httpStatus,
      redirects: []
    },
    extraction: {
      text: '',
      headings: [],
      links: [],
      forms: []
    },
    artifacts: {
      directory: jobArtifacts.relative.directory,
      request: jobArtifacts.relative.request,
      response: jobArtifacts.relative.response,
      screenshot: screenshotCreated ? jobArtifacts.relative.screenshot : null,
      html: await fileExists(jobArtifacts.absolute.html) ? jobArtifacts.relative.html : null,
      text: await fileExists(jobArtifacts.absolute.text) ? jobArtifacts.relative.text : null,
      downloads: downloadArtifacts
    },
    events: normalizedEvents,
    warnings
  });
  await writeJsonFile(jobArtifacts.absolute.response, envelope);
  return writeJson(res, 200, envelope);
}

export function createConcurrencyGate(maxConcurrentJobs) {
  const limit = positiveInteger(maxConcurrentJobs, DEFAULT_MAX_CONCURRENT_JOBS);
  let activeJobs = 0;

  return {
    tryAcquire() {
      if (activeJobs >= limit) return null;
      activeJobs += 1;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        activeJobs = Math.max(0, activeJobs - 1);
      };
    },
    snapshot() {
      return { activeJobs, maxConcurrentJobs: limit };
    }
  };
}

function writeWorkerBusy(res, gate) {
  const startedAt = nowIso();
  const endedAt = nowIso();
  const { activeJobs, maxConcurrentJobs } = gate.snapshot();
  return writeJson(res, 429, createResponseEnvelope({
    ok: false,
    jobId: makeJobId(),
    startedAt,
    endedAt,
    status: 'failed',
    errors: [{
      code: 'worker_busy',
      message: 'Browser worker is at its concurrent job limit.',
      phase: 'admissionControl',
      retryable: true,
      detail: { activeJobs, maxConcurrentJobs }
    }]
  }));
}

export function createServer(options = {}) {
  const config = {
    artifactRoot: 'artifacts',
    capturePage: runIsolatedCapturePage,
    maxRequestBodyBytes: DEFAULT_MAX_REQUEST_BODY_BYTES,
    jobTimeoutMs: DEFAULT_JOB_TIMEOUT_MS,
    maxConcurrentJobs: DEFAULT_MAX_CONCURRENT_JOBS,
    policyBundle: null,
    policyBundlePath: null,
    ...options
  };
  config.maxRequestBodyBytes = positiveInteger(config.maxRequestBodyBytes, DEFAULT_MAX_REQUEST_BODY_BYTES);
  config.jobTimeoutMs = positiveInteger(config.jobTimeoutMs, DEFAULT_JOB_TIMEOUT_MS);
  config.maxConcurrentJobs = positiveInteger(config.maxConcurrentJobs, DEFAULT_MAX_CONCURRENT_JOBS);
  const gate = options.concurrencyGate ?? createConcurrencyGate(config.maxConcurrentJobs);
  const categoryPolicyBundlePromise = config.policyBundle
    ? Promise.resolve({ ok: true, bundle: config.policyBundle })
    : config.policyBundlePath
      ? Promise.resolve()
        .then(() => loadCategoryPolicyBundle(config.policyBundlePath))
        .then((bundle) => ({ ok: true, bundle }))
        .catch((error) => ({ ok: false, error }))
      : Promise.resolve({ ok: true, bundle: null });

  return http.createServer(async (req, res) => {
    try {
      if (req.method === 'GET' && req.url === '/health') {
        return writeJson(res, 200, {
          ok: true,
          service: 'browser-worker',
          version: '0.1.0',
          status: 'healthy'
        });
      }

      if (req.method === 'POST' && req.url === '/v1/browser/jobs') {
        const release = gate.tryAcquire();
        if (!release) return writeWorkerBusy(res, gate);
        try {
          return await handleBrowserJob(req, res, {
            ...config,
            getCategoryPolicyBundle: () => categoryPolicyBundlePromise
          });
        } finally {
          release();
        }
      }

      return writeJson(res, 404, { ok: false, error: 'not_found' });
    } catch (error) {
      return writeJson(res, 500, { ok: false, error: 'internal_error', message: error.message });
    }
  });
}

export function getListenConfig(env = process.env) {
  return {
    port: Number(env.PORT ?? 3080),
    host: env.BROWSER_WORKER_HOST ?? '127.0.0.1',
    artifactRoot: env.BROWSER_WORKER_ARTIFACT_ROOT ?? 'artifacts',
    policyBundlePath: env.BROWSER_WORKER_POLICY_BUNDLE_PATH ?? null
  };
}

export function getRuntimeLimits(env = process.env) {
  return {
    maxRequestBodyBytes: positiveInteger(env.BROWSER_WORKER_MAX_REQUEST_BODY_BYTES, DEFAULT_MAX_REQUEST_BODY_BYTES),
    jobTimeoutMs: positiveInteger(env.BROWSER_WORKER_JOB_TIMEOUT_MS, DEFAULT_JOB_TIMEOUT_MS),
    maxConcurrentJobs: positiveInteger(env.BROWSER_WORKER_MAX_CONCURRENT_JOBS, DEFAULT_MAX_CONCURRENT_JOBS)
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { port, host, artifactRoot, policyBundlePath } = getListenConfig();
  createServer({ artifactRoot, policyBundlePath, ...getRuntimeLimits() }).listen(port, host, () => {
    console.log(`browser-worker listening on ${host}:${port}`);
  });
}
