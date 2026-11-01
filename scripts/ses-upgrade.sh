#!/bin/bash
# macOS 升级执行器（薄壳）。由 SES 服务端复制到 .ses-update/ 后以分离进程运行：
#   /bin/bash <root>/.ses-update/ses-upgrade.sh <root>
# 读取 .ses-update/plan.json，依次：停止服务 -> 备份数据库 -> 解压 -> 替换文件 -> 启动新版。
# 任一步失败：回滚文件、恢复数据库、重新启动旧版，并把结果写入 .ses-run/upgrade-status.json。
# 文件逻辑全部在 apply-update.cjs；兼容 bash 3.2。不使用 set -e：每一步的失败都要走恢复流程。
set -u

if [ $# -lt 1 ] || [ ! -d "$1" ]; then
  echo "用法：$0 <SES 根目录>" >&2
  exit 2
fi
ROOT="$(cd -- "$1" && pwd -P)"

# 执行器与 stop 本应已由服务端以独立会话拉起（launchctl remove 不会连带结束）。
# 如果发现仍和父进程在同一进程组，就用 job control 让真正的工作进程自成一组；
# 父进程只负责等待并转发退出码，即使它被连带结束，工作进程也会继续。
if [ -z "${SES_UPGRADE_DETACHED:-}" ]; then
  own_group="$(ps -o pgid= -p $$ 2>/dev/null | tr -d ' ')"
  parent_group="$(ps -o pgid= -p "$PPID" 2>/dev/null | tr -d ' ')"
  if [ -n "$own_group" ] && [ "$own_group" = "$parent_group" ]; then
    set -m
    SES_UPGRADE_DETACHED=1 nohup /bin/bash "$0" "$@" </dev/null &
    child=$!
    set +m
    wait "$child"
    exit $?
  fi
fi
trap '' HUP PIPE

UPD="$ROOT/.ses-update"
RUN="$ROOT/.ses-run"
PLAN="$UPD/plan.json"
APPLY="$UPD/apply-update.cjs"
STATUS_FILE="$RUN/upgrade-status.json"
export SES_UPGRADE_ROOT="$ROOT"

log() { printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"; }

# 无论怎样结束都释放服务端创建的升级锁。
cleanup() { rm -f "$UPD/apply-update.next.cjs"; rm -rf "$UPD/lock"; }
trap cleanup EXIT

mkdir -p "$RUN"

# plan.node 是服务端写入的 node 绝对路径。此时还不能用 node 解析 JSON，只能用 sed 取这一个字符串字段。
resolve_node() {
  local value=""
  if [ -n "${SES_UPGRADE_NODE:-}" ]; then
    printf '%s' "$SES_UPGRADE_NODE"
    return
  fi
  if [ -f "$PLAN" ]; then
    value="$(sed -nE 's/.*"node"[[:space:]]*:[[:space:]]*"(([^"\\]|\\.)*)".*/\1/p' "$PLAN" | head -n 1 | sed -e 's/\\\\/\\/g' -e 's/\\"/"/g' -e 's|\\/|/|g')"
  fi
  if [ -z "$value" ] || [ ! -x "$value" ]; then
    value="$(command -v node 2>/dev/null || true)"
  fi
  printf '%s' "$value"
}

NODE="$(resolve_node)"

# node 不可用时手写一份最小状态文件（消息只含固定文字，无需转义）。
write_status() {
  local state="$1" step="$2" message="${3:-}"
  if [ -n "$NODE" ] && [ -f "$APPLY" ]; then
    if [ -n "$message" ]; then
      "$NODE" "$APPLY" status --root "$ROOT" --state "$state" --step "$step" --message "$message" --plan "$PLAN" && return 0
    else
      "$NODE" "$APPLY" status --root "$ROOT" --state "$state" --step "$step" --plan "$PLAN" && return 0
    fi
  fi
  printf '{"state":"%s","step":"%s","from":null,"to":null,"message":"%s","log":".ses-run/upgrade.log","updatedAt":"%s"}\n' \
    "$state" "$step" "$(printf '%s' "$message" | tr -d '"\\' | tr '\n' ' ')" "$(date -u '+%Y-%m-%dT%H:%M:%S.000Z')" > "$STATUS_FILE"
}

apply_cmd() { "$NODE" "$APPLY" "$@"; }

# apply / rollback 优先使用升级包里新版本的 apply-update.cjs（旧版本的文件清单可能已经过时）；
# status、backup-db、restore-db、finalize、plan-get 仍用当前版本的副本。
# 两者的子命令与参数是跨版本契约（见 apply-update.cjs 顶部注释）。
APPLIER=""
applier_cmd() { "$NODE" "${APPLIER:-$APPLY}" "$@"; }

choose_applier() {
  local entry top="" count=0 next="$UPD/apply-update.next.cjs"
  APPLIER=""
  rm -f "$next"
  for entry in "$STAGING"/*; do
    [ -d "$entry" ] || continue
    [ "$(basename "$entry")" = "__MACOSX" ] && continue
    top="$entry"
    count=$((count + 1))
  done
  if [ "$count" = 1 ] && [ -f "$top/scripts/apply-update.cjs" ]; then
    if cp "$top/scripts/apply-update.cjs" "$next" && "$NODE" --check "$next"; then
      APPLIER="$next"
      log "使用升级包中的新版 apply-update.cjs。"
      return 0
    fi
    log "升级包中的 apply-update.cjs 无法使用，回退到当前版本。"
    rm -f "$next"
  else
    log "升级包中没有 apply-update.cjs，使用当前版本。"
  fi
}

run_stop() {
  if [ -n "${SES_UPGRADE_STOP_CMD:-}" ]; then
    /bin/bash -c "$SES_UPGRADE_STOP_CMD"
  else
    /bin/bash "$ROOT/scripts/ses-local.sh" stop
  fi
}

run_start() {
  if [ -n "${SES_UPGRADE_START_CMD:-}" ]; then
    /bin/bash -c "$SES_UPGRADE_START_CMD"
  else
    SES_NO_OPEN=1 SES_NO_PAUSE=1 /bin/bash "$ROOT/scripts/ses-local.sh" start
  fi
}

extract_zip() {
  local zip="$1" target="$2"
  rm -rf "$target"
  mkdir -p "$target" || return 1
  if command -v ditto >/dev/null 2>&1; then
    ditto -x -k "$zip" "$target"
  else
    # 仅测试环境（Linux）没有 ditto。
    unzip -q -o "$zip" -d "$target"
  fi
}

BACKED_UP=0
APPLIED=0
STARTED_NEW=0

# 失败恢复：回滚文件 -> 停止可能残留的新版进程 -> 恢复数据库 -> 启动旧版。
recover() {
  local reason="$1" rollback_ok=1 stop_ok=1
  log "升级失败：$reason"
  log "开始恢复到升级前的状态……"
  write_status running rolling-back "$reason"
  if [ "$APPLIED" = 1 ]; then
    log "回滚程序文件……"
    if ! applier_cmd rollback --root "$ROOT"; then
      rollback_ok=0
      log "回滚程序文件失败，请查看 $UPD/rollback。"
    fi
  fi
  # 新版可能已部分启动；此时旧版脚本已经恢复，由它负责停止。
  log "确认服务已停止……"
  if ! run_stop; then
    stop_ok=0
    log "停止服务失败，为避免损坏数据库，不会覆盖数据库文件。"
  fi
  if [ "$BACKED_UP" = 1 ]; then
    if [ "$stop_ok" = 1 ]; then
      log "恢复数据库……"
      if ! apply_cmd restore-db --root "$ROOT"; then
        rollback_ok=0
        log "恢复数据库失败，备份保留在 $UPD/db-backup。"
      fi
    elif [ "$STARTED_NEW" = 1 ]; then
      # 新版本可能已经改过数据库，且无法确认进程已退出：不能覆盖正在使用的数据库文件。
      rollback_ok=0
    fi
  fi
  if [ "$rollback_ok" = 1 ]; then
    log "启动升级前的版本……"
    if run_start; then
      write_status rolled-back done "升级失败，已恢复到原版本：$reason"
      log "已恢复到原版本。"
      # 数据库与程序均已还原，收尾并保留升级前备份。
      apply_cmd finalize --root "$ROOT" --plan "$PLAN" || true
      exit 1
    fi
    write_status failed rolling-back "升级失败（${reason}），且原版本未能重新启动，请手动运行启动脚本，日志见 .ses-run/upgrade.log"
    log "原版本启动失败。"
    exit 1
  fi
  write_status failed rolling-back "升级失败（${reason}），且未能完整恢复，请手动检查 .ses-update 目录并运行启动脚本"
  log "恢复未完成，需要手动处理。"
  exit 1
}

log "SES 升级开始（根目录：${ROOT}）"
if [ -z "$NODE" ] || [ ! -x "$NODE" ]; then
  write_status failed stopping "找不到 Node.js，无法执行升级"
  log "找不到 Node.js。"
  exit 1
fi
if [ ! -f "$APPLY" ] || [ ! -f "$PLAN" ]; then
  write_status failed stopping "升级文件不完整（缺少 plan.json 或 apply-update.cjs）"
  log "缺少 plan.json 或 apply-update.cjs。"
  exit 1
fi
ZIP="$(apply_cmd plan-get --plan "$PLAN" --key zip)"
[ -n "$ZIP" ] || ZIP="$UPD/download.zip"
STAGING="$UPD/staging"

write_status running stopping
log "[1/5] 停止 SES 服务……"
run_stop || recover "停止服务失败"

write_status running backing-up
log "[2/5] 备份数据库……"
BACKED_UP=1
apply_cmd backup-db --root "$ROOT" || { BACKED_UP=0; recover "备份数据库失败"; }

write_status running extracting
log "[3/5] 解压升级包：$ZIP"
[ -f "$ZIP" ] || recover "找不到升级包 $ZIP"
extract_zip "$ZIP" "$STAGING" || recover "解压升级包失败"

write_status running applying
log "[4/5] 替换程序文件……"
choose_applier
APPLIED=1
applier_cmd apply --root "$ROOT" --staging "$STAGING" --plan "$PLAN" || recover "替换程序文件失败"

write_status running starting
log "[5/5] 启动新版本……"
STARTED_NEW=1
run_start || recover "新版本启动失败"

apply_cmd finalize --root "$ROOT" --plan "$PLAN" || log "收尾清理失败（不影响升级结果）。"
write_status succeeded done
log "升级完成。"
exit 0
