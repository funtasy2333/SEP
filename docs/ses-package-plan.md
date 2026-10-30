# SES 文档包（.ses）导出与导入 — 开发计划

状态：已实施（2026-10-30）。

## 实施与计划的差异/衔接

以下实现细节补充或调整了原计划：

1. **正文快照只保存正文与阶段**：版本表没有 `title`、`meta` 字段，因此导入前的本地正文自动快照只记录 `content`、`stage`、`source: 'import'` 和固定备注，不扩展版本字段。文件设置仍完整进入包，并在更新文档时写入。
2. **校验但保留正文原 JSON**：`normalizeContent` 只用于当前正文 schema 校验；解析和导出都保留通过校验的原 JSON，避免补默认值或改写 `nodeId` 影响图片和 `figureResource` 往返。
3. **复用图片判定**：SES 导出复用 `export/external-images.ts` 的 `isInlineImage`，供只读扫描非 `data:` 图片引用；不改变既有导出图像处理。
4. **导出读取保持一致**：导出在一个 `WriteCoordinator.run` 中连续读取文档与完整版本列表，并显式读取 `baseContent`；这替代计划里分别调用文档查询和版本查询，避免共享 SQLite 连接在事务期间读到未提交或混合状态。
5. **不可快照的本地正文返回错误**：旧 API 允许本地正文为 `null` 或非 `doc` 对象，但版本快照要求 JSON 对象且 `type: "doc"`。更新正文有差异时，服务端先校验 `baseRevision`；若本地正文不能创建快照，则返回 `422`，零写入且不发布事件，提示先在编辑器保存可用正文或另存为新文档。相同正文不需要快照时不触发此检查。此边界已先在 PR #64 说明。
6. **版本号分配增加停滞保护**：沿用 `nextVersionNo` 处理普通续编；检测到候选号无进展时，从 `1.0` 起重新查找未占用号码，避免已有超大整数版本号导致导入循环不前。不修改原版本号算法，也不限制已有版本号字符串。此边界已先在 PR #64 说明。
7. **另存副本同步题名元数据**：uid 已被占用时，副本标题追加「（导入副本）」，并同步 `meta.titleCn`。这沿用首页 `createDocumentDuplicate` 的双标题方式；正文、版本和其他包内设置不变。首次新建或更新仍使用完整包内设置。
8. **既有 lint 基线兼容修复**：完整 server lint 在计划起点的四个既有文件中报告 29 项错误。`no-irregular-whitespace` 命中 `toc.ts`、`toc.spec.ts` 注释中的 U+3000；修复只把注释中的显示写法改为 `\u3000`，运行时正则、分隔符和字符串数据未改。另对 `document-ops.spec.ts`、`trash.spec.ts` 做测试类型绑定与断言类型清理，并按现有格式整理；不删改测试语义、不改 lint 规则。`main.ts` 的既有 floating-promises 提示不在该范围内。此额外范围已先在 PR #64 说明。

9. **快照判定与编号顺序（评审后修正）**：原计划「正文不同就快照，且先建快照」会在最常见的往返（本地导出后未改动、只有对方改了并存了版本）中多出一条重复快照，并让快照占用对方的下一个版本号，使同一版本在两端编号不同、预览的 `versionNoCollisions` 与实际不符。现改为：先追加包内版本，版本号只与导入前的本地版本比较；本地正文已等于某个已有版本（本地或包内）时不建快照；需要快照时最后分配版本号。预览新增 `createsSnapshot` 字段，首页提示据此显示。

原计划其余行为与边界以 [SES 文档包格式](ses-package-format.md) 和当前实现为准。完整命令与手工端到端验收结果由 PR 验收记录另行说明。

## Context

SES 目前只有"单格式出件"（DOCX/PDF/XML/HTML/语义 JSON），都只带正文，不能把**一份文档的全部状态**带走再完整恢复。WP9 方案（`docs/wp9-ai-coauthoring.md` §1、§6.3）已约定保留 `.ses.json` 作为"导入/导出/备份格式"，但一直没有实现。本次实现 SES 文档包：

- 文件扩展名 `.ses`，内容为 UTF-8 JSON（不压缩、不打 zip）；
- 包含：正文（PM JSON）、图片（正文里的 data URL 原样内嵌）、文件设置（title / meta / stage）、包格式版本、全部已保存版本快照（含 AI 版本的写入前内容 baseContent）；
- 导出、导入都在**服务端**完成。

**修订原因**：原计划"导入一律新建文档"在 A→B→A 往返时会让 A 本地出现两份同一文档，版本历史分叉、需要人工判断哪份是主本。修订后给文档和版本加稳定身份（uid），导入时识别"是不是本地已有的那份文档"：
- 本地没有 → 新建文档（保留 uid，B 第一次收到包就是这种情况）；
- 本地已有 → 让用户选"更新现有文档"（推荐）或"另存为新文档"（分叉，生成新 uid）。

已与用户确认：图片原样内嵌；版本附带 baseContent，不带旧 `xml` 列；服务端实现。

