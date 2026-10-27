# 环境配置指南

本文档说明 **SES 0.1.0 Preview** 的依赖要求。推荐先从 [Release](https://github.com/funtasy2333/SEP/releases/tag/v0.1.0-preview) 下载对应系统的压缩包；开发者可以使用 `git clone` 获取源码。下载链接和操作步骤见 [README：安装与启动](README.md#安装与启动)。

## 1. 按使用方式准备环境

| 依赖 | Windows 压缩包 | macOS 压缩包 | 从源码开发 |
| ---- | -------------- | ------------ | ---------- |
| Node.js | 启动脚本检查并按需安装便携版 22.22.0 | 手动安装，推荐 22.22.0 | 手动安装，推荐 22.22.0 |
| pnpm | 启动脚本安装本地版 10.33.0 | 手动安装，推荐 10.33.0 | 手动安装，推荐 10.33.0 |
| Windows PowerShell | 5.1 或更高版本，Windows 10/11 通常自带 | 无需 | 使用 Windows 双击启动脚本时需要 |
| Git | 无需 | 无需 | 使用 `git clone` 时需要 |
| Poppler | 使用 PDF 版式预览时安装 | 使用 PDF 版式预览时安装 | 使用 PDF 版式预览时安装 |
| Python 3 | 无需 | 无需 | 运行部分辅助检查、打包脚本时需要 |

两个压缩包包含 SES 源码、资源、启动文件和使用说明，第三方依赖会在首次启动时联网安装，然后构建项目。请先完整解压到可写的本地目录，再运行启动脚本。

### Windows 压缩包

支持 Windows 10/11 64 位。双击 `启动SES.cmd` 后，脚本会：

1. 检查已有 Node.js 是否兼容；缺少兼容版本时，在 SES 目录内安装经过 SHA256 校验的便携版 Node.js 22.22.0。
2. 在 SES 目录内安装 pnpm 10.33.0。
3. 按锁文件安装项目依赖，检查 SQLite 原生模块并安装 Playwright Chromium。
4. 构建项目、备份已有数据库，启动前后端并打开浏览器。

Node.js 与 pnpm 保存在 `.ses-tools/` 中，无需先手动安装，也不要求配置全局 pnpm。退出服务时双击 `退出SES.cmd`。

### macOS 压缩包

需要先手动安装 Node.js 和 pnpm，启动脚本会检查版本，然后安装项目依赖并构建。

1. 下载并安装 [Node.js 22.22.0（macOS 安装包）](https://nodejs.org/dist/v22.22.0/node-v22.22.0.pkg)。
2. 打开终端，安装 pnpm：

   ```bash
   npm install -g pnpm@10.33.0
   ```

3. 检查版本：

   ```bash
   node --version   # 推荐 v22.22.0
   pnpm --version   # 推荐 10.33.0
   ```

4. 在解压后的 SES 目录中双击 `启动SES.command`；退出时双击 `退出SES.command`。

如果脚本没有执行权限，在终端进入该目录后运行：

```bash
chmod +x 启动SES.command 退出SES.command scripts/ses-local.sh
```

## 2. 手动配置时的版本要求

### Node.js

推荐使用已经验证的 **Node.js 22.22.0**。项目声明的最低版本为 **20.19.0**，实际运行还需要同时满足前端 Vite 和 SQLite 原生模块的版本要求：

- Node.js 20：至少 **20.19.0**。
- Node.js 22：至少 **22.12.0**。
- Windows 启动脚本还接受当前 SQLite 依赖支持的 Node.js 23、24、25；未识别为兼容版本时会使用本地便携版。

请优先选择推荐版本。Node.js 21、22.0–22.11 不满足当前工具链要求；更新的主版本需要先确认项目依赖兼容性。

官方下载：[Node.js 22.22.0](https://nodejs.org/dist/v22.22.0/)。

### pnpm

最低版本为 **9.0**，推荐固定使用 **10.33.0**，与 Windows 启动脚本和 Preview 发布验证环境一致：

```bash
npm install -g pnpm@10.33.0
```

项目使用 pnpm Workspace 和 `pnpm-lock.yaml` 管理依赖。固定版本有助于保持锁文件与依赖构建配置一致；Windows 压缩包使用本地 pnpm，无需执行上述全局安装命令。

### 项目依赖与 SQLite

Vue、NestJS、TypeScript、`better-sqlite3` 等项目依赖由启动脚本或 `pnpm install --frozen-lockfile` 统一安装，不需要逐个手动安装。SQLite 随 `better-sqlite3` 依赖使用，无需另行配置数据库服务。

依赖可能包含与操作系统、CPU 架构和 Node.js 版本相关的原生模块。请在目标系统上安装依赖；已有依赖与环境不兼容时，应在当前环境重新安装或重建，并优先确认 Node.js 版本符合要求。

如果安装日志出现 `node-gyp` 编译错误，请先检查版本和预编译包下载是否正常。只有确实需要从源码编译原生模块时，才按 `node-gyp` 的要求补充 Python 和对应平台的编译工具。

## 3. 可选依赖

### Poppler：PDF 版式预览

PDF 版式预览使用 `@vivliostyle/cli` 排版，并通过 Poppler 的 `pdftotext`、`pdfinfo` 定位目次页码和核对页数。**编辑文档、导出 DOCX 无需安装 Poppler。**

- macOS：运行 `brew install poppler`（使用已安装的 Homebrew）。
- Windows：安装 Poppler，将包含 `pdftotext.exe`、`pdfinfo.exe` 的目录加入 `PATH`，再退出并重新启动 SES。
- Linux（Ubuntu/Debian，源码方式）：运行 `sudo apt install poppler-utils`。

验证命令：

```bash
pdftotext -v
pdfinfo -v
```

服务端会检查这两个命令。Vivliostyle 的排版浏览器可能在首次生成 PDF 时另行联网下载；Windows 安装的 Playwright Chromium 与 Vivliostyle 使用的浏览器由各自依赖管理。

### Git：获取开发源码

Git 仅用于克隆、更新源码和版本管理。压缩包用户无需安装 Git。

下载：[Git](https://git-scm.com/downloads)。安装后可用 `git --version` 验证。

### Python 3：辅助工具

部分 DOCX 检查、分析和发布打包脚本使用 Python 3。直接运行 SES 和日常前后端开发无需预装 Python；需要使用这些辅助工具时，再根据脚本要求准备环境。

下载：[Python](https://www.python.org/downloads/)。可用 `python --version` 或 macOS/Linux 上的 `python3 --version` 验证。

## 4. 开发者：从源码安装与启动

先准备 Git、Node.js 22.22.0 和 pnpm 10.33.0，再运行：

```bash
git clone https://github.com/funtasy2333/SEP.git
cd SEP

# 按锁文件安装整个工作区的依赖
pnpm install --frozen-lockfile

# 同时启动前后端开发服务
pnpm dev
```

依赖安装涵盖 `packages/client`、`packages/server`、`packages/shared`、`packages/io` 四个子包。

访问 [http://localhost:5173/](http://localhost:5173/)。开发服务在前台运行，按 Ctrl+C 停止。也可以分别启动：

```bash
pnpm dev:client   # 前端
pnpm dev:server   # 后端
```

构建所有工作区包：

```bash
pnpm build
```

双击启动脚本使用构建后的后端代码；修改后端代码后，请先退出服务再重新启动。使用双击启动方式前，应先停止原终端中的开发服务。

## 5. 下载来源与联网要求

### Windows 自动选择来源

Windows 启动脚本优先尝试官方来源，下载或安装失败后再自动重试中国大陆 npmmirror 镜像。连接情况通过实际 HTTPS 请求和安装结果判断，不依赖 ICMP ping。

此逻辑覆盖便携 Node.js、本地 pnpm、项目依赖和 Playwright 浏览器的安装重试；不修改全局 npm 源。两个来源都失败时，脚本会显示错误并停止，请检查网络或代理后重新运行。

### macOS 与手动安装

macOS 启动脚本以及手动执行的 `npm`、`pnpm` 命令沿用各自已有的来源和网络配置，不包含 Windows 的自动镜像切换逻辑。

首次启动、补齐依赖和首次下载 PDF 排版浏览器需要联网。Node.js 与 pnpm 安装完成后，仍需要完成 SES 项目依赖安装和构建，才能启动服务。

## 6. 端口、日志与数据

| 项目 | 默认地址或位置 |
| ---- | -------------- |
| 编辑器 | `http://localhost:5173/`；Windows 启动脚本打开 `http://127.0.0.1:5173/` |
| 后端 API | `http://127.0.0.1:3000/api` |
| MCP | `http://127.0.0.1:3000/mcp` |
| 文档数据库 | `packages/server/data/ses.db` |
| 启动前数据库备份 | `output/startup-backups/` |
| 启动脚本日志 | `.ses-run/` |
| Windows 本地运行环境 | `.ses-tools/` |

文件位置均相对于 SES 目录。关闭启动脚本窗口后，后台服务仍会运行；使用对应的退出脚本停止服务，文档数据会保留。端口 `3000`、`5173` 被其他程序占用时，请先停止占用程序。

后端默认只监听本机 `127.0.0.1`。需要从局域网访问时，可设置 `SES_LISTEN_HOST`（例如 `0.0.0.0`）；REST 接口没有鉴权，此时局域网设备可以读写文档。配置方式及 MCP 接入见 [本地接入 MCP](docs/wp9-mcp-local-setup.md)。
