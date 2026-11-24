#!/bin/bash
# 用受控命令输出验证真实启动入口，在构建及服务启停前结束。
set -euo pipefail
ROOT="$(cd -- "$(dirname -- "$0")/.." && pwd -P)"

node() {
  [ "$1" = --version ] || { echo UNEXPECTED_NODE_CALL; return 91; }
  printf '%s\n' "$SES_TEST_NODE_VERSION"
}
pnpm() {
  if [ "$1" = --version ]; then
    printf '%s\n' "$SES_TEST_PNPM_VERSION"
    return
  fi
  [ "${SES_TEST_INSTALL:-0}" = 1 ] && [ "$1" = install ] && [ "$2" = --frozen-lockfile ] || {
    echo UNEXPECTED_PNPM_CALL; return 92;
  }
  if [ -n "$SES_TEST_EXPECTED_STORE" ]; then
    [ "$#" = 4 ] && [ "$3" = --store-dir ] && [ "$4" = "$SES_TEST_EXPECTED_STORE" ] || {
      echo UNEXPECTED_PNPM_STORE; return 92;
    }
  else
    [ "$#" = 2 ] || { echo UNEXPECTED_PNPM_STORE; return 92; }
  fi
  [ "${PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD:-}" = 1 ] || { echo UNEXPECTED_BROWSER_DOWNLOAD; return 92; }
  echo PNPM_INSTALL_SKIP_BROWSER
  return 93
}
lsof() { [ "${SES_TEST_INSTALL:-0}" = 1 ] || printf '789999\n'; }
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

fixture="$(mktemp -d)"
trap 'rm -rf "$fixture"' EXIT
mkdir -p "$fixture/scripts" "$fixture/node_modules"
cp "$ROOT/scripts/ses-local.sh" "$fixture/scripts/"

check_install() {
  local output status=0
  output="$(SES_TEST_INSTALL=1 SES_TEST_EXPECTED_STORE="$1" PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=0 \
    SES_TEST_NODE_VERSION=v22.22.0 SES_TEST_PNPM_VERSION=10.33.0 \
    /bin/bash "$fixture/scripts/ses-local.sh" start 2>&1)" || status=$?
  if [ "$status" != 93 ] || [[ "$output" != *PNPM_INSTALL_SKIP_BROWSER* ]]; then
    printf 'FAIL: pnpm install exit=%s\n%s\n' "$status" "$output"
    return 1
  fi
  printf 'PASS: pnpm install skips Playwright browser download (store: %s)\n' "${1:-default}"
}

check_install ''
store="$fixture/existing store/v10"
printf '  "storeDir": "%s",\n' "$store" > "$fixture/node_modules/.modules.yaml"
check_install "$store"
