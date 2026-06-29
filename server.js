import { rm } from 'node:fs/promises';
import http from 'node:http';
import { randomUUID } from 'node:crypto';

import { createJobArtifacts, prepareJobArtifacts, writeJsonFile } from './artifacts.js';
import { runIsolatedCapturePage, fileExists } from './browser-capture.js';
import { createResponseEnvelope } from './response-envelope.js';
import { evaluateUrlPolicy } from './url-policy.js';

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

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
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

async function writeBlockedPolicyEnvelope(res, {
  jobArtifacts,
  jobId,
  startedAt,
  requestSummary,
  requestedUrl,
  policyError
}) {
  await removeFileIfPresent(jobArtifacts.absolute.screenshot);

  const normalizedPolicyError = normalizePostNavigationPolicyError(policyError);
  const blockedByPrivateNetwork = normalizedPolicyError.code === 'redirected_private_network_denied';
  const endedAt = nowIso();
  const envelope = createResponseEnvelope({
    ok: false,
    jobId,
    startedAt,
    endedAt,
    status: blockedByPrivateNetwork ? 'blocked' : 'failed',
    request: requestSummary,
    page: {
      requestedUrl,
      finalUrl: null
    },
    signals: {
      blocked: blockedByPrivateNetwork,
      privateNetworkDenied: blockedByPrivateNetwork
    },
    artifacts: {
      directory: jobArtifacts.relative.directory,
      request: jobArtifacts.relative.request,
      response: jobArtifacts.relative.response,
      screenshot: null
    },
    errors: [normalizedPolicyError]
  });
  await writeJsonFile(jobArtifacts.absolute.response, envelope);
  return writeJson(res, 200, envelope);
}

async function handleBrowserJob(req, res, { artifactRoot, capturePage }) {
  const jobId = makeJobId();
  const startedAt = nowIso();
  let requestBody;

  try {
    requestBody = await readJson(req);
  } catch (error) {
    const endedAt = nowIso();
    return writeJson(res, 400, createResponseEnvelope({
      ok: false,
      jobId,
      startedAt,
      endedAt,
      status: 'failed',
      errors: [{ code: 'invalid_json', message: error.message, phase: 'requestParsing', retryable: false }]
    }));
  }

  const requestedAction = requestBody?.action ?? null;
  const effectiveSessionMode = 'isolated';
  const requestedUrl = requestBody?.url ?? null;
  const requestSummary = { action: requestedAction, sessionMode: effectiveSessionMode };
  const urlPolicy = await evaluateUrlPolicy({ url: requestedUrl });
  if (!urlPolicy.ok) {
    const endedAt = nowIso();
    return writeJson(res, 400, createResponseEnvelope({
      ok: false,
      jobId,
      startedAt,
      endedAt,
      status: urlPolicy.error.code === 'private_network_denied' ? 'blocked' : 'failed',
      request: requestSummary,
      page: { requestedUrl },
      signals: {
        blocked: urlPolicy.error.code === 'private_network_denied',
        privateNetworkDenied: urlPolicy.error.code === 'private_network_denied'
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

  const jobArtifacts = createJobArtifacts({ artifactRoot, jobId });
  await prepareJobArtifacts(jobArtifacts);
  await writeJsonFile(jobArtifacts.absolute.request, requestBody);

  let captureResult;
  try {
    captureResult = await capturePage({
      targetUrl: urlPolicy.url.toString(),
      screenshotPath: jobArtifacts.absolute.screenshot
    });
  } catch (error) {
    const screenshotCreated = await fileExists(jobArtifacts.absolute.screenshot);
    const endedAt = nowIso();
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
        screenshot: screenshotCreated ? jobArtifacts.relative.screenshot : null
      },
      errors: [{
        code: 'capture_failed',
        message: 'Page capture failed before a browser result could be returned.',
        phase: 'capture',
        retryable: true
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
      policyError: captureResult.policyError
    });
  }

  const finalUrlPolicy = captureResult.finalUrl
    ? await evaluateUrlPolicy({ url: captureResult.finalUrl })
    : { ok: true };

  if (!finalUrlPolicy.ok) {
    return writeBlockedPolicyEnvelope(res, {
      jobArtifacts,
      jobId,
      startedAt,
      requestSummary,
      requestedUrl,
      policyError: finalUrlPolicy.error
    });
  }

  const endedAt = nowIso();
  const warnings = [];
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
      screenshot: screenshotCreated ? jobArtifacts.relative.screenshot : null
    },
    warnings
  });
  await writeJsonFile(jobArtifacts.absolute.response, envelope);
  return writeJson(res, 200, envelope);
}

export function createServer(options = {}) {
  const config = { artifactRoot: 'artifacts', capturePage: runIsolatedCapturePage, ...options };
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
        return await handleBrowserJob(req, res, config);
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
    artifactRoot: env.BROWSER_WORKER_ARTIFACT_ROOT ?? 'artifacts'
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { port, host, artifactRoot } = getListenConfig();
  createServer({ artifactRoot }).listen(port, host, () => {
    console.log(`browser-worker listening on ${host}:${port}`);
  });
}
