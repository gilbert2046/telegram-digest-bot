#!/usr/bin/env bash
set -euo pipefail

BASE_DIR="$(cd "$(dirname "$0")/.." && pwd)"
LOG_FILE="$BASE_DIR/auto-update.log"

echo "=== Auto update: $(date) ===" | tee -a "$LOG_FILE"

cd "$BASE_DIR"

# Pull latest code
if git pull --rebase >> "$LOG_FILE" 2>&1; then
  echo "git pull OK" | tee -a "$LOG_FILE"
else
  echo "git pull FAILED" | tee -a "$LOG_FILE"
  exit 1
fi

# Install deps if package-lock changed
if git diff --name-only HEAD@{1} HEAD | grep -q "package-lock.json"; then
  echo "package-lock.json changed, running npm install" | tee -a "$LOG_FILE"
  npm install >> "$LOG_FILE" 2>&1
fi

# Restart bot processes to pick up changes
pm2 restart telegram-bot --update-env >> "$LOG_FILE" 2>&1 || true
pm2 restart daily-digest-10 --update-env >> "$LOG_FILE" 2>&1 || true
pm2 restart daily-digest-14 --update-env >> "$LOG_FILE" 2>&1 || true
pm2 restart daily-digest-19 --update-env >> "$LOG_FILE" 2>&1 || true

echo "auto-update done" | tee -a "$LOG_FILE"
