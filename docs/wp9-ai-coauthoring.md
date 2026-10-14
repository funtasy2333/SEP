# WP9 人机共写方案（MCP 接入）

状态：WP9.1、WP9.2 已完成（2026-10-13，见 §10、§11）；WP9.3（MCP，本地部署）已完成（2026-10-14，见 §12）；原 WP9.4（云端接入）已并入 Phase 11（2026-10-14）。对应 `ses-requirements.md` Phase 9「MCP / CLI 支持」，并为 Phase 10「AI 集成」、Phase 11「实时协同」预留同一套写入机制。

## 1. 目标

最终目标是**人机共写**：AI 与人在 SES 中编辑同一份文档，始终只有一份。分两步走：

1. **接力编辑**（本方案首期）：人和 AI 轮流修改同一份文档，互不覆盖；AI 的每次修改都可追溯、可回滚；人在编辑器中能及时看到 AI 的修改；
2. **实时共写**（Phase 11）：人和 AI 同时修改，修改实时可见。2026-10-14 起 Phase 11 的协作主模型为实时协同，人与人、人与 AI 共用同一套协同机制。

DOCX/PDF 出件、`.ses.json` 导入导出作为配套能力保留。

## 2. 决策记录

| 日期 | 决策 | 状态 |
|---|---|---|
| 2026-10-13 | 方向为「AI 与人在 SES 里接力编辑同一份文档」，最终实现人机共写；文档以 SES 服务端为准 | 生效 |
| 2026-10-13 | AI 接入以 MCP 为主；CLI 以后作为同一写入层的薄客户端 | 生效 |
| 2026-10-13 | 写入内容使用 IR 片段（id 可省略、可推导字段可省略、行内可写字符串），Markdown 放后续 | 生效 |
| 2026-10-13 | 导出逻辑抽成共享包，避免重复实现 | 生效，范围调整为「让服务端能使用 shared 与 DOCX 出件」 |
| 2026-10-13 | 仅本地 `.ses.json` + SES 导入 | 被取代：`.ses.json` 只作为导入/导出/备份格式，不是编辑主路径 |
| 2026-10-13 | CLI 本地生成 PDF | 被取代：出件在服务端完成，沿用现有 Vivliostyle 管线 |
| 2026-10-13 | 服务端改用 webpack 打包式构建（§6.6 方案 2） | 生效，WP9.1 已实施 |
| 2026-10-13 | 冲突时不预设默认处理，每次弹框由人选择「重新加载」或「另存为副本」 | 生效，WP9.1 已实施 |
| 2026-10-13 | 「AI 写入前自动快照」移到 WP9.2，与 AI 写入入口一起实现；WP9.1 只增加版本来源字段 | 生效 |
| 2026-10-13 | AI 修改直接生效；每批 AI 写入在版本历史中留一条明确标注「AI 修改」的记录，可直接比较出该批修改的内容 | 生效（§6.5） |
| 2026-10-13 | 批准新增运行时依赖 `@modelcontextprotocol/sdk`（server，WP9.3 使用） | 生效，锁定 1.31.0 |
| 2026-10-14 | WP9.3 只做本地部署接入（Claude Code 等连接本机 SES 的 `/mcp`）；云端接入（claude.ai 连接器、用户与鉴权、OAuth）放到 WP9.4 | 被取代：WP9.4 并入 Phase 11 |
| 2026-10-14 | 原 WP9.4「云端接入」并入 Phase 11，在其服务器部署与用户管理之后实施；用户、角色权限、多端访问都归 Phase 11 | 生效 |
| 2026-10-14 | Phase 11 协作主模型由 PR 式异步协作改为实时协同（PR 式降为可选增强），见 `ses-requirements.md` | 生效 |
| 2026-10-14 | `export_document` 的 `outputPath` 只能写到允许的目录（未配置时只允许默认导出目录） | 生效 |
| 2026-10-14 | 本地部署的服务端默认只监听本机（127.0.0.1），需要局域网访问时显式配置 | 生效 |
| 2026-10-14 | Phase 9 的 CLI 与 OpenAPI 文档推迟：AI 调用由 MCP 覆盖；等做 CLI 或对接外部系统时再做 | 生效 |
| 待定 | 云端部署的具体形态 | 在 Phase 11 确定，见 §8 |

## 3. 参考项目经验

