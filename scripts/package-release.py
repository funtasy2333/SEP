#!/usr/bin/env python3
"""Build source distributions from an explicit runtime allowlist (no dependencies/data)."""
import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import shutil
import stat
import subprocess
import zipfile

ROOT = Path(__file__).resolve().parents[1]
VERSION = '0.2.2-preview'
CONFIG = [
    'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', '.npmrc', 'tsconfig.base.json',
    'packages/server/nest-cli.json', 'packages/server/webpack.config.js',
    'packages/server/tsconfig.json', 'packages/server/tsconfig.build.json',
    'packages/client/index.html', 'packages/client/vite.config.ts',
    'packages/client/tsconfig.json', 'packages/client/tsconfig.app.json', 'packages/client/tsconfig.node.json',
    'packages/io/tsconfig.json', 'packages/shared/tsconfig.json',
]


def runtime_files(platform):
    files = {name: ROOT / name for name in CONFIG}
    for package in ('client', 'server', 'shared', 'io'):
        name = f'packages/{package}/package.json'
        files[name] = ROOT / name
        for path in (ROOT / f'packages/{package}/src').rglob('*'):
            if not path.is_file():
                continue
            relative = path.relative_to(ROOT)
            if any(part.startswith('__') for part in relative.parts) or path.name.endswith(('.test.ts', '.spec.ts', '.snap', '.md', '.tsbuildinfo')):
                continue
            files[relative.as_posix()] = path
    for path in (ROOT / 'packages/client/public').rglob('*'):
        if path.is_file():
            files[path.relative_to(ROOT).as_posix()] = path
    # This user-facing MCP reference is an actual build input, not a development document.
    files['packages/server/resources/authoring-reference.md'] = ROOT / 'docs/wp9-authoring-reference.md'
    # 升级执行器及其平台脚本；scripts/apply-update.cjs 中的同名清单必须保持一致（有测试比对）。
    entries = (['启动SES.cmd', '退出SES.cmd', 'scripts/ses-windows.ps1', 'scripts/backup-db.cjs', 'scripts/build-state.cjs', 'scripts/check-sqlite.cjs', 'scripts/start-service.cjs',
                'scripts/apply-update.cjs', 'scripts/ses-upgrade.ps1', 'scripts/run-detached.cjs'] if platform == 'windows'
               else ['启动SES.command', '退出SES.command', 'scripts/ses-local.sh', 'scripts/backup-db.cjs', 'scripts/build-state.cjs', 'scripts/apply-update.cjs', 'scripts/ses-upgrade.sh'])
    files.update({name: ROOT / name for name in entries})
    return files


def build_commit():
    sha = os.environ.get('GITHUB_SHA', '').strip()
    if sha:
        return sha
    try:
        result = subprocess.run(['git', 'rev-parse', 'HEAD'], cwd=ROOT, capture_output=True, text=True, timeout=10)
    except (OSError, subprocess.SubprocessError):
        return None
    sha = result.stdout.strip()
    return sha if result.returncode == 0 and sha else None


def build_info(version, commit):
    return {
        'version': version,
        'channel': 'stable',
        'commit': commit,
        'builtAt': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%S.000Z'),
    }


