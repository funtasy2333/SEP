# WP9 人机共写方案（MCP 接入）

状态：WP9.1 已完成（2026-10-13，见 §10）；WP9.2 起待实施。对应 `ses-requirements.md` Phase 9「MCP / CLI 支持」，并为 Phase 10「AI 集成」、Phase 11「多人协作」预留同一套写入机制。

## 1. 目标

最终目标是**人机共写**：AI 与人在 SES 中编辑同一份文档，始终只有一份。分两步走：

1. **接力编辑**（本方案首期）：人和 AI 轮流修改同一份文档，互不覆盖；AI 的每次修改都可追溯、可回滚；人在编辑器中能及时看到 AI 的修改；
2. **实时共写**（后续）：人和 AI 同时修改，修改实时可见，与 Phase 11 多人协作共用协同机制。

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
| 待定 | 部署方式（本地 / 云端 / 两者） | 见 §8 |

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

> WP9.1 之后：第 2 项已由修订号与乐观锁解决；第 4 项已解决（服务端打包引用 shared 与 `@ses/io`）；第 6 项已增加来源字段；第 8 项服务端已可出 DOCX。第 3、5、7 项仍待 WP9.2 及以后处理。

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

- `versions` 增加 `source`（`human` / `ai` / `import`）与 `client`（如 MCP 客户端名称）字段；
- 每批 AI 写入前自动创建版本快照，`note` 记录操作摘要；
- 版本历史标注来源，可一键回滚到某次 AI 修改之前；
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

DOCX 出件把 `client/src/serializer/` 中的公式 OMML、图片资源、DOCX 打包抽成共享包（`@ses/io`），client 与 server 共用；client 原导出名保留。生产 schema 的服务端引用方式留到 WP9.2 确定。

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

- 返回结果带 `revision`，AI 下一次写入以此为 `baseRevision`。

### 6.8 部署方式与接入

| | 本地部署 | 云端部署 |
|---|---|---|
| MCP 接入 | Claude Code 直接连 `http://localhost:3000/mcp`；只支持本地 stdio 的客户端需要一个桥接小命令 | claude.ai 等通过公网 HTTPS 连接，需要用户体系与 OAuth 鉴权 |
| 文档去向 | 只在本机 | 存于服务器；AI 生成的内容在模型提供方处理 |
| 出件交付 | 写入本机路径或本机下载链接 | 临时下载链接，需要存储与过期清理 |

文档操作层、乐观锁、快照、推送与部署方式无关，可先实施。

## 7. 分期

| 阶段 | 内容 | 是否依赖部署方式 |
|---|---|---|
| WP9.1 基础（已完成） | 服务端打包式构建并引用 shared；修订号与乐观锁、编辑器冲突处理；版本来源字段；`@ses/io` 抽取；服务端 DOCX 导出接口 | 否 |
| WP9.2 文档操作层 | 结构树、节点读写、批量操作、校验、出件接口（PDF/HTML/JSON）；服务端生产 schema 校验；AI 写入前自动快照；SSE 推送与编辑器刷新 | 否 |
| WP9.3 MCP（本地） | `/mcp` 端点与工具；写作参考；端到端：AI 建文档 → 人编辑 → AI 续写 → 导出 DOCX/PDF | 否 |
| WP9.4 云端接入 | 用户与鉴权、OAuth、下载链接存储与清理 | 是（确定云端部署后） |
| 后续 | 建议模式；实时共写（Tiptap Collaboration / Yjs，与 Phase 11 合并）；CLI 薄客户端；Markdown 写作输入 | — |

## 8. 待定事项

1. 部署方式（本地 / 云端 / 两者）：影响 WP9.4 与 MCP 接入方式，不影响 WP9.1–9.3；
2. AI 修改的生效方式：首期建议「直接生效 + 自动快照」，「建议模式」放后续；
3. 新增运行时依赖 `@modelcontextprotocol/sdk`（server）的批准。

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

