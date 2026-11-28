<p align="center">
  <img src="packages/client/src/assets/ses-logo.png" alt="SES Logo" width="360" />
</p>

# SES - 标准化文件编辑系统

**Standards Editor System** — 面向标准化组织的在线文档编辑系统，实现标准文件的高效、规范化编写和管理。

系统以 **GB/T 1.1-2020**《标准化工作导则》为编写和排版依据，提供所见即所得的编辑体验和结构化的文档管理能力；XML 导出、导入与版本快照已统一切换到 **GB/T 46687.2—2026**，方案见 [XML实施方案](docs/wp8-xml46687.md)。

现阶段聚焦内容编写、文档结构、格式检查、引用管理及第2部分XML交换。GB/T 46687.1—2025、GB/T 46687.3—2026暂作背景资料，不据此增加技术对象、属性、关系或可执行规则的语义建模任务；WP6/WP8范围不扩大。

---

## 功能特性

### 富文本编辑器

- 基于 Tiptap/ProseMirror 的所见即所得 (WYSIWYG) 编辑器
- 针对标准文件定制的节点类型：章节、条款、术语定义、附录、注/示例、公式等
- Slash Command 快速插入内容要素
- 文档大纲面板，支持点击跳转
- 自动编号系统（章节、条款、图表、附录）
- 列项编号可选「继续前一列项编号」或「重新编号」：被段落或二级列项隔开的同一组列项接着编号（如 a）、b） 后接 c）），二级列项照常从 1）开始；编辑器、内部引用与 DOCX/PDF/HTML/XML 编号一致，见 [列项继续编号验收](docs/qa/2026-11-02-list-continuation.md)
- 数字与单位之间自动添加空格（依据 GB 3101—1993）
- 符号（行内公式）：正文、列项、注、示例、表格单元格、术语定义与公式「式中」里带上下标的量、变量符号用可视化公式编辑器（MathLive）输入（工具栏「符号」或 Ctrl/Cmd+Shift+M，选中带上下标的文字可直接转换；运算式请用「公式」单独成行），导出时与主公式同一引擎排版；「式中」按「符号 | 释义」条目编辑，旧的文字式中可一键转换，见 [Phase 7 行内公式](docs/phase7-inline-formula.md)

### 文件设置

- 编辑器内修改标准编号、中英文名称、ICS/CCS、类别、阶段及单位信息，支持发布/实施日期、代替标准和备案号等封面字段；新建与文件设置中，行业、地方、团体、企业标准显示固定前后缀，用户只填写名称片段，国家标准与指导性技术文件保持固定称谓
- 分组表单与实时信息摘要，支持保存、重置、未保存保护和窄屏布局
- 设置与封面导出同步，保留已编辑的前言和正文；验收记录见 [文件设置验收](docs/document-settings-validation.md)

### 内容与格式分离

- 编辑器内容以语义化的 ProseMirror 文档结构存储
- 支持 XML（GB/T 46687.2—2026）/ JSON / HTML 多种结构化标注格式导出；WP6 已将 JSON 渲染迁入 shared，补齐元数据、TBX、MathML、表图资源、文献及索引模型，见 [WP6 验收](docs/wp6-validation.md)
- 新信息完整保存在 JSON；尚未支持这些信息的 DOCX/HTML/PDF/XML 出口会按输出边界明确拒绝，避免内容丢失
- XML 仅提供 **GB/T 46687.2—2026** 导入与导出（纯 `.xml` 与含图片资源的 `.zip` 资源包），已完全切断 GB/T 37967 及项目早期自定义 XML（遇到旧格式将明确报错拒绝）

### 文档导出

- **SES 文档包**：导入与导出包含当前正文、文件设置和全部版本的 `.ses` 文件，格式与身份规则见 [SES 文档包格式](docs/ses-package-format.md)
- **DOCX 测试版**：从零生成章条结构、编号、分节、页眉页脚、目次和终结线，支持图、表、公式、横排与封面；交付要求见 [WP7 DOCX 规格](docs/wp7-docx-delivery.md)
- **PDF 版式预览**：0.3.1 Preview 暂停 PDF 导出。
- DOCX 中的目次页码由 Word 更新；增删章条后需重新导出以更新目次条目（见 docs/wp7-docx-delivery.md）
- DOCX 真实文稿交付验收尚未完成，当前状态、补充样稿证据及素材限制见 [WP7.6 验收记录](docs/wp7.6-delivery-validation.md)

### AI 共写（MCP）

Agent 可以在 SES 中新建、读取、修改、校验和导出文档。你可以在编辑器里继续编辑同一份文档。

#### 支持的 Agent