def instructions(platform, version=VERSION, portable=False):
    common = f'''# SES {version.replace('-preview', '')} Preview

标准化文件编辑系统。此包包含 SES 程序源码和启动文件，首次启动需要联网安装依赖并构建，未捆绑系统运行时或第三方依赖。
请先完整解压到可写的本地目录，再启动；不要在压缩包内双击。Preview 为预览版本。

'''
    if portable:
        system = 'Windows 10/11（x64）' if platform == 'windows' else 'macOS（Apple Silicon）'
        launch = 'cmd' if platform == 'windows' else 'command'
        client_url = 'http://127.0.0.1:5173/' if platform == 'windows' else 'http://localhost:5173/'
        source_requirements = 'macOS 源码包需要系统提供 Node.js 和 pnpm。' if platform == 'macos' else ''
        return f'''# SES {version.replace('-preview', '')} Preview

## {system}

将 ZIP 完整解压到可写的本地目录。双击「启动SES.{launch}」后，编辑器会在默认浏览器中打开。包内已包含 Node.js、程序和运行依赖，解压后即可离线启动。

用完后双击「退出SES.{launch}」，也可以在网页的「设置 → 升级 / 退出」中退出。关闭网页后，服务仍在后台运行。编辑器地址为 {client_url}，MCP 地址为 http://127.0.0.1:3000/mcp。

文档保存在 `packages/server/data/ses.db`，启动备份位于 `output/startup-backups/`，日志位于 `.ses-run/`。

通过「设置 → 升级 / 退出」中的「稳定版」联网下载并安装新版。新版发布包包含完整运行环境。升级会备份数据库，新版启动失败时会恢复原版本和文档。使用「每次提交」通道会下载源码并联网构建。{source_requirements}不支持降级。
'''
    platform_text = ('''## Windows 10/11（64 位）

双击「启动SES.cmd」；退出时双击「退出SES.cmd」。需要 Windows PowerShell 5.1 或更高版本。
首次启动会检查 Node.js（>=20.19.0），缺少时安装经过 SHA256 校验的便携版 Node.js 22.22.0；pnpm 10.33.0 安装在本目录的 .ses-tools 中，无需管理员权限。
依赖下载优先尝试官方 HTTPS 来源，失败才自动重试中国大陆 npmmirror 镜像。两个来源都失败会显示错误并停止，请查看日志、检查代理或网络后重试。脚本不修改全局 npm 源。

pnpm 的依赖缓存位于 SES 目录内的 `.ses-tools/pnpm-store/`。从旧版升级后，如需复用盘根目录的 `.pnpm-store`，可以先退出 SES，把旧缓存 `v10` 内的 `files` 和 `index` 复制到新缓存的 `v10` 目录。下次需要安装依赖时，pnpm 会重建依赖链接并复用已缓存的文件。确认 SES 已使用新缓存且没有其他项目使用旧缓存后，可以删除旧缓存。

''' if platform == 'windows' else '''## macOS

安装 Node.js >=20.19.0（推荐 22 LTS）和 pnpm >=9：`npm install -g pnpm@10.33.0`。
双击「启动SES.command」；退出时双击「退出SES.command」。首次启动会安装依赖并构建。
如果系统提示文件没有执行权限，在终端进入解压目录执行：`chmod +x *.command scripts/ses-local.sh`。
macOS 使用现有官方安装来源，不包含 Windows 的自动镜像切换逻辑。

''')
    return common + platform_text + '''## 使用和数据

启动后打开 http://localhost:5173/（Windows 也可使用 http://127.0.0.1:5173/）。关闭启动窗口后 SES 继续运行；退出脚本只停止其登记的服务。
端口 3000、5173 被其他程序占用时，请先退出该程序。不要与 `pnpm dev` 同时启动。
文档保存在 `packages/server/data/ses.db`；启动前的数据库备份位于 `output/startup-backups/`（数据库未变化时不重复备份，默认保留最近 10 份，可通过 `SES_STARTUP_BACKUP_KEEP` 调整），日志位于 `.ses-run/`。退出后备份整个 SES 目录可保留文档。

## 设置 → 升级 / 退出

打开 SES 后，进入「设置 → 升级 / 退出」：

- **升级**：检查并安装新版本，无需手动下载或覆盖文件。提供两个通道：
  - 稳定版（默认）：GitHub Release 发布的正式预览版本。
  - 每次提交：main 分支的最新提交，可能不稳定，仅建议想尽早试用新功能时选择。
  升级时 SES 会先停止服务，自动备份数据库到 `output/upgrade-backups/`（默认保留最近 5 份，可通过 `SES_UPGRADE_BACKUP_KEEP` 调整），替换程序文件，再重新启动。新版本无法启动时会自动恢复到升级前的程序和数据。文档数据（`packages/server/data/`）、`.ses-tools/`、`output/` 和 `.env` 不会被改动。
  不支持降级：只能升级到比当前更新的版本。升级过程和结果记录在 `.ses-run/upgrade.log`。
- **退出 SES**：停止后台服务，作用与「退出SES」脚本相同。

注意：**关闭网页不会退出 SES**，服务仍在后台运行，需要使用上面的「退出 SES」按钮或退出脚本才会停止。
从 0.1.1 及更早版本升级到带有此功能的版本，仍需按旧方式手动升级一次；之后即可在应用内升级。

本预览版暂时停用 PDF 导出。DOCX 编辑与导出无需安装 Poppler。
MCP 地址为 http://127.0.0.1:3000/mcp。写作参考资料已作为程序资源保留。
本包不包含开发过程文档、测试、示例、现有数据库、缓存或 node_modules；不需要 Git 或 Python 即可启动。
'''


