import test from 'node:test';
import assert from 'node:assert/strict';

import { createResponseEnvelope } from '../response-envelope.js';

test('createResponseEnvelope returns a completed success envelope with stable top-level shape', () => {
  const envelope = createResponseEnvelope({
    jobId: 'job-test-001',
    startedAt: '2026-06-26T10:00:00.000Z',
    endedAt: '2026-06-26T10:00:01.250Z',
    page: {
      requestedUrl: 'https://example.com',
      finalUrl: 'https://example.com/',
      title: 'Example Domain',
      httpStatus: 200,
      redirects: []
    },
    extraction: {
      text: 'Example Domain',
      headings: [{ level: 1, text: 'Example Domain' }],
      links: [{ text: 'More information...', href: 'https://www.iana.org/help/example-domains' }],
      forms: []
    },
    artifacts: {
      directory: 'artifacts/jobs/job-test-001',
      screenshot: 'screenshot.png'
    }
  });

  assert.deepEqual(Object.keys(envelope), [
    'ok',
    'jobId',
    'startedAt',
    'endedAt',
    'durationMs',
    'status',
    'page',
    'signals',
    'extraction',
    'artifacts',
    'warnings',
    'errors'
  ]);
  assert.equal(envelope.ok, true);
  assert.equal(envelope.status, 'completed');
  assert.equal(envelope.durationMs, 1250);
  assert.deepEqual(envelope.signals, {
    requiresLogin: false,
    captchaDetected: false,
    cookieBannerDetected: false,
    blocked: false
  });
  assert.deepEqual(envelope.errors, []);
});

test('createResponseEnvelope returns a failed envelope with normalized structured errors', () => {
  const envelope = createResponseEnvelope({
    ok: false,
    jobId: 'job-test-002',
    startedAt: '2026-06-26T10:00:00.000Z',
    endedAt: '2026-06-26T10:00:00.050Z',
    status: 'failed',
    page: { requestedUrl: 'not-a-url' },
    errors: [{ code: 'invalid_url', message: 'URL must be http or https', detail: { field: 'url' } }]
  });

  assert.equal(envelope.ok, false);
  assert.equal(envelope.status, 'failed');
  assert.deepEqual(envelope.errors, [
    { code: 'invalid_url', message: 'URL must be http or https', detail: { field: 'url' } }
  ]);
  assert.deepEqual(envelope.extraction, {
    text: '',
    headings: [],
    links: [],
    forms: [],
    ariaSnapshotPath: null
  });
});
