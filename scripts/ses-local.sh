#!/bin/bash
# macOS 启动/退出入口共用逻辑。后台进程不依赖 Terminal 窗口。
set -euo pipefail
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
ROOT="$(cd -- "$(dirname -- "$0")/.." && pwd -P)"
RUN="$ROOT/.ses-run"
LABEL="local.ses.$(printf '%s' "$ROOT" | shasum | cut -c1-12)"
cd "$ROOT"

listener() {
  lsof -nP -t -iTCP:"$1" -sTCP:LISTEN 2>/dev/null | sort -u || true
}

owned() {
  local details job_pid
  job_pid="$(launchctl list "$LABEL.$2" 2>/dev/null | sed -nE 's/^[[:space:]]*"PID" = ([0-9]+);$/\1/p')" || return 1
  [ "$job_pid" = "$1" ] || return 1
  details="$(lsof -a -p "$1" -d cwd -Fcn 2>/dev/null)" || return 1
  [[ "$details" == *$'\ncnode\n'* && "$details" == *$'\nn'"$ROOT/packages/$2" ]]
}

check_port() {
  local pid
  for pid in $(listener "$1"); do
    if ! owned "$pid" "$2"; then
      echo "端口 $1 被其他进程（PID ${pid}）占用，请先释放端口。"
      echo "如已通过 pnpm dev 启动 SES，请先在原终端按 Ctrl+C，再运行本脚本。"
      return 1
    fi
  done
}

wait_ready() {
  local count
  for count in {1..60}; do
    if curl --fail --silent --max-time 2 "$2" >/dev/null; then
      return 0
    fi
    launchctl list "$1" >/dev/null 2>&1 || break
    sleep 1
  done
  echo "服务启动失败，日志：$3"
  tail -n 25 "$3"
  return 1
}

start() {
  command -v node >/dev/null || { echo "请先安装 Node.js（>=20.19.0）。"; return 1; }
  command -v pnpm >/dev/null || { echo "请先安装 pnpm（>=9）。"; return 1; }
  check_port 3000 server
  check_port 5173 client
  mkdir -p "$RUN"
  if ! mkdir "$RUN/start.lock" 2>/dev/null; then
    echo "另一次启动尚未结束。如上次被强制中断，可删除 $RUN/start.lock 后重试。"
    return 1
  fi
  server_job=""
  client_job=""
  success=0
  # 失败时只回收本次新启动的进程，保留原来已经运行的服务。
  trap 'if [ "$success" != 1 ]; then
    for job in "$server_job" "$client_job"; do
      [ -z "$job" ] || launchctl remove "$job" 2>/dev/null || true
    done
  fi
  rmdir "$RUN/start.lock" 2>/dev/null || true' EXIT

  if ! cmp -s pnpm-lock.yaml node_modules/.pnpm/lock.yaml ||
     [ ! -e packages/server/node_modules/@modelcontextprotocol/sdk/package.json ] ||
     [ ! -e packages/io/node_modules/typescript/package.json ]; then
    echo "正在按锁文件补齐依赖……"
    local store=""
    if [ -f node_modules/.modules.yaml ]; then
      store="$(sed -nE 's/^[[:space:]]*"?storeDir"?:[[:space:]]*"?([^",]+)"?,?$/\1/p' node_modules/.modules.yaml)"
    fi
    if [ -n "$store" ]; then
      pnpm install --frozen-lockfile --store-dir "$store"
    else
      pnpm install --frozen-lockfile
    fi
  fi

  if [ -z "$(listener 3000)" ]; then
    echo "正在构建 SES……"
    pnpm build
    # 启动会同步数据库表结构，因此在启动前保存 SQLite 一致性备份。
    if [ -f packages/server/data/ses.db ]; then
      node <<'JS'
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const Database = createRequire(path.resolve('packages/server/package.json'))('better-sqlite3');
const dir = 'output/startup-backups';
fs.mkdirSync(dir, { recursive: true });
const target = path.resolve(dir, `ses-before-start-${new Date().toISOString().replace(/[:.]/g, '-')}.db`);
const db = new Database('packages/server/data/ses.db', { readonly: true });
db.backup(target).then(() => {
  db.close(); console.log(`数据库已备份：${target}`);
}).catch(error => { db.close(); console.error(error); process.exitCode = 1; });
JS
    fi
    echo "正在启动后端……"
    server_job="$LABEL.server"
    launchctl remove "$server_job" 2>/dev/null || true
    launchctl submit -l "$server_job" -o "$RUN/server.log" -e "$RUN/server.log" -- \
      /usr/bin/env "PATH=$PATH" /bin/bash -c 'cd "$1" && exec env PORT=3000 SES_LISTEN_HOST=127.0.0.1 "$2" dist/main.js' \
      ses-server "$ROOT/packages/server" "$(command -v node)"
    wait_ready "$server_job" http://127.0.0.1:3000/api/documents "$RUN/server.log"
  fi
  if [ -z "$(listener 5173)" ]; then
    echo "正在启动前端……"
    client_job="$LABEL.client"
    launchctl remove "$client_job" 2>/dev/null || true
    launchctl submit -l "$client_job" -o "$RUN/client.log" -e "$RUN/client.log" -- \
      /usr/bin/env "PATH=$PATH" /bin/bash -c 'cd "$1" && exec "$2" node_modules/vite/bin/vite.js --port 5173 --strictPort' \
      ses-client "$ROOT/packages/client" "$(command -v node)"
    wait_ready "$client_job" http://localhost:5173/ "$RUN/client.log"
  fi
  curl --fail --silent --max-time 5 http://localhost:5173/api/documents >/dev/null
  success=1
  echo "SES 已启动：http://localhost:5173/"
  echo "日志目录：$RUN"
  if [ "${SES_NO_OPEN:-0}" != 1 ]; then
    open http://localhost:5173/ || true
  fi
}

stop() {
  if [ -d "$RUN/start.lock" ]; then
    echo "SES 正在启动，请等待启动完成后再退出。"
    return 1
  fi
  local port package pid count failed=0
  for port in 5173 3000; do
    if [ "$port" = 5173 ]; then package=client; else package=server; fi
    for pid in $(listener "$port"); do
      if owned "$pid" "$package"; then
        echo "正在停止 ${package}（PID ${pid}）……"
        kill -TERM "$pid"
        for count in {1..30}; do
          owned "$pid" "$package" || break
          sleep 0.2
        done
        if owned "$pid" "$package"; then
          echo "进程 $pid 尚未退出，请检查。"
          failed=1
        fi
      else
        echo "跳过端口 $port 的其他进程（PID ${pid}）。"
      fi
    done
  done
  launchctl remove "$LABEL.client" 2>/dev/null || true
  launchctl remove "$LABEL.server" 2>/dev/null || true
  [ "$failed" = 0 ] || return 1
  echo "本脚本管理的 SES 已退出，文档数据保留。"
}

case "${1:-}" in
  start) start ;;
  stop) stop ;;
  *) echo "用法：$0 start|stop"; exit 1 ;;
esac
