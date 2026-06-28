import test from 'node:test';
import assert from 'node:assert/strict';

import { evaluateUrlPolicy } from '../url-policy.js';

test('evaluateUrlPolicy rejects malformed URLs', async () => {
  const result = await evaluateUrlPolicy({ url: 'not a url' });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'invalid_url');
});

test('evaluateUrlPolicy rejects non-http protocols', async () => {
  const result = await evaluateUrlPolicy({ url: 'file:///etc/passwd' });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'invalid_url');
});

test('evaluateUrlPolicy rejects localhost and loopback targets', async () => {
  const localhost = await evaluateUrlPolicy({ url: 'http://localhost:3080/health' });
  const loopback = await evaluateUrlPolicy({ url: 'http://127.0.0.1:80/' });

  assert.equal(localhost.ok, false);
  assert.equal(localhost.error.code, 'private_network_denied');
  assert.equal(loopback.ok, false);
  assert.equal(loopback.error.code, 'private_network_denied');
});

test('evaluateUrlPolicy rejects metadata and RFC1918/private targets', async () => {
  const metadata = await evaluateUrlPolicy({ url: 'http://169.254.169.254/latest/meta-data/' });
  const privateRange = await evaluateUrlPolicy({ url: 'http://192.168.1.10/' });

  assert.equal(metadata.ok, false);
  assert.equal(metadata.error.code, 'private_network_denied');
  assert.equal(privateRange.ok, false);
  assert.equal(privateRange.error.code, 'private_network_denied');
});

test('evaluateUrlPolicy rejects IPv6 loopback and unique-local targets', async () => {
  const ipv6Loopback = await evaluateUrlPolicy({ url: 'http://[::1]/' });
  const uniqueLocal = await evaluateUrlPolicy({ url: 'http://[fd00::1]/' });

  assert.equal(ipv6Loopback.ok, false);
  assert.equal(ipv6Loopback.error.code, 'private_network_denied');
  assert.equal(uniqueLocal.ok, false);
  assert.equal(uniqueLocal.error.code, 'private_network_denied');
});

test('evaluateUrlPolicy rejects hostnames that resolve to blocked IPs', async () => {
  const result = await evaluateUrlPolicy({
    url: 'http://internal.test/',
    resolveHostname: async () => ['10.0.0.42']
  });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'private_network_denied');
  assert.equal(result.error.detail.host, 'internal.test');
});

test('evaluateUrlPolicy accepts public https targets', async () => {
  const result = await evaluateUrlPolicy({
    url: 'https://example.com/',
    resolveHostname: async () => ['93.184.216.34']
  });

  assert.equal(result.ok, true);
  assert.equal(result.url.toString(), 'https://example.com/');
  assert.deepEqual(result.resolvedAddresses, ['93.184.216.34']);
});
