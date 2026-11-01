#!/bin/bash
# 升级执行器（ses-upgrade.sh + apply-update.cjs）的端到端测试，Linux / macOS 均可运行。
# stop/start 用桩命令替代（SES_UPGRADE_STOP_CMD / SES_UPGRADE_START_CMD），不会启动真实服务。
set -u
SRC="$(cd -- "$(dirname -- "$0")/.." && pwd -P)"
NODE_BIN="$(command -v node)" || { echo "需要 node"; exit 1; }
TMP="$(mktemp -d "${TMPDIR:-/tmp}/ses-upgrade-test.XXXXXX")"
trap 'rm -rf "$TMP"' EXIT
failures=0

fail() { printf 'FAIL: %s\n' "$*"; failures=$((failures + 1)); }
pass() { printf 'PASS: %s\n' "$*"; }
check() { # check <描述> <命令...>
  local label="$1"; shift
  if "$@" >/dev/null 2>&1; then pass "$label"; else fail "$label"; fi
}
json_get() { "$NODE_BIN" -e 'const v=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"))[process.argv[2]];process.stdout.write(v==null?"":String(v))' "$1" "$2"; }
contents() { cat "$1" 2>/dev/null || true; }

# 构造新版本发布包（9.9.9-preview）：只包含升级需要识别的最少文件。
make_zip() {
  python3 - "$1" <<'PY'
import json, sys, zipfile
with zipfile.ZipFile(sys.argv[1], 'w') as z:
    top = 'SES-9.9.9-preview-macos/'
    z.writestr(top + 'ses-build.json', json.dumps({'version': '9.9.9-preview', 'channel': 'stable', 'commit': None, 'builtAt': '2026-11-01T00:00:00.000Z'}))
    z.writestr(top + 'scripts/ses-local.sh', '#!/bin/bash\necho new launcher\n')
    z.writestr(top + 'packages/server/src/main.ts', 'new')
    z.writestr(top + '使用说明.md', '# new')
PY
}

# 构造“已安装的旧版本”，并复制升级执行器到 .ses-update（与服务端的做法一致）。
make_install() {
  local root="$1"
  mkdir -p "$root/packages/server/data" "$root/packages/server/src" "$root/scripts" "$root/.ses-update" "$root/.ses-run" "$root/output"
  printf 'old' > "$root/packages/server/src/main.ts"
  printf 'stale' > "$root/packages/server/src/stale.ts"
  printf '#!/bin/bash\necho old launcher\n' > "$root/scripts/ses-local.sh"
  printf 'SECRET=1' > "$root/.env"
  printf 'the user documents' > "$root/packages/server/data/ses.db"
  printf '{"version":"0.1.1-preview","channel":"stable","commit":null,"builtAt":"x"}' > "$root/ses-build.json"
  cp "$SRC/scripts/apply-update.cjs" "$SRC/scripts/ses-upgrade.sh" "$root/.ses-update/"
  make_zip "$root/.ses-update/download.zip"
  printf '{"zip":"%s","channel":"stable","targetVersion":"9.9.9-preview","targetCommit":null,"fromVersion":"0.1.1-preview","fromCommit":null,"node":"%s","platform":"macos","requestedAt":"2026-11-01T00:00:00.000Z"}\n' \
    "$root/.ses-update/download.zip" "$NODE_BIN" > "$root/.ses-update/plan.json"
  mkdir "$root/.ses-update/lock"
}

# run_case <名称> <STOP 桩> <START 桩> [环境变量...]；在 $ROOT 中运行，退出码存入 $rc
run_case() {
  local name="$1" stop="$2" start="$3"
  shift 3
  ROOT="$TMP/$name/SES 中文 [升级]"
  make_install "$ROOT"
  [ -z "${PRE_HOOK:-}" ] || eval "$PRE_HOOK"
  cp -R "$ROOT" "$TMP/$name-before"
  rc=0
  env SES_UPGRADE_STOP_CMD="$stop" SES_UPGRADE_START_CMD="$start" "$@" \
    /bin/bash "$ROOT/.ses-update/ses-upgrade.sh" "$ROOT" > "$TMP/$name.out" 2>&1 || rc=$?
  STATUS="$ROOT/.ses-run/upgrade-status.json"
  CALLS="$ROOT/calls.log"
}

same_as_before() { diff -r -x .ses-update -x .ses-run -x output -x calls.log "$TMP/$1-before" "$ROOT" >/dev/null; }
status_is() { [ "$(json_get "$STATUS" state)" = "$1" ] && [ "$(json_get "$STATUS" step)" = "$2" ]; }
backup_dir_ok() { local f; for f in "$ROOT"/output/upgrade-backups/ses-before-upgrade-*/ses.db; do [ "$(contents "$f")" = "the user documents" ] && return 0; done; return 1; }

STOP_OK='echo stop >> "$SES_UPGRADE_ROOT/calls.log"'
START_RECORD='echo "start:$(cat "$SES_UPGRADE_ROOT/packages/server/src/main.ts")" >> "$SES_UPGRADE_ROOT/calls.log"'
# 新版本（main.ts 为 new）启动失败，并弄坏数据库；旧版本正常启动。
START_NEW_FAILS='if [ "$(cat "$SES_UPGRADE_ROOT/packages/server/src/main.ts")" = new ]; then echo start-new-failed >> "$SES_UPGRADE_ROOT/calls.log"; echo corrupted > "$SES_UPGRADE_ROOT/packages/server/data/ses.db"; echo broken > "$SES_UPGRADE_ROOT/packages/server/data/ses.db-wal"; exit 1; else echo start-old >> "$SES_UPGRADE_ROOT/calls.log"; fi'