| 图标 | 名称 |
|:---:|---|
| 💻 | Codex |
| ✳️ | Claude Code |
| 🚀 | Antigravity |
| ✨ | Gemini Desktop |
| 🤝 | WorkBuddy |
| 🫘 | 豆包工作 |
| 💠 | 千问办公 |

接入需要使用支持自定义 Streamable HTTP MCP 服务的本地客户端或本地会话。先在同一台电脑上启动 SES，并保持服务端运行。以下示例使用默认端口 `3000`，如已修改 `PORT`，请替换为实际端口。

#### 方式一：让 Agent 帮你配置

把下面这段提示词发给本机的 Agent：

> 请帮我把本机运行的 SES 添加到当前 Agent 的 MCP 配置中，服务名为 ses，使用 Streamable HTTP 连接 http://127.0.0.1:3000/mcp。请按当前客户端的配置格式添加，保留已有的 MCP 服务和工具授权设置。配置生效后，请调用 ses 的只读工具 list_documents 验证连接，并告诉我是否成功。

#### 方式二：用 JSON 配置 Streamable HTTP

如果客户端使用 `mcpServers` 和 `type: "http"`，可在 MCP 设置中合并下面的 `ses` 条目。其他配置格式可用方式一。

```json
{
  "mcpServers": {
    "ses": {
      "type": "http",
      "url": "http://127.0.0.1:3000/mcp"
    }
  }
}
```

保存后重新连接，让 Agent 调用 `list_documents`。返回文档列表即表示接入成功，空列表也表示连接正常。

`export_document` 可以向本机允许的目录写入文件，建议保留逐次确认。工具列表与权限说明见[本地接入 MCP](docs/wp9-mcp-local-setup.md)，设计背景见 [WP9 人机共写方案](docs/wp9-ai-coauthoring.md)。

### 版本管理

- 手动版本创建与快照保存
- 支持标准文件各阶段管理：工作草案 → 征求意见稿 → 送审稿 → 报批稿 → 发布稿
- 版本历史浏览与差异比对
- 支持回滚到指定版本

### 交叉引用与校验

- 交叉引用标记（章节、表格、图片）：工具栏「交叉引用」插入对本文件内容的引用（如“见5.2”），与引用其他文件（规范性引用、参考文献）区分
- 参考文献管理
- 格式一致性检查

---

## 技术架构

```
SEP/
├── packages/
│   ├── client/     # 前端 - Vue 3 + Vite + Tiptap
│   ├── server/     # 后端 - NestJS + TypeORM + SQLite
│   └── shared/     # 共享类型定义
└── scripts/        # 辅助调试脚本
```

- **前端**：Vue 3 + TypeScript + Vite，使用 Element Plus 组件库，Tiptap v3 编辑器
- **后端**：NestJS + TypeORM + better-sqlite3，提供 REST API
- **Monorepo**：pnpm Workspace 管理多包结构

---

## 安装与启动

### 下载使用（推荐）

