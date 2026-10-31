<p align="center">
  <img src="packages/client/src/assets/ses-logo.png" alt="SES Logo" width="360" />
</p>

# SES - 标准化文件编辑系统

**Standards Editor System** — 面向标准化组织的在线文档编辑系统，实现标准文件的高效、规范化编写和管理。

系统以 **GB/T 1.1-2020**《标准化工作导则》为编写和排版依据，提供所见即所得的编辑体验和结构化的文档管理能力。2026-10-05已决定将XML统一切换到 **GB/T 46687.2—2026**；新格式实现与验收尚未完成，见 [XML实施方案](docs/wp8-xml46687.md)。

现阶段聚焦内容编写、文档结构、格式检查、引用管理及第2部分XML交换。GB/T 46687.1—2025、GB/T 46687.3—2026暂作背景资料，不据此增加技术对象、属性、关系或可执行规则的语义建模任务；WP6/WP8范围不扩大。

---

## 功能特性

### 富文本编辑器

- 基于 Tiptap/ProseMirror 的所见即所得 (WYSIWYG) 编辑器
- 针对标准文件定制的节点类型：章节、条款、术语定义、附录、注/示例、公式等
- Slash Command 快速插入内容要素
- 文档大纲面板，支持点击跳转
- 自动编号系统（章节、条款、图表、附录）
- 数字与单位之间自动添加空格（依据 GB 3101—1993）
- 行内公式：正文、列项、注、示例、表格单元格、术语定义与公式「式中」里的符号用可视化公式编辑器（MathLive）输入（工具栏「行内公式」或 Ctrl/Cmd+Shift+M，选中带上下标的文字可直接转换），导出时与主公式同一引擎排版；「式中」按「符号 | 释义」条目编辑，旧的文字式中可一键转换，见 [Phase 7 行内公式](docs/phase7-inline-formula.md)

### 文件设置

- 编辑器内修改标准编号、中英文名称、ICS/CCS、类别、阶段及单位信息，支持发布/实施日期、代替标准和备案号等封面字段；新建与文件设置中，行业、地方、团体、企业标准显示固定前后缀，用户只填写名称片段，国家标准与指导性技术文件保持固定称谓
- 分组表单与实时信息摘要，支持保存、重置、未保存保护和窄屏布局
- 设置与封面导出同步，保留已编辑的前言和正文；验收记录见 [文件设置验收](docs/document-settings-validation.md)

### 内容与格式分离

- 编辑器内容以语义化的 ProseMirror 文档结构存储
- 支持 XML / JSON / HTML 多种结构化标注格式导出；WP6 已将 JSON 渲染迁入 shared，补齐元数据、TBX、MathML、表图资源、文献及索引模型，见 [WP6 验收](docs/wp6-validation.md)
- 新信息完整保存在 JSON；尚未支持这些信息的 DOCX/HTML/PDF/旧 XML 出口会明确拒绝，避免内容丢失
- XML后续只提供GB/T 46687.2—2026导入、导出，完全切断37967及项目旧XML；当前仍为切换前实现，不能视为已通过新国标验收

### 文档导出

- **SES 文档包**：导入与导出包含当前正文、文件设置和全部版本的 `.ses` 文件，格式与身份规则见 [SES 文档包格式](docs/ses-package-format.md)
- **DOCX 测试版**：从零生成章条结构、编号、分节、页眉页脚、目次和终结线，支持图、表、公式、横排与封面；交付要求见 [WP7 DOCX 规格](docs/wp7-docx-delivery.md)
- **PDF 版式预览**：由服务端 Vivliostyle 两遍排版生成，自动填充目次页码；无需 LibreOffice
- DOCX 中的目次页码由 Word 更新；增删章条后需重新导出以更新目次条目（见 docs/wp7-docx-delivery.md）
- DOCX 真实文稿交付验收尚未完成，当前状态、补充样稿证据及素材限制见 [WP7.6 验收记录](docs/wp7.6-delivery-validation.md)

### AI 共写（MCP）

- 本地运行的服务端提供 MCP 端点（`http://127.0.0.1:3000/mcp`），Claude Code 等客户端可以新建文档、读取结构、写入内容、校验并导出，人在编辑器里同时修改同一份文档；接入方法与安全限制见 [本地接入 MCP](docs/wp9-mcp-local-setup.md)，设计见 [WP9 人机共写方案](docs/wp9-ai-coauthoring.md)

### 版本管理

- 手动版本创建与快照保存
- 支持标准文件各阶段管理：工作草案 → 征求意见稿 → 送审稿 → 报批稿 → 发布稿
- 版本历史浏览与差异比对
- 支持回滚到指定版本

### 交叉引用与校验

- 交叉引用标记（章节、表格、图片）
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