调研对象：[excalidraw/cli](https://github.com/excalidraw/cli)（提交 55fe7f4，2026-10-08）、[jgraph/drawio-mcp](https://github.com/jgraph/drawio-mcp)（提交 e147828，2026-10-12）。

| 经验 | 来源 | 本方案的做法 |
|---|---|---|
| 按元素 id 合并的 `patch`，版本号高者生效；`put` 整体替换 | excalidraw `scenes content patch/put` | 按 nodeId 做节点级操作，写入带修订号（§6.1、§6.3） |
| 写入前完整校验，不合法不落库 | excalidraw `scenes create --file` | 每次写入先过生产 schema 校验，失败整批不写 |
| 大文件按页读写，只把需要的部分放进上下文 | drawio `list_pages`/`get_page`/`set_page` | 结构树 + 单节点读写，避免整篇文档进入 AI 上下文 |
| 一份写作参考供 MCP、skill、项目说明共用 | drawio `shared/xml-reference.md` + `get_drawio_reference` | `get_authoring_reference` 工具返回同一份写作说明 |
| 托管与自托管两种部署，明确数据去向 | drawio「Data Residency」 | 按部署方式说明 MCP 接入与数据去向（§6.8） |
| 机器可读输出、错误信息不混入数据 | excalidraw | 工具返回结构化结果，问题带路径、nodeId 与原因 |

## 4. 现状与差距（2026-10-13 核对代码）

> WP9.1 之后：第 2 项已由修订号与乐观锁解决；第 4 项已解决（服务端打包引用 shared 与 `@ses/io`）；第 6 项已增加来源字段；第 8 项服务端已可出 DOCX。
> WP9.2 之后：第 3 项由 SSE 变更推送解决；第 5 项服务端已通过别名打包引用 client 的生产 schema（§11）；第 8 项服务端可出 PDF/HTML/JSON。第 7 项（用户与鉴权）归 Phase 11。

1. **存储**：文档与版本存于 SQLite（`packages/server/data/ses.db`，表 `documents`、`versions`）；图片以 dataURL 内嵌在正文 JSON，服务端没有独立文件存储。
2. **整篇覆盖写入**：编辑器自动保存以 `PUT /api/documents/:id` 提交整份正文；`document.service.ts` `update` 直接 `Object.assign` 后保存，不检查版本。人和 AI 同时修改时，后写入者会静默覆盖先写入者。
3. **编辑器不感知外部修改**：文档只在打开时加载，之后不会得知服务端内容已变。
4. **服务端不使用 `@ses/shared`**：`pmToIr`、`resolve`、`renderDocx` 只在浏览器运行。
   - 原因一（有提交记录）：服务端只负责文档存取、版本与 HTML→PDF；WP5（#27）把 PDF 设计为「浏览器渲染 print HTML 后提交给服务端」，提交说明为「shared 零改动」。正文起始哨兵 `SESBODYSTARTANCHOR` 在 `server/src/convert/pdf/toc.ts` 中复制了一份，注释为「跨包字符串契约，二者必须同步修改」；`DocumentEntity.meta` 也是服务端自写的类型，未复用 shared 的 `DocumentMeta`。
   - 原因二（2026-10-13 实验）：shared 的包入口直接指向 TS 源码（`./src/index.ts`），面向 Vite/vitest 这类会转译 TS 的工具。临时让 server 引用 shared 后，`nest build` 通过（TS 不为经 `node_modules` 解析到的文件产出 JS）、jest 通过（ts-jest 会转译），但 Node 运行编译产物时直接加载 shared 的 TS 源码，报 `ERR_UNSUPPORTED_DIR_IMPORT`（shared 内部使用打包器风格的无扩展名、目录导入）。即编译和测试都通过、启动时才失败。
5. **生产 schema 在 client**：PM schema 由 `client/src/extensions/editorExtensions.ts` 的 Tiptap 扩展构建。实测 `getSchema(createEditorExtensions())` 可在纯 Node 环境构建（88 种节点，根节点 `doc`），但服务端如何引用尚需确定打包方式。
6. **版本无来源信息**：`versions` 表只有 `versionNo/stage/content/xml/note`，无法区分人工修改与 AI 修改。
7. **无用户与鉴权**：现有接口不区分调用者；CORS 只放行本机开发端口。
8. **出件位置**：DOCX 在浏览器生成（公式 OMML、图片资源、JSZip 打包在 `client/src/serializer/`）；PDF 已在服务端（`server/src/convert/pdf/`）。

## 5. 总体架构

```
AI 客户端（Claude Code / Claude Desktop / claude.ai）──MCP──┐
SES 编辑器（人）─────────── REST + 变更推送 ──────────────┤
（后续）CLI、编辑器内 AI 侧边栏 ───────────────────────────┤
                                                          ▼
                     SES 服务端：文档操作层（所有写入的唯一入口）
                       ├─ 修订号与乐观锁
                       ├─ 按 nodeId 的节点级操作 + 生产 schema 校验
                       ├─ AI 写入前自动快照、来源标记
                       ├─ 变更推送（SSE）
                       └─ 出件：DOCX（共享出件包）、PDF（现有管线）
                                                          ▼
                                       存储（SQLite；随部署方式调整）
```

原则：人、AI、以后的 CLI 都经过同一个文档操作层写入；MCP 只是其中一个入口。实时共写阶段替换操作层的内部实现，不改各入口的接口。

## 6. 关键设计

### 6.1 修订号与乐观锁

- `documents` 增加 `revision`（整数，每次写入加 1）；读取接口返回当前 `revision`；
- 所有写入携带 `baseRevision`，与当前值不一致时返回 `409` 和最新 `revision`，不写入；
- 编辑器自动保存遇到 `409` 时暂停自动保存并提示「文档已被修改」，由人选择「重新加载」或「另存为副本」，不做静默合并（默认选项待定，见 §8）。

### 6.2 变更推送

- `GET /api/documents/:id/events`（SSE）推送 `revision` 变化及来源（人 / AI）；
- 编辑器没有未保存修改时自动重新加载；有未保存修改时提示，规则同 §6.1。

### 6.3 文档操作层

| 操作 | 说明 |
|---|---|
| 结构树 | 章、条、附录、表、图、公式等的 nodeId、类型、编号、标题，由 `pmToIr` + `resolve` 计算 |
| 读取节点 | 返回指定 nodeId 的内容（IR 片段）及编号 |
| 批量写入 | `apply_operations(baseRevision, operations[])`：插入（指定父节点及前后位置）、替换、删除、移动、修改文件设置；整批原子执行 |
| 校验 | Resolver 问题 + 各格式输出边界检查（与编辑器导出前检查一致） |
| 出件 | DOCX / PDF / HTML / 语义 JSON / `.ses.json` |

写入流程：读取最新文档 → 在 PM JSON 中按 nodeId 定位并执行操作，只把新增片段经 `irToPm` 投影 → 生产 schema `check()` → `normalizeNodeIds` → `synchronizeCoverMetadata` → 写入并把 `revision` 加 1 → 推送变更。不做整篇 IR 往返，避免 `pmToIr`/`irToPm` 往返对未覆盖内容造成影响。这一点需在实施初期做技术验证。

### 6.4 写入内容格式

插入或替换的内容使用 IR 片段，在 `packages/shared/src/ir/types.ts` 基础上放宽：

- `id` 可省略，省略时生成；被交叉引用的目标需要显式 `id`；
- 行内内容可写字符串，块数组中的字符串视为段落；
- 条 `level` 由插入位置推导；章 `secType` 缺省时按标题推断（范围 / 规范性引用文件 / 术语和定义）；
- 表格单元格可写字符串，`headerRowCount` 缺省为 1；
- 图片 `src` 只接受 dataURL，不下载外链。

归一化放在 shared（同构纯 TS），MCP、CLI、编辑器内 AI 共用。

### 6.5 AI 修改的追溯与撤销

- `versions` 增加 `source`（`human` / `ai` / `import`）与 `client`（如 MCP 客户端名称）字段（WP9.1 已实施）；
- AI 修改直接生效（2026-10-13 决定）。每批 AI 写入在同一事务中生成一条版本记录：`source = 'ai'`、`client` 为写入方、`note` 为操作摘要；`content` 为写入后的内容，新增 `baseContent` 保存写入前的内容；
- 版本历史中该记录明确标注「AI 修改」，可直接查看 `baseContent → content` 的差异，即只包含这一批 AI 修改，不混入其间人的编辑；
- 可一键回滚到该批 AI 修改之前（`baseContent`）；
- 后续可选「建议模式」：AI 修改以待接受的建议呈现，人逐条接受或拒绝。

### 6.6 服务端使用 shared 与 DOCX 出件

需要先解决服务端引用工作区 TS 包的问题（见 §4 第 4 项），候选方案：

1. 给 `@ses/shared` 和共享出件包增加构建产物，server 引用构建产物。需要为 shared 内部导入补扩展名或另用打包器产出，且每次修改 shared 后都要重新构建；
2. server 改用打包式构建，把工作区源码打入 `dist`。可选 Nest CLI 的 webpack 构建（ts-loader 保留 Nest 依赖注入所需的 `emitDecoratorMetadata`；需配置为把 `@ses/*` 打入产物，而不是当作外部依赖）。不能直接用 esbuild：它不支持 `emitDecoratorMetadata`。

倾向方案 2：服务端还需要引用生产 schema（client 的 Tiptap 扩展）和 `@ses/io`，打包式构建不必为每个包分别产出构建结果。方案 2 只改 server 的构建配置，不改 shared 和 client 的代码与构建；方案 1 要改写 shared 全部内部导入。

2026-10-13 方案 2 实验（已还原，未提交）：

- `nest build --webpack` + 把 `@ses/*` 排除出外部依赖，产出单个 `dist/main.js`（约 0.5 MB）；服务端正常启动，文档接口可用；在服务端执行 `pmToIr` → `resolve` → `renderDocx` 得到 14 个 DOCX 部件、章编号正确；
- 发现一处必须适配：webpack 会在构建时改写 `require.resolve`，`server/src/convert/pdf/build.ts` 定位 `@vivliostyle/cli` 与 KaTeX 样式失败，PDF 能力被误报为不可用。改用 `createRequire(__filename)`（3 行）后恢复，并经 `/api/convert/html-to-pdf` 实际产出含公式的 PDF；
- 实验未改动 shared、client 任何文件。

DOCX 出件把 `client/src/serializer/` 中的公式 OMML、图片资源、DOCX 打包抽成共享包（`@ses/io`），client 与 server 共用；client 原导出名保留。生产 schema 的服务端引用方式见 §11（WP9.2a）。

WP9.1 实施结果：

- `nest-cli.json` 指定 webpack builder，`packages/server/webpack.config.js` 把 `@ses/*` 打入产物；`build`、`start`、`dev`（watch 会跟踪 shared 源码变化）、`start:prod` 均可用；
- 外部依赖规则补充一条：`@ses/*` 源码导入的第三方包若与 server 自己解析到的不是同一份（版本不同），改为打入产物。原因是 server 为 PDF 预渲染锁定 KaTeX 0.16.11，而 `@ses/io` 的 DOCX 公式转换用 0.16.44；若按包名外置，产物会静默改用 0.16.11（实测 `\vdots` 的 OMML 会不同）。现在产物中 DOCX 路径为 0.16.44，PDF 预渲染与 KaTeX 样式仍为 0.16.11；
- mathml2omml 在产物中是独立 chunk（`dist/1.main.js`），部署时必须随 `dist/` 一起拷贝，缺失时公式降级为 LaTeX 文本并只在告警中体现；
- server 的 jest 改为 `node --experimental-vm-modules` 运行，以加载 ESM-only 的 mathml2omml。

### 6.7 MCP 服务

- 在 NestJS 内提供 Streamable HTTP 端点 `/mcp`，使用官方 TypeScript SDK `@modelcontextprotocol/sdk`（新增运行时依赖，需按不变式 5 批准）；
- 工具（与 Phase 9 清单对应，改为按 nodeId 寻址）：

| 工具 | 用途 |
|---|---|
| `list_documents` / `create_document` | 列出、创建文档（含文件设置） |
| `get_outline` | 结构树 |
| `get_node` | 读取节点内容 |
| `apply_operations` | 批量写入（带 `baseRevision`） |
| `validate_document` | 校验 |
| `export_document` | 出件，返回下载链接（本地部署也可写入指定路径） |
| `get_authoring_reference` | 写作说明（IR 片段格式、GB/T 1.1 结构约定） |

WP9.3 实际实现的工具共 8 个：上表 7 项，其中「列出、创建」为 `list_documents`、`create_document` 两个工具；读取前言、引言、参考文献并入 `get_node` 的 `container` 参数。接入方法见 [本地接入 MCP](wp9-mcp-local-setup.md)。

- 返回结果带 `revision`，AI 下一次写入以此为 `baseRevision`。

### 6.8 部署方式与接入

| | 本地部署 | 云端部署 |
|---|---|---|
| MCP 接入 | Claude Code 直接连 `http://localhost:3000/mcp`；只支持本地 stdio 的客户端需要一个桥接小命令 | claude.ai 等通过公网 HTTPS 连接，需要用户体系与 OAuth 鉴权 |
| 文档去向 | 只在本机 | 存于服务器；AI 生成的内容在模型提供方处理 |
| 出件交付 | 写入本机路径或本机下载链接 | 临时下载链接，需要存储与过期清理 |

文档操作层、乐观锁、快照、推送与部署方式无关，可先实施。云端一列在 Phase 11 实施（原 WP9.4）。

## 7. 分期

| 阶段 | 内容 | 是否依赖部署方式 |
|---|---|---|
| WP9.1 基础（已完成） | 服务端打包式构建并引用 shared；修订号与乐观锁、编辑器冲突处理；版本来源字段；`@ses/io` 抽取；服务端 DOCX 导出接口 | 否 |
| WP9.2 文档操作层 | 结构树、节点读写、批量操作、校验、出件接口（PDF/HTML/JSON）；服务端生产 schema 校验；AI 写入前自动快照；SSE 推送与编辑器刷新 | 否 |
| WP9.3 MCP（本地，已完成） | `/mcp` 端点与工具；写作参考；端到端：AI 建文档 → 人编辑 → AI 续写 → 导出 DOCX/PDF | 否 |
| ~~WP9.4 云端接入~~ | 并入 Phase 11「AI 云端接入」：远程 MCP 的 OAuth 授权、AI 写入归属用户并受角色权限约束、下载链接存储与清理、云端安全收口；依赖 Phase 11 的服务器部署与用户管理 | 是 |
| Phase 11 | 实时协同（Tiptap Collaboration / Yjs / Hocuspocus）：AI 作为协同参与者，经同一操作层写入；建议模式、批注 | — |
| 后续 | CLI 薄客户端；Markdown 写作输入 | — |

## 8. 待定事项

1. 云端部署的具体形态：在 Phase 11 确定，影响其「AI 云端接入」部分，不影响 WP9.1–9.3。

（AI 修改生效方式与 `@modelcontextprotocol/sdk` 已于 2026-10-13 决定，见 §2。）

### 7.1 WP9.2 拆分

| 子任务 | 内容 | 依赖 |
|---|---|---|
| 9.2a | 服务端加载编辑器生产 schema（打包引用 client 的 `createEditorExtensions`），提供内容校验与 nodeId 规范化；client 增加「扩展在纯 Node 环境可导入」的守护测试 | — |
| 9.2b | shared：写作片段归一化（§6.4）与片段到生产 PM JSON 的投影 | — |
| 9.2e | 服务端按文档导出 PDF / HTML / 语义 JSON；PDF 请求构建迁入 `@ses/io`（目次提取不依赖 DOMParser） | — |
| 9.2c | 文档操作层：结构树、读取节点、批量写入（带 baseRevision，原子执行，生产 schema 校验）；AI 写入生成带 `baseContent` 的版本记录；对外 REST 接口 | 9.2a、9.2b |
| 9.2d | SSE 变更推送；编辑器收到外部修改后刷新或提示；版本面板查看 AI 修改差异、回滚到 AI 修改前 | 9.2c |

## 9. 首期验收（WP9.1–9.3）

1. 文档在编辑器中打开时，AI 通过 MCP 修改：编辑器在数秒内显示修改；人的未保存修改不会被静默覆盖，AI 的修改也不会被编辑器自动保存冲掉；
2. 每批 AI 写入都有可回滚的版本快照，版本历史能区分来源；
3. AI 写入的内容通过生产 schema 校验；非法操作整批拒绝，返回路径与原因，不写入；
4. 服务端导出的 DOCX 与编辑器导出的同一文档逐部件一致（固定 `createdAt`），PDF 沿用现有管线；
5. 既有 shared / client / server 测试全部通过。

## 10. WP9.1 交付记录（2026-10-13）

| 子任务 | 提交 | 内容 |
|---|---|---|
| 9.1a | `da6cab2` | 服务端 webpack 打包构建，引用 `@ses/shared`；PDF 管线改用 `createRequire`；正文起始哨兵常量由 shared 导出 |
| 9.1d | `49d9fcc` | `documents.revision` 与条件 UPDATE；PUT 必须带 `baseRevision`（缺失 428、非法 400、过期 409）；client 按文档串行写入，409 时暂停自动保存并提供「重新加载」「另存为副本」；`versions.source`/`client` |
| 9.1b | `63edaa5` | 新包 `@ses/io`：公式 OMML、图片资源、DOCX 打包、导出前检查、封面同步；client 保留原导出名 |
| 9.1c | `d71fac4` | `GET /api/documents/:id/export/docx`；拒绝抓取外部图片；KaTeX 版本分流 |

验收结果：

1. 测试：shared 1028、io 73、client 435（另 1 跳过）、server 67，全部通过；`pnpm -r run build` 通过；
2. DOCX 一致性：打包后的服务端导出与 client 路径生成的同一文档（3 个公式、图片、表格、脚注、封面字段）逐字节相同；真实浏览器中编辑器导出与服务端导出的 18 个部件全部相同；
3. PDF：打包产物上 `/api/convert/capabilities` 为可用，含公式的 HTML 与完整 print HTML 均能出件，目次页码正确；
4. 冲突流程（真实浏览器）：外部修改后本地输入触发冲突提示，关闭后横幅保留、自动保存暂停、本地内容未写入服务端；「重新加载」后显示外部修改、横幅消失；页面无异常；「另存为副本」由实现方在浏览器中验证；
5. SSRF：含 `http://` 图片的文档导出成功并产生 `image-resource-failed` 告警，本地监听端口未收到任何连接。

遗留事项：

1. Chromium（Vivliostyle 出 PDF 时）会尝试连接 `www.google.com` 等地址，本机代理拒绝后不影响出件；本地部署要求数据不出机器时，需评估关闭 Chromium 后台服务的启动参数；
2. 打包产物无 source map，生产堆栈指向 `dist/main.js`；
3. KaTeX 版本分流与 mathml2omml chunk 只在打包产物上手工验证，建议增加「构建 → 启动 → 与 client 比对」的自动化检查；
4. 服务端导出未经生产 schema 校验（WP9.2 处理）；只含一个空段落的文档会导出为仅有封面的 DOCX；
5. CORS 未暴露 `X-SES-*` 与 `Content-Disposition` 响应头，跨域直连时前端读不到（经 Vite 代理同源不受影响）；
6. `packages/server/test/app.e2e-spec.ts` 是过时的脚手架用例（期望 `GET /` 返回 Hello World），改动前后均失败，未纳入 `pnpm test`；
7. 冲突后已打开的版本面板不会自动刷新列表。

## 11. WP9.2 交付记录（2026-10-13）

| 子任务 | 提交 | 内容 |
|---|---|---|
| 9.2e | `45075c1` | `GET /api/documents/:id/export/{pdf,html,json}`；PDF 请求构建迁入 `@ses/io`（目次提取不依赖 DOMParser）；服务端 PDF 导出前清空非 data URL 图片地址（防止排版用 Chromium 按文档内容发请求） |
| 9.2a | `d832560` | 服务端以别名 `@client/editor-schema` 打包引用 client 的生产 schema（webpack 与 jest 各一处配置，类型手写声明）；`validateContent`/`normalizeContent`；client 守护测试保证扩展在无 DOM 环境可加载 |
| 9.2b | `e9feea2` | shared：写作片段归一化 `normalizeAuthoringFragment` 与投影 `irFragmentToPm`；面向 AI 的写作说明 `docs/wp9-authoring-reference.md`（示例由测试执行） |
| 9.2c1 | `799f0d0` | `@ses/io` 文档操作引擎：`buildOutline`、`readNode`、`readContainer`、`applyDocumentOperations`（insert/replace/delete/move，全有或全无；替换会丢失内容时默认拒绝，需 `acceptLoss`） |
| 9.2c2 | `3dc49f0` | `GET outline/nodes/containers`、`POST operations`；文档更新与 AI 版本记录（`baseContent` 为写入前内容）同一事务；写入经进程内互斥串行；变更事件与 `GET /api/documents/:id/events`（SSE）；导出全部格式补齐 schema 校验 |
| 9.2d | `85c74e8` | 编辑器订阅变更：无未保存修改时自动载入并提示来源，有未保存修改时进入冲突；版本面板标注「AI 修改」、查看本次修改、回滚到修改前；Vite 开发代理修复 SSE 静默失效 |

验收结果：

1. 测试：shared 1224、io 243、client 624（另 1 跳过）、server 205，全部通过；`pnpm -r run build` 通过；
2. 打包产物端到端：读结构树（自动补齐缺失 nodeId 并持久化）→ AI 插入条（revision 递增，过期 baseRevision 409）→ 版本记录 `source=ai`、`client`、`note`、`baseContent`/`content` 恰为写入前后内容，列表不含 `baseContent` → SSE 收到 system 与 ai 事件 → 导出正常；
3. 服务端导出的 HTML、JSON 与编辑器逐字节相同；PDF 页数与文本相同、目次页码已注入；DOCX 加入 schema 校验后仍与编辑器逐字节相同；
4. 真实浏览器（Playwright + Chromium，经 Vite 代理）：AI 写入后编辑器约 50 ms 内自动显示并提示来源；本地有未保存输入时立即出现冲突提示且输入保留；版本面板「查看本次修改」只含该批 AI 修改，「回滚到修改前」后经自动保存写回；断线重连后补充比较并自动载入。

遗留事项（在 §10 的基础上补充）：

1. 浏览器端使用的 `POST /api/convert/html-to-pdf` 接受任意 HTML，排版用的 Chromium 会抓取其中的外部地址；云端部署前（Phase 11 AI 云端接入）需限制；
2. 每批 AI 写入保存两份完整文档（`content` 与 `baseContent`），内嵌图片多时数据库增长快；单次 operations 的操作数没有上限；
3. 变更事件只在单进程内有效，多实例部署需换实现；
4. 服务端没有只读 revision 的轻量接口，编辑器每次（重）连都读取整篇文档；版本列表没有 `hasBaseContent` 字段，面板需逐个拉详情探测；
5. 写作片段暂不支持行内脚注、行内公式、表格单元格内的表/图等，见写作说明；术语条目整体替换会把「来源/注/示例」按固定顺序重排（`irToPm` 既有行为）；
6. 引擎每个操作都整篇重建索引，3000 块文档 40 个操作约 0.6 秒。
7. **已修复**（Codex 评审 P2；提交 `f9b6ebd`）。原问题：写入已全部经 `WriteCoordinator` 串行（Codex 评审 P1 修复），但读不受锁约束：共享连接下，事务进行期间的读（GET、导出、MCP 读取）可能读到未提交数据。事务若随后回滚（如 AI 写入的版本插入失败），读方拿到的是从未存在过的内容与递增后的 revision，从该 GET 打开的编辑器下一次保存立刻冲突；只有在回滚后另一写入恰好把 revision 推到同一数值时，持有该「幽灵 revision」的写入才会通过检查造成丢失更新。做法（采用原先列出的第一个方案）：`DocumentService` 的 `findAll` / `findSummaries` / `findOne` / `assertExists` 与 `VersionService` 的 `findByDocument` / `findOne` 改为经 `WriteCoordinator.run` 执行，在途事务结束后才读，所以 GET、导出、MCP 读取、operations 读接口、SSE 首次读取只会读到已提交的数据。取舍：FIFO 互斥让读与写串行，读与读也不再并行；SQLite 单连接本来就不能并行执行语句，代价只是读要等在途的一次文档更新加版本插入。约定「读不可在锁内调用」（锁不可重入，同写入）：锁内（`transaction` 回调、`run` 任务）要读，只能用事务传入的 manager 或不加锁的内部读取；`DocumentService.remove` 持锁时的存在性检查因此改用私有的 `findOneIn`，否则会死锁。另开 WAL 只读连接的方案未采用，吞吐不足时可作为备选。测试：`document-ops.spec.ts` 的「读取排在在途事务之后」（事务挂起时读取不返回，回滚后读到原状、提交后读到新值）与「取锁次数与死锁回归」。

## 12. WP9.3 交付记录（2026-10-14）

| 子任务 | 提交 | 内容 |
|---|---|---|
| 9.3a | `89186d9` | `/mcp` 端点（Streamable HTTP，有状态会话，JSON 响应，不带 `api` 前缀）；会话空闲 24 小时失效、上限 100、满时淘汰最久未用；只接受本机连接（对端回环地址 + Host + Origin 三项检查）；工具 `list_documents`、`create_document`（与编辑器首页新建一致，经别名复用 client 的 `createNewDocument`，保存前补齐 nodeId）、`get_outline`、`get_node`、`apply_operations`（来源固定 ai，client 取 `clientInfo.name`）、`get_authoring_reference`（写作说明打入产物） |
| 9.3b | `d455f65` | `validate_document`（只读；Resolver 问题 + docx/pdf/html 导出前检查，与导出接口共用同一检查方法）；`export_document`（返回下载地址，可选 `outputPath` 写到本机：绝对路径、扩展名对应、默认不覆盖、覆盖时临时文件 + rename、`SES_MCP_ALLOW_FILE_WRITE=0` 关闭）；PDF 管线不可用时保留 503 与原因；端到端测试；[本地接入说明](wp9-mcp-local-setup.md) |
| 9.3c | `3a2cce3` | `outputPath` 强制目录限制（`SES_MCP_OUTPUT_DIRS`，默认 `~/SES-exports`）；服务端默认只监听 127.0.0.1（`SES_LISTEN_HOST`）；接入地址改为 `http://127.0.0.1:3000/mcp` |

验收结果：

1. 测试：shared 1224、io 243、client 624（另 1 跳过）、server 619（9.3c 后 712），全部通过；`pnpm -r run build` 通过；新增运行时依赖只有 `@modelcontextprotocol/sdk` 1.31.0；
2. 打包产物（SDK Client）：8 个工具可用；create 后直接以返回的 revision 写入成功；过期 revision 返回 409 与当前 revision；伪造 Host、非本机 Origin 返回 403；docx/pdf/html/json 导出与 REST 一致；服务端日志不含正文、标题与输出路径；
3. 真实 Claude Code（2.1.296，无界面模式）+ 真实浏览器（Playwright + Chromium，经 Vite 代理）人机接力：
   - Claude Code 新建文档、读写作说明与结构、在「范围」写入一段，编辑器打开后显示该段；
   - 人在编辑器里在该段末尾输入，自动保存（revision 2）；
   - Claude Code 重新读取，看到人的修改并保留，在章末续写（revision 3）；编辑器在 AI 写入后 1 秒内自动载入并提示「AI（claude-code）已更新文档，已载入最新内容」，人的输入仍在；
   - `validate_document` 无问题；`export_document` 把 DOCX（35822 字节）与 PDF（3 页）写到指定目录，两份文件都含人与 AI 的内容；
   - 版本历史两条 `source=ai`、`client=claude-code`、note 为 AI 填写的修改说明；人的保存不生成版本；
4. 服务端重启：Claude Code 在重启前后各调用一次工具，第二次照常成功（客户端收到 404 后自动重新建立会话）。
5. 9.3c 复验（真实 Claude Code + 浏览器，服务端只监听 127.0.0.1，编辑器经 127.0.0.1 代理）：接力流程同第 3 条；让 AI 导出到允许目录之外时返回 403 `output-dir-not-allowed`，AI 按提示改为只给文件名，DOCX 与 PDF 存入默认导出目录（自动创建，权限 700），指定的目录之外没有生成文件。

遗留事项：

1. ~~`outputPath` 没有目录白名单~~：已于 `3a2cce3` 改为强制目录限制（2026-10-14 决定）。只能写到 `SES_MCP_OUTPUT_DIRS` 列出的目录；未配置时只允许 `~/SES-exports`（首次写入时创建，权限 700）；只给文件名时存到第一个允许目录；包含关系按 realpath 判断，防符号链接逃逸。仍存在的限制：检查与写入之间有时间窗（本机有该目录写权限的进程可在其间把目录换成符号链接）；允许目录之外，目录不存在返回 400、存在返回 403，可据此区分；Windows 未实测；
2. REST 接口（`/api/...`）没有 `/mcp` 的 Host/Origin 检查，不能防 DNS 重绑定（恶意网页把自己的域名解析到 127.0.0.1 后可与本机 SES 同源调用 REST 接口）。2026-10-14 决定：全部接口的鉴权与多端访问放到 Phase 11；本地部署先由下一条缩小暴露面；
3. ~~服务端监听所有网卡~~：已于 `3a2cce3` 改为默认只监听 127.0.0.1，`SES_LISTEN_HOST` 可覆盖（非回环时启动日志警告），编辑器开发代理改连 127.0.0.1。`/mcp` 访问守卫保留；它在 JSON 请求体解析之后执行，只有显式监听非本机地址时，非本机连接才会让服务端先读取请求体（最大 25 MB）；
4. 会话只在内存，空闲 24 小时失效；Claude Code 能自动重建会话，其他客户端未验证；只支持 stdio 的客户端需要桥接，未验证任何桥接工具；
5. `validate_document` 只读，对从未在编辑器打开过、经 REST 直接创建的文档会报告 `missing-id`（MCP 新建的文档已补齐 nodeId，不受影响）；
6. 导出 PDF 需要两遍 Vivliostyle，实测约 9 秒；客户端工具调用超时过短时会先超时。server 测试含真实 PDF 管线，耗时由约 15 秒增到约 28 秒；
7. 未知工具名返回 `isError` 结果（与 SDK `McpServer` 实际行为一致），而非 JSON-RPC -32602；
8. `packages/server/src/document-ops/document-ops.spec.ts` 第 1679 行有一个既有的 TS 类型错误（`tsc --noEmit` 报告，jest 与构建不受影响）。
9. 文档里已有的、取容器名（foreword / introduction / body / appendices / bibliography）的 nodeId 不会被重新生成：这类节点不能作为 insert / move 的父节点。只有经 REST 直接写入手写 nodeId 才会出现（编辑器与操作引擎都不会生成，写作片段里显式写这些 id 会被 `invalid-id` 拒绝）；修复需要改编辑器也在用的 nodeId 规范化，暂不处理（Codex 评审，2026-10-14）。
10. 文档在别处（另一个标签页、REST）被删除时，服务端不推送删除事件，已打开的编辑器不会得知；下一次保存得到 404，提示「保存失败；正文仍保留在编辑器中」，内容不会丢失但没有专门的恢复引导（Codex 评审，2026-10-14，暂不处理）。
