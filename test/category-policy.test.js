import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { runIsolatedCapturePage } from '../browser-capture.js';
import {
  loadCategoryPolicyBundle,
  lookupCategoryPolicy,
  measureCategoryPolicyLookup
} from '../category-policy.js';
import { evaluateUrlPolicy } from '../url-policy.js';
import { createServer } from '../server.js';

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

async function writeBundleFixture(manifest) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'browser-worker-category-policy-'));
  const effectiveManifest = { ...manifest };
  if (Array.isArray(effectiveManifest.rules)) {
    const payload = JSON.stringify(effectiveManifest.rules, null, 2);
    await writeFile(path.join(root, 'adult-domains.json'), payload);
    effectiveManifest.files = {
      ...(effectiveManifest.files ?? {}),
      adultDomains: {
        path: 'adult-domains.json',
        sha256: sha256Hex(payload)
      }
    };
    delete effectiveManifest.rules;
  }
  await writeFile(path.join(root, 'manifest.json'), JSON.stringify(effectiveManifest, null, 2));
  return root;
}

function sha256Hex(content) {
  return createHash('sha256').update(content).digest('hex');
}

async function writeFileBackedBundleFixture({
  policyVersion = '2026-07-13.synthetic',
  source = 'synthetic-fixture',
  publicSuffixes = ['com', 'co.uk', 'github.io'],
  adultDomains = ['blocked.example', 'mañana.example'],
  checksumOverride = null,
  adultDomainsPath = 'adult-domains.json'
}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'browser-worker-category-policy-bundle-'));
  const adultDomainsPayload = JSON.stringify(adultDomains, null, 2);
  await writeFile(path.join(root, adultDomainsPath), adultDomainsPayload);
  const manifest = {
    policyVersion,
    source,
    publicSuffixes,
    files: {
      adultDomains: {
        path: adultDomainsPath,
        sha256: checksumOverride ?? sha256Hex(adultDomainsPayload)
      }
    }
  };
  await writeFile(path.join(root, 'manifest.json'), JSON.stringify(manifest, null, 2));
  return root;
}

