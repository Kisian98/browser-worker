import { createHash } from 'node:crypto';
import { readFile, realpath, stat } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { domainToASCII } from 'node:url';

function nowMs() {
  return performance.now();
}

function makeError(code, message, detail = {}, phase = 'categoryPolicy', retryable = false) {
  return { code, message, phase, retryable, detail };
}

function normalizeHostname(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().replace(/\.$/, '');
  if (!trimmed || trimmed.includes('*')) return null;
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    return net.isIP(trimmed.slice(1, -1)) ? null : null;
  }
  if (net.isIP(trimmed)) return null;

  const ascii = domainToASCII(trimmed);
  if (!ascii) return null;
  if (ascii.includes('..')) return null;
  if (ascii.startsWith('.') || ascii.endsWith('.')) return null;
  if (ascii.length > 253) return null;
  const labels = ascii.split('.');
  if (labels.some((label) => label.length === 0 || label.length > 63
    || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label))) return null;
  return ascii.toLowerCase();
}

function normalizeRuleHost(value) {
  return normalizeHostname(value);
}

function normalizeSuffixHost(value) {
  return normalizeHostname(value);
}

function normalizePublicSuffixes(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error('Category policy publicSuffixes must be an array.');
  const normalized = [];
  for (const entry of value) {
    const suffix = normalizeSuffixHost(entry);
    if (!suffix) throw new Error(`Category policy public suffix is malformed: ${entry}.`);
    normalized.push(suffix);
  }
  return [...new Set(normalized)];
}

function normalizeRule(rule, publicSuffixSet) {
  if (!rule || typeof rule !== 'object') {
    throw new Error('Category policy rules must be objects.');
  }

  const category = typeof rule.category === 'string' ? rule.category.trim() : '';
  if (!category) {
    throw new Error('Category policy rules must include a non-empty category.');
  }

  const originalHost = typeof rule.host === 'string'
    ? rule.host
    : typeof rule.domain === 'string'
      ? rule.domain
      : '';
  const asciiHost = normalizeRuleHost(originalHost);
  if (!asciiHost) {
    throw new Error(`Category policy rule host is malformed or unsupported: ${originalHost || '<missing>'}.`);
  }
  if (publicSuffixSet.has(asciiHost)) {
    throw new Error(`Category policy rule host is public-suffix-only: ${originalHost}.`);
  }
  if (asciiHost.split('.').length < 2) {
    throw new Error(`Category policy rule host is malformed or unsupported: ${originalHost || '<missing>'}.`);
  }

  return {
    category,
    host: originalHost.trim().replace(/\.$/, ''),
    asciiHost
  };
}

function sortRulesBySpecificity(rules) {
  return [...rules].sort((left, right) => {
    const leftLabels = left.asciiHost.split('.').length;
    const rightLabels = right.asciiHost.split('.').length;
    if (leftLabels !== rightLabels) return rightLabels - leftLabels;
    if (left.asciiHost.length !== right.asciiHost.length) return right.asciiHost.length - left.asciiHost.length;
    return left.asciiHost.localeCompare(right.asciiHost);
  });
}

async function readManifestFile(bundlePath) {
  const bundleStat = await stat(bundlePath);
  const isDirectory = bundleStat.isDirectory();
  const manifestPath = isDirectory ? path.join(bundlePath, 'manifest.json') : bundlePath;
  const bundleRoot = isDirectory ? bundlePath : path.dirname(manifestPath);
  const raw = await readFile(manifestPath, 'utf8');
  return { bundleRoot, manifestPath, manifest: JSON.parse(raw) };
}

function sha256Hex(content) {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

async function resolveBundleFile(bundleRoot, relativeFilePath, { manifestPath, fileLabel }) {
  if (typeof relativeFilePath !== 'string' || !relativeFilePath.trim()) {
    throw new Error(`Category policy ${fileLabel} file path must be a non-empty string.`);
  }

  const trimmed = relativeFilePath.trim();
  const resolvedPath = path.resolve(bundleRoot, trimmed);
  const relativeFromRoot = path.relative(bundleRoot, resolvedPath);
  if (relativeFromRoot.startsWith('..') || path.isAbsolute(relativeFromRoot)) {
    throw new Error(`Category policy ${fileLabel} file must stay within the bundle directory defined by ${manifestPath}.`);
  }

  const [realRoot, realFile] = await Promise.all([realpath(bundleRoot), realpath(resolvedPath)]);
  const realRelativeFromRoot = path.relative(realRoot, realFile);
  if (realRelativeFromRoot.startsWith('..') || path.isAbsolute(realRelativeFromRoot)) {
    throw new Error(`Category policy ${fileLabel} file must stay within the bundle directory defined by ${manifestPath}.`);
  }

  return realFile;
}

function normalizeAdultDomainRule(entry) {
  if (typeof entry === 'string') {
    return { category: 'adult', host: entry };
  }

  if (!entry || typeof entry !== 'object') {
    throw new Error('Category policy adult-domains entries must be strings or objects.');
  }

  return {
    category: typeof entry.category === 'string' && entry.category.trim() ? entry.category.trim() : 'adult',
    host: typeof entry.host === 'string'
      ? entry.host
      : typeof entry.domain === 'string'
        ? entry.domain
        : ''
  };
}

async function loadAdultDomainRulesFromFile(bundleRoot, manifestPath, fileDescriptor) {
  if (!fileDescriptor || typeof fileDescriptor !== 'object' || Array.isArray(fileDescriptor)) {
    throw new Error('Category policy adult-domains file descriptor must be an object.');
  }

  const filePath = await resolveBundleFile(bundleRoot, fileDescriptor.path, { manifestPath, fileLabel: 'adult-domains' });
  const expectedSha256 = typeof fileDescriptor.sha256 === 'string' ? fileDescriptor.sha256.trim().toLowerCase() : '';
  if (!expectedSha256 || !/^[0-9a-f]{64}$/.test(expectedSha256)) {
    throw new Error('Category policy adult-domains file descriptor must include a SHA-256 checksum.');
  }

  const raw = await readFile(filePath, 'utf8');
  const actualSha256 = sha256Hex(raw);
  if (actualSha256 !== expectedSha256) {
    throw new Error(`Category policy adult-domains checksum mismatch for ${filePath}.`);
  }

  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error(`Category policy adult-domains file at ${filePath} must be a JSON array.`);
  }

  return parsed.map((entry) => normalizeAdultDomainRule(entry));
}

