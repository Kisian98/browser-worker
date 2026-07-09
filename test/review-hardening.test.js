import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { buildHostResolverRules, runIsolatedCapturePage } from '../browser-capture.js';
import { createServer, getRuntimeLimits } from '../server.js';
import { createPinnedUrlPolicy } from '../url-policy.js';

async function withServer(options, callback) {
  const server = createServer(options);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  try {
    return await callback(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

test('createPinnedUrlPolicy reuses validated addresses and denies host changes', async () => {
  const policy = createPinnedUrlPolicy({
    targetUrl: 'https://example.com/start',
    resolvedAddresses: ['93.184.216.34']
  });

  const sameHost = await policy({ url: 'https://example.com/final' });
  assert.equal(sameHost.ok, true);
  assert.deepEqual(sameHost.resolvedAddresses, ['93.184.216.34']);

  const crossHost = await policy({ url: 'https://cdn.example.net/app.js' });
  assert.equal(crossHost.ok, false);
  assert.equal(crossHost.error.code, 'cross_origin_request_denied');

  const privateLiteral = await policy({ url: 'http://127.0.0.1/internal' });
  assert.equal(privateLiteral.ok, false);
  assert.equal(privateLiteral.error.code, 'private_network_denied');
});

test('buildHostResolverRules pins the approved host and denies other DNS names', () => {
  assert.equal(
    buildHostResolverRules({
      targetUrl: 'https://example.com',
      resolvedAddresses: ['93.184.216.34']
    }),
    'MAP example.com 93.184.216.34, MAP * ~NOTFOUND'
  );
});

test('runIsolatedCapturePage applies policy to subresources and blocks service workers', async () => {
  const artifactRoot = await mkdtemp(path.join(os.tmpdir(), 'browser-worker-route-policy-'));
  const handlers = {};
  const routeActions = [];
  let contextOptions;
  let webSocketHandler;
  let webSocketClosed = false;

  const page = {
    on: () => {},
    route: async (_pattern, handler) => { handlers.route = handler; },
    routeWebSocket: async (_pattern, handler) => { webSocketHandler = handler; },
    setDefaultTimeout: () => {},
    setDefaultNavigationTimeout: () => {},
    goto: async () => {
      await webSocketHandler({
        close: async () => { webSocketClosed = true; }
      });
      await handlers.route({
        request: () => ({
          url: () => 'http://127.0.0.1/private.png',
          resourceType: () => 'image',
          isNavigationRequest: () => false
        }),
        abort: async () => { routeActions.push('private-abort'); },
        continue: async () => { routeActions.push('private-continue'); }
      });
      await handlers.route({
        request: () => ({
          url: () => 'https://example.com/app.js',
          resourceType: () => 'script',
          isNavigationRequest: () => false
        }),
        abort: async () => { routeActions.push('same-abort'); },
        continue: async () => { routeActions.push('same-continue'); }
      });
      return { status: () => 200 };
    },
    url: () => 'https://example.com/final',
    title: async () => 'Example',
    content: async () => '<html><body>Example</body></html>',
    locator: () => ({ evaluate: async () => 'Example' }),
    screenshot: async ({ path: targetPath }) => writeFile(targetPath, 'png'),
    close: async () => {}
  };
  const context = {
    on: () => {},
    newPage: async () => page,
    close: async () => {}
  };
  const browser = {
    newContext: async (options) => {
      contextOptions = options;
      return context;
    },
    close: async () => {}
  };

  try {
    const result = await runIsolatedCapturePage({
      targetUrl: 'https://example.com',
      resolvedAddresses: ['93.184.216.34'],
      screenshotPath: path.join(artifactRoot, 'screenshot.png'),
      htmlPath: path.join(artifactRoot, 'page.html'),
      textPath: path.join(artifactRoot, 'text.txt'),
      launchBrowser: async () => browser
    });

    assert.deepEqual(routeActions, ['private-abort', 'same-continue']);
    assert.equal(result.warnings.includes('subresource_request_blocked'), true);
    assert.equal(result.warnings.includes('websocket_request_blocked'), true);
    assert.equal(webSocketClosed, true);
    assert.equal(contextOptions.serviceWorkers, 'block');
  } finally {
    await rm(artifactRoot, { recursive: true, force: true });
  }
});

test('POST /v1/browser/jobs rejects oversized request bodies', async () => {
  const artifactRoot = await mkdtemp(path.join(os.tmpdir(), 'browser-worker-body-limit-'));
  try {
    await withServer({
      artifactRoot,
      maxRequestBodyBytes: 64,
      capturePage: async () => { throw new Error('capture should not run'); }
    }, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/v1/browser/jobs`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          url: 'http://93.184.216.34',
          action: 'capturePage',
          padding: 'x'.repeat(200)
        })
      });
      const body = await response.json();

      assert.equal(response.status, 413);
      assert.equal(body.errors[0].code, 'request_body_too_large');
      assert.equal(body.errors[0].detail.maxBytes, 64);
    });
  } finally {
    await rm(artifactRoot, { recursive: true, force: true });
  }
});

test('POST /v1/browser/jobs aborts and reports jobs that exceed the deadline', async () => {
  const artifactRoot = await mkdtemp(path.join(os.tmpdir(), 'browser-worker-timeout-'));
  let aborted = false;

  try {
    await withServer({
      artifactRoot,
      jobTimeoutMs: 25,
      capturePage: ({ signal }) => new Promise((resolve, reject) => {
        signal.addEventListener('abort', () => {
          aborted = true;
          reject(signal.reason);
        }, { once: true });
      })
    }, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/v1/browser/jobs`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url: 'http://93.184.216.34', action: 'capturePage' })
      });
      const body = await response.json();

      assert.equal(response.status, 200);
      assert.equal(body.ok, false);
      assert.equal(body.errors[0].code, 'job_timed_out');
      assert.equal(body.errors[0].detail.timeoutMs, 25);
      assert.equal(aborted, true);
    });
  } finally {
    await rm(artifactRoot, { recursive: true, force: true });
  }
});