当前版本为 [SES 0.3.1 Preview](https://github.com/funtasy2333/SEP/releases/tag/v0.3.1-preview)。请根据操作系统下载对应压缩包，**完整解压到可写的本地目录后再启动，不要直接在压缩包内运行脚本**。

| 操作系统 | 下载 | 启动 | 退出 |
| -------- | ---- | ---- | ---- |
| Windows 10/11（64 位 x64，自包含） | [SES-0.3.1-preview-windows.zip](https://github.com/funtasy2333/SEP/releases/download/v0.3.1-preview/SES-0.3.1-preview-windows.zip) | 双击 `启动SES.cmd` | 双击 `退出SES.cmd` |
| macOS（Apple Silicon arm64，自包含） | [SES-0.3.1-preview-macos-arm64.zip](https://github.com/funtasy2333/SEP/releases/download/v0.3.1-preview/SES-0.3.1-preview-macos-arm64.zip) | 双击 `启动SES.command` | 双击 `退出SES.command` |
| macOS（通用源码包 / Intel） | [SES-0.3.1-preview-macos.zip](https://github.com/funtasy2333/SEP/releases/download/v0.3.1-preview/SES-0.3.1-preview-macos.zip) | 双击 `启动SES.command` | 双击 `退出SES.command` |

Windows x64 与 macOS Apple Silicon 自包含发布包已内置 Node.js 22.22.0、已构建前后端和生产依赖，**完整解压后即可离线启动，无需安装 Node.js、pnpm、Git 或 Python**。通用 macOS 源码包首次启动需联网安装依赖并构建。

#### Windows

1. 解压 Windows 压缩包，进入解压后的 SES 目录。
2. 双击 `启动SES.cmd`；启动成功后终端窗口会自动关闭，浏览器会自动打开编辑器，并在首次成功启动时自动创建桌面和开始菜单快捷方式 `SES`（若启动失败则保留终端窗口显示报错信息）。
3. 使用结束后，双击 `退出SES.cmd` 停止服务（成功退出后窗口自动关闭），或在网页右上角「设置」中点击「退出 SES」。

需要 Windows PowerShell 5.1 或更高版本（Windows 10/11 通常已自带）。若使用源码模式或切换到「每次提交」通道，脚本会按需在本目录 `.ses-tools/` 安装经过 SHA256 校验的便携版 Node.js 22.22.0 与 pnpm 10.33.0，优先尝试官方 HTTPS 来源，失败后自动重试中国大陆 npmmirror 镜像（不修改全局 npm 源）。

#### macOS

- **Apple Silicon（M 系列，推荐）**：下载 `SES-0.3.1-preview-macos-arm64.zip`，解压后在 Finder 中双击 `启动SES.command` 即可离线启动；启动成功后窗口会自动关闭，并在首次成功启动时自动在桌面与 `~/Applications` 创建 `SES.app` 快捷方式（失败时保留窗口提示）。使用结束后双击 `退出SES.command` 或在网页「设置」中点击「退出 SES」。
- **Intel Mac / 通用源码包**：需先安装 [Node.js 22.22.0（macOS 安装包）](https://nodejs.org/dist/v22.22.0/node-v22.22.0.pkg) 与 `npm install -g pnpm@10.33.0`，再下载解压 `SES-0.3.1-preview-macos.zip` 并双击 `启动SES.command`（首次启动将联网安装依赖并构建）。

如果提示脚本没有执行权限，请在终端进入解压后的 SES 目录执行以下命令，再双击启动：

```bash
chmod +x 启动SES.command 退出SES.command scripts/ses-local.sh scripts/ses-desktop.sh
```

macOS 源码包沿用原有依赖来源配置，不包含 Windows 的自动镜像切换逻辑。

### 访问、退出与数据保存

启动成功后访问 [http://localhost:5173/](http://localhost:5173/)；Windows 启动脚本会打开 [http://127.0.0.1:5173/](http://127.0.0.1:5173/)。后端 API 使用端口 `3000`，默认只监听本机 `127.0.0.1`。

可在网页右上角「设置」中随时重新创建桌面与开始菜单/应用程序快捷方式，或开关「开机后台自启」（登录系统后静默在后台启动 SES 服务，无需管理员权限）。

关闭启动脚本窗口后，SES 会继续在后台运行；请使用对应的退出脚本停止服务。**关闭网页同样不会退出 SES**，需要使用退出脚本，或在网页「设置 → 升级 / 退出」中点击「退出 SES」。重复启动会复用这套脚本已启动的服务，退出脚本只停止其登记的 SES 进程，保留文档数据。

| 内容 | 保存位置（相对于 SES 目录） |
| ---- | ------------------------- |
| 文档数据库 | `packages/server/data/ses.db` |
| 启动前的数据库备份 | `output/startup-backups/`（默认保留最近 10 份） |
| 应用内升级前的数据库备份 | `output/upgrade-backups/`（默认保留最近 5 份） |
| 服务日志 | `.ses-run/` |
| 升级日志与结果 | `.ses-run/upgrade.log`、`.ses-run/upgrade-status.json` |
| 升级临时文件 | `.ses-update/`（升级结束后自动清理，可忽略） |
| Windows 本地 Node.js 与 pnpm | `.ses-tools/` |

启动脚本只在源码、依赖或 Node 版本变化时重新构建后端（需要强制重建可设置 `SES_FORCE_BUILD=1`），并在启动后端前按需备份已有数据库（自上次备份后未变化则跳过，最多保留最近 10 份，可通过 `SES_STARTUP_BACKUP_KEEP` 调整）。手动升级或移动 SES 前，请先退出服务并备份原目录，避免丢失文档。

### 升级

**应用内升级（推荐）**：在网页「设置 → 升级 / 退出」中检查并安装新版本，无需手动下载或复制文件。有两个通道：

| 通道 | 来源 | 说明 |
| ---- | ---- | ---- |
| 稳定版 | GitHub Release | 正式发布的预览版本，默认通道 |
| 每次提交 | main 分支最新提交 | 可能不稳定，仅建议想尽早试用新功能时选择 |

升级过程由 SES 自动完成：停止服务 → 备份数据库到 `output/upgrade-backups/`（默认保留最近 5 份，可通过 `SES_UPGRADE_BACKUP_KEEP` 调整） → 解压并替换程序文件 → 重新启动（必要时补装依赖并重新构建，需要联网）。新版本无法启动时，会自动恢复升级前的程序文件和数据库，并重新启动原版本；结果和原因会显示在设置页，详细日志在 `.ses-run/upgrade.log`。升级只替换程序源码，不会改动文档数据（`packages/server/data/`）、`node_modules`、`.ses-tools/`、`output/` 和 `.env`。

- 不支持降级：只能升级到比当前更新的版本，旧版本无法读取新版本改过的数据库结构。
- 应用内升级与「退出 SES」仅在通过启动脚本启动的 SES 上可用；用 `pnpm dev` 启动的开发服务不提供。
- 升级期间请不要手动运行启动或退出脚本。

**从 0.1.1 及更早版本升级**：这些版本不含应用内升级，需要手动升级一次：先双击退出脚本停止旧版本，把旧目录中的 `packages/server/data/ses.db` 复制到新版本目录的同一位置后再启动。升级前请备份整个旧目录。完成后，之后的版本即可在应用内升级。

如提示端口 `3000` 或 `5173` 被占用，请先退出占用端口的程序。如已通过 `pnpm dev` 启动，请先在原终端按 Ctrl+C 停止，再使用双击启动脚本。

### 从源码开发

需要自行安装 Git、Node.js 和 pnpm。推荐使用 Node.js **22.22.0** 与 pnpm **10.33.0**；项目最低 Node.js 版本为 20.19.0，使用 Node.js 22 时需至少 22.12.0，pnpm 至少 9.0。

```bash
# 克隆项目
git clone https://github.com/funtasy2333/SEP.git
cd SEP

# 按锁文件安装依赖
pnpm install --frozen-lockfile

# 启动前端和后端开发服务
pnpm dev
```

启动后访问 [http://localhost:5173/](http://localhost:5173/)。开发服务在前台运行，按 Ctrl+C 停止。也可以分别启动前后端：

```bash
pnpm dev:client   # 仅前端
pnpm dev:server   # 仅后端
```

构建项目：

```bash
pnpm build
```

双击启动脚本采用构建后的后端代码；修改后端代码后，需要先退出服务再重新启动。需要从局域网访问或配置 MCP 时，请参阅 [本地接入 MCP](docs/wp9-mcp-local-setup.md)。

---

## 开源项目致谢

本项目的开发依赖于以下优秀的开源项目：

### 前端

| 项目 | 说明 |
| ---- | ---- |
| [Vue 3](https://github.com/vuejs/core) | 渐进式 JavaScript 框架 |
| [Vite](https://github.com/vitejs/vite) | 下一代前端构建工具 |
| [Tiptap](https://github.com/ueberdosis/tiptap) | 基于 ProseMirror 的无头富文本编辑器框架 |
| [ProseMirror](https://github.com/ProseMirror/prosemirror) | 底层富文本编辑器工具包 |
| [Element Plus](https://github.com/element-plus/element-plus) | Vue 3 UI 组件库 |
| [Pinia](https://github.com/vuejs/pinia) | Vue 状态管理库 |
| [Vue Router](https://github.com/vuejs/router) | Vue 官方路由库 |
| [JSZip](https://github.com/Stuk/jszip) | JavaScript ZIP 压缩/解压库 |
| [KaTeX](https://github.com/KaTeX/KaTeX) | 快速的数学公式排版库 |
| [mathml2omml](https://github.com/fiduswriter/mathml2omml) | KaTeX MathML 转 Word OMML；LGPL-3.0-or-later，按需动态加载 |
| [Axios](https://github.com/axios/axios) | HTTP 客户端 |
| [diff](https://github.com/kpdecker/jsdiff) | JavaScript 文本差异比对库 |

### 后端

| 项目 | 说明 |
| ---- | ---- |
| [NestJS](https://github.com/nestjs/nest) | 渐进式 Node.js 服务端框架 |
| [TypeORM](https://github.com/typeorm/typeorm) | TypeScript ORM 框架 |
| [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) | 高性能 SQLite3 驱动 |
| [Multer](https://github.com/expressjs/multer) | Node.js 文件上传中间件 |

### 工具链

| 项目 | 说明 |
| ---- | ---- |
| [TypeScript](https://github.com/microsoft/TypeScript) | JavaScript 的超集，提供静态类型 |
| [pnpm](https://github.com/pnpm/pnpm) | 快速、节省磁盘空间的包管理器 |
| [ESLint](https://github.com/eslint/eslint) | JavaScript/TypeScript 代码检查工具 |
| [Prettier](https://github.com/prettier/prettier) | 代码格式化工具 |
| [Jest](https://github.com/jestjs/jest) | JavaScript 测试框架 |

### 可选依赖

| 项目 | 说明 |
| ---- | ---- |
| [Poppler](https://poppler.freedesktop.org/) | PDF 版式预览的页码定位与页数检查 |

---

## 许可证

本项目采用 [Apache License 2.0](LICENSE) 许可证。

Copyright 2026 funtasy2333

第三方依赖各自遵循其原有许可证。
