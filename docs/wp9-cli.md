# WP9 SES CLI 方案

状态：方案待确认，尚未实施。对应 `ses-requirements.md` Phase 9「MCP / CLI 支持」中的 CLI 部分；MCP Server、版本管理命令与 Markdown 写作输入不在首期范围。

## 1. 目标

1. 通过 CLI 生成标准文件，产物能在 SES 中导入并继续编辑；
2. 通过 CLI 直接导出 DOCX / PDF（以及 HTML、语义 JSON），出件结果与 SES 编辑器导出一致；
3. 输出对脚本和 AI Agent 友好，为后续 skill / MCP 复用同一套实现打基础。

## 2. 决策记录（2026-10-13 用户确认）

| 事项 | 决定 |
|---|---|
| 进入 SES 编辑的方式 | 仅本地文件：CLI 产出 `.ses.json`，在 SES 首页「打开 .ses.json」导入为新文档。CLI 首期不调用文档 REST，不做 push/pull |
| 写作输入格式 | IR JSON 先行（id 可省略、可推导字段可省略、行内可用字符串）；Markdown 方言放到后续阶段 |
| PDF 执行位置 | 默认在本地执行 Vivliostyle 两遍构建；`--server <url>` 时交给 SES 服务端 `/api/convert/html-to-pdf` |
| 代码组织 | 把 client / server 中的导出逻辑抽成共享包，client、server、cli 共同引用，不复制实现 |

## 3. 参考项目经验与取舍