echo "== 成功路径 =="
run_case ok "$STOP_OK" "$START_RECORD"
[ "$rc" = 0 ] && pass "退出码为 0" || { fail "退出码 $rc"; cat "$TMP/ok.out"; }
check "状态 succeeded/done" status_is succeeded done
check "状态文件含版本" test "$(json_get "$STATUS" from)" = "0.1.1-preview" -a "$(json_get "$STATUS" to)" = "9.9.9-preview"
check "ses-build.json 为新版本" test "$(json_get "$ROOT/ses-build.json" version)" = "9.9.9-preview"
check "程序文件已替换且残留被清除" test "$(contents "$ROOT/packages/server/src/main.ts")" = new -a ! -e "$ROOT/packages/server/src/stale.ts"
check "数据库与 .env 保持不变" test "$(contents "$ROOT/packages/server/data/ses.db")" = "the user documents" -a "$(contents "$ROOT/.env")" = "SECRET=1"
check "升级前数据库备份已归档" backup_dir_ok
check "升级锁已删除" test ! -e "$ROOT/.ses-update/lock"
check "staging 与 rollback 已清理" test ! -e "$ROOT/.ses-update/staging" -a ! -e "$ROOT/.ses-update/rollback" -a ! -e "$ROOT/.ses-update/download.zip"
check "stop 与新版 start 各调用一次" test "$(contents "$CALLS")" = "$(printf 'stop\nstart:new')"
check "日志带时间戳" grep -Eq '^\[[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9:]{8}\] 升级完成' "$TMP/ok.out"

echo "== 新版本启动失败：回滚并启动旧版 =="
run_case start_fail "$STOP_OK" "$START_NEW_FAILS" SES_UPGRADE_DETACHED=1
[ "$rc" != 0 ] && pass "退出码非 0" || fail "退出码应非 0"
check "状态 rolled-back/done" status_is rolled-back done
check "message 写明失败原因" grep -q '新版本启动失败' "$STATUS"
check "程序文件还原且与升级前一致" same_as_before start_fail
check "ses-build.json 仍为旧版本" test "$(json_get "$ROOT/ses-build.json" version)" = "0.1.1-preview"
check "数据库恢复为升级前内容，新版本产生的 wal 被删除" test "$(contents "$ROOT/packages/server/data/ses.db")" = "the user documents" -a ! -e "$ROOT/packages/server/data/ses.db-wal"
check "调用顺序：stop、新版 start 失败、stop、旧版 start" test "$(contents "$CALLS")" = "$(printf 'stop\nstart-new-failed\nstop\nstart-old')"
check "升级锁已删除" test ! -e "$ROOT/.ses-update/lock"
check "数据库备份已归档" backup_dir_ok

echo "== 旧版也无法启动：failed =="
run_case both_fail "$STOP_OK" 'echo start >> "$SES_UPGRADE_ROOT/calls.log"; exit 1' SES_UPGRADE_DETACHED=1
[ "$rc" != 0 ] && pass "退出码非 0" || fail "退出码应非 0"
check "状态 failed" test "$(json_get "$STATUS" state)" = failed
check "message 写明原因" grep -q '未能重新启动' "$STATUS"
check "程序文件已回滚" same_as_before both_fail
check "升级锁已删除" test ! -e "$ROOT/.ses-update/lock"

echo "== 替换到一半失败：回滚 =="
run_case apply_fail "$STOP_OK" "$START_RECORD" SES_APPLY_TEST_FAIL_AFTER=2 SES_UPGRADE_DETACHED=1
[ "$rc" != 0 ] && pass "退出码非 0" || fail "退出码应非 0"
check "状态 rolled-back" status_is rolled-back done
check "程序文件与升级前一致" same_as_before apply_fail
check "只启动了旧版" test "$(contents "$CALLS")" = "$(printf 'stop\nstop\nstart:old')"
check "升级锁已删除" test ! -e "$ROOT/.ses-update/lock"

echo "== 升级包缺失 =="
PRE_HOOK='rm -f "$ROOT/.ses-update/download.zip"' run_case no_zip "$STOP_OK" "$START_RECORD" SES_UPGRADE_DETACHED=1
[ "$rc" != 0 ] && pass "退出码非 0" || fail "退出码应非 0"
check "状态 rolled-back 且数据库未变" test "$(json_get "$STATUS" state)" = rolled-back -a "$(contents "$ROOT/packages/server/data/ses.db")" = "the user documents"

echo "== 停止服务失败：不改动任何文件，仍尝试启动旧版 =="
run_case stop_fail 'echo stop >> "$SES_UPGRADE_ROOT/calls.log"; exit 1' "$START_RECORD" SES_UPGRADE_DETACHED=1
[ "$rc" != 0 ] && pass "退出码非 0" || fail "退出码应非 0"
check "状态 rolled-back" status_is rolled-back done
check "程序文件与升级前一致" same_as_before stop_fail
check "没有备份或覆盖数据库" test "$(contents "$ROOT/packages/server/data/ses.db")" = "the user documents" -a ! -e "$ROOT/output/upgrade-backups"
check "升级锁已删除" test ! -e "$ROOT/.ses-update/lock"

echo "== 默认路径（不设置 SES_UPGRADE_DETACHED）也能正常完成并转发退出码 =="
run_case reexec "$STOP_OK" 'exit 1'
[ "$rc" != 0 ] && pass "失败时退出码被转发" || fail "退出码应非 0"
check "状态为 failed（旧版 start 也失败）" test "$(json_get "$STATUS" state)" = failed

echo "== 语法检查 =="
for f in "$SRC"/scripts/*.sh "$SRC"/启动SES.command "$SRC"/退出SES.command; do
  check "bash -n $(basename "$f")" bash -n "$f"
done

if [ "$failures" != 0 ]; then
  printf '\n%s 项失败\n' "$failures"
  exit 1
fi
echo "全部通过"
