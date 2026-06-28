import test from 'node:test';
import assert from 'node:assert/strict';

import { createResponseEnvelope } from '../response-envelope.js';

test('createResponseEnvelope returns a completed success envelope with spec-aligned top-level shape', () => {
  const envelope = createResponseEnvelope({
    jobId: 'job-test-001',
    startedAt: '2026-06-26T10:00:00.000Z',
    endedAt: '2026-06-26T10:00:01.250Z',
    request: { action: 'capturePage', sessionMode: 'isolated' },
    page: {
      requestedUrl: 'https://example.com',
      finalUrl: 'https://example.com/',
      title: 'Example Domain',
      httpStatus: 200,
      redirects: [],
      contentType: 'text/html'
    },
    extraction: {
      text: 'Example Domain',
      textLength: 14,
      headings: [{ level: 1, text: 'Example Domain' }],
      links: [{ text: 'More information...', href: 'https://www.iana.org/help/example-domains' }],
      forms: [],
      buttons: []
    },
    artifacts: {
      directory: 'artifacts/jobs/job-test-001',
      request: 'request.json',
      response: 'response.json',
      screenshot: 'screenshot.png'
    },
    events: { console: [{ type: 'warning', text: 'demo' }] }
  });

  assert.deepEqual(Object.keys(envelope), [
    'ok',
    'jobId',
    'startedAt',
    'endedAt',
    'durationMs',
    'status',
    'request',
    'page',
    'signals',
    'extraction',
    'artifacts',
    'events',
    'warnings',
    'errors'
  ]);
  assert.equal(envelope.ok, true);
  assert.equal(envelope.status, 'completed');
  assert.equal(envelope.durationMs, 1250);
  assert.deepEqual(envelope.request, { action: 'capturePage', sessionMode: 'isolated' });
  assert.deepEqual(envelope.signals, {
    requiresLogin: false,
    captchaDetected: false,
    cookieBannerDetected: false,
    blocked: false,
    privateNetworkDenied: false
  });
  assert.equal(envelope.extraction.textLength, 14);
  assert.equal(envelope.artifacts.response, 'response.json');
  assert.deepEqual(envelope.events.dialogs, []);
  assert.deepEqual(envelope.events.console, [{ type: 'warning', text: 'demo' }]);
  assert.deepEqual(envelope.errors, []);
});

test('createResponseEnvelope returns a failed envelope with normalized structured errors', () => {
  const envelope = createResponseEnvelope({
    ok: false,
    jobId: 'job-test-002',
    startedAt: '2026-06-26T10:00:00.000Z',
    endedAt: '2026-06-26T10:00:00.050Z',
    status: 'failed',
    request: { action: 'capturePage' },
    page: { requestedUrl: 'not-a-url' },
    errors: [{ code: 'invalid_url', message: 'URL must be http or https', phase: 'urlPolicy', retryable: false, detail: { field: 'url' } }]
  });

  assert.equal(envelope.ok, false);
  assert.equal(envelope.status, 'failed');
  assert.deepEqual(envelope.errors, [
    { code: 'invalid_url', message: 'URL must be http or https', phase: 'urlPolicy', retryable: false, detail: { field: 'url' } }
  ]);
  assert.deepEqual(envelope.extraction, {
    text: '',
    textLength: 0,
    headings: [],
    links: [],
    forms: [],
    buttons: [],
    ariaSnapshotPath: null
  });
  assert.deepEqual(envelope.events, {
    dialogs: [],
    popups: [],
    downloads: [],
    console: [],
    pageErrors: []
  });
});

test('createResponseEnvelope defaults error metadata when callers omit it', () => {
  const envelope = createResponseEnvelope({
    ok: false,
    jobId: 'job-test-003',
    startedAt: '2026-06-26T10:00:00.000Z',
    endedAt: '2026-06-26T10:00:00.005Z',
    errors: [{ code: 'demo_error', message: 'Demo error' }]
  });

  assert.deepEqual(envelope.errors, [
    { code: 'demo_error', message: 'Demo error', phase: 'unknown', retryable: false, detail: null }
  ]);
});
