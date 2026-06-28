import http from 'node:http';
import { randomUUID } from 'node:crypto';

import { createJobArtifacts, prepareJobArtifacts, writeJsonFile } from './artifacts.js';
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

async function handleBrowserJob(req, res, { artifactRoot }) {
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

  const endedAt = nowIso();
  const envelope = createResponseEnvelope({
    jobId,
    startedAt,
    endedAt,
    request: requestSummary,
    page: {
      requestedUrl,
      finalUrl: urlPolicy.url.toString(),
      title: '',
      httpStatus: null,
      redirects: []
    },
    extraction: {
      text: '',
      headings: [],
      links: [],
      forms: [],
      ariaSnapshotPath: jobArtifacts.relative.ariaSnapshotPath
    },
    artifacts: {
      directory: jobArtifacts.relative.directory,
      request: jobArtifacts.relative.request,
      response: jobArtifacts.relative.response,
      screenshot: jobArtifacts.relative.screenshot,
      html: jobArtifacts.relative.html,
      text: jobArtifacts.relative.text,
      trace: jobArtifacts.relative.trace,
      downloads: jobArtifacts.relative.downloads
    },
    warnings: ['browser_execution_not_yet_connected']
  });
  await writeJsonFile(jobArtifacts.absolute.response, envelope);
  return writeJson(res, 200, envelope);
}

export function createServer(options = {}) {
  const config = { artifactRoot: 'artifacts', ...options };
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