export async function loadCategoryPolicyBundle(bundlePath, { now = nowMs } = {}) {
  const startedAt = now();
  const { bundleRoot, manifestPath, manifest } = await readManifestFile(bundlePath);

  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw new Error(`Category policy manifest at ${manifestPath} must be a JSON object.`);
  }
  if (typeof manifest.policyVersion !== 'string' || !manifest.policyVersion.trim()) {
    throw new Error(`Category policy manifest at ${manifestPath} must include policyVersion.`);
  }

  const publicSuffixes = normalizePublicSuffixes(manifest.publicSuffixes);
  const publicSuffixSet = new Set(publicSuffixes);

  const adultDomainsFile = manifest.files?.adultDomains;
  if (!adultDomainsFile) {
    throw new Error(`Category policy manifest at ${manifestPath} must reference a checksummed adult-domains file.`);
  }
  const rules = await loadAdultDomainRulesFromFile(bundleRoot, manifestPath, adultDomainsFile);

  const normalizedRules = sortRulesBySpecificity(rules.map((rule) => normalizeRule(rule, publicSuffixSet)));
  const endedAt = now();

  return {
    policyVersion: manifest.policyVersion.trim(),
    source: typeof manifest.source === 'string' ? manifest.source.trim() : null,
    publicSuffixes,
    rules: normalizedRules,
    metrics: {
      corpusSize: normalizedRules.length,
      elapsedMs: Math.max(0, endedAt - startedAt)
    }
  };
}

function buildMatchResult(bundle, rule, hostname) {
  return {
    blocked: true,
    match: {
      category: rule.category,
      host: hostname,
      rule: {
        host: rule.host,
        asciiHost: rule.asciiHost
      },
      policyVersion: bundle.policyVersion,
      source: bundle.source ?? null
    }
  };
}

export function lookupCategoryPolicy(bundle, hostname) {
  const corpusSize = Array.isArray(bundle?.rules) ? bundle.rules.length : 0;
  const normalizedHost = normalizeHostname(hostname);
  if (!bundle || !normalizedHost) {
    return {
      blocked: false,
      match: null,
      metrics: { corpusSize, elapsedMs: 0 }
    };
  }

  for (const rule of bundle.rules) {
    const asciiHost = rule.asciiHost ?? normalizeHostname(rule.host ?? rule.domain);
    if (!asciiHost) continue;
    if (normalizedHost === asciiHost || normalizedHost.endsWith(`.${asciiHost}`)) {
      return {
        ...buildMatchResult(bundle, { ...rule, asciiHost, host: rule.host ?? rule.domain ?? asciiHost }, normalizedHost),
        metrics: {
          corpusSize,
          elapsedMs: 0
        }
      };
    }
  }

  return {
    blocked: false,
    match: null,
    metrics: {
      corpusSize,
      elapsedMs: 0
    }
  };
}

export function measureCategoryPolicyLookup(bundle, hostname, { now = nowMs } = {}) {
  const startedAt = now();
  const lookup = lookupCategoryPolicy(bundle, hostname);
  const endedAt = now();

  return {
    ...lookup,
    metrics: {
      corpusSize: lookup.metrics.corpusSize,
      elapsedMs: Math.max(0, endedAt - startedAt)
    }
  };
}

export function makeCategoryPolicyError(match, { phase = 'urlPolicy' } = {}) {
  return makeError(
    'category_policy_denied',
    'URL target matches the category policy.',
    {
      category: match.category,
      host: match.host,
      rule: match.rule.host,
      source: match.source,
      policy_version: match.policyVersion
    },
    phase,
    false
  );
}

export function makePolicyBundleUnavailableError(detail = {}, { phase = 'admissionControl' } = {}) {
  return makeError(
    'policy_bundle_unavailable',
    'Configured category policy bundle could not be loaded.',
    detail,
    phase,
    false
  );
}

export function evaluateCategoryPolicy({ hostname, policyBundle, phase = 'urlPolicy' }) {
  const lookup = measureCategoryPolicyLookup(policyBundle, hostname);
  if (!lookup.blocked) {
    return lookup;
  }

  return {
    blocked: true,
    match: lookup.match,
    metrics: lookup.metrics,
    error: makeCategoryPolicyError(lookup.match, { phase })
  };
}
