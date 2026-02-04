#!/usr/bin/env bash
set -euo pipefail

BASE_DIR="$(cd "$(dirname "$0")/.." && pwd)"
TMP_DIR="$BASE_DIR/tmp"

echo "=== Cleanup tmp: $(date) ==="
echo "Target: $TMP_DIR"

if [ ! -d "$TMP_DIR" ]; then
  echo "No tmp dir, nothing to clean."
  exit 0
fi

# 删除 7 天前的文件（更安全）
find "$TMP_DIR" -type f -mtime +7 -print -delete

# 顺便清掉空目录（可选）
find "$TMP_DIR" -type d -empty -print -delete

echo "Done."
