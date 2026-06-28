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

test('evaluateUrlPolicy rejects localhost, loopback, and unspecified IPv4 targets', async () => {
  const localhost = await evaluateUrlPolicy({ url: 'http://localhost:3080/health' });
  const loopback = await evaluateUrlPolicy({ url: 'http://127.0.0.1:80/' });
  const unspecified = await evaluateUrlPolicy({ url: 'http://0.0.0.0:80/' });

  assert.equal(localhost.ok, false);
  assert.equal(localhost.error.code, 'private_network_denied');
  assert.equal(loopback.ok, false);
  assert.equal(loopback.error.code, 'private_network_denied');
  assert.equal(unspecified.ok, false);
  assert.equal(unspecified.error.code, 'private_network_denied');
});

test('evaluateUrlPolicy rejects metadata and RFC1918/private targets', async () => {
  const metadata = await evaluateUrlPolicy({ url: 'http://169.254.169.254/latest/meta-data/' });
  const privateRange = await evaluateUrlPolicy({ url: 'http://192.168.1.10/' });

  assert.equal(metadata.ok, false);
  assert.equal(metadata.error.code, 'private_network_denied');
  assert.equal(privateRange.ok, false);
  assert.equal(privateRange.error.code, 'private_network_denied');
});

test('evaluateUrlPolicy rejects IPv6 loopback, unique-local, and IPv4-mapped blocked targets', async () => {
  const ipv6Loopback = await evaluateUrlPolicy({ url: 'http://[::1]/' });
  const uniqueLocal = await evaluateUrlPolicy({ url: 'http://[fd00::1]/' });
  const mappedLoopback = await evaluateUrlPolicy({ url: 'http://[::ffff:127.0.0.1]/' });
  const mappedMetadata = await evaluateUrlPolicy({ url: 'http://[::ffff:169.254.169.254]/' });

  assert.equal(ipv6Loopback.ok, false);
  assert.equal(ipv6Loopback.error.code, 'private_network_denied');
  assert.equal(uniqueLocal.ok, false);
  assert.equal(uniqueLocal.error.code, 'private_network_denied');
  assert.equal(mappedLoopback.ok, false);
  assert.equal(mappedLoopback.error.code, 'private_network_denied');
  assert.equal(mappedMetadata.ok, false);
  assert.equal(mappedMetadata.error.code, 'private_network_denied');
});

test('evaluateUrlPolicy returns structured invalid_url errors when DNS resolution fails', async () => {
  const result = await evaluateUrlPolicy({
    url: 'https://missing.example/',
    resolveHostname: async () => {
      const error = new Error('getaddrinfo ENOTFOUND missing.example');
      error.code = 'ENOTFOUND';
      throw error;
    }
  });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'invalid_url');
  assert.equal(result.error.detail.field, 'url');
  assert.equal(result.error.detail.host, 'missing.example');
  assert.equal(result.error.detail.reason, 'dns_resolution_failed');
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
