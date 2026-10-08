# WP6 全面复审与修复规划

## 基线与复审范围

- PR：[#45](https://github.com/funtasy2333/SEP/pull/45)，最早记录的复审起点 head `c24181ca77fa77bdb73923d26f498bed265bf7b3`，相对 `origin/main` 的 merge base 为 `e0e9ab09d2b5867ba81bdf7be9f17866a1ab1f28`。83 个文件只描述该历史起点的 PR 差异；之后各轮新增修改已扩大差异，不能把 83 视作当前或最终 PR 文件总数。
- 本次复审起点：PR 提交 `72e127b52ffd446cb20e575235d5377e2df0c891`；最新 Codex review ID `5443480187`，审阅提交 `72e127b5`，于 2026-10-07 22:02:30（Asia/Shanghai）提交；唯一 P2 inline comment ID `4207853177`，[查看意见](https://github.com/funtasy2333/SEP/pull/45#discussion_r4207853177)，针对 Resolver 已报错的 typed cross-reference 仍被 HTML/DOCX 输出的问题。此前 `c24181ca` 是上一轮复审起点；83 个文件只描述更早的 PR 差异基线，不是当前或最终 PR 文件总数。
- 复审由三条相互衔接的路径组成：生产 Tiptap schema 与 `pmToIr`/`irToPm`/Resolver；编辑器和 JSON/HTML/DOCX/XML 的生产导出入口；IR allowlist 与每种渲染器实际消费的字段。结论只覆盖 PR #45 改动及其直接生产入口，不能推断整个仓库没有其他问题。

核心生产路径包括：生产 `createEditorExtensions()` schema → 编辑器加载/保存和稳定 nodeId → `pmToIr` → Resolver/输出边界 → `renderJson`、HTML exporter、DOCX exporter、旧 XML `serializeToXml`；反向路径包括 native IR → `irToPm` → 生产 schema → 保存/加载。真实 API/SQLite 冷重开、浏览器验收、Word 排版和正式 XML 互操作是不同层级，不能以单元测试代替。

## 最近一轮输出边界问题与处理

| 可复现输入 | 原实现会怎样 | 修复/规划 | 回归证据 |
|---|---|---|---|
| `formulaContent` 中含 bold/italic 等 marks，或纯文本源与 LaTeX 不同 | IR 保留 `sourceInlines`，但 HTML/DOCX 仅用 `latex`，旧 XML 仅序列公式文本；导出成功却丢源格式或冲突文本 | HTML、DOCX、XML 共同在 `sourceInlines` 上拒绝 marks、style、嵌套公式、脚注及 trim 后不同于 LaTeX 的文本；纯文本等价（含首尾空格及空 marks/style）仍允许。JSON 保留原形 | shared `outputBoundary.test.ts`；生产 `wp6OutputBoundaryAudit.test.ts`；JSON 导出含 bold mark 的回归 |
| native PM `formula > whereList > whereItem` 非空；对照旧 `formulaDescription` | HTML/DOCX 消费 IR `whereList`；旧 XML 只处理 `formulaDescription`，native 列表会消失。两种 PM 来源到 IR 后都能成为 `whereList` | XML 在原 PM 来源扫描中只拒绝 native typed `whereList`，诊断带路径并继承 formula `nodeId`；旧 `formulaDescription` 继续可导出。不新增 XML/MathML 输出 | 生产 client 回归分别验证拒绝 typed 列表、旧 `<def-list>` 仍输出 |
| 单元格中放入 `stdList`、`note` 或 `example` | HTML/DOCX 递归消费支持块；旧 XML `serializeCellContent` 只取 textblock 并作行内序列化：列表等块被丢弃，note/example 即使是 textblock 也会被展平而丢语义 | XML 只允许此旧序列化路径能表达的 `paragraph`/`stdParagraph` 子项；非 textblock 和其他语义 textblock 精确阻断。诊断继承单元格 `nodeId`。不重构旧转换器 | 生产 schema 允许的列表、note、example 三类单元格用例：XML 带 cell ID/path 拒绝，HTML/DOCX 导出通过 |
| 显式 `headerRowCount` 与首段连续的全 header 行不一致 | HTML 用该字段划分 `thead`，DOCX 用于重复表头；旧 XML 只看 `tableHeader`/`tableCell` 标签而忽略显式行数 | XML 仅在显式行数与 PM header 标签表达不一致时拒绝；缺省旧稿仍由 cell 类型推断并导出 | shared 边界回归和生产 client 中 header 数不一致/一致各一例 |
| chapter 的显式 `secType` 与旧标题推断冲突，如 `title=方法, secType=scope` 或 `title=范围, secType=general` | HTML/DOCX 保留角色；旧 XML `serializeChapter` 不序列化 `secType`，回导后会按标题重新推断而改变角色 | XML 仅对角色不等价输入报告 `chapter.attrs.secType`；合法匹配标题或一般标题不阻断，不改旧 XML 输出 | 生产 schema 回归覆盖两个冲突方向、角色匹配方向；错误带 chapter nodeId/path 且输入 JSON 不变 |
| `meta.applicant` 非空 | HTML/DOCX 原先 allowlist 接受字段却不实际输出；旧 XML 没有 applicant 字段 | HTML 输出 `ses-applicant` meta，DOCX 输出 `ses-applicant` custom property。旧 XML 保持既有可导出契约：`xmlDocumentMeta.ts` 将 applicant 明确作为 XML front 外的编辑器维护值，导入沿用当前 metadata；不宣称 XML 独立携带 applicant，也不改既有新建/复制出口契约 | HTML 字符转义、真实 DOCX ZIP custom.xml、XML 新建/复制兼容回归 |
| `proposer`、`technicalCommittee` 非空 | 输出 allowlist 与实际消费曾不一致 | HTML/DOCX metadata 实际输出后允许这两类 print 出口；旧 XML 对非空字段仍按字段路径拒绝；不重写前言 | shared output-boundary 和现有前言/文档设置回归 |

有意保留的差异：`captionEn` 在 HTML screen 预览中显示，但 print HTML 与 DOCX 不输出，依据 [WP4 排版决策](wp4-fix-gbt11-format.md) 和 [WP7 DOCX 输出约定](wp7-docx-delivery.md)。allowlist 接受该字段不能被解释为印刷输出承诺。

## 模型与生产 schema 审查

本节汇总 model/schema 子代理对 PR 核心转换契约的补充审查；覆盖实际生产 schema，不把 schema round-trip 等同于正式交换格式验证。

- PM→IR 多个 foreword/introduction 容器原本会以后者覆盖前者；现合并内容并对额外容器保留 unsupportedContent。重复 coverPage 只由首个提供 metadata，其余逐个诊断，不合并来源。
- 隐藏的 `clauseTitle` 即使 `hasTitle=false` 仍可能有内容；现对非空标题报告 PM→IR 诊断，IR→PM 返回有位置的 `IRToPmError`，不丢文本。真正空的无题标题仍可往返。
- 普通 `hardBreak` 的 marks/textStyle 现在进入 IR；只有 footnote 的 run、空文本但带 typed 引用 mark 的 IR 没有生产 PM carrier，IR→PM 精确拒绝；有正文文本/公式 carrier 和 tableFootnoteRef atom 仍允许。
- 生产 HTML parser 对 formula、cover、bibliography、chapter、figure/image、table 文本/样式单位、TBX descriptor 的字符串属性显式读取，避免 Tiptap 隐式数值或布尔强制转换；数值测量、行数和布尔 `numbered` 保持原类型。
- 完整 chapter DOM 回读中，`p[data-type="std-paragraph"]` 曾被通用 paragraph parse rule 抢先，导致语义节点退化。现提高专用 parse rule 优先级；两轮 DOM 往返保留 `stdParagraph`、`nodeId` 和 marks，无 `data-type` 的普通 `<p>` 仍解析为通用段落。model/schema 子代理报告该回归 2 个文件 / 24 项通过。
- 表脚注 HTML 之前存在独立缺陷：`TableFootnoteEntry` 输出把 `sup` 与 ProseMirror content hole 放在同一 `<p>`，会触发 DOMSerializer hole 异常；parser 优先级不足也可能把条目降为普通段落。现使用唯一内容槽、提高 typed parser 优先级、排除 label 作为正文，同时兼容无 slot 的旧 typed 段落。生产 schema 两轮往返保留 entry/node ID、marks/crossRef、`tableFootnoteRef.targetId` 与整行结构；label 不进入正文，普通 `<p>` 保持通用语义。model 报告与 metadata/HTML 往返专项合计 3 files / 26 tests 通过。

model/schema 子代理此前专项测试报告：client 7/7、shared 8/8；stdParagraph DOM 回归另报 2 个文件 / 24 项通过，表脚注 HTML 与相关 metadata/往返测试另报 3 个文件 / 26 项通过。这些是各自定向组合，不应与主代理 full-client 或全局总计相加。生产 Schema fixture、历史 JSON golden 与 screenshot 属测试资源/静态证据，不是 Word 真实稿件或 XML 外部互操作证明。全局最终计数见“主代理最终验证证据”。

## 集成层审查

integration 子代理报告下列生产入口的定向验收已通过；其范围不替代主代理执行的 full-client 测试与总体验收：

| 路径 | 改动与检查点 | 专项回归/状态 |
|---|---|---|
| `EditorView` 冷加载与保存 | 旧稿稳定 ID 冷加载落盘；失败保留 dirty、允许 Ctrl+S；保存期间新增编辑只安排必要的后续保存 | `EditorView.saveRetry.test.ts` 覆盖保存失败、并发编辑与重试 |
| 离开/设置确认 | 有未保存修改时离开先保存，失败阻止离开且 `beforeunload` 反映 dirty；设置确认期间再次检查正文是否变化 | `wp6IntegrationAudit.test.ts` 覆盖 |
| XML 导入与编辑器安装 | 先用生产 schema 构造 detached candidate、补稳定 ID 并持久化，成功后再安装到编辑器，避免失败时半安装；失败时维持原 EditorState/undo | `wp6IntegrationAudit.test.ts` 覆盖 |
| JSON 与 raw JSON 导出、错误诊断 | 两种 JSON 下载不被脚注打印校验误拦；输出边界失败时保留详细诊断 | `wp6IntegrationAudit.test.ts` 覆盖 |
| 版本恢复 | 区分用户取消恢复和实际 rollback 失败 | `VersionPanel.restore.test.ts` 覆盖 |
| 粘贴节点 ID 与内部引用 | 生产 DOMSerializer → `view.pasteHTML` 覆盖复制重映射、cut 保持原 ID、typed refs 与表脚注行；slice 内重复定义且带内部引用，或重复定义同时与当前文档 node ID 冲突时精确拒绝；正常唯一目标复制会重映射 ID。合并段落若会丢失唯一被引用目标也拒绝。拒绝时保持原件、外部 crossRef、selection、undo/history，并显示提示 | 最新 paste + `tableFootnoteHtml.test.ts` 定向组合 2 个文件 / 11 项通过（其中 paste 9 项）；修改前的 7 文件 / 56 项是历史专项结果，未与新组合相加 |

此前发现的表脚注邻接缺陷已修复：`TableFootnoteEntry` 使用唯一内容槽避免 DOMSerializer hole 异常，typed parser 提高优先级，完整 `view.pasteHTML` 回归确认表脚注行、ID 和 target 语义保留。仅在 slice 内重复定义且带内部引用，或重复定义同时撞当前文档 ID 时拒绝；唯一目标复制仍执行 ID 重映射。普通段落合并若会丢失唯一被引用目标也拒绝。测试检查拒绝时原件、外部 crossRef、selection 和 undo/history 不变及可见提示。integration 子代理报告最后一次 `vue-tsc -b` 通过；该代理未运行 full-client 或 Vite build，之后主代理完整 client 测试已通过，`pnpm build` 也通过（Vite 仅有 chunk size warning），具体计数与日志见最终验证证据。

## 上一轮子任务验证与证据等级（c24181ca）

- 本轮定向 shared 输出边界：`packages/shared/src/renderers/outputBoundary.test.ts`，12 项通过。
- 本轮定向 client 生产出口、申请单位新建/复制兼容：`wp6OutputBoundaryAudit.test.ts`、`newDocument.test.ts`、`duplicateDocument.test.ts`，31 项通过。
- shared `tsc --noEmit` 通过；client `vue-tsc -b` 与 `pnpm build` 通过，Vite 仅报告现有 chunk size warning。日志：`/private/tmp/wp6-final-client-build.log`。
- happy-dom 下 KaTeX 输出 quirks-mode warning，不影响上述定向用例。

证据分层：当前代码回归用于验证数据映射和拒绝边界；JSON golden 固定旧文档字节兼容；`docs/qa/wp6-output-boundary.png` 是静态 QA 资源；`docs/wp6-validation.md` 中 API/SQLite、浏览器与历史测试记录是先前执行证据。历史测试数字与本轮最新差异不是同一次运行，不能混写为当前验收结果。

## 上一轮主代理最终验证证据（c24181ca）

- shared：43 个测试文件 / 942 项通过；`tsc --noEmit` 通过。日志：`/private/tmp/wp6-final-shared-test.log`。
- server：2 个 test suites / 23 项通过，Nest `pnpm build` 通过。日志：`/private/tmp/wp6-final-server-test.log`、`/private/tmp/wp6-final-server-build.log`。
- client：最终全套测试 48 个文件通过、1 个文件跳过（49 files）；366 项通过、1 项 opt-in API 测试跳过（367 tests）。日志：`/private/tmp/wp6-final-client-test.log`。`vue-tsc -b` 与 `pnpm build` 通过，Vite 报现有 chunk size warning；build 日志：`/private/tmp/wp6-final-client-build.log`。最新 paste + 表脚注 HTML 定向组合 `ensureNodeId.paste.test.ts` + `tableFootnoteHtml.test.ts` 为 2 个文件 / 11 项通过；此前 7 文件 / 56 项组合是扩展前历史定向证据，不与新组合相加。
- 上一轮总计：shared 942 + client 366 + server 23 = 1,331 项通过，另有 1 项 opt-in API 测试跳过；不是本轮 typed-reference 复审的计数。

## 最新 typed-reference 复审（2026-10-08）

Codex review `5443480187` 于北京时间 2026-10-07 22:02:30 针对 `72e127b5` 提出唯一 P2（comment `4207853177`）：当 `crossRef.targetKind='figure'` 指向实际存在的 chapter 时，Resolver 已产生 `dangling-typed-ref` error，但输出 allowlist 未消费该诊断；HTML/DOCX 仍按 targetId 读取目标 label，可能把章编号作为图引用标签输出。相同 Resolver typed-reference 错误也涵盖 bibRef/termRef 和嵌套/脚注引用。

- shared 非 JSON 输出边界现在只把 `severity='error' && code='dangling-typed-ref'` 转成 `unsupported-output`，格式包括 HTML、DOCX、legacy XML（PDF 生产请求经 HTML 出口处理）。记录 Resolver 原 message、owner nodeId，并用 `resolver.problems[dangling-typed-ref]` 明示诊断来源；IRProblem 没有 mark field path，因此不伪造字段位置。其他 Resolver warning/error 不因本修复一并阻断。
- 直接 HTML/DOCX renderer 即使收到空 labels 或错误 labels 也先执行统一 boundary。生产 client 回归覆盖 HTML、DOCX、PDF request builder 和 legacy XML；菜单/源码出口展示详细原因并阻止错误格式复制/下载。JSON semantic/raw 仍可保留并导出原始错类型数据，不修改源 IR/PM。
- 正向兼容覆盖正确 chapter 引用、正确的无编号 paragraph/formula typed 引用、正确/缺省 kind 旧引用；wrong-type crossRef、bibRef、termRef 覆盖脚注及 nested note。未将所有 Resolver problem 泛化为导出阻断。
- 首次 full shared 回归发现历史 `fullFixture()` 的通用 `xref()` 把 table、figure、formula、bibliography 引用也全部标成 `clause`。没有放宽 guard 或更改 JSON golden；新增仅用于 HTML/DOCX 的 `fullRendererFixture()` 深拷贝，在测试中按五个明确目标 ID 设置真实 target kind，保持原 `fullFixture()` 以及语义 JSON 输入不变。HTML/DOCX builder 断言没有 `dangling-xref` 或 `dangling-typed-ref`；快照与 DOCX golden 未更新。

### 本轮验证

- shared：43 files / 946 tests 通过；`tsc --noEmit` 通过。日志 `/private/tmp/wp6-typed-ref-shared-test.log`、`/private/tmp/wp6-typed-ref-shared-types.log`。
- client：50 files 中 49 passed、1 skipped；370 tests passed、1 个 opt-in API 测试 skipped。`vue-tsc -b` 与 Vite build 通过，只有既有 chunk-size warning。日志 `/private/tmp/wp6-typed-ref-client-test.log`、`/private/tmp/wp6-typed-ref-client-build.log`。
- server：2 suites / 23 tests 与 Nest build 通过。日志 `/private/tmp/wp6-typed-ref-server-test.log`、`/private/tmp/wp6-typed-ref-server-build.log`。
- 本轮总计 shared 946 + client 370 + server 23 = 1,339 tests passed，另有 1 个默认跳过的 opt-in API 测试。此数字基于本轮复审起点及修复，不与上一轮 1,331 累加。

本轮自动回归不代表新 Codex 复审已批准或 PR 已合并；也不代表正式 XML 外部互操作、Microsoft Word 排版、真实标准文稿、浏览器冷启动或 SQLite 冷重开已经重新验收。VersionPanel 原有 JSON-only snapshot fallback 保留；本轮只补既有出口诊断，未新增操作面板。旧 XML 实现移除与新国标 XML 统一切换归 WP8，不重建旧转换器。

## 尚未声称完成的验证

本记录不声称全仓库无缺陷，不代表 PR 已由 Codex 重新批准，不代表 WP8 正式 XML 结构、外部互操作、Word 渲染或真实标准文稿验收完成。旧 XML 实现移除与新国标 XML 统一切换归 WP8，不重建旧转换器；本轮仅在已核实的静默丢失点添加精确边界，不扩展 XML 模式，不新增 MathML 打印。
