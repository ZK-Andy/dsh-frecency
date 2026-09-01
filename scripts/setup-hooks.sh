#!/usr/bin/env bash
# 安装 git hooks：core.hooksPath 指向 .githooks/
set -euo pipefail
cd "$(dirname "$0")/.."
git config core.hooksPath .githooks
echo "git hooks 已指向 .githooks (core.hooksPath=.githooks)"
