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
  const htmlPath = path.join(screenshotRoot, 'page.html');
  const textPath = path.join(screenshotRoot, 'text.txt');
  let routeHandler;
  let continuedUrl = null;
  let newContextOptions = null;

  const page = {
    route: async (_pattern, handler) => {
      routeHandler = handler;
    },
    goto: async () => {
      await routeHandler({
        request: () => ({ resourceType: () => 'document', isNavigationRequest: () => true, url: () => 'https://example.com/final' }),
        continue: async () => { continuedUrl = 'https://example.com/final'; },
        abort: async () => { throw new Error('should not abort allowed request'); }
      });
      return { status: () => 204 };
    },
    title: async () => 'Captured Title',
    url: () => 'https://example.com/final',
    content: async () => '<html></html>',
    locator: () => ({
      evaluate: async (fn) => fn({ innerText: 'Visible body text' })
    }),
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
    newContext: async (options) => {
      newContextOptions = options;
      return context;
    },
    close: async () => { calls.push(['browser.close']); }
  };

  try {
    const result = await runIsolatedCapturePage({
      targetUrl: 'https://example.com',
      screenshotPath,
      htmlPath,
      textPath,
      launchBrowser: async () => browser
    });

    assert.equal(result.finalUrl, 'https://example.com/final');
    assert.equal(result.title, 'Captured Title');
    assert.equal(result.httpStatus, 204);
    assert.equal(result.screenshotCreated, true);
    assert.deepEqual(result.events, { dialogs: [], popups: [], downloads: [] });
    assert.deepEqual(result.downloadArtifacts, []);
    assert.equal(continuedUrl, 'https://example.com/final');
    assert.deepEqual(newContextOptions, { acceptDownloads: true, downloadsPath: undefined });
    assert.equal(await readFile(screenshotPath, 'utf8'), 'png');
    assert.equal(await readFile(htmlPath, 'utf8'), '<html></html>');
    assert.equal(await readFile(textPath, 'utf8'), 'Visible body text');
    assert.deepEqual(calls.slice(-3), [['page.close'], ['context.close'], ['browser.close']]);
  } finally {
    await rm(screenshotRoot, { recursive: true, force: true });
  }
});

