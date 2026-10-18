#!/bin/bash
# 用受控命令输出验证真实启动入口；端口探针阻止构建及服务启停。
set -euo pipefail
ROOT="$(cd -- "$(dirname -- "$0")/.." && pwd -P)"

node() {
  [ "$1" = --version ] || { echo UNEXPECTED_NODE_CALL; return 91; }
  printf '%s\n' "$SES_TEST_NODE_VERSION"
}
pnpm() {
  [ "$1" = --version ] || { echo UNEXPECTED_PNPM_CALL; return 92; }
  printf '%s\n' "$SES_TEST_PNPM_VERSION"
}
lsof() { printf '789999\n'; }
launchctl() { return 1; }
export -f node pnpm lsof launchctl

check() {
  local output status=0
  output="$(SES_TEST_NODE_VERSION="$1" SES_TEST_PNPM_VERSION="$2" \
    /bin/bash "$ROOT/scripts/ses-local.sh" start 2>&1)" || status=$?
  if [ "$status" = 0 ] || [[ "$output" != *"$3"* ]] ||
     [[ "$output" == *UNEXPECTED_* ]]; then
    printf 'FAIL: Node=%s pnpm=%s exit=%s\n%s\n' "$1" "$2" "$status" "$output"
    return 1
  fi
  printf 'PASS: Node=%s pnpm=%s -> %s\n' "$1" "$2" "$3"
}

check v18.20.8 10.33.0 'Node.js 版本不符合要求'
check v20.18.9 10.33.0 'Node.js 版本不符合要求'
check v20.19.0 8.15.9 'pnpm 版本不符合要求'
check v22.22.3 8.99.0 'pnpm 版本不符合要求'
check v20.19.0 9.0.0 '端口 3000 被其他进程'
check v20.19.1 9.1.0 '端口 3000 被其他进程'
check v20.20.0 10.0.0 '端口 3000 被其他进程'
check v22.0.0 10.33.0 '端口 3000 被其他进程'
check invalid 10.33.0 'Node.js 版本不符合要求'
check v22.22.3 invalid 'pnpm 版本不符合要求'
