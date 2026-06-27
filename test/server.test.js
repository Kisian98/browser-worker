import test from 'node:test';
import assert from 'node:assert/strict';

import { createServer } from '../server.js';

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

test('POST /v1/browser/jobs returns structured envelope for invalid URL errors', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/v1/browser/jobs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: 'file:///etc/passwd', action: 'capture' })
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

test('POST /v1/browser/jobs returns structured envelope for capture requests', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/v1/browser/jobs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: 'https://example.com', action: 'capture' })
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
