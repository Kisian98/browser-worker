const DEFAULT_PAGE = Object.freeze({
  requestedUrl: null,
  finalUrl: null,
  title: '',
  httpStatus: null,
  redirects: []
});

const DEFAULT_SIGNALS = Object.freeze({
  requiresLogin: false,
  captchaDetected: false,
  cookieBannerDetected: false,
  blocked: false
});

const DEFAULT_EXTRACTION = Object.freeze({
  text: '',
  headings: [],
  links: [],
  forms: [],
  ariaSnapshotPath: null
});

const DEFAULT_ARTIFACTS = Object.freeze({
  directory: null,
  screenshot: null,
  html: null,
  downloads: []
});

function cloneDefaults(defaults) {
  return structuredClone(defaults);
}

function durationMs(startedAt, endedAt) {
  const start = Date.parse(startedAt);
  const end = Date.parse(endedAt);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return Math.max(0, end - start);
}

function normalizeErrors(errors = []) {
  return errors.map((error) => ({
    code: error.code ?? 'unknown_error',
    message: error.message ?? String(error),
    detail: error.detail ?? null
  }));
}

export function createResponseEnvelope({
  ok = true,
  jobId,
  startedAt,
  endedAt,
  status,
  page = {},
  signals = {},
  extraction = {},
  artifacts = {},
  warnings = [],
  errors = []
}) {
  const normalizedOk = Boolean(ok);
  return {
    ok: normalizedOk,
    jobId,
    startedAt,
    endedAt,
    durationMs: durationMs(startedAt, endedAt),
    status: status ?? (normalizedOk ? 'completed' : 'failed'),
    page: { ...cloneDefaults(DEFAULT_PAGE), ...page },
    signals: { ...cloneDefaults(DEFAULT_SIGNALS), ...signals },
    extraction: { ...cloneDefaults(DEFAULT_EXTRACTION), ...extraction },
    artifacts: { ...cloneDefaults(DEFAULT_ARTIFACTS), ...artifacts },
    warnings,
    errors: normalizeErrors(errors)
  };
}