**能力边界（需如实告知用户）**：这不是自动合并。A、B 若在往返期间都改了正文，SES 不做三方合并：B 的正文成为当前正文，A 导入前的当前正文自动存成一个版本快照，A 用版本历史已有的"比较"功能（`components/version/VersionPanel.vue`）对照后手工取舍。多人同时编辑属于 Phase 11 实时协同。

## 身份模型

- `DocumentEntity.uid`：UUID（`crypto.randomUUID()`），`DocumentService.create` 生成，客户端传入的值忽略（因此"复制文档"、MCP 新建都是新身份）。
- `VersionEntity.uid`：UUID，所有建版本的路径（`VersionService.create`、`createForAiWrite`）生成。
- 两列都设为 nullable（`synchronize: true` 下给已有行加列最安全），`SesPackageModule`/`DocumentModule` 的 `onModuleInit` 一次性为 `uid IS NULL` 的旧行补值，之后不再为空。
- 本地活动文档（未在回收站）中 uid 唯一；由导入逻辑保证（DB 层不加 unique 约束，避免旧库补值前冲突）。

## 包格式（formatVersion 1）

```jsonc
{
  "format": "ses-document-package",
  "formatVersion": 1,
  "exportedAt": "2026-10-30T08:00:00.000Z",
  "generator": { "name": "SES", "version": "0.1.0" },
  "document": {
    "uid": "6f1c…",                     // 文档身份，导入时用于识别同一文档
    "title": "...", "stage": "working_draft",
    "meta": { /* DocumentMeta */ },
    "content": { "type": "doc", ... },   // 图片为 data URL / figureResource 节点，原样
    "createdAt": "...", "updatedAt": "..."   // 仅记录
  },
  "versions": [                          // createdAt ASC, id ASC
    { "uid": "a2e9…", "versionNo": "1.0", "stage": "...", "content": {...},
      "baseContent": null, "note": "...", "source": "human|ai|import",
      "client": null, "createdAt": "..." }
  ]
}
```

不进包：数据库 id、revision、deletedAt、versions.xml。版本演进规则：新增可选字段不升版本；语义变化或删除才升 `formatVersion` 并写迁移；更高版本直接拒绝并提示升级 SES。

## 导入的三种结果

`POST /api/documents/import/ses?mode=preview|new|update[&targetId=&baseRevision=]`，请求体为原始字节（Content-Type `application/vnd.ses-package+json`）。

1. **preview**（只读）：解析校验后返回
   - `match`：本地活动文档中 uid 相同的文档（id、标题、revision），或 null；同 uid 文档在回收站时返回 `inTrash: true`；
   - 若匹配：`newVersions`（包中有、本地没有的版本数）、`localOnlyVersions`（本地有、包中没有的版本数，>0 说明双方都存过版本）、`contentDiffers`（本地当前正文与包内正文是否不同）、`versionNoCollisions`（包中新版本与本地已有版本号重复的列表）。
2. **new**：新建文档。uid 未被本地占用时沿用包内 uid；已被占用（即用户选择"另存为新文档"）时生成新 uid、标题加"（导入副本）"。版本全部插入。
3. **update**（仅匹配时可用，必须带 `targetId` 与 preview 时拿到的 `baseRevision`，revision 变了返回 409，沿用现有乐观锁约定）：在一个事务里
   - 若 `contentDiffers`：先把本地当前正文/设置存为一个版本，`source: 'import'`、note"导入 .ses 前的本地正文（自动快照）"——与 AI 写入前自动快照同一思路，保证不丢任何内容；
   - 追加包中本地没有的版本（按 version uid 判断；已有的跳过，不覆盖）。版本号不冲突时保留原号；冲突时按 `nextVersionNo`（`version/version.service.ts`）续编，note 前缀"原版本号 x.y"；
   - 用包内 title/meta/stage/content 更新文档（走 `DocumentService.updateWithin`，revision +1），提交后 `publishChange`（来源 `import`，需在 `DocumentChangeOrigin` 的 source 中加入该值；打开着该文档的编辑器会按现有外部变更机制刷新或提示冲突）。

因版本按 uid 去重、只增不改，A→B→A→B 多轮往返时版本历史会收敛为两边版本的并集，不会重复。

## 服务端实现

新建模块 `packages/server/src/ses-package/`：

1. **`ses-package-format.ts`**：常量（`SES_PACKAGE_FORMAT`、`SES_PACKAGE_FORMAT_VERSION`、`SES_PACKAGE_MIME`、`SES_PACKAGE_BODY_LIMIT = '200mb'`）、类型、`buildSesPackage`、`parseSesPackage`（逐字段校验，错误消息带字段路径）。复用 `parseDocumentMeta`（`document/document-update.ts`）、`VERSION_SOURCES`（`version/version.entity.ts`）、`MAX_CLIENT_LENGTH`、`nextVersionNo`（`version/version.service.ts`）。
2. **`ses-package.service.ts`**：`exportPackage(id)`、`previewImport(pkg)`、`importAsNew(pkg)`、`importUpdate(pkg, targetId, baseRevision)`。
   - 导出：`DocumentService.findOne` 读文档；版本用 QueryBuilder `addSelect('version.baseContent')` 正序读出；扫描非 data URL 图片生成告警（判定同 `export/external-images.ts` 的 `isInlineImage`，只读）。
   - 当前正文用 `normalizeContent`（`editor-schema/editor-schema.ts`）校验，不通过 422；版本正文/baseContent 只做结构校验（对象且 `type === 'doc'`），不按当前 schema 严格校验（旧版本可能早于当前 schema）。
   - 写入全部在 `DocumentService.transaction` 内用传入的 manager 完成；版本显式写入原 `createdAt`。
   - 正文比较用稳定序列化后的字符串比较（键序无关）。
