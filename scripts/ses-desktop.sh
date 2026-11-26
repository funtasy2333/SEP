#!/bin/bash
# macOS 桌面集成：创建桌面 / ~/Applications 快捷方式（SES.app）及登录后台自启（LaunchAgent）。
set -euo pipefail

ROOT="$(cd -- "$(dirname -- "$0")/.." && pwd -P)"
RUN="$ROOT/.ses-run"
MARKER="$RUN/shortcuts-initialized.json"
ICON_SRC="$ROOT/scripts/ses.icns"
AUTOLAUNCH_LABEL="local.ses.autostart"

DESKTOP_DIR="${SES_DESKTOP_DIR:-$HOME/Desktop}"
APPLICATIONS_DIR="${SES_APPLICATIONS_DIR:-$HOME/Applications}"
LAUNCH_AGENTS_DIR="${SES_LAUNCH_AGENTS_DIR:-$HOME/Library/LaunchAgents}"

json_escape() {
  local s="$1" out="" i ch bs='\' dq='"'
  for ((i = 0; i < ${#s}; i++)); do
    ch="${s:$i:1}"
    if [ "$ch" = "$bs" ]; then
      out="${out}\\\\"
    elif [ "$ch" = "$dq" ]; then
      out="${out}\\\""
    elif [ "$ch" = $'\b' ]; then
      out="${out}\\b"
    elif [ "$ch" = $'\f' ]; then
      out="${out}\\f"
    elif [ "$ch" = $'\n' ]; then
      out="${out}\\n"
    elif [ "$ch" = $'\r' ]; then
      out="${out}\\r"
    elif [ "$ch" = $'\t' ]; then
      out="${out}\\t"
    else
      out="${out}${ch}"
    fi
  done
  printf '%s' "$out"
}

xml_escape() {
  local s="$1" out="" i ch sq="'" dq='"'
  for ((i = 0; i < ${#s}; i++)); do
    ch="${s:$i:1}"
    if [ "$ch" = '&' ]; then
      out="${out}&amp;"
    elif [ "$ch" = '<' ]; then
      out="${out}&lt;"
    elif [ "$ch" = '>' ]; then
      out="${out}&gt;"
    elif [ "$ch" = "$dq" ]; then
      out="${out}&quot;"
    elif [ "$ch" = "$sq" ]; then
      out="${out}&apos;"
    else
      out="${out}${ch}"
    fi
  done
  printf '%s' "$out"
}

read_root_txt() {
  local app_path="$1/SES.app"
  local root_file="$app_path/Contents/Resources/ses-root.txt"
  if [ -f "$root_file" ]; then
    cat "$root_file"
  fi
}

has_app_shortcut() {
  local dir="$1"
  local actual
  [ -d "$dir/SES.app" ] || return 1
  actual="$(read_root_txt "$dir")" || return 1
  [ "$actual" = "$ROOT" ]
}

has_autostart() {
  local plist="$LAUNCH_AGENTS_DIR/$AUTOLAUNCH_LABEL.plist"
  [ -f "$plist" ] || return 1
  local escaped_root expected_line
  escaped_root="$(xml_escape "$ROOT")"
  expected_line="<string>${escaped_root}</string>"
  awk -v expected="$expected_line" '
    /<key>WorkingDirectory<\/key>/ { found_key = 1; next }
    found_key {
      line = $0
      gsub(/^[[:space:]]+|[[:space:]]+$/, "", line)
      if (line == expected) { matched = 1 }
      found_key = 0
    }
    END { exit(matched ? 0 : 1) }
  ' "$plist"
}

build_app_bundle() {
  local target_dir="$1"
  local app_dir="$target_dir/SES.app"
  local contents="$app_dir/Contents"
  local macos_dir="$contents/MacOS"
  local resources_dir="$contents/Resources"

  mkdir -p "$target_dir"
  rm -rf "$app_dir"
  mkdir -p "$macos_dir" "$resources_dir"

  cat > "$contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key>
  <string>SES</string>
  <key>CFBundleDisplayName</key>
  <string>SES</string>
  <key>CFBundleIdentifier</key>
  <string>local.ses.launcher</string>
  <key>CFBundleVersion</key>
  <string>1.0</string>
  <key>CFBundleShortVersionString</key>
  <string>1.0</string>
  <key>CFBundleExecutable</key>
  <string>ses-launch</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleIconFile</key>
  <string>ses</string>
  <key>LSMinimumSystemVersion</key>
  <string>11.0</string>
</dict>
</plist>
PLIST

  printf '%s' "$ROOT" > "$resources_dir/ses-root.txt"

  if [ -f "$ICON_SRC" ]; then
    cp "$ICON_SRC" "$resources_dir/ses.icns"
  fi

  cat > "$macos_dir/ses-launch" <<'LAUNCH'
#!/bin/bash
set -u
APP_DIR="$(cd -- "$(dirname -- "$0")/../.." && pwd -P)"
ROOT="$(cat "$APP_DIR/Contents/Resources/ses-root.txt")"
mkdir -p "$ROOT/.ses-run"
if ! /bin/bash "$ROOT/scripts/ses-local.sh" start >"$ROOT/.ses-run/launcher.log" 2>&1; then
  if command -v osascript >/dev/null 2>&1; then
    osascript -e 'display alert "SES 启动失败" message "请查看日志：.ses-run/launcher.log，或打开 SES 目录双击「启动SES.command」查看详细信息。" as critical' >/dev/null 2>&1 || true
  fi
  exit 1
fi
LAUNCH
  chmod 755 "$macos_dir/ses-launch"
}

cmd_status() {
  local desktop=false apps=false autostart=false
  if has_app_shortcut "$DESKTOP_DIR"; then desktop=true; fi
  if has_app_shortcut "$APPLICATIONS_DIR"; then apps=true; fi
  if has_autostart; then autostart=true; fi
  printf '{"desktopShortcut":%s,"startMenuShortcut":%s,"autoStart":%s}\n' "$desktop" "$apps" "$autostart"
}

cmd_create_shortcuts() {
  build_app_bundle "$DESKTOP_DIR"
  build_app_bundle "$APPLICATIONS_DIR"

  local desktop_app="$DESKTOP_DIR/SES.app"
  local apps_app="$APPLICATIONS_DIR/SES.app"
  local now
  now="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
  mkdir -p "$RUN"
  printf '{"initializedAt":"%s","root":"%s","desktopPath":"%s","startMenuPath":"%s"}\n' \
    "$(json_escape "$now")" \
    "$(json_escape "$ROOT")" \
    "$(json_escape "$desktop_app")" \
    "$(json_escape "$apps_app")" > "$MARKER"

  printf '{"desktopShortcut":true,"startMenuShortcut":true,"desktopPath":"%s","startMenuPath":"%s"}\n' \
    "$(json_escape "$desktop_app")" \
    "$(json_escape "$apps_app")"
}

cmd_ensure_first_shortcuts() {
  if [ "${SES_NO_SHORTCUT:-0}" = 1 ] || [ -f "$MARKER" ]; then
    return 0
  fi
  if ! cmd_create_shortcuts >/dev/null; then
    echo "警告：未能自动创建桌面快捷方式，可稍后在网页设置中创建。" >&2
  fi
  return 0
}

cmd_set_autostart() {
  local raw="${1:-}"
  local normalized
  normalized="$(printf '%s' "$raw" | tr '[:upper:]' '[:lower:]')"
  local plist="$LAUNCH_AGENTS_DIR/$AUTOLAUNCH_LABEL.plist"

  if [ "$normalized" = "true" ]; then
    mkdir -p "$LAUNCH_AGENTS_DIR" "$RUN"
    local x_script x_root x_log
    x_script="$(xml_escape "$ROOT/scripts/ses-local.sh")"
    x_root="$(xml_escape "$ROOT")"
    x_log="$(xml_escape "$RUN/autostart.log")"
    cat > "$plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${AUTOLAUNCH_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>${x_script}</string>
    <string>start</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${x_root}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>SES_NO_OPEN</key>
    <string>1</string>
    <key>SES_NO_PAUSE</key>
    <string>1</string>
    <key>SES_NO_SHORTCUT</key>
    <string>1</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${x_log}</string>
  <key>StandardErrorPath</key>
  <string>${x_log}</string>
</dict>
</plist>
PLIST
  elif [ "$normalized" = "false" ]; then
    if [ "$(uname -s)" = "Darwin" ] && [ "${SES_SKIP_LAUNCHCTL:-0}" != 1 ] && [ -f "$plist" ]; then
      launchctl bootout "gui/$(id -u)" "$plist" 2>/dev/null || launchctl unload "$plist" 2>/dev/null || true
    fi
    rm -f "$plist"
  else
    echo "用法：$0 set-autostart <true|false>" >&2
    exit 1
  fi

  local autostart=false
  if has_autostart; then autostart=true; fi
  printf '{"autoStart":%s}\n' "$autostart"
}

case "${1:-status}" in
  status) cmd_status ;;
  create-shortcuts) cmd_create_shortcuts ;;
  ensure-first-shortcuts) cmd_ensure_first_shortcuts ;;
  set-autostart) cmd_set_autostart "${2:-}" ;;
  *) echo "用法：$0 status|create-shortcuts|ensure-first-shortcuts|set-autostart <true|false>" >&2; exit 1 ;;
esac