test('loadCategoryPolicyBundle validates synthetic manifests and measures corpus size and elapsed time', async () => {
  const fixtureRoot = await writeBundleFixture({
    policyVersion: '2026-07-13.synthetic',
    publicSuffixes: ['com', 'co.uk', 'github.io'],
    rules: [
      { category: 'blocked', host: 'blocked.example' },
      { category: 'blocked', host: 'mañana.example' }
    ]
  });

  try {
    const bundle = await loadCategoryPolicyBundle(fixtureRoot);

    assert.equal(bundle.policyVersion, '2026-07-13.synthetic');
    assert.equal(bundle.metrics.corpusSize, 2);
    assert.equal(typeof bundle.metrics.elapsedMs, 'number');
    assert.equal(bundle.metrics.elapsedMs >= 0, true);
    assert.equal(bundle.rules.length, 2);
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test('loadCategoryPolicyBundle reads referenced local policy files and validates SHA-256 checksums', async () => {
  const fixtureRoot = await writeFileBackedBundleFixture({
    adultDomains: [
      'blocked.example',
      'mañana.example'
    ]
  });

  try {
    const bundle = await loadCategoryPolicyBundle(fixtureRoot);

    assert.equal(bundle.policyVersion, '2026-07-13.synthetic');
    assert.equal(bundle.source, 'synthetic-fixture');
    assert.equal(bundle.metrics.corpusSize, 2);
    const ruleHosts = bundle.rules.map((rule) => rule.host).sort();
    assert.deepEqual(ruleHosts, ['blocked.example', 'mañana.example']);
    assert.equal(bundle.rules.every((rule) => rule.category === 'adult'), true);
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test('loadCategoryPolicyBundle rejects policy bundles with checksum mismatches', async () => {
  const fixtureRoot = await writeFileBackedBundleFixture({
    checksumOverride: '0'.repeat(64)
  });

  try {
    await assert.rejects(
      () => loadCategoryPolicyBundle(fixtureRoot),
      /sha-256|checksum/i
    );
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test('loadCategoryPolicyBundle rejects malformed host labels and symlink escapes', async () => {
  const malformedRoot = await writeBundleFixture({
    policyVersion: '2026-07-13.synthetic',
    publicSuffixes: ['com'],
    rules: [{ category: 'adult', host: 'bad_host.example' }]
  });
  const symlinkRoot = await mkdtemp(path.join(os.tmpdir(), 'browser-worker-category-policy-symlink-'));
  const outsideRoot = await mkdtemp(path.join(os.tmpdir(), 'browser-worker-category-policy-outside-'));
  const outsideFile = path.join(outsideRoot, 'adult-domains.json');
  const linkedFile = path.join(symlinkRoot, 'adult-domains.json');
  const payload = JSON.stringify(['blocked.example'], null, 2);
  const manifest = {
    policyVersion: '2026-07-13.synthetic',
    publicSuffixes: ['com'],
    files: { adultDomains: { path: 'adult-domains.json', sha256: sha256Hex(payload) } }
  };

  try {
    await assert.rejects(() => loadCategoryPolicyBundle(malformedRoot), /malformed|unsupported/i);
    await writeFile(outsideFile, payload);
    await symlink(outsideFile, linkedFile);
    await writeFile(path.join(symlinkRoot, 'manifest.json'), JSON.stringify(manifest, null, 2));
    await assert.rejects(() => loadCategoryPolicyBundle(symlinkRoot), /stay within|bundle directory/i);
  } finally {
    await rm(malformedRoot, { recursive: true, force: true });
    await rm(symlinkRoot, { recursive: true, force: true });
    await rm(outsideRoot, { recursive: true, force: true });
  }
});

test('lookupCategoryPolicy matches exact hosts and subdomains on label boundaries using ASCII and IDNA normalization', async () => {
  const bundle = {
    policyVersion: '2026-07-13.synthetic',
    publicSuffixes: ['com', 'co.uk'],
    rules: [
      { category: 'adult', host: 'blocked.example' },
      { category: 'adult', host: 'mañana.example' }
    ],
    metrics: { corpusSize: 2, elapsedMs: 0 }
  };

  const exact = lookupCategoryPolicy(bundle, 'blocked.example');
  const subdomain = lookupCategoryPolicy(bundle, 'deep.blocked.example');
  const idna = lookupCategoryPolicy(bundle, 'xn--maana-pta.example');
  const idnaUnicode = lookupCategoryPolicy(bundle, 'shop.mañana.example');
  const boundaryMismatch = lookupCategoryPolicy(bundle, 'notblockedexample');

  assert.equal(exact.blocked, true);
  assert.equal(exact.match.rule.host, 'blocked.example');
  assert.equal(subdomain.blocked, true);
  assert.equal(subdomain.match.rule.host, 'blocked.example');
  assert.equal(idna.blocked, true);
  assert.equal(idna.match.rule.host, 'mañana.example');
  assert.equal(idnaUnicode.blocked, true);
  assert.equal(idnaUnicode.match.rule.host, 'mañana.example');
  assert.equal(boundaryMismatch.blocked, false);
});

test('evaluateUrlPolicy does not resolve DNS when a category rule blocks the hostname', async () => {
  const bundle = {
    policyVersion: '2026-07-13.synthetic',
    publicSuffixes: ['com'],
    rules: [
      { category: 'adult', host: 'blocked.example' }
    ],
    metrics: { corpusSize: 1, elapsedMs: 0 }
  };
  let resolveCalls = 0;

  const result = await evaluateUrlPolicy({
    url: 'https://blocked.example/path',
    categoryPolicyBundle: bundle,
    resolveHostname: async () => {
      resolveCalls += 1;
      throw new Error('DNS resolver should not be called for category matches');
    }
  });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'category_policy_denied');
  assert.equal(resolveCalls, 0);
});

test('loadCategoryPolicyBundle rejects malformed, IP, wildcard, and public-suffix-only rules', async () => {
  const fixtureRoot = await writeBundleFixture({
    policyVersion: '2026-07-13.synthetic',
    publicSuffixes: ['com', 'co.uk', 'github.io'],
    rules: [
      { category: 'blocked', host: 'com' },
      { category: 'blocked', host: '192.168.1.1' },
      { category: 'blocked', host: '*.example.com' },
      { category: 'blocked', host: 'bad host' }
    ]
  });

  try {
    await assert.rejects(
      () => loadCategoryPolicyBundle(fixtureRoot),
      /public-suffix-only|IP|wildcard|malformed/i
    );
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test('evaluateUrlPolicy and createServer deny category matches before DNS or browser work when a policy bundle is present', async () => {
  const fixtureRoot = await writeBundleFixture({
    policyVersion: '2026-07-13.synthetic',
    publicSuffixes: ['com', 'co.uk'],
    rules: [
      { category: 'adult', host: 'blocked.example' }
    ]
  });

  try {
    const policyBundle = await loadCategoryPolicyBundle(fixtureRoot);
    let captureInvoked = false;

    await withServer({
      policyBundle,
      capturePage: async () => {
        captureInvoked = true;
        throw new Error('capture should not run for category-blocked targets');
      }
    }, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/v1/browser/jobs`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url: 'https://blocked.example/path', action: 'capturePage' })
      });
      const body = await response.json();

      assert.equal(response.status, 400);
      assert.equal(body.status, 'blocked');
      assert.equal(body.signals.blocked, true);
      assert.equal(body.signals.categoryPolicyDenied, true);
      assert.equal(body.errors[0].code, 'category_policy_denied');
      assert.equal(body.errors[0].retryable, false);
      assert.equal(body.errors[0].detail.category, 'adult');
      assert.equal(body.errors[0].detail.host, 'blocked.example');
      assert.equal(body.errors[0].detail.rule, 'blocked.example');
      assert.equal(body.errors[0].detail.policy_version, '2026-07-13.synthetic');
      assert.equal(captureInvoked, false);
      assert.equal(body.artifacts.screenshot, null);
      assert.equal(body.artifacts.html, null);
      assert.equal(body.artifacts.text, null);
      assert.deepEqual(body.artifacts.downloads, []);
    });
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test('runIsolatedCapturePage blocks category-matched subresources and final URLs before screenshot capture', async () => {
  const fixtureRoot = await writeBundleFixture({
    policyVersion: '2026-07-13.synthetic',
    publicSuffixes: ['com', 'co.uk'],
    rules: [
      { category: 'adult', host: 'blocked.example' }
    ]
  });
  const artifactRoot = await mkdtemp(path.join(os.tmpdir(), 'browser-worker-category-route-'));
  let routeHandler;
  const routeActions = [];
  let screenshotCalled = false;
  let contextOptions;

  try {
    const policyBundle = await loadCategoryPolicyBundle(fixtureRoot);
    const page = {
      on: () => {},
      route: async (_pattern, handler) => { routeHandler = handler; },
      routeWebSocket: async () => {},
      setDefaultTimeout: () => {},
      setDefaultNavigationTimeout: () => {},
      goto: async () => {
        await routeHandler({
          request: () => ({
            url: () => 'https://blocked.example/script.js',
            resourceType: () => 'script',
            isNavigationRequest: () => false
          }),
          abort: async () => { routeActions.push('subresource-abort'); },
          continue: async () => { routeActions.push('subresource-continue'); }
        });
        return { status: () => 200 };
      },
      url: () => 'https://blocked.example/final',
      title: async () => 'Blocked Final',
      content: async () => '<html><body>Blocked Final</body></html>',
      locator: () => ({ evaluate: async () => 'Blocked Final' }),
      screenshot: async () => { screenshotCalled = true; },
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

    const result = await runIsolatedCapturePage({
      targetUrl: 'https://allowed.example',
      resolvedAddresses: ['93.184.216.34'],
      categoryPolicyBundle: policyBundle,
      screenshotPath: path.join(artifactRoot, 'shot.png'),
      htmlPath: path.join(artifactRoot, 'page.html'),
      textPath: path.join(artifactRoot, 'text.txt'),
      launchBrowser: async () => browser
    });

    assert.deepEqual(routeActions, ['subresource-abort']);
    assert.equal(result.policyBlocked, true);
    assert.equal(result.policyError.code, 'category_policy_denied');
    assert.equal(result.policyError.phase, 'postNavigationPolicy');
    assert.equal(result.warnings.includes('subresource_request_blocked'), true);
    assert.equal(screenshotCalled, false);
    assert.equal(contextOptions.serviceWorkers, 'block');
  } finally {
    await rm(artifactRoot, { recursive: true, force: true });
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test('measureCategoryPolicyLookup reports a deterministic corpus size and elapsed lookup time', () => {
  const bundle = {
    policyVersion: '2026-07-13.synthetic',
    publicSuffixes: ['com'],
    rules: [
      { category: 'adult', host: 'blocked.example' },
      { category: 'adult', host: 'mañana.example' },
      { category: 'adult', host: 'other.example' }
    ],
    metrics: { corpusSize: 3, elapsedMs: 0 }
  };

  const result = measureCategoryPolicyLookup(bundle, 'deep.blocked.example');

  assert.equal(result.blocked, true);
  assert.equal(result.metrics.corpusSize, 3);
  assert.equal(typeof result.metrics.elapsedMs, 'number');
  assert.equal(result.metrics.elapsedMs >= 0, true);
});
