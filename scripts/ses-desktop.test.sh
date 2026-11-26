#!/bin/bash
# macOS 桌面集成脚本（scripts/ses-desktop.sh）测试，Linux / macOS 均可运行。
set -euo pipefail

SRC="$(cd -- "$(dirname -- "$0")/.." && pwd -P)"
TMP="$(cd -- "$(mktemp -d "${TMPDIR:-/tmp}/ses-desktop-test.XXXXXX")" && pwd -P)"
trap 'rm -rf "$TMP"' EXIT
unset SES_NO_SHORTCUT

ROOT="$TMP/SES [preview] 中文 路径"
DESKTOP="$TMP/Desktop"
APPS="$TMP/Applications"
AGENTS="$TMP/LaunchAgents"
mkdir -p "$ROOT/scripts" "$DESKTOP" "$APPS" "$AGENTS"
cp "$SRC/scripts/ses-desktop.sh" "$ROOT/scripts/ses-desktop.sh"
cp "$SRC/scripts/ses.icns" "$ROOT/scripts/ses.icns"
chmod +x "$ROOT/scripts/ses-desktop.sh"

run_desktop() {
  SES_DESKTOP_DIR="$DESKTOP" \
  SES_APPLICATIONS_DIR="$APPS" \
  SES_LAUNCH_AGENTS_DIR="$AGENTS" \
  SES_SKIP_LAUNCHCTL=1 \
  /bin/bash "$ROOT/scripts/ses-desktop.sh" "$@"
}

assert_eq() {
  local actual="$1" expected="$2" msg="$3"
  if [ "$actual" != "$expected" ]; then
    printf 'FAIL: %s\n  expected: %s\n  actual:   %s\n' "$msg" "$expected" "$actual" >&2
    exit 1
  fi
}

echo "== 1. 初始状态全为 false =="
out="$(run_desktop status)"
assert_eq "$out" '{"desktopShortcut":false,"startMenuShortcut":false,"autoStart":false}' "initial status"

echo "== 2. create-shortcuts 生成合法 SES.app bundle 与 marker =="
out="$(run_desktop create-shortcuts)"
python3 - "$out" "$ROOT" "$DESKTOP/SES.app" "$APPS/SES.app" <<'PY'
import json, sys
data = json.loads(sys.argv[1])
assert data['desktopShortcut'] is True
assert data['startMenuShortcut'] is True
assert data['desktopPath'] == sys.argv[3]
assert data['startMenuPath'] == sys.argv[4]
PY

for app_dir in "$DESKTOP/SES.app" "$APPS/SES.app"; do
  [ -f "$app_dir/Contents/Info.plist" ]
  [ -f "$app_dir/Contents/Resources/ses.icns" ]
  [ -f "$app_dir/Contents/Resources/ses-root.txt" ]
  [ -x "$app_dir/Contents/MacOS/ses-launch" ]
  assert_eq "$(cat "$app_dir/Contents/Resources/ses-root.txt")" "$ROOT" "ses-root.txt equals ROOT"
  grep -q '<string>local.ses.launcher</string>' "$app_dir/Contents/Info.plist"
  grep -q '<string>ses-launch</string>' "$app_dir/Contents/Info.plist"
done

[ -f "$ROOT/.ses-run/shortcuts-initialized.json" ]
python3 - "$ROOT/.ses-run/shortcuts-initialized.json" "$ROOT" <<'PY'
import json, sys
data = json.load(open(sys.argv[1], encoding='utf-8'))
assert data['root'] == sys.argv[2]
PY

out="$(run_desktop status)"
assert_eq "$out" '{"desktopShortcut":true,"startMenuShortcut":true,"autoStart":false}' "status after create-shortcuts"

echo "== 3. 手动删除快捷方式后 ensure-first-shortcuts 幂等不重建 =="
rm -rf "$DESKTOP/SES.app" "$APPS/SES.app"
run_desktop ensure-first-shortcuts
[ ! -e "$DESKTOP/SES.app" ]
[ ! -e "$APPS/SES.app" ]
out="$(run_desktop status)"
assert_eq "$out" '{"desktopShortcut":false,"startMenuShortcut":false,"autoStart":false}' "status after manual delete"

echo "== 4. 删除 marker 时受 SES_NO_SHORTCUT=1 跳过，否则自动创建 =="
rm -f "$ROOT/.ses-run/shortcuts-initialized.json"
SES_NO_SHORTCUT=1 run_desktop ensure-first-shortcuts
[ ! -e "$DESKTOP/SES.app" ]
[ ! -f "$ROOT/.ses-run/shortcuts-initialized.json" ]

run_desktop ensure-first-shortcuts
[ -d "$DESKTOP/SES.app" ]
[ -d "$APPS/SES.app" ]
[ -f "$ROOT/.ses-run/shortcuts-initialized.json" ]

