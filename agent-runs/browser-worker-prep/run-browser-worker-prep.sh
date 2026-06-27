#!/usr/bin/env bash
set -Eeuo pipefail
BASE=/DATA/browser-stack
RUN_DIR="$BASE/agent-runs/browser-worker-prep"
LOG_DIR="$RUN_DIR/logs"
mkdir -p "$LOG_DIR"
LOG="$LOG_DIR/run-$(date -u +%Y%m%dT%H%M%SZ).log"
exec > >(tee -a "$LOG") 2>&1
MARKER='# browser-worker-prep-one-shot'
echo "[$(date -Is)] browser-worker prep started"
# one-shot guard: remove system cron.d entry if present; ignore if unavailable
rm -f /etc/cron.d/browser-worker-prep-one-shot 2>/dev/null || true
if command -v crontab >/dev/null 2>&1; then
  crontab -l 2>/dev/null | grep -vF "$MARKER" | crontab - || true
fi
if [ -f "$RUN_DIR/.ran" ]; then
  echo "Guard present at $RUN_DIR/.ran; exiting without repeat."
  exit 0
fi
date -Is > "$RUN_DIR/.ran"
{
  echo "Project files present:"
  find "$BASE" -maxdepth 2 -type f | sort
  echo
  echo "Runtime files intentionally not modified by prep job."
} > "$LOG_DIR/project-scan.txt"
echo "[$(date -Is)] browser-worker prep completed"
