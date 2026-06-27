import http from 'node:http';
import { randomUUID } from 'node:crypto';

import { createResponseEnvelope } from './response-envelope.js';

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

function validateHttpUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return { ok: false, message: 'URL must use http or https' };
    }
    return { ok: true, url };
  } catch {
    return { ok: false, message: 'URL must be a valid absolute URL' };
  }
}

function validateAction(value) {
  if (value !== 'capturePage') {
    return { ok: false, message: 'Action must be capturePage' };
  }
  return { ok: true, action: value };
}

async function handleBrowserJob(req, res) {
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
      errors: [{ code: 'invalid_json', message: error.message }]
    }));
  }

  const requestedUrl = requestBody.url ?? null;
  const urlValidation = validateHttpUrl(requestedUrl);
  if (!urlValidation.ok) {
    const endedAt = nowIso();
    return writeJson(res, 400, createResponseEnvelope({
      ok: false,
      jobId,
      startedAt,
      endedAt,
      status: 'failed',
      page: { requestedUrl },
      errors: [{ code: 'invalid_url', message: urlValidation.message, detail: { field: 'url' } }]
    }));
  }

  const requestedAction = requestBody.action ?? null;
  const actionValidation = validateAction(requestedAction);
  if (!actionValidation.ok) {
    const endedAt = nowIso();
    return writeJson(res, 400, createResponseEnvelope({
      ok: false,
      jobId,
      startedAt,
      endedAt,
      status: 'failed',
      page: { requestedUrl },
      errors: [{ code: 'invalid_action', message: actionValidation.message, detail: { field: 'action', allowed: ['capturePage'] } }]
    }));
  }

  const endedAt = nowIso();
  return writeJson(res, 200, createResponseEnvelope({
    jobId,
    startedAt,
    endedAt,
    page: {
      requestedUrl,
      finalUrl: urlValidation.url.toString(),
      title: '',
      httpStatus: null,
      redirects: []
    },
    extraction: {
      text: '',
      headings: [],
      links: [],
      forms: []
    },
    artifacts: {
      directory: null,
      screenshot: null,
      html: null,
      downloads: []
    },
    warnings: ['browser_execution_not_yet_connected']
  }));
}

export function createServer() {
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
        return await handleBrowserJob(req, res);
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
    host: env.BROWSER_WORKER_HOST ?? '127.0.0.1'
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { port, host } = getListenConfig();
  createServer().listen(port, host, () => {
    console.log(`browser-worker listening on ${host}:${port}`);
  });
}
