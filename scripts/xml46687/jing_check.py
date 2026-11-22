#!/usr/bin/env python3
"""独立的 Jing RELAX NG 校验工具（GB/T 46687.2—2026 XML，WP8.5）。

使用 Python 3 标准库调用本地 `java -jar <jing.jar> <schema.rng> <file...>`，
提供独立于 libxml2（lxml / xmllint）的第二套 RELAX NG 校验引擎。

查找 `jing.jar` 的优先级（绝不联网或自动下载）：
  1. 命令行参数 `--jing <path>`
  2. 环境变量 `JING_JAR`
  3. 默认本地路径 `~/.local/share/jing/jing.jar`

运行方式：
    python3 -I scripts/xml46687/jing_check.py [--json] [--schema <schema.rng>] [--jing <jing.jar>] <file.xml> [...]

退出码：
  0 = 全部待检文件通过 RELAX NG 校验；
  1 = 任一文件校验失败、文件缺失，或 java / jing.jar / schema 不可用。
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

DEFAULT_SCHEMA = Path(__file__).resolve().parents[2] / "schemas" / "gbt46687.2" / "ses-gbt46687-2.rng"
DEFAULT_JING_PATH = Path.home() / ".local" / "share" / "jing" / "jing.jar"

# Jing 标准诊断行：<file>:<line>:<column>: <severity>: <message>
# 也兼容无行号/列号的 I/O 或致命错误：<file>: <severity>: <message>
_LINE_COL_RE = re.compile(r"^(?P<path>.+?):(?P<line>\d+):(?P<col>\d+):\s*(?P<sev>fatal|error|warning):\s*(?P<msg>.*)$")
_NO_POS_RE = re.compile(r"^(?P<path>.+?):\s*(?P<sev>fatal|error|warning):\s*(?P<msg>.*)$")
_JAVA_VER_RE = re.compile(r'version\s+"([^"]+)"')
_JING_VER_RE = re.compile(r"Jing\s+version\s+(\S+)")


def resolve_jing_jar(cli_jing: str | None) -> Path | None:
    """按 --jing -> JING_JAR -> 默认本地路径 查找 jing.jar（不联网）。"""
    if cli_jing:
        return Path(cli_jing).expanduser()
    env_jing = os.environ.get("JING_JAR", "").strip()
    if env_jing:
        return Path(env_jing).expanduser()
    return DEFAULT_JING_PATH


def detect_java_version(java_bin: str) -> str | None:
    try:
        proc = subprocess.run(
            [java_bin, "-version"],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=15,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    combined = f"{proc.stdout}\n{proc.stderr}"
    m = _JAVA_VER_RE.search(combined)
    if m:
        return m.group(1)
    first_line = combined.strip().splitlines()
    return first_line[0].strip() if first_line else None


def detect_jing_version(java_bin: str, jing_jar: Path) -> str | None:
    try:
        proc = subprocess.run(
            [java_bin, "-jar", str(jing_jar)],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=15,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    combined = f"{proc.stdout}\n{proc.stderr}"
    m = _JING_VER_RE.search(combined)
    return m.group(1) if m else None


def _normalize_key(path_str: str) -> str:
    try:
        return str(Path(path_str).resolve())
    except OSError:
        return os.path.abspath(path_str)


def run_jing(
    files: list[str],
    *,
    schema_path: Path,
    jing_jar: Path,
    java_bin: str,
) -> tuple[dict, int]:
    """执行 Jing 校验并返回 (payload, exit_code)。"""
    java_version = detect_java_version(java_bin)
    jing_version = detect_jing_version(java_bin, jing_jar) if jing_jar.is_file() else None

    payload: dict = {
        "engine": "jing",
        "jing_version": jing_version,
        "java_version": java_version,
        "jing_jar": str(jing_jar),
        "schema": str(schema_path),
        "valid": False,
        "results": [],
    }

    if java_version is None:
        payload["error"] = f"无法执行 Java 运行时：{java_bin}"
        return payload, 1
    if not jing_jar.is_file():
        payload["error"] = f"找不到本地 jing.jar：{jing_jar}（请通过 --jing 或 JING_JAR 指定）"
        return payload, 1
    if not schema_path.is_file():
        payload["error"] = f"找不到 RELAX NG schema：{schema_path}"
        return payload, 1

    # 预先按输入次序建立结果条目，并筛出实际存在的可检文件
    entries: list[dict] = []
    key_to_entries: dict[str, list[dict]] = {}
    existing_args: list[str] = []
    seen_existing: set[str] = set()

    for raw_file in files:
        p = Path(raw_file)
        entry = {"file": raw_file, "valid": True, "errors": []}
        entries.append(entry)
        if not p.is_file():
            entry["valid"] = False
            entry["errors"].append({
                "line": None,
                "column": None,
                "severity": "fatal",
                "message": f"待校验文件不存在或不可读：{raw_file}",
            })
            continue
        abs_key = _normalize_key(raw_file)
        key_to_entries.setdefault(abs_key, []).append(entry)
        if abs_key not in seen_existing:
            seen_existing.add(abs_key)
            existing_args.append(abs_key)

    global_errors: list[dict] = []

    if existing_args:
        cmd = [
            java_bin,
            "-Djavax.xml.accessExternalDTD=",
            "-Djavax.xml.accessExternalSchema=file",
            "-jar",
            str(jing_jar),
            str(schema_path.resolve()),
            *existing_args,
        ]
        try:
            proc = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                timeout=120,
            )
        except (OSError, subprocess.SubprocessError) as exc:
            payload["error"] = f"调用 Jing 失败：{exc}"
            payload["results"] = entries
            return payload, 1

        output_lines = [line for line in (proc.stdout + "\n" + proc.stderr).splitlines() if line.strip()]
        for line in output_lines:
            m = _LINE_COL_RE.match(line)
            if m:
                target_key = _normalize_key(m.group("path"))
                err = {
                    "line": int(m.group("line")),
                    "column": int(m.group("col")),
                    "severity": m.group("sev"),
                    "message": m.group("msg").strip(),
                }
            else:
                m2 = _NO_POS_RE.match(line)
                if m2:
                    target_key = _normalize_key(m2.group("path"))
                    err = {
                        "line": None,
                        "column": None,
                        "severity": m2.group("sev"),
                        "message": m2.group("msg").strip(),
                    }
                else:
                    target_key = ""
                    err = {
                        "line": None,
                        "column": None,
                        "severity": "error",
                        "message": line.strip(),
                    }

            matched_entries = key_to_entries.get(target_key)
            if matched_entries:
                for entry in matched_entries:
                    entry["errors"].append(err)
                    if err["severity"] in ("error", "fatal"):
                        entry["valid"] = False
            else:
                global_errors.append(err)

        # 若 Jing 返回非 0 但既没有解析出单文件错误也没有全局错误，保守判失败
        if proc.returncode != 0 and not global_errors and all(e["valid"] for e in entries):
            global_errors.append({
                "line": None,
                "column": None,
                "severity": "fatal",
                "message": f"Jing 退出码为 {proc.returncode}，但未输出可解析的诊断信息",
            })

    if global_errors:
        payload["global_errors"] = global_errors
        for entry in entries:
            if entry["valid"]:
                entry["valid"] = False

    payload["results"] = entries
    all_valid = bool(entries) and not global_errors and all(e["valid"] for e in entries)
    payload["valid"] = all_valid
    return payload, (0 if all_valid else 1)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="使用本地 Jing（独立 RELAX NG 引擎）校验 GB/T 46687.2—2026 XML 文件。",
    )
    parser.add_argument("files", nargs="+", help="待校验的 XML 文件路径")
    parser.add_argument(
        "--schema",
        default=str(DEFAULT_SCHEMA),
        help=f"RELAX NG schema 路径（默认：{DEFAULT_SCHEMA}）",
    )
    parser.add_argument(
        "--jing",
        default=None,
        help="jing.jar 路径（优先级高于 JING_JAR 环境变量和默认路径）",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        dest="as_json",
        help="以 JSON 格式输出校验结果",
    )
    args = parser.parse_args(argv)

    java_bin = shutil.which("java") or "java"
    jing_jar = resolve_jing_jar(args.jing)
    assert jing_jar is not None
    schema_path = Path(args.schema).expanduser()

    payload, exit_code = run_jing(
        args.files,
        schema_path=schema_path,
        jing_jar=jing_jar,
        java_bin=java_bin,
    )

    if args.as_json:
        sys.stdout.write(json.dumps(payload, ensure_ascii=False, indent=2) + "\n")
    else:
        if "error" in payload:
            sys.stderr.write(f"ERROR: {payload['error']}\n")
        else:
            for item in payload["results"]:
                status = "PASS" if item["valid"] else "FAIL"
                sys.stdout.write(f"[{status}] {item['file']} (errors: {len(item['errors'])})\n")
                for err in item["errors"]:
                    loc = f"{err['line']}:{err['column']}" if err["line"] is not None else "-"
                    sys.stdout.write(f"  - {loc} [{err['severity']}] {err['message']}\n")
            for err in payload.get("global_errors", []):
                sys.stderr.write(f"GLOBAL [{err['severity']}] {err['message']}\n")

    return exit_code


if __name__ == "__main__":
    raise SystemExit(main())