test('POST /v1/browser/jobs rejects work above the concurrency limit', async () => {
  const artifactRoot = await mkdtemp(path.join(os.tmpdir(), 'browser-worker-concurrency-'));
  let releaseFirst;
  let enteredFirst;
  const firstEntered = new Promise((resolve) => { enteredFirst = resolve; });
  const firstRelease = new Promise((resolve) => { releaseFirst = resolve; });

  try {
    await withServer({
      artifactRoot,
      maxConcurrentJobs: 1,
      capturePage: async () => {
        enteredFirst();
        await firstRelease;
        return {
          finalUrl: 'http://93.184.216.34/',
          title: 'Done',
          httpStatus: 200,
          screenshotCreated: false,
          events: {},
          warnings: []
        };
      }
    }, async (baseUrl) => {
      const request = {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url: 'http://93.184.216.34', action: 'capturePage' })
      };
      const firstResponsePromise = fetch(`${baseUrl}/v1/browser/jobs`, request);
      await firstEntered;

      const secondResponse = await fetch(`${baseUrl}/v1/browser/jobs`, request);
      const secondBody = await secondResponse.json();
      assert.equal(secondResponse.status, 429);
      assert.equal(secondBody.errors[0].code, 'worker_busy');
      assert.deepEqual(secondBody.errors[0].detail, {
        activeJobs: 1,
        maxConcurrentJobs: 1
      });

      releaseFirst();
      const firstResponse = await firstResponsePromise;
      assert.equal(firstResponse.status, 200);
    });
  } finally {
    releaseFirst?.();
    await rm(artifactRoot, { recursive: true, force: true });
  }
});

test('getRuntimeLimits provides bounded defaults and environment overrides', () => {
  assert.deepEqual(getRuntimeLimits({}), {
    maxRequestBodyBytes: 65536,
    jobTimeoutMs: 30000,
    maxConcurrentJobs: 2
  });
  assert.deepEqual(getRuntimeLimits({
    BROWSER_WORKER_MAX_REQUEST_BODY_BYTES: '1024',
    BROWSER_WORKER_JOB_TIMEOUT_MS: '5000',
    BROWSER_WORKER_MAX_CONCURRENT_JOBS: '1'
  }), {
    maxRequestBodyBytes: 1024,
    jobTimeoutMs: 5000,
    maxConcurrentJobs: 1
  });
});
