import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { runIsolatedCapturePage } from '../browser-capture.js';

test('runIsolatedCapturePage closes page, context, and browser after successful capture', async () => {
  const calls = [];
  const screenshotRoot = await mkdtemp(path.join(os.tmpdir(), 'browser-capture-success-'));
  const screenshotPath = path.join(screenshotRoot, 'shot.png');

  const page = {
    goto: async () => ({ status: () => 204 }),
    title: async () => 'Captured Title',
    url: () => 'https://example.com/final',
    screenshot: async ({ path: targetPath }) => {
      calls.push(['screenshot', targetPath]);
      await import('node:fs/promises').then(({ writeFile }) => writeFile(targetPath, 'png'));
    },
    close: async () => { calls.push(['page.close']); }
  };
  const context = {
    newPage: async () => page,
    close: async () => { calls.push(['context.close']); }
  };
  const browser = {
    newContext: async () => context,
    close: async () => { calls.push(['browser.close']); }
  };

  try {
    const result = await runIsolatedCapturePage({
      targetUrl: 'https://example.com',
      screenshotPath,
      launchBrowser: async () => browser
    });

    assert.equal(result.finalUrl, 'https://example.com/final');
    assert.equal(result.title, 'Captured Title');
    assert.equal(result.httpStatus, 204);
    assert.equal(result.screenshotCreated, true);
    assert.equal(await readFile(screenshotPath, 'utf8'), 'png');
    assert.deepEqual(calls.slice(-3), [['page.close'], ['context.close'], ['browser.close']]);
  } finally {
    await rm(screenshotRoot, { recursive: true, force: true });
  }
});

test('runIsolatedCapturePage blocks redirected private final URLs before screenshot capture and still closes browser resources', async () => {
  const calls = [];
  const screenshotRoot = await mkdtemp(path.join(os.tmpdir(), 'browser-capture-blocked-'));
  const screenshotPath = path.join(screenshotRoot, 'shot.png');
  const page = {
    goto: async () => ({ status: () => 200 }),
    title: async () => 'Internal Target',
    url: () => 'http://127.0.0.1:8080/internal',
    screenshot: async ({ path: targetPath }) => {
      calls.push(['screenshot', targetPath]);
      await import('node:fs/promises').then(({ writeFile }) => writeFile(targetPath, 'png'));
    },
    close: async () => { calls.push(['page.close']); }
  };
  const context = {
    newPage: async () => page,
    close: async () => { calls.push(['context.close']); }
  };
  const browser = {
    newContext: async () => context,
    close: async () => { calls.push(['browser.close']); }
  };

  try {
    const result = await runIsolatedCapturePage({
      targetUrl: 'https://example.com',
      screenshotPath,
      launchBrowser: async () => browser
    });

    assert.equal(result.finalUrl, 'http://127.0.0.1:8080/internal');
    assert.equal(result.httpStatus, 200);
    assert.equal(result.screenshotCreated, false);
    assert.equal(result.policyBlocked, true);
    assert.equal(result.policyError.code, 'redirected_private_network_denied');
    assert.equal(result.policyError.phase, 'postNavigationPolicy');
    await assert.rejects(readFile(screenshotPath, 'utf8'));
    assert.equal(calls.some(([name]) => name === 'screenshot'), false);
    assert.deepEqual(calls.slice(-3), [['page.close'], ['context.close'], ['browser.close']]);
  } finally {
    await rm(screenshotRoot, { recursive: true, force: true });
  }
});

test('runIsolatedCapturePage still closes browser resources when capture fails', async () => {
  const calls = [];
  const page = {
    goto: async () => { throw new Error('navigation failed'); },
    close: async () => { calls.push(['page.close']); }
  };
  const context = {
    newPage: async () => page,
    close: async () => { calls.push(['context.close']); }
  };
  const browser = {
    newContext: async () => context,
    close: async () => { calls.push(['browser.close']); }
  };

  await assert.rejects(
    () => runIsolatedCapturePage({
      targetUrl: 'https://example.com',
      screenshotPath: '/tmp/unused.png',
      launchBrowser: async () => browser
    }),
    /navigation failed/
  );

  assert.deepEqual(calls, [['page.close'], ['context.close'], ['browser.close']]);
});