当前版本为 [SES 0.1.1 Preview](https://github.com/funtasy2333/SEP/releases/tag/v0.1.1-preview)。请根据操作系统下载对应压缩包，**完整解压到可写的本地目录后再启动，不要直接在压缩包内运行脚本**。

| 操作系统 | 下载 | 启动 | 退出 |
| -------- | ---- | ---- | ---- |
| Windows 10/11（64 位） | [SES-0.1.1-preview-windows.zip](https://github.com/funtasy2333/SEP/releases/download/v0.1.1-preview/SES-0.1.1-preview-windows.zip) | 双击 `启动SES.cmd` | 双击 `退出SES.cmd` |
| macOS | [SES-0.1.1-preview-macos.zip](https://github.com/funtasy2333/SEP/releases/download/v0.1.1-preview/SES-0.1.1-preview-macos.zip) | 双击 `启动SES.command` | 双击 `退出SES.command` |

压缩包包含 SES 程序源码、资源、启动文件和使用说明；不包含开发过程文档、测试、已有数据库或第三方依赖。直接使用压缩包无需安装 Git 或 Python，**首次启动需要联网安装依赖并构建项目**。

#### Windows

1. 解压 Windows 压缩包，进入解压后的 SES 目录。
2. 双击 `启动SES.cmd`，等待依赖安装与构建完成，浏览器会自动打开编辑器。
3. 使用结束后，双击 `退出SES.cmd` 停止服务。

需要 Windows PowerShell 5.1 或更高版本（Windows 10/11 通常已自带）。脚本会检查现有 Node.js；未找到兼容版本时，在 SES 目录内安装经过 SHA256 校验的便携版 Node.js 22.22.0，并在本目录安装 pnpm 10.33.0，无需手动配置全局运行环境。

Windows 脚本优先尝试官方 HTTPS 来源，下载或安装失败后自动重试中国大陆 npmmirror 镜像；通过实际请求判断连接情况，不依赖 ICMP ping。此逻辑仅适用于 Windows，不修改全局 npm 源。两个来源都失败时会显示错误并停止，请检查网络或代理后重新启动。

#### macOS

1. 下载并安装 [Node.js 22.22.0（macOS 安装包）](https://nodejs.org/dist/v22.22.0/node-v22.22.0.pkg)，或使用已安装的兼容版本。
2. 在终端安装 pnpm（最低 9.0，推荐 10.33.0）：

   ```bash
   npm install -g pnpm@10.33.0
   ```

3. 解压 macOS 压缩包，在 Finder 中双击 `启动SES.command`，等待依赖安装与构建完成。
4. 使用结束后，双击 `退出SES.command` 停止服务。

如果提示脚本没有执行权限，请在终端进入解压后的 SES 目录执行以下命令，再双击启动：

```bash
chmod +x 启动SES.command 退出SES.command scripts/ses-local.sh
```

macOS 启动脚本沿用原有依赖来源配置，不包含 Windows 的自动镜像切换逻辑。

### 访问、退出与数据保存

启动成功后访问 [http://localhost:5173/](http://localhost:5173/)；Windows 启动脚本会打开 [http://127.0.0.1:5173/](http://127.0.0.1:5173/)。后端 API 使用端口 `3000`，默认只监听本机 `127.0.0.1`。

关闭启动脚本窗口后，SES 会继续在后台运行；请使用对应的退出脚本停止服务。重复启动会复用这套脚本已启动的服务，退出脚本只停止其登记的 SES 进程，保留文档数据。

| 内容 | 保存位置（相对于 SES 目录） |
| ---- | ------------------------- |
| 文档数据库 | `packages/server/data/ses.db` |
| 启动前的数据库备份 | `output/startup-backups/` |
| 服务日志 | `.ses-run/` |
| Windows 本地 Node.js 与 pnpm | `.ses-tools/` |

启动脚本会在启动后端前备份已有数据库。升级或移动 SES 前，请先退出服务并备份原目录，避免丢失文档。

如提示端口 `3000` 或 `5173` 被占用，请先退出占用端口的程序。如已通过 `pnpm dev` 启动，请先在原终端按 Ctrl+C 停止，再使用双击启动脚本。

### 可选：启用 PDF 版式预览

PDF 版式预览还需要 Poppler，DOCX 编辑与导出无需安装此依赖。

- macOS：运行 `brew install poppler`。
- Windows：安装 Poppler，并将包含 `pdftotext.exe` 和 `pdfinfo.exe` 的目录加入 `PATH`；安装后退出并重新启动 SES。

Vivliostyle 的排版浏览器可能在首次生成 PDF 时另行联网下载。更多环境说明见 [ENVIRONMENT.md](ENVIRONMENT.md)。

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
