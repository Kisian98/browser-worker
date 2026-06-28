import dns from 'node:dns/promises';
import net from 'node:net';

const PRIVATE_NETWORK_DENIED = 'private_network_denied';
const INVALID_URL = 'invalid_url';

function makeError(code, message, detail = {}) {
  return { code, message, detail };
}

function isIpv4InCidr(address, networkAddress, prefixLength) {
  const ip = ipv4ToInt(address);
  const network = ipv4ToInt(networkAddress);
  const shift = 32 - prefixLength;
  return (ip >>> shift) === (network >>> shift);
}

function ipv4ToInt(address) {
  return address.split('.').reduce((value, part) => (value << 8) + Number(part), 0) >>> 0;
}

function classifyIp(address) {
  const version = net.isIP(address);
  if (version === 4) return classifyIpv4(address);
  if (version === 6) return classifyIpv6(address);
  return { blocked: false, reason: null };
}

function classifyIpv4(address) {
  const blockedCidrs = [
    ['0.0.0.0', 32, 'loopback_denied'],
    ['127.0.0.0', 8, 'loopback_denied'],
    ['10.0.0.0', 8, 'private_network_denied'],
    ['172.16.0.0', 12, 'private_network_denied'],
    ['192.168.0.0', 16, 'private_network_denied'],
    ['169.254.0.0', 16, 'link_local_denied'],
    ['100.64.0.0', 10, 'carrier_nat_denied'],
    ['198.18.0.0', 15, 'benchmark_network_denied'],
    ['224.0.0.0', 4, 'special_use_denied']
  ];

  for (const [networkAddress, prefixLength, reason] of blockedCidrs) {
    if (isIpv4InCidr(address, networkAddress, prefixLength)) {
      return { blocked: true, reason };
    }
  }

  return { blocked: false, reason: null };
}

function parseMappedIpv4(normalizedIpv6) {
  const mappedPrefix = '::ffff:';
  if (!normalizedIpv6.startsWith(mappedPrefix)) return null;

  const suffix = normalizedIpv6.slice(mappedPrefix.length);
  if (suffix.includes('.')) return suffix;

  const parts = suffix.split(':');
  if (parts.length !== 2) return null;

  const values = parts.map((part) => Number.parseInt(part, 16));
  if (values.some((value) => Number.isNaN(value) || value < 0 || value > 0xffff)) return null;

  return [
    values[0] >> 8,
    values[0] & 0xff,
    values[1] >> 8,
    values[1] & 0xff
  ].join('.');
}

function classifyIpv6(address) {
  const normalized = address.toLowerCase();
  const mappedIpv4 = parseMappedIpv4(normalized);
  if (mappedIpv4) {
    return classifyIpv4(mappedIpv4);
  }

  if (normalized === '::1') return { blocked: true, reason: 'loopback_denied' };
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) {
    return { blocked: true, reason: 'private_network_denied' };
  }
  if (normalized.startsWith('fe8') || normalized.startsWith('fe9') || normalized.startsWith('fea') || normalized.startsWith('feb')) {
    return { blocked: true, reason: 'link_local_denied' };
  }
  if (normalized.startsWith('ff')) {
    return { blocked: true, reason: 'special_use_denied' };
  }

  return { blocked: false, reason: null };
}

async function defaultResolveHostname(host) {
  const results = await dns.lookup(host, { all: true, verbatim: true });
  return [...new Set(results.map((result) => result.address))];
}

export async function evaluateUrlPolicy({ url: value, resolveHostname = defaultResolveHostname }) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return { ok: false, error: makeError(INVALID_URL, 'URL must be a valid absolute URL', { field: 'url' }) };
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, error: makeError(INVALID_URL, 'URL must use http or https', { field: 'url' }) };
  }

  const host = url.hostname;
  const normalizedHost = host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;
  const literalVersion = net.isIP(normalizedHost);

  let resolvedAddresses;
  if (literalVersion) {
    resolvedAddresses = [normalizedHost];
  } else {
    try {
      resolvedAddresses = await resolveHostname(normalizedHost);
    } catch {
      return {
        ok: false,
        error: makeError(INVALID_URL, 'URL host could not be resolved', {
          field: 'url',
          host: normalizedHost,
          reason: 'dns_resolution_failed'
        })
      };
    }
  }

  for (const address of resolvedAddresses) {
    const classification = classifyIp(address);
    if (classification.blocked) {
      return {
        ok: false,
        error: makeError(PRIVATE_NETWORK_DENIED, 'URL target is blocked by private-network policy', {
          field: 'url',
          host,
          address,
          reason: classification.reason
        })
      };
    }
  }

  return { ok: true, url, resolvedAddresses };
}