echo "== 5. ses-launch 实测调用 ses-local.sh start 与失败兜底 =="
cat > "$ROOT/scripts/ses-local.sh" <<'EOF'
#!/bin/bash
printf '%s\n' "$1" > "$(dirname "$0")/../.ses-run/launch-called.txt"
EOF
chmod +x "$ROOT/scripts/ses-local.sh"
"$DESKTOP/SES.app/Contents/MacOS/ses-launch"
assert_eq "$(cat "$ROOT/.ses-run/launch-called.txt")" "start" "ses-launch invokes ses-local.sh start"

cat > "$ROOT/scripts/ses-local.sh" <<'EOF'
#!/bin/bash
echo "boom" >&2
exit 1
EOF
chmod +x "$ROOT/scripts/ses-local.sh"
FAKE_BIN="$TMP/fake-bin"
mkdir -p "$FAKE_BIN"
cat > "$FAKE_BIN/osascript" <<'EOF'
#!/bin/bash
printf '%s\n' "$*" > "$(dirname "$0")/osascript-called.txt"
EOF
chmod +x "$FAKE_BIN/osascript"
if PATH="$FAKE_BIN:$PATH" "$DESKTOP/SES.app/Contents/MacOS/ses-launch"; then
  echo "FAIL: ses-launch should exit non-zero when ses-local.sh fails" >&2
  exit 1
fi
grep -q 'launcher.log' "$ROOT/.ses-run/launcher.log" || grep -q 'boom' "$ROOT/.ses-run/launcher.log"
[ -f "$FAKE_BIN/osascript-called.txt" ]

echo "== 6. 特殊 XML 字符路径与 set-autostart true/false =="
XML_ROOT="$TMP/SES & <demo> 'quote' \"dbl\""
mkdir -p "$XML_ROOT/scripts"
cp "$SRC/scripts/ses-desktop.sh" "$XML_ROOT/scripts/ses-desktop.sh"
chmod +x "$XML_ROOT/scripts/ses-desktop.sh"

out="$(SES_DESKTOP_DIR="$DESKTOP" SES_APPLICATIONS_DIR="$APPS" SES_LAUNCH_AGENTS_DIR="$AGENTS" SES_SKIP_LAUNCHCTL=1 /bin/bash "$XML_ROOT/scripts/ses-desktop.sh" set-autostart true)"
assert_eq "$out" '{"autoStart":true}' "set-autostart true"
PLIST="$AGENTS/local.ses.autostart.plist"
[ -f "$PLIST" ]
python3 - "$PLIST" "$XML_ROOT" <<'PY'
import plistlib, sys
with open(sys.argv[1], 'rb') as f:
    pl = plistlib.load(f)
root = sys.argv[2]
assert pl['Label'] == 'local.ses.autostart'
assert pl['RunAtLoad'] is True
assert pl['WorkingDirectory'] == root
assert pl['ProgramArguments'] == ['/bin/bash', root + '/scripts/ses-local.sh', 'start']
assert pl['EnvironmentVariables'] == {'SES_NO_OPEN': '1', 'SES_NO_PAUSE': '1', 'SES_NO_SHORTCUT': '1'}
assert pl['StandardOutPath'] == root + '/.ses-run/autostart.log'
assert pl['StandardErrorPath'] == root + '/.ses-run/autostart.log'
PY

out="$(SES_DESKTOP_DIR="$DESKTOP" SES_APPLICATIONS_DIR="$APPS" SES_LAUNCH_AGENTS_DIR="$AGENTS" SES_SKIP_LAUNCHCTL=1 /bin/bash "$XML_ROOT/scripts/ses-desktop.sh" status)"
python3 - "$out" <<'PY'
import json, sys
data = json.loads(sys.argv[1])
assert data['autoStart'] is True
PY

# 其他目录安装实例不应将当前 LaunchAgent 误判为自己
out="$(run_desktop status)"
assert_eq "$out" '{"desktopShortcut":true,"startMenuShortcut":true,"autoStart":false}' "other root does not match autostart"

out="$(SES_DESKTOP_DIR="$DESKTOP" SES_APPLICATIONS_DIR="$APPS" SES_LAUNCH_AGENTS_DIR="$AGENTS" SES_SKIP_LAUNCHCTL=1 /bin/bash "$XML_ROOT/scripts/ses-desktop.sh" set-autostart false)"
assert_eq "$out" '{"autoStart":false}' "set-autostart false"
[ ! -e "$PLIST" ]

echo "== 7. create-shortcuts 在含特殊字符路径下输出合法 JSON =="
out="$(SES_DESKTOP_DIR="$DESKTOP" SES_APPLICATIONS_DIR="$APPS" SES_LAUNCH_AGENTS_DIR="$AGENTS" /bin/bash "$XML_ROOT/scripts/ses-desktop.sh" create-shortcuts)"
python3 - "$out" "$XML_ROOT" <<'PY'
import json, sys
data = json.loads(sys.argv[1])
assert data['desktopShortcut'] is True
assert data['startMenuShortcut'] is True
PY

echo "ALL_MACOS_DESKTOP_TESTS_PASSED"
