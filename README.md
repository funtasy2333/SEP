# SES - 标准化文件编辑系统

**Standards Editor System** — 面向标准化组织的在线文档编辑系统，实现标准文件的高效、规范化编写和管理。

系统遵循 **GB/T 1.1-2020**《标准化工作导则》和 **GB/T 37967-2019** 等国家标准，提供所见即所得的编辑体验和结构化的文档管理能力。

---

## 功能特性

### 富文本编辑器

- 基于 Tiptap/ProseMirror 的所见即所得 (WYSIWYG) 编辑器
- 针对标准文件定制的节点类型：章节、条款、术语定义、附录、注/示例、公式等
- Slash Command 快速插入内容要素
- 文档大纲面板，支持点击跳转
- 自动编号系统（章节、条款、图表、附录）
- 数字与单位之间自动添加空格（依据 GB 3101—1993）

### 内容与格式分离

- 编辑器内容以语义化的 ProseMirror 文档结构存储
- 支持 XML / JSON / HTML 多种结构化标注格式导出
- 与 GB/T 37967-2019 XML 标签体系对应

### 文档导出

- **DOCX 交付稿**：生成器重建中（见 docs/wp7-docx-delivery.md）
- **PDF 导出**：通过服务端 LibreOffice 引擎将 DOCX 转换为 PDF
- 封面页、页眉页脚、目次、样式映射自动生成

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
| Node.js | 18.0.0   |
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

启动后访问 http://localhost:5173 即可使用编辑器，后端 API 运行在 http://localhost:3000。

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
| [LibreOffice](https://www.libreoffice.org/) | 开源办公套件，用于 DOCX → PDF 转换 |

---

## 许可证

本项目为私有项目。