test('runIsolatedCapturePage blocks redirected private final URLs before screenshot capture and still closes browser resources', async () => {
  const calls = [];
  const screenshotRoot = await mkdtemp(path.join(os.tmpdir(), 'browser-capture-blocked-'));
  const screenshotPath = path.join(screenshotRoot, 'shot.png');
  let routeHandler;
  let abortedUrl = null;
  const page = {
    route: async (_pattern, handler) => {
      routeHandler = handler;
    },
    goto: async () => {
      await routeHandler({
        request: () => ({ resourceType: () => 'document', isNavigationRequest: () => true, url: () => 'http://127.0.0.1:8080/internal' }),
        continue: async () => { throw new Error('blocked request should not continue'); },
        abort: async () => { abortedUrl = 'http://127.0.0.1:8080/internal'; }
      });
      throw new Error('Navigation to http://127.0.0.1:8080/internal was aborted');
    },
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
    assert.equal(result.httpStatus, null);
    assert.equal(result.screenshotCreated, false);
    assert.equal(result.policyBlocked, true);
    assert.deepEqual(result.events, { dialogs: [], popups: [], downloads: [] });
    assert.equal(abortedUrl, 'http://127.0.0.1:8080/internal');
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
    route: async () => {},
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

test('runIsolatedCapturePage handles dialogs, popups, and downloads deterministically', async () => {
  const calls = [];
  const artifactRoot = await mkdtemp(path.join(os.tmpdir(), 'browser-capture-events-'));
  const screenshotPath = path.join(artifactRoot, 'shot.png');
  const htmlPath = path.join(artifactRoot, 'page.html');
  const textPath = path.join(artifactRoot, 'text.txt');
  const downloadsDirectory = path.join(artifactRoot, 'downloads');
  const handlers = {};
  const openPopupPages = new Set();
  let newContextOptions = null;

  const popupPage = {
    url: () => 'https://example.com/popup',
    title: async () => 'Popup',
    close: async () => {
      calls.push(['popup.close']);
      openPopupPages.delete(popupPage);
    }
  };

  const page = {
    on: (event, handler) => { handlers[event] = handler; },
    route: async () => {},
    goto: async () => {
      const dialog = {
        type: () => 'alert',
        message: () => 'Heads up',
        defaultValue: () => null,
        dismiss: async () => { calls.push(['dialog.dismiss']); }
      };
      handlers.dialog(dialog);

      openPopupPages.add(popupPage);
      handlers.popup(popupPage);
      handlers.download({
        suggestedFilename: () => '../evil?.txt',
        url: () => 'https://example.com/report.txt',
        saveAs: async (targetPath) => {
          calls.push(['download.saveAs', targetPath]);
          await import('node:fs/promises').then(({ writeFile }) => writeFile(targetPath, 'downloaded'));
        }
      });
      return { status: () => 200 };
    },
    title: async () => 'Example Domain',
    url: () => 'https://example.com/final',
    content: async () => '<html><body>Example Domain</body></html>',
    locator: () => ({ evaluate: async (fn) => fn({ innerText: 'Example Domain' }) }),
    screenshot: async ({ path: targetPath }) => {
      await import('node:fs/promises').then(({ writeFile }) => writeFile(targetPath, 'png'));
    },
    close: async () => { calls.push(['page.close']); }
  };
  const context = {
    on: (event, handler) => {
      handlers[`context:${event}`] = handler;
    },
    newPage: async () => page,
    close: async () => { calls.push(['context.close']); }
  };
  const browser = {
    newContext: async (options) => {
      newContextOptions = options;
      return context;
    },
    close: async () => { calls.push(['browser.close']); }
  };

  try {
    const result = await runIsolatedCapturePage({
      targetUrl: 'https://example.com',
      screenshotPath,
      htmlPath,
      textPath,
      downloadsDirectory,
      launchBrowser: async () => browser
    });

    const expectedDownloadPath = path.join(downloadsDirectory, 'evil_.txt');

    assert.deepEqual(newContextOptions, { acceptDownloads: true, downloadsPath: downloadsDirectory });
    assert.deepEqual(result.events.dialogs, [{ type: 'alert', message: 'Heads up', defaultValue: null }]);
    assert.deepEqual(result.events.popups, [{ url: 'https://example.com/popup', title: 'Popup' }]);
    assert.deepEqual(result.events.downloads, [{
      suggestedFilename: '../evil?.txt',
      savedFilename: 'evil_.txt',
      path: expectedDownloadPath,
      relativePath: null,
      url: 'https://example.com/report.txt'
    }]);
    assert.deepEqual(result.downloadArtifacts, [expectedDownloadPath]);
    assert.equal(await readFile(expectedDownloadPath, 'utf8'), 'downloaded');
    assert.equal(calls.some(([name]) => name === 'dialog.dismiss'), true);
    assert.equal(calls.some(([name]) => name === 'popup.close'), true);
    assert.equal(openPopupPages.size, 0);
    assert.match(expectedDownloadPath, new RegExp(`${downloadsDirectory.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
    assert.deepEqual(result.warnings, ['download_filename_sanitized']);
  } finally {
    await rm(artifactRoot, { recursive: true, force: true });
  }
});

test('runIsolatedCapturePage proves state isolation with a controlled browser fixture', async () => {
  const calls = [];
  const contexts = [];
  const browser = {
    newContext: async () => {
      const state = { cookies: [], localStorage: [], sessionStorage: [] };
      const context = {
        state,
        newPage: async () => ({
          route: async () => {},
          goto: async () => {
            state.cookies.push('job-cookie');
            state.localStorage.push('job-local-storage');
            state.sessionStorage.push('job-session-storage');
            return { status: () => 200 };
          },
          title: async () => 'Example',
          url: () => 'https://example.com/final',
          content: async () => '<html></html>',
          locator: () => ({ evaluate: async (fn) => fn({ innerText: 'Example' }) }),
          screenshot: async ({ path: targetPath }) => {
            calls.push(['screenshot', targetPath]);
            await import('node:fs/promises').then(({ writeFile }) => writeFile(targetPath, 'png'));
          },
          close: async () => { calls.push(['page.close']); }
        }),
        close: async () => { calls.push(['context.close']); }
      };
      contexts.push(context);
      return context;
    },
    close: async () => { calls.push(['browser.close']); }
  };
  const screenshotRoot = await mkdtemp(path.join(os.tmpdir(), 'browser-capture-isolation-'));
  const firstShot = path.join(screenshotRoot, 'first.png');
  const secondShot = path.join(screenshotRoot, 'second.png');

  try {
    await runIsolatedCapturePage({
      targetUrl: 'https://example.com/one',
      screenshotPath: firstShot,
      htmlPath: path.join(screenshotRoot, 'one.html'),
      textPath: path.join(screenshotRoot, 'one.txt'),
      launchBrowser: async () => browser
    });

    await runIsolatedCapturePage({
      targetUrl: 'https://example.com/two',
      screenshotPath: secondShot,
      htmlPath: path.join(screenshotRoot, 'two.html'),
      textPath: path.join(screenshotRoot, 'two.txt'),
      launchBrowser: async () => browser
    });

    assert.equal(contexts.length, 2);
    assert.deepEqual(contexts[0].state, {
      cookies: ['job-cookie'],
      localStorage: ['job-local-storage'],
      sessionStorage: ['job-session-storage']
    });
    assert.deepEqual(contexts[1].state, {
      cookies: ['job-cookie'],
      localStorage: ['job-local-storage'],
      sessionStorage: ['job-session-storage']
    });
    assert.equal(await readFile(firstShot, 'utf8'), 'png');
    assert.equal(await readFile(secondShot, 'utf8'), 'png');
  } finally {
    await rm(screenshotRoot, { recursive: true, force: true });
  }
});
