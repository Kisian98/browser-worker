const DEFAULT_REQUEST = Object.freeze({
  action: null,
  sessionMode: 'isolated'
});

const DEFAULT_PAGE = Object.freeze({
  requestedUrl: null,
  finalUrl: null,
  title: '',
  httpStatus: null,
  redirects: [],
  contentType: null
});

const DEFAULT_SIGNALS = Object.freeze({
  requiresLogin: false,
  captchaDetected: false,
  cookieBannerDetected: false,
  blocked: false,
  privateNetworkDenied: false
});

const DEFAULT_EXTRACTION = Object.freeze({
  text: '',
  textLength: 0,
  headings: [],
  links: [],
  forms: [],
  buttons: [],
  ariaSnapshotPath: null
});

const DEFAULT_ARTIFACTS = Object.freeze({
  directory: null,
  request: null,
  response: null,
  screenshot: null,
  html: null,
  text: null,
  trace: null,
  downloads: []
});

const DEFAULT_EVENTS = Object.freeze({
  dialogs: [],
  popups: [],
  downloads: [],
  console: [],
  pageErrors: []
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
    phase: error.phase ?? 'unknown',
    retryable: error.retryable ?? false,
    detail: error.detail ?? null
  }));
}

export function createResponseEnvelope({
  ok = true,
  jobId,
  startedAt,
  endedAt,
  status,
  request = {},
  page = {},
  signals = {},
  extraction = {},
  artifacts = {},
  events = {},
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
    request: { ...cloneDefaults(DEFAULT_REQUEST), ...request },
    page: { ...cloneDefaults(DEFAULT_PAGE), ...page },
    signals: { ...cloneDefaults(DEFAULT_SIGNALS), ...signals },
    extraction: { ...cloneDefaults(DEFAULT_EXTRACTION), ...extraction },
    artifacts: { ...cloneDefaults(DEFAULT_ARTIFACTS), ...artifacts },
    events: { ...cloneDefaults(DEFAULT_EVENTS), ...events },
    warnings,
    errors: normalizeErrors(errors)
  };
}
