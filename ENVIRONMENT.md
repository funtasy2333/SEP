# 环境配置指南

本文档说明 **SES 0.1.3 Preview** 的依赖要求。推荐先从 [Release](https://github.com/funtasy2333/SEP/releases/tag/v0.1.3-preview) 下载对应系统的压缩包；开发者可以使用 `git clone` 获取源码。下载链接和操作步骤见 [README：安装与启动](README.md#安装与启动)。

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

### 导出字体

PDF 由 SES 后端所在的机器排版。要输出指定字体，该机器需要安装 **Times New Roman** 以及宋体、黑体等文档字体；列项破折号单独使用 Times New Roman。缺少字体时，浏览器会使用系统替代字体。DOCX 保存字体名称，打开文件的机器也需要具备对应字体。

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
| 应用内升级前数据库备份 | `output/upgrade-backups/` |
| 启动脚本日志 | `.ses-run/` |
| 升级日志与结果 | `.ses-run/upgrade.log`、`.ses-run/upgrade-status.json` |
| 升级临时目录（含升级锁） | `.ses-update/` |
| Windows 本地运行环境 | `.ses-tools/` |

文件位置均相对于 SES 目录。关闭启动脚本窗口后，后台服务仍会运行；使用对应的退出脚本停止服务，文档数据会保留。端口 `3000`、`5173` 被其他程序占用时，请先停止占用程序。

后端默认只监听本机 `127.0.0.1`。需要从局域网访问时，可设置 `SES_LISTEN_HOST`（例如 `0.0.0.0`）；REST 接口没有鉴权，此时局域网设备可以读写文档。服务端还会检查请求的 Host 头（防 DNS 重绑定），只接受 `localhost`、`127.0.0.1`、`[::1]`；用局域网地址访问时，请用 `SES_ALLOWED_HOSTS`（逗号分隔，如 `192.168.1.20,my-pc.local:3000`）加入访问地址，`SES_LISTEN_HOST` 设为具体地址时会自动放行该地址。配置方式及 MCP 接入见 [本地接入 MCP](docs/wp9-mcp-local-setup.md)。

## 7. 应用内升级与退出

SES 在「设置 → 升级 / 退出」中提供升级与退出。**关闭网页不会退出 SES**；退出需要点击「退出 SES」或运行退出脚本。

### 可用条件

启动脚本在启动后端时设置环境变量 `SES_LAUNCHER`（macOS 为 `macos`，Windows 为 `windows`），服务端据此判断是否由官方启动脚本管理。只有这种方式启动的 SES 才允许应用内升级与退出；`pnpm dev`、手动运行 `node dist/main.js` 等方式不提供。不要手动设置这个变量。

### 升级通道与联网

| 通道 | 来源 | 说明 |
| ---- | ---- | ---- |
| 稳定版 | GitHub Release 的发布包 | 默认通道 |
| 每次提交 | main 分支最新提交的源码归档 | 可能不稳定 |

检查和下载新版本需要能访问 GitHub。升级后的首次启动会按锁文件补装依赖并重新构建，也需要联网（Windows 同样优先官方来源、失败再重试 npmmirror 镜像）。不修改全局 npm 源。

### 升级流程与数据安全

升级由 `scripts/ses-upgrade.sh`（macOS）或 `scripts/ses-upgrade.ps1`（Windows）执行：服务端把它和 `scripts/apply-update.cjs` 复制到 `.ses-update/` 后以独立进程运行，因此替换 `scripts/` 目录时不会影响正在运行的脚本。Windows 上服务端不直接分离拉起 PowerShell（无控制台时 PowerShell 5.1 不能可靠运行），而是分离拉起 `node scripts/run-detached.cjs powershell.exe ...`（升级时同样使用复制到 `.ses-update/` 的副本），由它以子进程运行 PowerShell 并把输出写入日志；退出脚本同理。流程为：停止服务 → 备份数据库 → 解压 → 替换程序文件 → 启动新版本 → 清理。

- 使用系统自带工具解压：macOS 使用 `ditto`，Windows 使用 PowerShell 5.1 的 `Expand-Archive`；脚本使用启动时记录的 Node.js 运行升级逻辑。
- 数据库：停止服务后把 `packages/server/data/ses.db`（及存在的 `-wal`、`-shm`）复制到 `.ses-update/db-backup/`；升级成功后移动到 `output/upgrade-backups/ses-before-upgrade-<时间戳>/` 永久保留。
- 替换文件与回滚优先使用升级包里新版本的 `scripts/apply-update.cjs`（先复制为 `.ses-update/apply-update.next.cjs` 并做语法检查，不可用则回退到当前版本），这样新版本新增的程序文件也会被安装；备份、恢复数据库、状态文件等仍由当前版本处理。
- 整目录替换 `packages/{client,server,shared,io}/src`、`packages/client/public`、`packages/server/resources`，旧文件不会残留；其余程序文件逐个替换。
- 绝不改动：`packages/server/data/`、任何层级的 `node_modules`、`.ses-tools/`、`.ses-run/`、`output/`、`.ses-update/`、`.env`。路径超出 SES 目录、落入上述目录或经符号链接逃出目录的升级包会被整体拒绝。
- 任一步失败（包括新版本构建或启动失败）：回滚程序文件、恢复数据库、启动原版本，并在 `.ses-run/upgrade-status.json` 记录 `rolled-back`；原版本也无法启动时记录 `failed`，需要手动运行启动脚本。
- 不支持降级：TypeORM 会随版本同步表结构，降级可能丢失列数据。

### 排查

- 过程日志：`.ses-run/upgrade.log`；最终状态：`.ses-run/upgrade-status.json`（`state` 为 `running`、`succeeded`、`rolled-back` 或 `failed`）。
- `.ses-update/lock` 是升级锁，升级结束时自动删除。如果升级进程被强制终止导致残留，确认没有升级在进行后可手动删除该目录。
- 失败时 `.ses-update/db-backup/` 和 `.ses-update/rollback/` 会保留，可用于手动恢复。
