#!/usr/bin/env python3
"""Build source distributions from an explicit runtime allowlist (no dependencies/data)."""
import argparse
from pathlib import Path
import stat
import zipfile

ROOT = Path(__file__).resolve().parents[1]
VERSION = '0.1.0-preview'
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
    entries = (['启动SES.cmd', '退出SES.cmd', 'scripts/ses-windows.ps1', 'scripts/backup-db.cjs', 'scripts/check-sqlite.cjs', 'scripts/start-service.cjs'] if platform == 'windows'
               else ['启动SES.command', '退出SES.command', 'scripts/ses-local.sh'])
    files.update({name: ROOT / name for name in entries})
    return files


def instructions(platform):
    common = '''# SES 0.1.0 Preview

标准化文件编辑系统。此包包含 SES 程序源码和启动文件，首次启动需要联网安装依赖并构建，未捆绑系统运行时或第三方依赖。
请先完整解压到可写的本地目录，再启动；不要在压缩包内双击。Preview 为预览版本。

'''
    platform_text = ('''## Windows 10/11（64 位）

双击「启动SES.cmd」；退出时双击「退出SES.cmd」。需要 Windows PowerShell 5.1 或更高版本。
首次启动会检查 Node.js（>=20.19.0），缺少时安装经过 SHA256 校验的便携版 Node.js 22.22.0；pnpm 10.33.0 安装在本目录的 .ses-tools 中，无需管理员权限。
依赖和浏览器下载优先尝试官方 HTTPS 来源，失败才自动重试中国大陆 npmmirror 镜像。两个来源都失败会显示错误并停止，请查看日志、检查代理或网络后重试。脚本不修改全局 npm 源。

''' if platform == 'windows' else '''## macOS

安装 Node.js >=20.19.0（推荐 22 LTS）和 pnpm >=9：`npm install -g pnpm@10.33.0`。
双击「启动SES.command」；退出时双击「退出SES.command」。首次启动会安装依赖并构建。
如果系统提示文件没有执行权限，在终端进入解压目录执行：`chmod +x *.command scripts/ses-local.sh`。
macOS 使用现有官方安装来源，不包含 Windows 的自动镜像切换逻辑。

''')
    return common + platform_text + '''## 使用和数据

启动后打开 http://localhost:5173/（Windows 也可使用 http://127.0.0.1:5173/）。关闭启动窗口后 SES 继续运行；退出脚本只停止其登记的服务。
端口 3000、5173 被其他程序占用时，请先退出该程序。不要与 `pnpm dev` 同时启动。
文档保存在 `packages/server/data/ses.db`；启动前的数据库备份位于 `output/startup-backups/`，日志位于 `.ses-run/`。退出后备份整个 SES 目录可保留文档。

PDF 版式预览还需要 Poppler：macOS 使用 `brew install poppler`；Windows 安装 Poppler 后，将包含 `pdftotext.exe` 和 `pdfinfo.exe` 的目录加入 PATH。DOCX 编辑与导出不需要 Poppler。Vivliostyle 的排版浏览器可能在首次生成 PDF 时另行下载。
MCP 地址为 http://127.0.0.1:3000/mcp。写作参考资料已作为程序资源保留。
本包不包含开发过程文档、测试、示例、现有数据库、缓存或 node_modules；不需要 Git 或 Python 即可启动。
'''


def build_archive(platform, output):
    output.mkdir(parents=True, exist_ok=True)
    root = f'SES-{VERSION}-{platform}'
    target = output / f'{root}.zip'
    with zipfile.ZipFile(target, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for name, source in sorted(runtime_files(platform).items()):
            info = zipfile.ZipInfo(f'{root}/{name}')
            info.create_system = 3
            executable = name.endswith(('.command', '.sh'))
            info.external_attr = (stat.S_IFREG | (0o755 if executable else 0o644)) << 16
            info.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(info, source.read_bytes())
        archive.writestr(f'{root}/使用说明.md', instructions(platform))
    print(f'{target} ({target.stat().st_size:,} bytes)')
    return target


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=ROOT / 'release')
    args = parser.parse_args()
    for platform in ('windows', 'macos'):
        build_archive(platform, args.output)