调研对象：[excalidraw/cli](https://github.com/excalidraw/cli)（提交 55fe7f4，2026-10-08）与 [jgraph/drawio-mcp](https://github.com/jgraph/drawio-mcp)（提交 e147828，2026-10-12）。

| 经验 | 来源 | SES 的做法 |
|---|---|---|
| 本地命令无需账号，工作区命令才调 API | excalidraw `render` / `scenes` | 首期全部为本地命令；以后加服务端命令时单独分组 |
| stdout 默认 JSON；`-` 表示 stdin/stdout；`--out -` 写二进制时不再打印 JSON；提示与错误写 stderr | excalidraw | 同样约定，见 §7 |
| 渲染使用已安装的浏览器，不自动下载；`--browser-path` / 环境变量覆盖 | excalidraw | PDF 使用 `--browser-path` / `SES_BROWSER_PATH`，并探测常见 Chrome/Chromium 路径 |
| 文件必须自包含，图片内嵌，不加载外链 | excalidraw | 写作输入中的本地图片路径在构建时转为 dataURL；`http(s)` 图片直接拒绝 |
| 写入前完整校验，不留半成品 | excalidraw `scenes create --file` | `build`/`export` 先校验，失败不写输出文件 |
| 一切先成原生文件，再打开/导出 | drawio skill | 以 `.ses.json` 为中心；`export` 也接受写作 JSON，内部先转成同一份文档 |
| 简洁写作格式与精确原生格式并存 | drawio（Mermaid / XML） | 首期只做精确格式（IR JSON），Markdown 方言后续作为简洁格式 |
| 一份参考文档供 MCP、skill、项目说明共用 | drawio `shared/xml-reference.md` | `ses reference` 输出写作说明，源文件为 `packages/cli/reference.md` |
| URL 片段打开编辑器（`#create=`） | drawio | 不采用：标准文件体积大且含 base64 图片，超出 URL 长度上限；SES 为自部署系统 |
| 明确数据去向，不做隐式云端回退 | drawio「Data Residency」 | 首期只有 `export --server` 会把 HTML 发给指定服务器，见 §9 |

## 4. 包结构

```
packages/
├── shared/   # 已有：IR、Resolver、renderDocx/renderHtml、.ses.json 格式、写作输入归一化（同构纯 TS）
├── io/       # 新 @ses/io：client 与 cli 共用的同构导出工具
├── pdf/      # 新 @ses/pdf：Node 专用 Vivliostyle 两遍构建管线（server 与 cli 共用）
├── cli/      # 新 @ses/cli：命令行 ses
├── client/
└── server/
```

### 4.1 shared 新增（遵守全局不变式 1、4、5）

- `sesFile.ts`：`.ses.json` 类型、`createSesDocumentFile`、`parseSesDocumentFile`；
- `ir/authoring.ts`：`normalizeAuthoringDocument`，把写作输入归一化为 `IRDoc`、`DocumentMeta`、阶段，并给出带路径的问题列表。

### 4.2 @ses/io（从 client 迁出，行为不变）

| 模块 | 来源 |
|---|---|
| `formulaOmml.ts` | `client/src/serializer/formulaOmml.ts`（KaTeX → MathML → OMML，mathml2omml 仍为动态导入） |
| `imageResources.ts` | `client/src/serializer/imageResources.ts` |
| `docx.ts` | `client/src/serializer/docxExporter.ts` 的平台无关部分；打包输出 `Uint8Array`，client 仍包装为 `Blob` |
| `pdfRequest.ts` | `client/src/serializer/pdfExporter.ts`；目次提取改为不依赖 `DOMParser`（目次文本只含 `&amp;`/`&lt;`/`&gt;`/`&quot;` 转义，见 `renderers/html.ts` `tocText`） |
| `exportGuard.ts` | `EditorView.vue` 中导出前的脚注校验与输出边界检查 |
| `coverMetadata.ts` | `client/src/utils/documentSettings.ts` 的 `synchronizeCoverMetadata`、`COVER_SETTINGS_KEYS` |
| `defaultContent.ts` | `client/src/utils/newDocument.ts` 的 `createDefaultDocumentContent` |
| `semanticOutput.ts` | `client/src/serializer/jsonExporter.ts`、`htmlExporter.ts` 的 PM JSON 版本 |

client 中原文件保留原导出名（薄壳或重新导出），调用方与测试不需要改行为。

### 4.3 @ses/pdf（从 server 迁出）

`server/src/convert/pdf/*` 原样迁入（`pipeline`、`build`、`toc`、`katex-prerender`），只做两处接口调整：日志参数改为最小接口 `{ log, warn }`（不再依赖 Nest 类型）；`runVivliostyleBuild` 支持可选浏览器路径（转为 vivliostyle `--executable-browser`）。server 不传浏览器路径，行为不变。

server 由 `nest build`（tsc，CommonJS）编译，无法直接编译工作区 TS 源码，因此 @ses/pdf 编译为 `dist/`（CommonJS + d.ts），通过 `prepare` 在 `pnpm install` 后生成；cli 打包时经 `source` 条件直接引用源码。修改 @ses/pdf 后需重新构建（`pnpm dev` 会并行运行其 `tsc --watch`）。

KaTeX 版本保持现状：PDF 预渲染用 server 锁定的 0.16.11，DOCX 公式用 client 的 ^0.16.44。cli 打包时两份 KaTeX 各自随调用方打入，样式资源取 0.16.11，与 SES 服务端出件一致。

### 4.4 @ses/cli

- 参数解析使用 Node 内置 `util.parseArgs`，不新增运行时依赖；
- esbuild（开发依赖，复用锁文件中的 0.27.7）打包为 `dist/ses.mjs`；`mathml2omml`（LGPL）、`@vivliostyle/cli`、`katex` 保持外部模块，不打入包内；
- 根目录 `pnpm ses <命令>` 运行，首次使用前 `pnpm --filter @ses/cli build`。

## 5. `.ses.json` 文件格式

与数据库文档实体同构，导入时逐字段写入，往返不丢内容：

```json
{
  "format": "ses-document",
  "version": 1,
  "title": "示例标准",
  "stage": "working_draft",
  "meta": { "titleCn": "示例标准", "standardType": "national", "standardNo": "GB/T XXXXX—XXXX" },
  "content": { "type": "doc", "content": [] }
}
```

- `meta` 为 `DocumentMeta`；`stage` 为 `DocumentStage`；`content` 为编辑器生产 schema 的 ProseMirror JSON；
- `title` 缺省取 `meta.titleCn`；
- 可选 `generator`（如 `ses-cli 0.1.0`），导入时忽略；
- 未知顶层字段、未知 `format`/`version` 一律拒绝。

SES 导入流程：解析文件 → 生产 schema `nodeFromJSON` + `check()` → `normalizeNodeIds` → `synchronizeCoverMetadata` → 创建文档 → 进入编辑器。任何一步失败都不创建文档。CLI 无法加载编辑器 schema（依赖 Tiptap/Vue 扩展），所以生产 schema 校验以 SES 导入为准；client 测试会把 CLI 示例产物送入生产 schema，防止两端漂移。

## 6. 写作输入（`format: "ses-ir"`）

在 IR（`packages/shared/src/ir/types.ts`）基础上放宽，完整说明见 `ses reference`：

- 所有 `id` 可省略，省略时生成；交叉引用目标需要显式 `id`，重复 id 报错；
- 行内内容可写字符串，块数组中的字符串视为段落；
- 章 `secType` 缺省时按标题推断（范围 / 规范性引用文件 / 术语和定义），其余为 `general`；
- 条 `level` 由嵌套深度推导，显式值不一致时报错；`titled` 缺省为「标题非空」；
- 表格单元格可写字符串，`headerRowCount` 缺省为 1，前 `headerRowCount` 行默认为表头；
- 图片 `src` 可写相对写作文件的本地路径，构建时转为 dataURL；
- 元数据 `meta` 使用文件设置字段（`DocumentMeta`），`standardType` 缺省为 `national`；
- 首期支持的块：段落、列项、表、图、公式、注、示例；术语条目、附录、参考文献按 IR 字段写。其余 IR 扩展块报错并给出路径。

归一化后的 IR 通过 `irToPm` 投影为生产 PM JSON；投影诊断（`IRToPmError`）原样作为问题返回。

## 7. 命令

| 命令 | 说明 |
|---|---|
| `ses init [--out <file>] [--type <类型>] [--title <名称>] [--stage <阶段>]` | 生成写作模板（含默认前言和前三章），默认写到 stdout |
| `ses build <input> [--out <file>]` | 写作 JSON → `.ses.json`；输入已是 `.ses.json` 时校验后原样规范化输出 |
| `ses validate <input>` | 归一化 + Resolver 校验 + 各格式输出边界检查，输出问题列表 |
| `ses export <input> --format docx\|pdf\|html\|json [--out <file>\|-]` | 导出；PDF 另有 `--server`、`--browser-path`、`--timeout` |
| `ses reference` | 打印写作说明（Markdown） |

`<input>` 可以是 `.ses.json`、写作 JSON 或 `-`（stdin），按 `format` 字段识别。

输出约定：

- 成功时 stdout 输出一个 JSON 对象（`ok: true` 及路径、字节数、告警等）；`--out -` 输出文件内容本身；
- 校验失败或导出被阻止时 stdout 输出 `{ "ok": false, "problems": [...] }`，stderr 输出一行说明，退出码 1；
- 运行错误退出码 1，参数错误退出码 2；
- 导出前检查与编辑器一致：脚注错误与 `getOutputSupportProblems` 阻止 DOCX/HTML/PDF；
- DOCX `createdAt` 默认取当前时间，可用 `--created-at` 或 `SOURCE_DATE_EPOCH` 固定，保证可复现。

## 8. PDF 浏览器

本地 PDF 依赖 `@vivliostyle/cli`（随 cli 安装）、Chromium 系浏览器和 poppler（`pdftotext`/`pdfinfo`）。浏览器取 `--browser-path` → `SES_BROWSER_PATH` → 常见安装路径，都没有时交给 vivliostyle 默认行为。缺少 poppler 时给出安装提示并退出。

## 9. 数据去向

- `init`、`build`、`validate`、`export --format docx|html|json`、本地 PDF：全部在本机完成，不发网络请求；
- `export --format pdf --server <url>`：把 print HTML 与目次目标发送到指定 SES 服务端；
- 写作输入中的 `http(s)` 图片不下载，直接报错。

## 10. 分期

| 阶段 | 内容 |
|---|---|
| WP9.1（本期） | 共享包抽取；`init`/`build`/`validate`/`export`/`reference`；SES 首页导入 `.ses.json` |
| WP9.2 | 写作输入 JSON Schema（由类型生成）；Claude Code skill（复用 `reference.md`） |
| WP9.3 | Markdown 写作方言（与 Phase 8 映射规则一致）；DOCX 内嵌源 JSON 以便回到 SES |
| 后续 | 版本命令、服务端命令（需鉴权方案）、MCP Server（复用同一实现） |

## 11. 验收

1. shared / io / pdf / client / server 既有测试全部通过，迁移不改变已有行为（DOCX golden、PDF 目次测试不变）；
2. `ses build` 示例产物在 client 测试中通过生产 schema `check()`，并可经 SES 首页导入；
3. `ses export` 生成的 DOCX 与同一文档在编辑器导出的 DOCX 部件逐字节一致（固定 `createdAt`）；
4. 本机安装 Chromium 与 poppler 时，`ses export --format pdf` 产出目次带页码的 PDF；
5. 输出约定（JSON、退出码、`-`）有测试覆盖。
