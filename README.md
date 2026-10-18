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
- 公式「式中」按「符号 | 释义」条目编辑，符号用可视化公式编辑器（MathLive）输入，导出时与主公式同一引擎排版；旧的文字式中可一键转换，见 [式中符号公式化](docs/where-symbol-formula.md)

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

## 快速开始

### 环境要求

| 依赖项  | 最低版本 |
| ------- | -------- |
| Node.js | 20.19.0  |
| pnpm    | 9.0      |

> 详细的环境配置说明请参阅 [ENVIRONMENT.md](ENVIRONMENT.md)

### 安装与启动

```bash
# 克隆项目
git clone https://github.com/funtasy2333/SEP.git
cd SEP

# 安装依赖
pnpm install

# 启动开发环境（前端 + 后端）
pnpm dev
```

启动后访问 http://localhost:5173 即可使用编辑器，后端 API 运行在 http://localhost:3000（默认只监听本机 127.0.0.1，局域网内的其他设备访问不到；如需开放，见 [本地接入 MCP](docs/wp9-mcp-local-setup.md) 的 `SES_LISTEN_HOST`）。

也可以分别启动前端和后端：

```bash
pnpm dev:client   # 仅前端
pnpm dev:server   # 仅后端
```

### 构建

```bash
pnpm build
```

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

本项目为私有项目。