3. **`ses-package.controller.ts`**：`GET /api/documents/:id/export/ses`（`attachmentDisposition`、`buildWarningHeaders`，见 `export/export-http.ts`）与上面的 POST。
4. **实体与已有服务改动**：`document/document.entity.ts`、`version/version.entity.ts` 加 `uid`；`DocumentService.create`、`VersionService.create`/`createForAiWrite` 生成 uid；启动补值；`document-events` 的来源类型加 `import`。
5. **`app-setup.ts`**：`app.useBodyParser('raw', { type: SES_PACKAGE_MIME, limit: SES_PACKAGE_BODY_LIMIT })`，超限 413。
6. `app.module.ts` 注册 `SesPackageModule`。

## 客户端实现

1. **`client/src/api/document.ts`**：`exportSesPackage(id)`（blob + 告警头）、`previewSesImport(file)`、`importSesPackage(file, mode, target?)`。
2. **编辑器导出对话框**（`views/EditorView.vue` 导出卡片区）：新增"SES 文档包"卡片；沿用 `persistenceOperation`/`settingsDirty` 拦截，正文 dirty 时先保存并 `await waitForLocalWrites()`；`downloadBlob` 下载 `${docTitle}.ses`；外部图片告警用 `ElMessage.warning`。
3. **标准库首页**（`views/HomeView.vue`）：新增"导入 .ses"按钮与隐藏文件框。流程：preview →
   - 无匹配：直接 `mode=new`，成功后跳转编辑器；
   - 有匹配：弹确认框，写明"本地已有同一文档《…》；包中新增 N 个版本；本地有 M 个版本对方没有；导入后对方正文成为当前正文，你的当前正文会先自动存为版本"。按钮：「更新现有文档」（推荐，默认）/「另存为新文档」/「取消」；
   - 同 uid 在回收站：提示先恢复或永久删除，或选择另存为新文档；
   - 409：提示"该文档在你确认期间被修改，请重新导入"。
4. 版本面板（`components/version/VersionPanel.vue`）已对 `source: 'import'` 显示"导入"标签，无需改动。

## 文档

- 新增 `docs/ses-package-format.md`：格式、字段表、身份与导入规则、不进包内容、版本演进规则、已知限制（不做自动合并；外部 URL 图片不打包；体积随版本数线性增长；版本快照不按当前 schema 校验）。
- `README.md` 功能特性补一条并链接；`docs/wp9-ai-coauthoring.md` 中 `.ses.json` 改为 `.ses`。

## 不在本次范围

- 正文的自动三方合并、逐段冲突解决；
- MCP `export_document` 增加 `ses` 格式（可后续复用 `SesPackageService`）；
- 标准库卡片菜单上的"导出 .ses"；图片抽取去重、压缩包格式。

## 验证

1. 服务端测试 `server/src/ses-package/ses-package.spec.ts`（`createTestApp` + supertest，参照 `export/export-http.spec.ts`）：
   - 往返新建：内容、设置、版本（uid、versionNo、note、source、client、createdAt、baseContent）、图片 data URL 与 figureResource 一致；
   - **A→B→A 场景**：A 导出 → 以新库模拟 B 导入（沿用 uid）→ B 加版本并改正文 → 导出 → A preview 识别匹配、计数正确 → update：A 原正文成为 `import` 快照版本、B 的新版本追加、已有版本不重复、文档 revision +1 且发布事件；再来一轮往返版本数不增长重复；
   - 版本号冲突时续编并在 note 记录原号；
   - 另存为新文档生成新 uid；回收站同 uid 的提示；update 时 baseRevision 过期返回 409 且无任何写入；
   - 旧库补值：uid 为 null 的文档/版本启动后有值且导出稳定；
   - 拒绝：format/formatVersion/JSON 语法/meta 类型/未知 source/正文不符合 schema（422 且事务回滚）；超限 413；回收站文档导出 404。
2. 运行：
   ```bash
   pnpm --filter @ses/server test -- ses-package
   pnpm --filter @ses/server test
   pnpm --filter @ses/server lint
   pnpm --filter @ses/client test
   pnpm -r run build
   ```
3. 手工端到端（`pnpm dev`）：建含图、多版本的文档 → 导出 → 首页导入（应提示已有同一文档）→ 选"更新现有文档" → 版本历史中出现"导入"快照，用"比较"对照两边正文。