def portable_files(runtime, node):
    required = (node, 'LICENSE.node', 'server/package.json', 'server/dist/main.js', 'client/index.html',
                'server/node_modules/better-sqlite3/build/Release/better_sqlite3.node')
    for name in required:
        if not (runtime / name).is_file():
            raise ValueError(f'Bundled runtime is missing {name}')
    def check_link(source):
        if source.is_symlink() or getattr(source, 'is_junction', lambda: False)():
            raise ValueError(f'Bundled runtime contains a link: {source}')

    for name in (node, 'LICENSE.node', 'server/package.json'):
        check_link(runtime / name)
        yield name, runtime / name
    for root in ('server/dist', 'server/node_modules', 'client'):
        check_link(runtime / root)
        for directory, dirs, files in os.walk(runtime / root):
            parent = Path(directory)
            dirs[:] = sorted(name for name in dirs if name != '.bin')
            for name in dirs + sorted(files):
                source = parent / name
                check_link(source)
                if source.is_file() and name not in ('.modules.yaml', '.pnpm-workspace-state-v1.json'):
                    yield source.relative_to(runtime).as_posix(), source


def build_archive(platform, output, version=None, commit=None, windows_runtime=None, macos_runtime=None):
    version = version or VERSION
    commit = commit if commit is not None else build_commit()
    if ((windows_runtime is not None and platform != 'windows') or
        (macos_runtime is not None and platform != 'macos')):
        raise ValueError('The bundled runtime does not match the target platform')
    staged_runtime = windows_runtime if platform == 'windows' else macos_runtime
    portable = staged_runtime is not None
    files = runtime_files(platform)
    runtime = list(portable_files(staged_runtime, 'node.exe' if platform == 'windows' else 'node')) if portable else []
    if portable:
        files = {name: source for name, source in files.items() if name.startswith('scripts/') or name.endswith(('.cmd', '.command'))}
        files['LICENSE'] = ROOT / 'LICENSE'
    output.mkdir(parents=True, exist_ok=True)
    suffix = 'macos-arm64' if macos_runtime is not None else platform
    root = f'SES-{version}-{suffix}'
    target = output / f'{root}.zip'
    with zipfile.ZipFile(target, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for name, source in sorted(files.items()):
            info = zipfile.ZipInfo(f'{root}/{name}')
            info.create_system = 3
            executable = name.endswith(('.command', '.sh'))
            info.external_attr = (stat.S_IFREG | (0o755 if executable else 0o644)) << 16
            info.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(info, source.read_bytes())
        for name, source in runtime:
            target_name = f'{root}/.ses-runtime/{name}'
            if name == 'node':
                executable = zipfile.ZipInfo.from_file(source, target_name)
                executable.external_attr = (stat.S_IFREG | 0o755) << 16
                executable.compress_type = zipfile.ZIP_DEFLATED
                with source.open('rb') as content, archive.open(executable, 'w') as output_file:
                    shutil.copyfileobj(content, output_file)
            else:
                archive.write(source, target_name, compresslevel=6)
        archive.writestr(f'{root}/使用说明.md', instructions(platform, version, portable))
        info = zipfile.ZipInfo(f'{root}/ses-build.json')
        info.create_system = 3
        info.external_attr = (stat.S_IFREG | 0o644) << 16
        info.compress_type = zipfile.ZIP_DEFLATED
        metadata = build_info(version, commit)
        if portable:
            metadata['runtime'] = 'windows-x64' if platform == 'windows' else 'macos-arm64'
        archive.writestr(info, json.dumps(metadata, ensure_ascii=False, indent=2) + '\n')
    print(f'{target} ({target.stat().st_size:,} bytes)')
    return target


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=ROOT / 'release')
    parser.add_argument('--print-version', action='store_true', help='print the release version (e.g. 0.2.2-preview) and exit')
    parser.add_argument('--version', default=None, help='override VERSION (CI uses this to build a "newer" package)')
    parser.add_argument('--platform', choices=('windows', 'macos'))
    parser.add_argument('--windows-runtime', type=Path, help='staged Windows x64 runtime to include')
    parser.add_argument('--macos-runtime', type=Path, help='staged macOS arm64 runtime to include')
    args = parser.parse_args()
    version = args.version or VERSION
    if args.print_version:
        print(version)
        raise SystemExit(0)
    if args.windows_runtime and args.platform != 'windows':
        parser.error('--windows-runtime requires --platform windows')
    if args.macos_runtime and args.platform != 'macos':
        parser.error('--macos-runtime requires --platform macos')
    platforms = (args.platform,) if args.platform else ('windows', 'macos')
    for platform in platforms:
        build_archive(platform, args.output, version, windows_runtime=args.windows_runtime, macos_runtime=args.macos_runtime)
