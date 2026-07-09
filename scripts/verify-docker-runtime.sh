#!/usr/bin/env bash
set -euo pipefail

COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml}"
SERVICE="${BROWSER_WORKER_DOCKER_SERVICE:-browser-worker}"
HOST_PORT="${BROWSER_WORKER_HOST_PORT:-3080}"
BASE_URL="${BROWSER_WORKER_VERIFY_BASE_URL:-http://127.0.0.1:${HOST_PORT}}"
ARTIFACT_ROOT="${BROWSER_WORKER_HOST_ARTIFACT_ROOT:-./artifacts/docker-runtime-verification}"

export BROWSER_WORKER_HOST_ARTIFACT_ROOT="$ARTIFACT_ROOT"

health_file="$(mktemp)"
job_file="$(mktemp)"

cleanup() {
  rm -f "$health_file" "$job_file"
  docker compose -f "$COMPOSE_FILE" down --remove-orphans >/dev/null 2>&1 || true
}
trap cleanup EXIT

fail() {
  echo "$1" >&2
  exit 1
}

require_json_field() {
  local file="$1"
  local pattern="$2"
  local message="$3"

  if ! grep -Eq "$pattern" "$file"; then
    echo "Response payload:" >&2
    cat "$file" >&2
    fail "$message"
  fi
}

extract_json_string() {
  local file="$1"
  local key="$2"

  sed -n "s/.*\"${key}\": \"\([^\"]*\)\".*/\1/p" "$file" | head -n 1
}

extract_artifact_string() {
  local file="$1"
  local key="$2"

  awk -v key="$key" '
    /"artifacts": \{/ {
      in_artifacts = 1
      next
    }
    in_artifacts && /^  }/ {
      exit
    }
    in_artifacts {
      marker = "\"" key "\": \""
      start = index($0, marker)
      if (start > 0) {
        value = substr($0, start + length(marker))
        sub(/\".*/, "", value)
        print value
        exit
      }
    }
  ' "$file"
}

require_artifact_file() {
  local relative_path="$1"
  local label="$2"

  [ -n "$relative_path" ] || fail "Expected $label artifact path"
  case "$relative_path" in
    /*|*..*) fail "Expected $label artifact path to stay under artifact root: $relative_path" ;;
  esac

  local absolute_path="$ARTIFACT_ROOT/$relative_path"
  [ -f "$absolute_path" ] || fail "Expected $label artifact file: $absolute_path"
  [ -s "$absolute_path" ] || fail "Expected non-empty $label artifact file: $absolute_path"
}

rm -rf "$ARTIFACT_ROOT"
mkdir -p "$ARTIFACT_ROOT"

echo "Building Docker image..."
docker compose -f "$COMPOSE_FILE" build --quiet "$SERVICE"

echo "Running npm test inside Docker..."
docker compose -f "$COMPOSE_FILE" run --rm "$SERVICE" npm test

echo "Starting browser-worker service in Docker..."
docker compose -f "$COMPOSE_FILE" up -d "$SERVICE"

for attempt in $(seq 1 30); do
  if curl -fsS "$BASE_URL/health" > "$health_file"; then
    break
  fi

  if [ "$attempt" -eq 30 ]; then
    docker compose -f "$COMPOSE_FILE" logs "$SERVICE"
    fail "Service did not become healthy at $BASE_URL/health"
  fi

  sleep 1
done

require_json_field "$health_file" '"ok": true' 'Expected health.ok to be true'
require_json_field "$health_file" '"service": "browser-worker"' 'Expected health.service to be browser-worker'
require_json_field "$health_file" '"status": "healthy"' 'Expected health.status to be healthy'

echo "Submitting capturePage smoke job..."
curl -fsS \
  -X POST "$BASE_URL/v1/browser/jobs" \
  -H 'content-type: application/json' \
  -d '{"url":"https://example.com","action":"capturePage"}' \
  > "$job_file"

require_json_field "$job_file" '"ok": true' 'Expected capturePage smoke job to complete'
require_json_field "$job_file" '"status": "completed"' 'Expected completed job status'
require_json_field "$job_file" '"action": "capturePage"' 'Expected capturePage action in response'
require_json_field "$job_file" '"sessionMode": "isolated"' 'Expected isolated session mode'
require_json_field "$job_file" '"requestedUrl": "https://example.com"' 'Expected requested URL to match smoke target'
require_json_field "$job_file" '"finalUrl": "https://example.com/"' 'Expected final URL to be https://example.com/'
require_json_field "$job_file" '"httpStatus": 200' 'Expected HTTP 200 from smoke target'

job_id="$(extract_json_string "$job_file" 'jobId')"
artifact_directory="$(extract_artifact_string "$job_file" 'directory')"
request_artifact="$(extract_artifact_string "$job_file" 'request')"
response_artifact="$(extract_artifact_string "$job_file" 'response')"
screenshot_artifact="$(extract_artifact_string "$job_file" 'screenshot')"
html_artifact="$(extract_artifact_string "$job_file" 'html')"
text_artifact="$(extract_artifact_string "$job_file" 'text')"

[ -n "$job_id" ] || fail 'Expected jobId in capture response'
[[ "$artifact_directory" == jobs/job-* ]] || fail "Expected job artifact directory, got: $artifact_directory"
[ "$request_artifact" = "$artifact_directory/request.json" ] || fail 'Expected request.json under job artifact directory'
[ "$response_artifact" = "$artifact_directory/response.json" ] || fail 'Expected response.json under job artifact directory'

require_artifact_file "$request_artifact" 'request'
require_artifact_file "$response_artifact" 'response'
require_artifact_file "$screenshot_artifact" 'screenshot'
require_artifact_file "$html_artifact" 'HTML'
require_artifact_file "$text_artifact" 'text'

[ -d "$ARTIFACT_ROOT/$artifact_directory/downloads" ] || fail "Expected downloads directory: $ARTIFACT_ROOT/$artifact_directory/downloads"
grep -Fq "\"jobId\": \"$job_id\"" "$ARTIFACT_ROOT/$response_artifact" || fail 'Expected persisted response jobId to match returned response'
grep -Fq '"ok": true' "$ARTIFACT_ROOT/$response_artifact" || fail 'Expected persisted response to be successful'

echo "Verified Docker capture artifacts under $ARTIFACT_ROOT/$artifact_directory"
echo "Docker runtime verification passed."
