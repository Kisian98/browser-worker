import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { createServer, getListenConfig } from '../server.js';

async function withServer(callback, options = {}) {
  const server = createServer(options);
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
  assert.equal(config.artifactRoot, 'artifacts');
});

test('getListenConfig allows explicit host, port, and artifact root overrides', () => {
  const config = getListenConfig({ BROWSER_WORKER_HOST: '0.0.0.0', PORT: '3099', BROWSER_WORKER_ARTIFACT_ROOT: '/tmp/browser-artifacts' });

  assert.equal(config.host, '0.0.0.0');
  assert.equal(config.port, 3099);
  assert.equal(config.artifactRoot, '/tmp/browser-artifacts');
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
    assert.equal(body.request.action, 'capturePage');
    assert.equal(body.request.sessionMode, 'isolated');
    assert.equal(body.page.requestedUrl, 'file:///etc/passwd');
    assert.equal(body.errors[0].code, 'invalid_url');
    assert.equal(body.errors[0].phase, 'urlPolicy');
    assert.equal(body.errors[0].retryable, false);
    assert.deepEqual(Object.keys(body), [
      'ok', 'jobId', 'startedAt', 'endedAt', 'durationMs', 'status', 'request', 'page',
      'signals', 'extraction', 'artifacts', 'events', 'warnings', 'errors'
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
    assert.equal(body.status, 'blocked');
    assert.equal(body.page.requestedUrl, 'http://127.0.0.1:80/');
    assert.equal(body.signals.blocked, true);
    assert.equal(body.signals.privateNetworkDenied, true);
    assert.equal(body.errors[0].code, 'private_network_denied');
    assert.equal(body.errors[0].phase, 'urlPolicy');
    assert.equal(body.errors[0].retryable, false);
    assert.equal(body.errors[0].detail.field, 'url');
  });
});

test('POST /v1/browser/jobs returns structured envelope for capturePage requests', async () => {
  const artifactRoot = await mkdtemp(path.join(os.tmpdir(), 'browser-worker-capture-'));

  try {
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
      assert.equal(body.request.action, 'capturePage');
      assert.equal(body.request.sessionMode, 'isolated');
      assert.equal(body.page.requestedUrl, 'https://example.com');
      assert.equal(body.page.finalUrl, 'https://example.com/final');
      assert.equal(body.page.title, 'Example Domain');
      assert.equal(body.page.httpStatus, 200);
      assert.deepEqual(body.events.dialogs, []);
      assert.match(body.jobId, /^job-/);
      assert.deepEqual(body.errors, []);
      assert.equal(body.warnings.includes('browser_execution_not_yet_connected'), false);
      assert.equal(body.artifacts.screenshot, `${body.artifacts.directory}/screenshot.png`);
      const screenshotStat = await stat(path.join(artifactRoot, body.artifacts.screenshot));
      assert.equal(screenshotStat.isFile(), true);
    }, {
      artifactRoot,
      capturePage: async ({ screenshotPath }) => {
        await writeFile(screenshotPath, 'fake-image');
        return {
          finalUrl: 'https://example.com/final',
          title: 'Example Domain',
          httpStatus: 200,
          screenshotCreated: true
        };
      }
    });
  } finally {
    await rm(artifactRoot, { recursive: true, force: true });
  }
});

test('POST /v1/browser/jobs creates job artifact directory and persists request and response JSON', async () => {
  const artifactRoot = await mkdtemp(path.join(os.tmpdir(), 'browser-worker-artifacts-'));
  const requestPayload = { url: 'https://example.com', action: 'capturePage' };

  try {
    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/v1/browser/jobs`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(requestPayload)
      });
      const body = await response.json();

      assert.equal(response.status, 200);
      assert.match(body.artifacts.directory, /^jobs\/job-/);
      assert.equal(body.artifacts.request, `${body.artifacts.directory}/request.json`);
      assert.equal(body.artifacts.response, `${body.artifacts.directory}/response.json`);
      assert.equal(body.artifacts.screenshot, null);
      assert.equal(body.artifacts.html, null);
      assert.equal(body.artifacts.text, null);
      assert.equal(body.artifacts.trace, null);
      assert.equal(body.extraction.ariaSnapshotPath, null);
      assert.deepEqual(body.artifacts.downloads, []);

      const jobDirectory = path.join(artifactRoot, body.artifacts.directory);
      const directoryStat = await stat(jobDirectory);
      const downloadsStat = await stat(path.join(jobDirectory, 'downloads'));
      assert.equal(directoryStat.isDirectory(), true);
      assert.equal(downloadsStat.isDirectory(), true);

      const persistedRequest = JSON.parse(await readFile(path.join(artifactRoot, body.artifacts.request), 'utf8'));
      const persistedResponse = JSON.parse(await readFile(path.join(artifactRoot, body.artifacts.response), 'utf8'));
      assert.deepEqual(persistedRequest, requestPayload);
      assert.deepEqual(persistedResponse, body);
    }, {
      artifactRoot,
      capturePage: async () => ({
        finalUrl: 'https://example.com/',
        title: 'Example Domain',
        httpStatus: 200,
        screenshotCreated: false
      })
    });
  } finally {
    await rm(artifactRoot, { recursive: true, force: true });
  }
});

test('POST /v1/browser/jobs keeps screenshot path null when no screenshot file exists', async () => {
  const artifactRoot = await mkdtemp(path.join(os.tmpdir(), 'browser-worker-no-shot-'));

  try {
    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/v1/browser/jobs`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url: 'https://example.com', action: 'capturePage' })
      });
      const body = await response.json();

      assert.equal(response.status, 200);
      assert.equal(body.artifacts.screenshot, null);
    }, {
      artifactRoot,
      capturePage: async () => ({
        finalUrl: 'https://example.com/',
        title: 'Example Domain',
        httpStatus: 200,
        screenshotCreated: true
      })
    });
  } finally {
    await rm(artifactRoot, { recursive: true, force: true });
  }
});

test('POST /v1/browser/jobs reports isolated as the effective session mode until sessions are implemented', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/v1/browser/jobs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        url: 'https://example.com',
        action: 'capturePage',
        session: { mode: 'persistentProfile' }
      })
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.request.action, 'capturePage');
    assert.equal(body.request.sessionMode, 'isolated');
  }, {
    capturePage: async () => ({
      finalUrl: 'https://example.com/',
      title: 'Example Domain',
      httpStatus: 200,
      screenshotCreated: false
    })
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
    assert.equal(body.request.action, 'capture');
    assert.equal(body.page.requestedUrl, 'https://example.com');
    assert.equal(body.errors[0].code, 'invalid_action');
    assert.equal(body.errors[0].phase, 'requestValidation');
    assert.equal(body.errors[0].retryable, false);
    assert.equal(body.errors[0].detail.field, 'action');
  });
});
