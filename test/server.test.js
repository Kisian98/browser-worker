import test from 'node:test';
import assert from 'node:assert/strict';

import { createServer, getListenConfig } from '../server.js';

async function withServer(callback) {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    return await callback(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

test('getListenConfig defaults to localhost and port 3080', () => {
  const config = getListenConfig({});

  assert.equal(config.host, '127.0.0.1');
  assert.equal(config.port, 3080);
});

test('getListenConfig allows explicit host and port overrides', () => {
  const config = getListenConfig({ BROWSER_WORKER_HOST: '0.0.0.0', PORT: '3099' });

  assert.equal(config.host, '0.0.0.0');
  assert.equal(config.port, 3099);
});

test('POST /v1/browser/jobs returns structured envelope for invalid URL errors', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/v1/browser/jobs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: 'file:///etc/passwd', action: 'capturePage' })
    });
    const body = await response.json();

    assert.equal(response.status, 400);
    assert.equal(body.ok, false);
    assert.equal(body.status, 'failed');
    assert.equal(body.page.requestedUrl, 'file:///etc/passwd');
    assert.equal(body.errors[0].code, 'invalid_url');
    assert.deepEqual(Object.keys(body), [
      'ok', 'jobId', 'startedAt', 'endedAt', 'durationMs', 'status', 'page',
      'signals', 'extraction', 'artifacts', 'warnings', 'errors'
    ]);
  });
});

test('POST /v1/browser/jobs rejects private-network targets with structured private_network_denied errors', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/v1/browser/jobs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: 'http://127.0.0.1:80/', action: 'capturePage' })
    });
    const body = await response.json();

    assert.equal(response.status, 400);
    assert.equal(body.ok, false);
    assert.equal(body.status, 'failed');
    assert.equal(body.page.requestedUrl, 'http://127.0.0.1:80/');
    assert.equal(body.errors[0].code, 'private_network_denied');
    assert.equal(body.errors[0].detail.field, 'url');
  });
});

test('POST /v1/browser/jobs returns structured envelope for capturePage requests', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/v1/browser/jobs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: 'https://example.com', action: 'capturePage' })
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.status, 'completed');
    assert.equal(body.page.requestedUrl, 'https://example.com');
    assert.equal(body.page.finalUrl, 'https://example.com/');
    assert.match(body.jobId, /^job-/);
    assert.deepEqual(body.errors, []);
  });
});

test('POST /v1/browser/jobs rejects unknown actions with structured invalid_action errors', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/v1/browser/jobs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: 'https://example.com', action: 'capture' })
    });
    const body = await response.json();

    assert.equal(response.status, 400);
    assert.equal(body.ok, false);
    assert.equal(body.status, 'failed');
    assert.equal(body.page.requestedUrl, 'https://example.com');
    assert.equal(body.errors[0].code, 'invalid_action');
    assert.equal(body.errors[0].detail.field, 'action');
  });
});
