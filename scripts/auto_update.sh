#!/usr/bin/env bash
set -euo pipefail

BASE_DIR="$(cd "$(dirname "$0")/.." && pwd)"
LOG_FILE="$BASE_DIR/auto-update.log"

# Ensure Node/npm/pm2 are available in non-interactive shells (PM2 cron)
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
if [ -s "$NVM_DIR/nvm.sh" ]; then
  # shellcheck disable=SC1090
  . "$NVM_DIR/nvm.sh"
  nvm use 20 >/dev/null 2>&1 || true
fi

PM2_BIN="$(command -v pm2 || true)"
if [ -z "$PM2_BIN" ] && [ -x "$NVM_DIR/versions/node/v20.20.0/bin/pm2" ]; then
  PM2_BIN="$NVM_DIR/versions/node/v20.20.0/bin/pm2"
fi
if [ -z "$PM2_BIN" ]; then
  echo "pm2 not found in PATH" | tee -a "$LOG_FILE"
  exit 1
fi

echo "=== Auto update: $(date) ===" | tee -a "$LOG_FILE"

cd "$BASE_DIR"

# If there are tracked local changes, stash them (do NOT include untracked like .env)
STASHED="0"
if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "Dirty tree: stashing tracked changes" | tee -a "$LOG_FILE"
  git stash push -m "auto-update" >> "$LOG_FILE" 2>&1 || true
  STASHED="1"
fi

# Pull latest code
if git pull --rebase >> "$LOG_FILE" 2>&1; then
  echo "git pull OK" | tee -a "$LOG_FILE"
else
  echo "git pull FAILED" | tee -a "$LOG_FILE"
  exit 1
fi

# Drop stashed tracked changes to keep server clean
if [ "$STASHED" = "1" ]; then
  git stash drop >> "$LOG_FILE" 2>&1 || true
fi

# Install deps if package-lock changed
if git diff --name-only HEAD@{1} HEAD | grep -q "package-lock.json"; then
  echo "package-lock.json changed, running npm install" | tee -a "$LOG_FILE"
  npm ci >> "$LOG_FILE" 2>&1
fi

# Restart bot processes to pick up changes
"$PM2_BIN" restart telegram-bot --update-env >> "$LOG_FILE" 2>&1 || true
"$PM2_BIN" restart daily-digest-10 --update-env >> "$LOG_FILE" 2>&1 || true
"$PM2_BIN" restart daily-digest-14 --update-env >> "$LOG_FILE" 2>&1 || true
"$PM2_BIN" restart daily-digest-19 --update-env >> "$LOG_FILE" 2>&1 || true

echo "auto-update done" | tee -a "$LOG_FILE"
