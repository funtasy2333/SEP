# WP8.M 补模型阶段设计

状态：设计稿，2026-10-21，待主导人审查。**只含设计，没有改动任何代码。**
基线：分支 `claude/wizardly-babbage-d3djmo`，HEAD `db33945`（已含 WP8.1 全部交付，含项目自写 RELAX NG schema `schemas/gbt46687.2/`）。
规格依据：[Phase 5.5 主计划](../dev-plan-phase-5.5.md) §1.1、§2.6；[WP8 实施方案](../wp8-xml46687.md)；[WP6 模型契约](../wp6-model-contract.md)、[WP6 方案审计](../wp6-plan-audit.md)；[WP8.1 总索引](../wp8.1/README.md)、[conventions-S](../wp8.1/conventions-S.md)、[conventions-T](../wp8.1/conventions-T.md)、`matrix-S.json`/`matrix-T.json`。
用户已确定的范围（2026-10-21）：WP8.M 只做“模型 + 显示”——补齐 IR、生产 Schema、PM↔IR 双向、Resolver 编号/标签、保存重开无损，编辑器能**正确显示**导入的这些结构（不丢不乱）；**不做**插入/编辑这些结构的菜单与属性面板（记为后续交互任务）。DOCX/HTML 等现有输出暂不能排版的新结构，按 WP6 方式走 `unsupported-output`，不得静默丢弃。

引用约定：`文件:行` 指当前基线；路径省略 `packages/` 前缀时写作 `shared/…`、`client/…`、`io/…`。未亲自核对之处标“未核实”。

---

## 0. 结论摘要

1. **33 个必做缺口**（矩阵 shall/should 的 gap-* 行）逐行列入 §2.1，归并为 **8 个实现任务组 G1～G8**。其中 `M-7.4-13`（公式图片）建议改为 not-applicable（理由见 §2.2），不实现；其余 32 行归入 G1～G8。README §2 表“术语（3）”实为 2 行，合计仍为 33（§2.4 勘误）。
2. **IR 只做加法**：新增 2 个块 kind（`normRefList`、`defList`）、2 个行内 mark（`stdRef`、`mixedCitation`），以及 `IRFigure.legend/examples`、`IRInline.image`、`IRDoc.bibliographyTitle`、`IRDoc.front.introductionClauses`、`IRTermEntry.subjectField`、`IRTable.columns`、`IRCellStyle.border*Style`、`IRReferenceTargetKind` 的 `listItem`/`abbreviation`、`ResolvedLabel.termEntryXmlId`、`NumberingStrategy.listItem?`。没有任何既有字段改名、改型、删除；唯一的“替换”是 `IRFormula.whereList` 的元素类型改为同形的别名 `IRDefItem`（JSON 不变）。
3. **生产 Schema**：新增 12 个节点（`normRefList`、`normRefStd`、`normRefStdRef`、`normRefStdTitle`、`normRefMixed`、`defList`、`figureLegend`、`figureLegendTitle`、`inlineImage`、`termSubjectField`、`noteBlock`、`exampleBlock`，见 §3.3 总表）、2 个 mark、`StdListType` 增加 `roman`、`stdTable`/单元格增加默认 `null` 的属性；既有节点只放宽内容表达式（旧文档全部仍合法，**不需要文档迁移**）。
4. **非 JSON 出口默认阻断**：不改 `BASE_FIELDS`，新 kind/新字段由 `outputBoundary.ts` 现有机制自动报 `unsupported-output`（§3.4）。放行仅限渲染器早已具备能力、只是 PM 以前存不住的内容：`IRFigure.notes`、多块注/示例（DOCX 已支持，HTML 需小修）、对列项/缩略语的 crossRef（用既有 mark 字段）；罗马列项另见 D-M-06。
5. **WP8.M 不改任何既有 xmlId**（R-1、R-2、R-4、R-5、R-6 仍归 WP8.2）；只加 R-3（`term_<n>`）、R-7（`sec_0.n`）、R-8（`ref_<n>`），并补上 WP8.1 里两处互相推诿的缺口：列项 id 与缩略语 `def-item` id（§3.2、D-M-02）。现有 HTML/DOCX 快照与 JSON golden **预期零变化**（§3.2 末表）。
6. **工作量**：8 组共 **18 个子任务** + 1 个收尾集成任务 M-Z，另有 1 个依 D-M-06 决定的可选子任务；折算约 18～20 人天（串行），按 §5 的波次并行后关键路径（G2 → G3 → M-Z）约 6.5 天，计 rebase 与审查约 7～9 个工作日（§8）。
7. **D-T-10（正文 fn 位置）**：不涉及模型改动，建议在本设计评审时一并决定，倾向方案 A“行内 `fn` 紧随其 `xref`”（STS 1.2 允许、无需国标扩展）；详见 D-M-01。

---

## 1. 范围、规则与设计原则

### 1.1 范围

做：§2.1 的 32 行（8 组）。不做：交互（插入菜单、属性面板、斜杠命令、快捷键）、新 XML 的导出/导入（WP8.2/8.3）、`may`/`example-only` 级缺口（§2.3 逐项给出处置）、DOCX/HTML 的新排版能力（除 D-M-06 的可选项）。

### 1.2 必须遵守的既有约束

- 主计划 §1.1：shared 同构纯 TS；编号只在 Resolver；渲染器无状态；IR 可 `JSON.stringify` 往返无损；不新增运行时依赖；无法无损映射时返回明确问题，禁止静默跳过。
- WP6 契约：新增字段可选；`IRDoc.extensionVersion?: 1` 与 `hasSemanticExtensions`（`shared/src/ir/extensions.ts:18-32`）；既有字段“不得改名、改型”（`shared/src/ir/types.ts:4`）；`shared/src/ir/__tests__/fixtures.ts` 字节锁定（SHA `cc6b1915…531d`，`client/src/serializer/__fixtures__/golden/manifest.json`）；JSON golden 不得变。
- 生产 Schema 约束：`client/src/extensions/editorSchema.ts` 供服务端打包——扩展模块加载期不得访问 `window/document`，不得用 `@/` 别名（`editorSchema.node.test.ts:108` 守护）；NodeView 内的 DOM 访问放在 `addNodeView()` 回调里即可。

### 1.3 本设计的 8 条设计原则（任务书直接引用）

| 编号 | 原则 | 理由 |
|---|---|---|
| P1 | 新增 IR 字段一律可选；既有字段不改名、不改型；union 只增不减 | WP6 契约；`hasSemanticExtensions` 靠“字段出现”判定 |
| P2 | 既有 PM 节点新增的属性一律 `default: null`；既有节点只放宽内容表达式 | `renderSemanticJson` 剔除 null 属性（`shared/src/renderers/json.ts:48-56`），JSON golden 因而不变；旧文档仍合法，免迁移 |
| P3 | 新扩展一律追加在 `createEditorExtensions()` 末尾（`client/src/extensions/editorExtensions.ts` 现列表末项 `WhereListEditing, InlineFormulaEditing` 之后） | Schema 内节点顺序决定 `block` 组的默认填充节点；新 `group:'block'` 节点排在 `paragraph` 之前会改变 `createAndFill` 结果 |
| P4 | 每个新增的带 `id` 的 IR 对象必须在 Resolver **主遍历**里 `registerId`，且需要标签的要在主遍历里 `setLabel` | 否则会落入 `registerExtendedData` 的 `ext_` 占位标签（`shared/src/ir/resolve.ts:610-625`），而 R-5 要求 XML 不得出现 `ext_` |
| P5 | PM 节点 + `pmToIr` + `irToPm` + 往返测试**同一个 PR 落地**，不得分拆 | 只加 PM 节点而不加映射，`pmToIr` 会把它记为 `unsupportedContent`（`pmToIr.ts:113-124`），所有出口随即被阻断 |
| P6 | 非 JSON 出口默认阻断：新 kind/字段**不**加入 `BASE_FIELDS`；放行必须有显式理由与测试 | `outputBoundary.ts:142-146,179,190-193` 已把“不在白名单且非空”的字段报为 `unsupported-output` |
| P7 | 不改任何既有 xmlId；只对**新结构**增加标签/xmlId；对既有对象只增加可选字段 | 避免与 WP8.2 的 R-1/R-2/R-4/R-5/R-6 冲突，并保持 HTML/DOCX 快照 |
| P8 | 能复用既有 PM 节点/IR 类型就复用（`whereItem/whereTerm/whereDefinition`、`resourceId` 引用键、`IRBibField`），不另造平行体系 | 复用既有的 NodeId、粘贴重映射（`ensureNodeId.ts`）、`externalIds.ts` 与编辑行为 |

---

## 2. 缺口清单与分组

### 2.1 33 个必做缺口逐行（矩阵 id → 组）

级别：shall 29 行、should 4 行（标 ※）。状态取矩阵 `status`。

| # | 矩阵 id | 级别/状态 | 元素（矩阵） | 组 | 处置要点 |
|---|---|---|---|---|---|
| 1 | M-4.4.2.3-02 | shall / gap-both | 规范性引用 `ref-list`（`content-type=norm-refs`） | G1 | `IRNormRefList` + PM `normRefList` |
| 2 | M-4.4.2.3-03 | shall / gap-both | `ref/std/std-ref/title`（标准化文件） | G1 | `IRNormRef{entryType:'std'}`，`ref`+`title` 两段行内 |
| 3 | M-4.4.2.3-04 | shall / gap-both | `mixed-citation`（非标准化文件） | G1 | `IRNormRef{entryType:'mixed'}` |
| 4 | M-4.4.2.3.2-01 | shall / gap-both | `ref-list` 属性（norm-refs/norm_refs） | G1 | 导出恒写 `norm-refs`；导入另收 `norm_refs`（WP8.3） |
| 5 | M-10.2-01 | shall / gap-both | 正文 `std` | G1 | mark `stdRef` |
| 6 | M-10.2-02 | shall / gap-both | 正文 `std-ref` | G1 | 同上（mark 覆盖的文本即 `std-ref` 内容） |
| 7 | M-10.1.7-01 | shall / gap-both | 正文 `mixed-citation` | G1 | mark `mixedCitation` |
| 8 | M-4.5.3-02 | shall / gap-ir | 参考文献 `title` | G1 | `IRDoc.bibliographyTitle?`（仅自定义时存在） |
| 9 | M-10.1.4-01 | shall / gap-both | 缩略语 `def-list[abbreviation]` | G2 | `IRDefList` + PM `defList` |
| 10 | M-10.1.4-03 | shall / gap-both | `def-item`（缩略语，可带 id） | G2 | `IRDefItem`；Resolver 给 `abb_<k>` |
| 11 | M-10.1.4-04 | shall / gap-both | `term`（缩略语） | G2 | `IRDefItem.term` |
| 12 | M-10.1.4-05 | shall / gap-both | `def`（缩略语释义） | G2 | `IRDefItem.definition` |
| 13 | M-10.1.1-04 | shall / gap-both | `xref[ref-type=abbreviation]` | G2 | `IRReferenceTargetKind` 增 `abbreviation` |
| 14 | M-8.5-01 | shall / gap-both | 图例 `legend` | G3 | `IRFigure.legend?` + PM `figureLegend` |
| 15 | M-8.5-02 | shall / gap-both | 图例 `title` | G3 | `IRLegend.title?` + PM `figureLegendTitle` |
| 16 | M-8.5-03 | shall / gap-both | 图例 `def-list[figure]` | G3 | `IRLegend.items: IRDefItem[]`（与 G2 共用项类型与项节点） |
| 17 | M-8.5-04 | shall / gap-both | 图例 `def-item` | G3 | 同上 |
| 18 | M-8.5-05 | shall / gap-both | 图例 `term` | G3 | 同上 |
| 19 | M-8.5-06 | shall / gap-both | 图例 `def` | G3 | 同上 |
| 20 | M-8.3-02 | shall / gap-both | 行内图 `inline-graphic` | G3 | `IRInline.image?` + PM 行内原子 `inlineImage` |
| 21 | M-8.2-11 | shall / gap-pm | 图注 `non-normative-note`（图内） | G3 | IR 已有 `IRFigure.notes`；PM `figure` 增 `note*` |
| 22 | M-8.4-03 | shall / gap-both | 图中示例 `non-normative-example` | G3 | `IRFigure.examples?` + PM `figure` 增 `example*` |
| 23 | M-10.1.5-01 | shall / gap-both | `xref[ref-type=list]` | G4 | `IRReferenceTargetKind` 增 `listItem` |
| 24 | M-10.1.5-02 | shall / gap-both | 被引用的 `list-item`（id） | G4 | Resolver 给有序列项标签与 `li_<k>`（仅被引用者） |
| 25 | M-9.2.9-01 | shall / gap-both | `tbx:subjectField` | G5 | `IRTermEntry.subjectField?` + PM `termSubjectField` |
| 26 | M-9.2.1-05 | shall / gap-ir | `tbx:termEntry@id`（`term_<n>`） | G5 | `ResolvedLabel.termEntryXmlId?`（纯 Resolver） |
| 27 | M-4.3.4-02 ※ | should / gap-both | 引言有条（`sec_0`） | G6 | `IRDoc.front.introductionClauses?` |
| 28 | M-4.3.4-03 ※ | should / gap-ir | 引言中的条（`sec_0.1`） | G6 | Resolver 编号 `0.n`、xmlId `sec_0.n` |
| 29 | M-5.7-04 | shall / gap-pm | 罗马列项 `roman-lower` | G7 | PM `StdListType` 增 `roman`；IR 已有 |
| 30 | M-5.6-05 ※ | should / gap-pm | 注/示例内的块内容（`p`、`list`） | G7 | PM 新增 `noteBlock`/`exampleBlock`（旧 `note`/`example` 不动） |
| 31 | M-6.1-03 | shall / gap-both | `col` 列宽 | G8 | `IRTable.columns?` + `stdTable.columns` 属性 |
| 32 | M-6.3.3.1-01 | shall / gap-both | 单元格边框样式 | G8 | `IRCellStyle.border*Style` + 单元格 4 个属性 |
| 33 | M-7.4-13 ※ | should / gap-both | 公式图片 `graphic[disp-formula]` | — | **不做，建议改 not-applicable**（§2.2） |

校验：shall 行数 = 33 − 4(※) = 29；G1 8 + G2 5 + G3 9 + G4 2 + G5 2 + G6 2 + G7 2 + G8 2 = 32，加 M-7.4-13 共 33。

### 2.2 M-7.4-13 建议改为 not-applicable

- 7.4 的命名规则 `formula_XX_Y.png`，XX = **PDF 文件页码**、Y = PDF 内图序（`conventions-T` C-T-24），针对“PDF → XML 转换流程”；SES 文档的来源是编辑器，没有 PDF 页码与图序，不存在可命名的对象。
- SES 的公式一律走 MathML（`IRFormula.mathml`/KaTeX→MathML，WP8 方案 §4.1），**不会生成**公式替代图；该图本身是 `disp-formula` 的“替代/备份”，不承载 SES 独有信息。
- 导入侧约定不变：遇到 `graphic[content-type=disp-formula]` 时**报 warning 并在导入报告里写明被忽略的资源名**（不静默），公式本体以 `mml:math` 为准。
- 动作（不在本任务范围）：把 `matrix-T.json` 中 `M-7.4-13` 的 `status` 改为 `not-applicable`、`export` 保持 not-applicable、`notes` 补一句“SES 无 PDF 来源，导入忽略并告警”，同步 `docs/wp8.1/README.md` §2 的“公式（1）”行。**需用户确认**（D-M-13）。

### 2.3 其余 20 个非必做缺口（may / example-only）处置

| 矩阵 id | 级别 | 处置 |
|---|---|---|
| M-4.2-06 | may | 不做。导入遇未知 `sec-type` 按 general + 告警（C-S-06）。 |
| M-4.3.2-29、M-G-01 | example-only | 不做。`std-org-level/type` 导入提示“已忽略”。 |
| M-5.7-11 | may | 不做（嵌套列项）。是否要在 WP8.3 把“嵌套 list”压平成同级二级列表见 D-M-12。 |
| M-5.8-01 | may | 不做（`array`，导出 n/a，导入拒绝）。 |
| M-5.9-03 | may | 不做（摘录 `attrib/permissions`，导入告警）。 |
| M-E-06 | example-only | **随 G1 一并解决**：规范性引用条目 `ref_<n>`（X-10）。 |
| M-6.2.3-02 | may | 不做（`frame/rules/cellspacing`，导入告警）。 |
| M-C.1-02 | example-only | **随 G8 部分覆盖**：导入时 `colgroup` 展开为 `IRTable.columns`，不单独建模。 |
| M-6.4-04 | example-only | 不做（`td@scope`，导入忽略并告警）。 |
| M-6.1-04、M-6.1-05 | may | 不做（表替代图/电子文件）。 |
| M-7.3-08 | may | 不做（`def` 多个 `p`，导入拼接并告警）。 |
| M-8.3-01 | may | 不做（块级 `graphic` 尺寸档位 T/S/M/L）。注意行内图的 `size:S/M/L` 随 M-8.3-02 的属性进入 G3。 |
| M-8.4-01、M-8.4-02 | may | 不做（同 `fig` 多 `graphic`、`fig-group`），见 D-M-12（对应 D-T-11）。 |
| M-10.1.4-02 | example-only | 导入侧：`xref[ref-type=other]` 指向缩略语时按 `abbreviation` 归类并告警（WP8.3）。 |
| M-10.1.8-04 | may | 不做（同一 `fn` 被多个 `xref` 引用，导入报 error）。 |
| M-10.1.9-03 | example-only | 不做（段落对齐 `style-type`）。 |
| M-D.1-03 | example-only | 不做（`thead` 等的 `@align/@valign/@style`，导入忽略并告警）。 |

### 2.4 勘误与交叉矛盾（登记，不在本任务修改）

1. README §2 表“术语（3）”：矩阵中术语类必做缺口只有 `M-9.2.9-01`、`M-9.2.1-05` 两行。按本设计分组，“引用（14）”= G1 的 7 行（不含参考文献标题）+ G2 的 5 行 + G4 的 2 行，图 9、术语 2、章节 2、表 2、其他 3（罗马列项、注/示例块内容、参考文献标题）、公式 1，合计仍为 33。
2. **循环委托**：conventions-S X-17（列项）、X-26（缩略语 `def-item`）把 id 方案“详见 T”；conventions-T C-T-51、C-T-52 又写“id 样式交 S”。两处都没有最终方案——本设计在 §3.2 补定，并列为 D-M-02。
3. X-10 `ref_<N>` 的“无正文”含义被标为“未核实”（`conventions-S.md:107`）。本设计按“没有 `<label>` 的规范性引用条目”解读，沿用 `ref_<清单内序号>`，仍标未核实。
4. `schemas/gbt46687.2/body.rng:178-193`、`README.md:267,498,518` 把 D-T-10 标为“待 WP8.M 决定”，见 D-M-01。

---

## 3. 跨组共性设计

### 3.1 IR 扩展契约

1. `IRDoc.extensionVersion` 保持 `1`（D-M-04 讨论是否升 2，倾向不升）。新字段的出现由 `hasSemanticExtensions` 判定；它在 `irToPm` 写根属性（`shared/src/ir/irToPm.ts:666`），在 `pmToIr` 末尾补 `doc.extensionVersion=1`（`pmToIr.ts:1741`）。
2. `shared/src/ir/extensions.ts` 的增量（G1～G8 合并后的完整形态）：
   - `semanticKeys` 增加：`introductionClauses`、`bibliographyTitle`、`subjectField`、`columns`、`image`、`legend`（这些键名在 IR 内唯一，可以走通用扫描）。
   - `semanticMarks` 增加：`stdRef`、`mixedCitation`。
   - `semanticKinds` 增加：`normRefList`、`defList`。
   - **不能走通用键扫描的名字**必须写成按 kind 的专门判断：`figure.examples`（`IRTermEntry.examples` 是旧的必有字段，同名）；`list.listType==='roman'`；`note/example` 的 `content` 含多于一个块或含非 `paragraph` 块（对应 `noteBlock`）。
   - 单元格 `style` 已在 `semanticKeys`（`extensions.ts:7`），`border*Style` 自动被覆盖。
3. **既有文档不会被误标**：`fullFixture`（字节锁定）与所有 WP6 之前的快照不含上述键/kind，`extensionVersion` 判定结果不变——这是 JSON golden 不变的前提，必须有回归测试（§3.6）。
4. 影响既有类型的地方（全部为“放宽”）：`IRBlock` 增 2 个成员（`shared/src/ir/types.ts:156-158`，影响所有对 `block.kind` 做穷尽 `switch` 的代码，§3.5）；`IRMark` 增 2 个成员（`types.ts:476-486`，`irToPm.markToPm` 的 switch 需补 case）；`IRReferenceTargetKind` 增 2 个值（`types.ts:488-490`，同步 `pmToIr.ts:174-179`、`pmToIr.ts:1329-1332`、`irToPm.ts:55-59`）；`ResolvedLabel`、`NumberingStrategy` 增可选成员；`IRFormula.whereList` 的元素类型改为 `IRDefItem`（形状与现有内联类型完全相同）。

### 3.2 Resolver 约定

**新增标签/xmlId 一览**（均在主遍历内登记，P4）：

| 目标（IR） | `label` | `xmlId` | `refText` | 何时产生 | 组 | 对应约定 |
|---|---|---|---|---|---|---|
| 规范性引用条目 `IRNormRef` | `''` | `ref_<n>`（n = 清单内序号，1 起） | 引用文本（`ref` 的纯文本，或 `content` 的前 40 字） | 总是 | G1 | R-8、X-10（未核实） |
| 缩略语项 `IRDefItem`（`IRDefList` 内） | 术语纯文本 | `abb_<k>`（k = 全文缩略语项序，1 起） | 同 label | 总是 | G2 | X-26 补缺（D-M-02） |
| 图例项（`IRLegend.items`） | — | —（不可被引用） | — | 不赋 label | G3 | C-T-31（图例不带 id） |
| 图注/图示例 | 沿用 `注：/注n：`、`示例：/示例n：`，作用域 = 该图 | 沿用全局序 `note_<n>`/`example_<n>` | 沿用 | 总是 | G3 | X-14/15、R-4（渲染器决定是否写 id） |
| 有序列项（`alpha/number/roman`） | `a)` `1)` `i)`（半角，D-M-03） | `li_<k>`（k = 全文被引用列项的文档序） | 容器编号 + 空格 + 标记路径，如 `5.2 a)`、`5.2 a) 1)` | **仅被 crossRef 引用者** | G4 | X-17/C-T-52 补缺 |
| 术语条目 | 既有 | 既有 `sec_<n>`；新增 `termEntryXmlId = term_<n>` | 既有 | 总是 | G5 | R-3、D-S-12 |
| 引言中的条 | `0.n`、`0.n.m` | `sec_0.n` | 同 label | 总是 | G6 | R-7、X-05 |

要点与实现位置：

- **G4 列项标签只给“被引用者”**。`visitBlock` 的 `list` 分支（`resolve.ts:208-214`）只登记候选（id、类型、序号、嵌套路径、容器标签）并 `ctx.kinds.set(item.id,'listItem')`；在 `resolve()` 里紧邻 `checkTypedReferences` **之前**（即 `visitIndexInlines`/`checkIndexTargets` 之后，使参考文献与索引内的引用也被计入 `ctx.xrefs`，见 `resolve.ts:715-722`）新增一步 `labelReferencedListItems(ctx)`，据此给被引用的有序列项 `setLabel`。理由：`checkTypedReferences`（`resolve.ts:660-663`）会对“类型正确但无标签”的目标补 `ext_` 占位标签，顺序错了就会出现 `ext_`；同时 HTML 渲染器对每个有 xmlId 的对象都会输出 `id=`（`html.ts:142-146`），只给被引用者赋 xmlId 可使现有快照零变化。
- **无序列项（dash/dot/boxed）与 `romanUpper` 不赋标签**，对它们的 crossRef 由既有 `checkXrefs` 报 `dangling-xref`（“没有编号”，`resolve.ts:542-548`）。
- **缩略语项**的类型：`ctx.kinds.set(item.id,'abbreviation')`（沿用公式注先登记 kind、通用扫描不覆盖的做法，`resolve.ts:288-291,619`）。
- **`NumberingStrategy`** 新增**可选**方法 `listItem?(listType, index): string`；`gbT11Strategy` 实现（`alpha`→`a)`…`z)`，27 起 `aa)`；`number`→`1)`；`roman`→`i)`…）。Resolver 在策略没有该方法时用内置同款函数，避免破坏既有第三方策略（`types.ts:522-543` 是“定稿接口”）。
- **脚注限制**（`ForbiddenFootnoteContainer`，`resolve.ts:111`）：G1 规范性引用条目内的脚注**允许**（与参考文献一致，`resolveBibliography` 对条目 `visitInlines` 不设限）；G2 缩略语项内的脚注**禁止**，为此给该联合类型增加新值 `'定义列表'`；G3 图例项继承既有的 `'图'`；G5 `subjectField` 沿用 `ctx.inTerm`（术语内不得有条文脚注）。这与编辑器 `canInsertBodyFootnote` 的白名单（`client/src/extensions/nodes/footnotes.ts:27-32`，只允许 `stdParagraph/paragraph/stdListItem/bibEntry/note/example`）保持一致——新增的文本容器都不在白名单里，不会新增可插入位置。
- **行内图**只允许出现在 `IRParagraph.content`，且不在术语条目/脚注内：`visitInlines` 增加参数 `allowImage`，仅 `visitBlock` 的 `paragraph` 分支传 `true`；其余位置出现 `run.image` 报 `unsupported-content`（error）。
- **规范性引用清单只能在 `secType==='norm-refs'` 的章内**：`visitChapter` 发现其他章含 `normRefList` 报 `unsupported-content`（error）。
- **参考文献标题**：`doc.bibliographyTitle` 存在时 `visitInlines(…, '标题')`（脚注报错），不产生标签。

**对现有快照/测试的影响（预期）**

| 变更 | HTML screen/print 快照 | DOCX 快照 | JSON golden | 需要同步修改的既有测试 |
|---|---|---|---|---|
| `termEntryXmlId`（G5） | 无（HTML 不读） | 无 | 无 | `shared/src/ir/__tests__/resolve.test.ts:41` 对术语 label 做整体 `toEqual`，需加字段 |
| 列项标签（仅被引用，G4） | 无（现有 fixture 无列项引用）；有引用时列项 `div` 多 `id="li_k"` | 无 | 无 | 无 |
| `introductionClauses`（G6） | 无 | 无 | 无 | 无 |
| `defList`/`normRefList`/legend 等（G1～G3） | 无（被边界阻断） | 无 | 无 | 无 |
| 注/示例多块（G7） | 单段落注输出不变；多块注见 G7（HTML 渲染器小修） | 无 | 无 | 无 |

`html.test.ts:320-339` 钉住的 `bib_<n>` 契约与 `resolve.test.ts:137` 的 `bib_1` **不动**（R-1 仍归 WP8.2）。

### 3.3 生产 Schema 约定与节点总表

通用约定：

1. 每个新节点：`parseHTML` 用 `data-type="…"` 并设 `priority: 51`（避开通用 `p/div` 规则，沿用 `semantic.ts` 的写法，如 `semantic.ts:411-428`）；`renderHTML` 带 `data-type` 与 `class="std-…"`；文本属性用 `stringAttribute()`（避免 Tiptap 把 `007/true` 隐式转型，`semantic.ts:17-19`）；JSON 载荷属性用 `data-*` + `JSON.stringify`/`JSON.parse`（沿用 `FigureResource` 的 `data-resource-payload` 做法，`semantic.ts:716-756`）。
2. 带 IR 实体 id 的节点加入 `NODE_ID_TYPES`（`client/src/extensions/plugins/ensureNodeId.ts:12-92`）：`normRefList`、`normRefStd`、`normRefMixed`、`defList`、`figureLegend`、`noteBlock`、`exampleBlock`。纯展示子节点与 `inlineImage`（IR 无 id）不加。
3. 含引用属性的新节点加入粘贴重映射两张表（`ensureNodeId.ts:349-355` 的 `targetFields`、`ensureNodeId.ts:445-451` 的 `referenceFields`）：`inlineImage: ['resourceId']`。`shared/src/ir/externalIds.ts` 因复用键名 `resourceId` 而**无需修改**（P8）。
4. 新节点文件放 `client/src/extensions/nodes/`，在 `nodes/index.ts` 导出、`editorExtensions.ts` 追加（P3）。

**新增 PM 节点/mark 总表**（12 节点 + 2 mark）

| 节点 | 组 | group | content 表达式 | attrs（均 default null / 空串） | HTML（data-type） |
|---|---|---|---|---|---|
| `normRefList` | G1 | block | `(normRefStd \| normRefMixed)+` | nodeId | `div[data-type=norm-ref-list]` |
| `normRefStd` | G1 | — | `normRefStdRef normRefStdTitle` | nodeId | `div[norm-ref-std]` |
| `normRefStdRef` | G1 | — | `inline*` | — | `span[norm-ref-std-ref]` |
| `normRefStdTitle` | G1 | — | `inline*` | — | `span[norm-ref-std-title]` |
| `normRefMixed` | G1 | — | `inline*` | nodeId | `div[norm-ref-mixed]` |
| `defList` | G2 | block | `whereItem+` | nodeId | `dl[def-list]` |
| `figureLegend` | G3 | — | `figureLegendTitle? whereItem+` | nodeId | `div[figure-legend]` |
| `figureLegendTitle` | G3 | — | `inline*` | — | `p[figure-legend-title]` |
| `inlineImage` | G3 | inline（atom） | — | src、resourceId、alt、size | `img[inline-image]` |
| `termSubjectField` | G5 | — | `inline*` | — | `div[term-subject-field]` |
| `noteBlock` | G7 | block | `(stdParagraph \| stdList)+` | nodeId | `div[note-block]` |
| `exampleBlock` | G7 | block | `(stdParagraph \| stdList)+` | nodeId | `div[example-block]` |
| mark `stdRef` | G1 | — | — | — | `span[std-ref]` |
| mark `mixedCitation` | G1 | — | — | — | `span[mixed-citation]` |

**NodeView**：只有 `noteBlock` 需要（与 `Note` 一致，挂可随 Resolver 更新的编号标记，见 G7）；`exampleBlock` 的“示例：”标签走 `FootnoteLabels` 的 `Decoration`；其余节点只用 `renderHTML` + CSS，不引入 NodeView。空节点的占位提示为可选项：参照 `whereListEditing.ts` 里 `where-term-empty` 的做法，用 `Decoration` 给空节点加 `is-empty` 类再由 CSS 画提示（ProseMirror 的空文本块内有 trailing `<br>`，不能依赖 `:empty`）。

既有节点的放宽（旧文档全部仍合法）：

| 既有节点 | 现表达式 | 新表达式 | 组 |
|---|---|---|---|
| `figure`（`figure.ts:25`） | `figureImage figureCaption figureCaptionEn? figureDescription* figureGroup*` | 尾部追加 `figureLegend? note* example*` | G3 |
| `termDef`（`term-def.ts:161`） | `termName termNameEn? termDefinition (…)*` | `termName termNameEn? termSubjectField? termDefinition (…)*` | G5 |
| `StdList`（`std-list.ts:18-32`） | `listType ∈ {dash,alpha,numeric,dot,boxedNumeric}` | 增加 `roman` | G7 |
| `stdTable`（`std-table.ts:66-85` 属性） | — | 增 `columns`（JSON 数组，默认 null） | G8 |
| `tableCell/tableHeader`（`semantic.ts:584-593,632-678`） | — | 增 `border{Top,Right,Bottom,Left}Style`（默认 null） | G8 |
| `introduction`（`introduction.ts:10`） | `block+` | **不变**——`clause` 本来就在 `block` 组，只缺映射 | G6 |

### 3.4 输出边界（DOCX / HTML / 旧 XML / XML46687）

机制（不改代码即生效）：`getOutputSupportProblems` 对每个对象按 `kind`（无 kind 时按父键推断的 shape）查 `BASE_FIELDS`（`outputBoundary.ts:20-48`）。`kind` 不在表内 → `report('kind')`（`:179`）；字段不在表内且非空 → `report(field)`（`:190-193`）；mark 类型不在 `MARKS`（`:50`）→ `report('type')`（`:194`）。`XML46687` 的字段表现在与旧 `XML` 完全相同（`:65`，“WP8.2 再放开”）。DOCX 对 `warning/quote/code` 另有渲染期 `throw`（`docx/body/block.ts:431-434`），新块 kind 沿用同款写法。

| 新结构 | HTML | DOCX | 旧 XML | XML46687（现在） | 备注 |
|---|---|---|---|---|---|
| `normRefList` / `normRef`（G1） | 阻断 | 阻断 | 阻断 | 阻断 → WP8.2 放开 | 未结构化的“规范性引用文件”章仍按普通段落输出（现状） |
| mark `stdRef` / `mixedCitation`（G1） | 阻断（D-M-07 可改放行） | 同左 | 阻断 | 阻断 → WP8.2 放开 | 打印上无视觉差异，见 D-M-07 |
| `bibliographyTitle`（G1，自定义时） | 阻断 | 阻断 | 阻断 | 阻断 → WP8.2 放开 | 默认标题不产生该字段 |
| `defList`（G2） | 阻断 | 阻断 | 阻断 | 阻断 → WP8.2 放开 | |
| crossRef `abbreviation` / `listItem`（G2/G4） | 放行（输出 `refText`，既有 mark 字段 `targetKind`） | 放行 | 由旧序列化器的目标检查拒绝（无 ID 载体，见 `wp6-plan-audit.md` 2026-10-08 补充） | 放行 | 含 `defList` 的文档整体被上一行阻断 |
| `figure.legend` / `figure.examples`（G3） | 阻断 | 阻断 | 阻断 | 阻断 → WP8.2 放开 | `figure` 字段表不含这两项 |
| `figure.notes`（G3，PM 现可保存） | **放行**：`html.ts:371` 与 `docx/body/block.ts:219` 已渲染 | 放行 | 放行（字段表含 `notes`；旧 XML 序列化器是否输出：未核实，随 WP8.4 删除） | 放行 | 唯一的“新放行”，须加 HTML/DOCX 渲染回归 |
| `IRInline.image`（G3） | 阻断（inline 字段表 `:42` 无 `image`） | 阻断 | 阻断 | 阻断 → WP8.2 放开 | |
| `termEntry.subjectField`（G5） | 阻断 | 阻断 | 阻断 | 阻断 → WP8.2 放开 | 可选后续：HTML/DOCX 在定义前输出“〈领域〉”（D-M-14） |
| `front.introductionClauses`（G6） | 阻断（`front` 字段表 `:25`） | 阻断 | 阻断 | 阻断 → WP8.2 放开 | |
| `roman` 列项（G7） | D-M-06 | D-M-06 | 旧序列化器降为 arabic（`xmlSerializer.test.ts:14`） | 放行（XML 有 `roman-lower`） | 见 D-M-06 |
| 多块注/示例（G7） | 放行但需修 HTML 渲染（见 G7） | 放行（`docx/body/block.ts:167-198` 已逐块输出） | 字段表放行；旧序列化器行为未核实（随 WP8.4 删除） | 放行 | |
| `table.columns`（G8） | 阻断 | 阻断 | 阻断 | 阻断 → WP8.2 放开 | `table` 字段表不含 |
| 单元格 `style.border*Style`（G8） | 阻断（`cell` 字段表本就不含 `style`） | 阻断 | 阻断 | 阻断 → WP8.2 放开 | |

WP8.M **不得**打开 XML46687 的任何白名单；WP8.2 的增量清单见 §6.2。

### 3.5 联动清单（必须同步的穷尽点）

TypeScript 对 `switch(block.kind)` 无 `default` 的函数会因返回类型报错，可当作“编译器清单”；其余靠本表。每个组的任务书需把相关行抄进“改动文件”。

| 位置 | 内容 | 涉及组 |
|---|---|---|
| `shared/src/ir/footnotes.ts:7-33` | `collectFootnotes` 的块 switch 加新 kind；通用 `extras` 兜底会扫到新增行内数组 | G1 G2 G3 |
| `shared/src/renderers/footnotes.ts:57,79,124` | 块遍历 switch 加 case（no-op） | G1 G2 |
| `shared/src/renderers/docx/body/block.ts:431-434`、`tablePagination.ts:55` | 与 `warning/quote/code` 同款“DOCX 尚未支持”分支 | G1 G2 |
| `shared/src/renderers/html.ts:418-444`（`renderBlock` 无 default） | 新 kind 已被边界阻断，补显式 no-op 与注释 | G1 G2 |
| `shared/src/ir/authoring.ts:169-177`（`IR_ONLY_FIELDS`） | `figure` 增 `legend/examples`，`table` 增 `columns`，`termEntry` 增 `subjectField`，`run` 增 `image`；让 documentOps 给出“暂不支持”的准确提示而非“未知字段” | G3 G5 G8 |
| `shared/src/ir/authoring.ts:735-737,749-751,972` | 三处断言“生产列表/图不支持嵌套、罗马、图中注”的提示文案在 G3/G7 落地后已不准确：改为“写作片段暂不支持（模型已支持，写作入口留后续交互任务）”，行为不变，同步 `authoring.test.ts:489-490,500`、`authoringReference.test.ts:276`（这两处断言的是写作层 `normalizeAuthoringFragment` 拒绝，写作入口本阶段不放开，断言不变，仅文案同步）；`authoringProjection.test.ts:327-341` 断言 roman 与图中注经 `irFragmentToPm` 被拒，G3/G7 之后必须改用 `romanUpper` 与多块图中注 | G3 G7 |
| `shared/src/ir/irToPm.ts:683-685`（`FRAGMENT_BLOCK_KINDS`） | **不增加**新 kind（写作片段不能创建它们，符合“不做插入”） | — |
| `io/src/documentOps/locator.ts:23-33` | `BLOCK_KINDS`、`BLOCK_BY_PM_TYPE` 与 `pmToIr.convertBlock` 保持同构：加入 `noteBlock→note`、`exampleBlock→example`；`normRefList/defList` 暂记为“不可寻址”（与 `pmToIr` 的块 kind 不在 `NodeKind` 内一致，需在任务里确认索引不偏移） | G1 G2 G7 |
| `io/src/documentOps/inspect.ts:181` 一带的 `FIELD_LABELS` | 为新字段补中文标签 | G3 G5 G8 |
| `client/src/utils/docDiff.ts:171,177` | 版本文本比对的 `note/example` 分支补 `noteBlock/exampleBlock`；补 `normRefList/defList/figureLegend` 的文本化 | G1 G2 G3 G7 |
| `client/src/components/editor/DocumentOutline.vue:183-186` | `introduction` 分支现在 `return false` 不进入子树，需改为继续遍历，使引言内的条进入大纲 | G6 |
| `client/src/extensions/plugins/footnoteLabels.ts:57-60` | 示例编号的 `Decoration` 目前只认 `example`；加 `exampleBlock`；`noteBlock` 的 NodeView 复用 `std-note-editor/std-note-marker` 类名即可被 `refreshFootnoteLabels` 处理 | G7 |
| `client/src/styles/standard-nodes.css` 与 `standard-nodes.test.ts:12` | 新增样式；测试里“不得出现 `lower-roman` 计数器”的断言需随 G7 修改 | G1～G8 |

### 3.6 测试通则

1. **fixture**：不得修改 `shared/src/ir/__tests__/fixtures.ts`。新增 `shared/src/ir/__tests__/wp8mFixtures.ts`（IR 原生构造器）与 `client/src/extensions/__fixtures__/wp8m.ts`（生产 PM JSON，仿 `wp6.ts` 的 `pm()/txt()` 写法）。**不改 `wp6.ts`**：它被 8 个测试文件共用（`editorSchema.node.test.ts`、`wp6Projection.test.ts`、`wp6Labels.test.ts` 等），改动会牵连既有断言。
2. **每组固定四类用例**（标题带 `[矩阵id]`，便于 §3.6.5 的覆盖断言）：
   - Schema：`schema.nodeFromJSON(fixture).check()` 通过；非法组合被拒。
   - 往返：生产 PM → `pmToIr`（`warnings=[]`、`unsupportedContent` 空）→ `resolve`（无 error）→ `irToPm` → `check()` → 逐属性对比（仿 `client/src/extensions/wp6Projection.test.ts:25-55`）→ `JSON.stringify/parse` → 再次 `pmToIr`，IR 深度相等。
   - HTML 往返：`DOMSerializer`/`DOMParser` 两轮（仿 `wp6ModelAudit.test.ts:9-27` 的 `roundtripHtml`），节点类型、`nodeId`、属性不变。
   - 保存重开：`Editor` + `replaceEditorDocument`（实际加载入口，`wp6-model-contract.md` “实际加载与展示”）加载、`exportSemanticJson` 再导，JSON 相等；与 `client/src/utils/wp6Roundtrip.test.ts` 同款。
3. **边界回归**：新增 `shared/src/renderers/__tests__/wp8mBoundary.test.ts`：对每个新 kind/字段逐一断言 HTML/DOCX/XML/XML46687 的 `getOutputSupportProblems` 结果（§3.4 表即期望）。
4. **golden 回归**（每个 PR 必跑，结果写进 PR 描述）：`jsonExporter.test.ts` 两个字节 golden、manifest 中 fixtures.ts 的 SHA、`git diff --stat` 对 `__snapshots__` 为空。
5. **矩阵覆盖断言**：新增 `wp8mMatrixCoverage.test.ts`，内置 32 个矩阵 id 常量，断言每个 id 出现在至少一个 `wp8m*.test.ts` 的用例标题里（WP8.1 README 要求 WP8.2 起测试引用矩阵 id，这里提前执行）。
6. **保存重开的真实验收**：仿 WP6 的 opt-in 验收（`wp6Persistence.acceptance.test.ts`，环境变量 `WP6_API_URL`/`WP6_EVIDENCE_FILE`）在收尾集成任务里对一次性 API/SQLite 实例执行一遍，使用 `wp8m.ts` fixture；不满足环境则明确记“未执行”，不得用单测冒充。

---

## 4. 各组详细设计

每组固定小节：矩阵行与约定 → IR → 生产 Schema → 映射与诊断 → Resolver → 输出边界 → 显示 → 测试 → 子任务。跨组共性（§3）不再重复；标 **（§3.x）** 处直接引用。

### 4.1 G1　规范性引用文件结构化条目 + 正文 std/mixed-citation + 参考文献标题

**矩阵行**：M-4.4.2.3-02、-03、-04，M-4.4.2.3.2-01，M-10.2-01、-02，M-10.1.7-01，M-4.5.3-02（并解决示例级 M-E-06）。
**约定**：C-S-24、C-S-27、C-T-54、X-09、X-10、R-8；采用 D-S-08 的选项①（扩展 IR，不做启发式拆分）。

**IR 草案**（`shared/src/ir/types.ts`）

```ts
/** 规范性引用文件清单（4.4.2.3.1～3）。只能出现在 secType==='norm-refs' 的章内（Resolver 校验）。 */
export interface IRNormRefList { kind: 'normRefList'; id: NodeId; entries: IRNormRef[] }

/**
 * 清单条目。std：标准化文件（std/std-ref/title）；mixed：非标准化文件（mixed-citation，保持原有格式）。
 * 不复用 IRBibEntry：IRBibEntry 同时存“显示文本 + 结构化字段”两份来源，且参与 [n] 编号与 bibRef 类型检查
 * （resolve.ts:502-528），而规范性引用条目无编号，只需要单一来源。
 */
export type IRNormRef =
  | { kind: 'normRef'; id: NodeId; entryType: 'std'; ref: IRInline[]; title: IRInline[] }
  | { kind: 'normRef'; id: NodeId; entryType: 'mixed'; content: IRInline[] }

export type IRBlock = /* 既有 */ | IRNormRefList | IRDefList     // G1、G2 各加一个成员

/** 正文中对标准化文件的引用：被标记的文本即 std-ref 内容（10.2）。 */
export type IRMark = /* 既有 */ | { type: 'stdRef' } | { type: 'mixedCitation' }

export interface IRDoc { /* 既有 */ bibliographyTitle?: IRInline[] }   // 仅当标题不是默认的“参考文献”时存在
```

**生产 Schema**（节点定义见 §3.3 总表；文件 `client/src/extensions/nodes/norm-ref.ts`、`marks/std-ref.ts` 新建）

- 结构：`normRefList > (normRefStd | normRefMixed)+`；`normRefStd > normRefStdRef normRefStdTitle`；`normRefMixed > inline*`。标准化条目用两个子节点而不是“显示文本 + 字段”，这样 PM 树是唯一事实来源，编辑显示文字与 XML 的 `std-ref/title` 不会分叉。
- mark `stdRef`、`mixedCitation`：`inclusive:false`，互相 `excludes`；`parseHTML` 为 `span[data-type="std-ref"]`/`span[data-type="mixed-citation"]`，`priority:51`。
- `bibliographyTitle` 节点已存在（`bibliography.ts:76-93`），无 Schema 变化。
- 新节点在 `normRefList` 之外不可出现（`normRefStd/normRefMixed/…` 不属于任何 group）。

**映射与诊断**

| 方向 | 规则 |
|---|---|
| pmToIr | `convertBlock`（`pmToIr.ts:905-946`）新增 `normRefList`；`normRefStd` 的两个子节点各 `convertInlines`；`normRefMixed` → `content`。`convertMarks`（`:194-274`）把 `stdRef/mixedCitation` 直接映射为同名 IR mark。`convertBibliography`（`:1186-1227`，现在在 `:1189` 直接 `continue` 丢弃标题）改为：取 `bibliographyTitle` 的行内内容，**仅当**它不等于单个无格式的“参考文献”时才写 `doc.bibliographyTitle`。 |
| irToPm | `blockToPm`（`irToPm.ts:436-457`）新增 `normRefList`；`markToPm`（`:61-81`）新增两个 case；`:621-624` 的固定标题改为 `doc.bibliographyTitle ?? [{text:'参考文献'}]`。 |
| 诊断 | `entries` 为空 → IRToPmError（PM 要求 `+`）；同一 run 同时带 `stdRef` 与 `mixedCitation` → 在 `diagnoseInlineProjection`（`inlineProjectionDiagnostics.ts`）新增冲突错误；norm-ref 条目内出现 `inlineImage`/脚注按 §3.2 规则；PM 的 `normRefList` 位于非 `norm-refs` 章 → pmToIr 不报，**Resolver 报** `unsupported-content`（章角色可能由标题推断，pmToIr 阶段尚不确定，见 `pmToIr.ts:1147-1173`）。 |

**Resolver**：`visitBlock` 增加 `normRefList` 分支：`registerId` 列表与各条目；条目 `setLabel(id,'',`ref_${n}`,refText)`；条目内行内用 `visitInlines`（脚注允许）。`visitChapter` 校验章角色。`resolve()` 在参考文献前后访问 `doc.bibliographyTitle`（容器 `'标题'`，`fromId` 用常量 `'doc.bibliographyTitle'`）。其余见 §3.2。

**输出边界**：§3.4 表（全部默认阻断）。注意：现状下，未结构化的“规范性引用文件”章（普通段落）的 HTML/DOCX 输出完全不变。

**显示**（`standard-nodes.css`）：`.std-norm-ref` 悬挂缩进（同 `.std-bib-entry`）；`normRefStdRef` 与 `normRefStdTitle` 之间用 `::before{content:'\2003'}` 呈现全角空格；`stdRef`/`mixedCitation` mark 用弱样式（点状下划线），保证作者能看出标记范围又不抢眼。子节点以 `span`、`display:inline` 渲染；若光标/选区行为异常再退为 `inline-block`（**未核实**，纳入 G1-c 的目视清单）。参考文献标题沿用既有 `h2.std-bibliography-title`，无需新增。

**测试**（标题带矩阵 id）：① 规范性引用章（引导 `p` + 2 个 std + 1 个 mixed，mixed 内含脚注）全链路往返；② 其他章含 `normRefList` → Resolver error；③ 三类容器内的 `stdRef/mixedCitation`（段落、列项、注）往返，与 `crossRef/bold` 叠加；④ `bibliographyTitle`：默认 → 字段缺失且 `extensionVersion` 不变；自定义“参考书目” → 字段存在且 `extensionVersion=1`；标题含脚注 → error；⑤ HTML 往返；⑥ 粘贴重复 `nodeId` 的重映射；⑦ 边界矩阵。

**子任务**

| # | 内容 | 主要文件 | 规模 | 验收 |
|---|---|---|---|---|
| G1-a | IR 类型、`extensions.ts`、Resolver（`ref_<n>`、章角色校验、标题访问）、`wp8mFixtures.ts` 的规范性引用部分、边界测试 | `shared/src/ir/{types,extensions,resolve}.ts`、`shared/src/renderers/__tests__/wp8mBoundary.test.ts` | M | Resolver/边界单测绿；golden 不变 |
| G1-b | PM 节点与 mark、`NODE_ID_TYPES`、`pmToIr`/`irToPm`（含 `bibliographyTitle`）、`diagnoseInlineProjection` 冲突、往返与 HTML 往返测试 | `client/src/extensions/nodes/norm-ref.ts`、`marks/std-ref.ts`、`editorExtensions.ts`、`ensureNodeId.ts`、`shared/src/ir/{pmToIr,irToPm,inlineProjectionDiagnostics}.ts` | L | §3.6 四类用例全绿 |
| G1-c | 显示样式、`docDiff`、io `locator`、`authoring` 字段表、目视清单 | `standard-nodes.css`、`docDiff.ts`、`io/src/documentOps/locator.ts`、`authoring.ts` | S | 目视清单逐项勾选 |

---

### 4.2 G2　通用“定义列表”（缩略语 def-list）与公式 whereList 的统一评估

**矩阵行**：M-10.1.4-01、-03、-04、-05，M-10.1.1-04。**约定**：C-T-51、X-26（补缺）、G-T-16。

**统一评估（回答 G-T-16）**

| 层 | 结论 |
|---|---|
| IR 项类型 | **统一**：公式“式中”、图例、缩略语的项都是 `{id, term, definition}`，现有 `IRFormula.whereList` 的元素类型与之逐字相同。新增别名 `IRDefItem` 并让 `IRFormula.whereList: IRDefItem[]`（JSON 与既有字段形状不变）。 |
| IR 容器 | **不统一**：公式保留 `whereList`（既有字段不得改型）；图例是 `IRFigure.legend`；缩略语是块 `IRDefList`。三者语义位置不同，合并成一个“万能容器”只会增加判别字段。 |
| PM 项节点 | **统一**：三者共用 `whereItem/whereTerm/whereDefinition`，因此 `WhereListEditing`（`whereListEditing.ts`）的 Enter/Tab 行为在图例、缩略语里天然可用（不属于本阶段验收，但无需额外代码）。 |
| PM 容器 | **不统一**：`whereList` 保持不动；新增 `defList`（块，缩略语）与 `figureLegend`（G3，非块组）。**不把公式的 `whereList` 并入 `defList`**：否则要给既有 `whereList` 补 `nodeId`，`ensureNodeId` 的 `onCreate` 会在打开每篇旧公式文档时补 id（`ensureNodeId.ts:669-678`），使文档变脏，还会触动公式 JSON golden 与 `whereListConversion.ts`。 |

**IR 草案**

```ts
export interface IRDefItem { id: NodeId; term: IRInline[]; definition: IRInline[] }
export interface IRFormula { /* 既有 */ whereList: IRDefItem[] }                 // 仅类型别名替换
/** 块级定义列表：目前只用于缩略语（导出恒写 list-content="abbreviation"）。 */
export interface IRDefList { kind: 'defList'; id: NodeId; items: IRDefItem[] }
export type IRReferenceTargetKind = /* 既有 */ | 'abbreviation' | 'listItem'      // listItem 属 G4
```

**生产 Schema**：`defList`（块，`whereItem+`，`<dl data-type="def-list">`），其余见 §3.3。`whereItem` 现有 `group:'block'`（`semantic.ts:448-452`）属历史写法，**不改**。

**映射与诊断**：把 `convertFormula` 中读取 `whereItem` 的循环（`pmToIr.ts:869-881`）与 `formulaToPm` 中写 `whereItem` 的映射（`irToPm.ts:427-432`）抽成共享函数 `convertDefItems/defItemsToPm`（纯重构，先跑公式相关测试证明零变化），`defList` 复用。`crossRef.targetKind='abbreviation'` ↔ PM `refType:'abbreviation'`：在 `REF_KIND_MAP`（`pmToIr.ts:174-179`）、`IR_REFERENCE_TARGET_KINDS`（`:1329-1332`）、`targetKinds`（`irToPm.ts:55-59`）各加一行。`items` 为空 → IRToPmError。

**Resolver**：`visitBlock` 增加 `defList` 分支：`registerId(list.id)`；每项 `registerId`、`ctx.kinds.set(id,'abbreviation')`、`visitInlines(term/definition, …, '定义列表')`、`setLabel(id, 术语纯文本, `abb_${++ctx.abbrSeq}`, 术语纯文本)`。无需改 `checkXrefs`/`checkTypedReferences`——类型为 `abbreviation` 的引用与目标 kind 一致即通过。

**输出边界 / 显示**：§3.4。显示：`.std-def-list` 两列（术语 / 释义），覆盖 `.std-where-item > dd::before{content:'——'}`（`standard-nodes.css:492-495`）使其对 `.std-def-list` 不加破折号；块前不加“式中：”。

**测试**：缩略语表（3 项）往返；正文 `crossRef(targetKind='abbreviation')` 指向第 2 项 → label/refText/`abb_2`；类型不符 → `dangling-typed-ref`；缩略语项内脚注 → `invalid-footnote`；`whereList` 抽取重构的回归（既有 `authoringWhereSymbol.test.ts`、`wp6FormulaEditing.test.ts`、`whereListEditing.test.ts` 必须不改动即通过）。

**子任务**

| # | 内容 | 主要文件 | 规模 |
|---|---|---|---|
| G2-a | `IRDefItem/IRDefList`、`abbreviation` 目标类型、共享抽取、Resolver、`pmToIr/irToPm` 的 `defList` 与 refType 映射、shared 测试 | `shared/src/ir/{types,resolve,pmToIr,irToPm}.ts` | M |
| G2-b | `defList` 节点、`NODE_ID_TYPES`、CSS、client 往返/HTML 往返测试、`docDiff` | `client/src/extensions/nodes/def-list.ts`、`ensureNodeId.ts`、`standard-nodes.css` | M |

---

### 4.3 G3　图：图例、行内图、图注、图中示例

**矩阵行**：M-8.5-01～06、M-8.3-02、M-8.2-11、M-8.4-03（共 9 行）。**约定**：C-T-26、C-T-29、C-T-31、C-T-32、G-T-07、G-T-08。依赖：与 G2 共享 `IRDefItem` 与 `whereItem` 节点（先合入者定义别名，后者复用）。

**IR 草案**

```ts
export interface IRLegend { id: NodeId; title?: IRInline[]; items: IRDefItem[] }          // legend > title + def-list[figure]
export interface IRFigure { /* 既有：notes: IRNote[] 保持必有 */ legend?: IRLegend; examples?: IRExample[] }
/** inline-graphic：纯行内叶子，不另造实体 id（WP6 契约）；resourceId 沿用既有引用键，外部 ID 重映射与 dangling-resource 校验自动覆盖。 */
export interface IRInlineImage { src: string; resourceId?: NodeId; alt?: string; size?: 'S' | 'M' | 'L' }
export interface IRInline { /* 既有 */ image?: IRInlineImage }
```

`size` 对应 `@specific-use="size:S|M|L"`（8.3 表 2，可选）；`size:T` 仅 `graphic` 可用，不收。

**生产 Schema**

- `figure.content` → `figureImage figureCaption figureCaptionEn? figureDescription* figureGroup* figureLegend? note* example*`。**顺序固定“注在前、示例在后”**——IR 里 `notes`/`examples` 是两个数组，PM 若允许交错，往返会改变作者顺序。XML 导入时交错的注/示例会被规范化为“注在前”，导入报告写 warning（D-M-09）。
- `figureLegend`（非块组，`figureLegendTitle? whereItem+`）与 `figureLegendTitle`：只能出现在 `figure` 内。
- `inlineImage`：`inline:true, atom:true, selectable:true`，属性 `src`（默认 `''`）、`resourceId`、`alt`、`size`；`parseHTML` 为 `img[data-type="inline-image"]`，`priority:51`（压过通用 `Image` 规则，仿 `figure.ts:105-108` 的 `FigureImage`）。
- 图内 `note` 沿用现有 `note` 节点（`inline*`，单段）；多块注在图里不支持（见映射）。

**映射与诊断**

| 方向 | 规则 |
|---|---|
| pmToIr | `convertFigure`（`pmToIr.ts:507-577`）：`allowed` 集合（`:513`）加入 `figureLegend/note/example`；`note` 子节点 → `notes[]`（`convertNote`，沿用 `${id}.p0` 规则），`example` 子节点 → `examples[]`；`figureLegend` → `legend`。`convertInlines`（`:277-335`）新增 `inlineImage` → `{text:'', image}`；`isInlineAtom`（`:768-775`）认 `image`；`trimInlines` 因此不再把它当空 run 丢弃。带 marks 的 `inlineImage` → `unsupportedContent`。 |
| irToPm | `figureToPm`（`irToPm.ts:399-418`）删除 `:400` 的 `notes` 拒绝，改为输出 `note`（经 `noteContent`，多块注报错并说明“图中的注只支持单段落”）、`example`、`figureLegend`。`inlineToPm`（`:83-113`）在 `formula` 之后输出 `inlineImage`。 |
| 诊断 | `legend.items` 为空；注/示例多块；`image` 带 marks/style（`inlineProjectionDiagnostics.ts` 的“空文本且无公式载体”分支加上 `!image`，并新增“image run 不得带 marks/style”）；`image` 出现在脚注负载内——`footnotePayload.ts:78-98` 的白名单自动判为不支持，无需改。 |

**Resolver**：`visitBlock` 的 `figure` 分支（`resolve.ts:248-269`）在注与图题之后增加：`legend`（`registerId`，标题与各项 `visitInlines(…, '图')`，不赋 label）与 `examples`（`registerId`、块 `visitBlock`、`ctx.scope(figure.id).examples.push`，与注同一作用域机制）。`paragraph` 分支传 `allowImage`（§3.2）。图内的注已有“先于图编号遍历”的顺序（`:249-254`），不动。

**输出边界**：§3.4。`figure.notes` 放行并新增 HTML/DOCX 渲染回归；`legend/examples/image` 阻断。

**显示**：`.std-figure-legend`（标题行 + 项列表，沿用 `.std-where-item` 布局但无“式中：”与破折号）；图内 `note` 直接使用现有 `Note` 的 NodeView 与 `FootnoteLabels`（`footnoteLabels.ts:12-18` 会为 `.std-note-editor` 按 Resolver 作用域写 `注：/注n：`）；图内 `example` 通过 `FootnoteLabels` 的 `Decoration` 得到“示例：”标签（`:57-60`，已按 `example` 类型处理）；`.std-inline-image { vertical-align: middle; max-height: 3em }`，`data-size=S/M/L` 分别 1.2em/2.4em/3.6em（对应 8.3 表 2 的“单/双/三倍行高”）。

**测试**：① 带 legend（3 项）+ 2 条注 + 1 条示例的图全链路；注标签为 `注1：/注2：`（作用域 = 该图）；② 行内图出现在段落、列项、注、单元格；出现在标题/图题/术语/脚注 → Resolver error；③ `resourceId` 悬空 → `dangling-resource`；④ **HTML 与 DOCX 渲染带图注的 PM 文档**（新增用例，不改旧快照）；⑤ 旧文档（无新节点）的 `figure` JSON 不变。

**子任务**

| # | 内容 | 规模 |
|---|---|---|
| G3-a | shared：类型、`extensions.ts`、`pmToIr/irToPm`（图/行内图）、`inlineProjectionDiagnostics`、Resolver、测试 | L |
| G3-b | client：`figure` 表达式、`figureLegend*`、`inlineImage`、粘贴重映射（`ensureNodeId.ts:349-355,445-451` 加 `inlineImage:['resourceId']`）、CSS、往返/HTML 往返测试 | M |
| G3-c | 联动：`authoring.ts:169-177`/`:972`、io `FIELD_LABELS`、`docDiff`、HTML/DOCX 图注渲染回归 | S |

---

### 4.4 G4　列项引用与列项 id

**矩阵行**：M-10.1.5-01、M-10.1.5-02。**约定**：C-T-52、X-17、R-9、G-T-17。**PM Schema 零变化。**

**IR 草案**：`IRReferenceTargetKind` 增 `'listItem'`（G2 已列同一处）；`NumberingStrategy` 增可选 `listItem?(listType: IRList['listType'], index: number): string`；`strategies.ts` 导出同名的内置实现并由 `gbT11Strategy` 引用。

**映射**：PM `crossRef.refType='listItem'` ↔ IR `targetKind:'listItem'`（`REF_KIND_MAP`、`IR_REFERENCE_TARGET_KINDS`、`targetKinds` 各加一行，与 G2 同一处，合并冲突时只需并集）。

**Resolver 规则（本组核心，见 §3.2 的位置说明）**

1. 候选登记：`visitBlock` 的 `list` 分支遍历 `block.items` 时，按 `block.listType ∈ {alpha, number, roman}` 登记 `{id, marker, markerPath, containerId}`，其中 `markerPath` 在嵌套列表（`IRList.items[].content` 可含 `IRList`）时为 `a) 1)` 这样的路径；全部列项（含无序）`ctx.kinds.set(id,'listItem')`。
2. 赋标签：`labelReferencedListItems(ctx)` 只处理出现在 `ctx.xrefs` 里的候选：`label = marker`，`xmlId = li_${k}`（k = 被引用候选的文档序），`refText = containerLabel + ' ' + markerPath`；`containerLabel` 取 `ctx.labels[scopeKey]?.label`，前言/引言（`scopeKey` 为 `front.*`）与无标签容器时省略前缀与空格。
3. 无序列项（`dash/dot/boxed`）、`romanUpper` 不赋标签；`checkXrefs` 照常报 `dangling-xref`（“没有编号”）。
4. 半角括号与 `refText` 形式取默认值，待 D-M-03 确认。
5. R-9 更新：`listItem` 现在是合法目标；`paragraph` 目标仍无 xmlId（导出时由 WP8.2 报告）。

**输出边界**：crossRef 的 `targetKind` 是既有 mark 字段，HTML/DOCX 放行（输出 `refText`；HTML 因被引用列项有 xmlId 而生成锚点 `id`）。

**显示**：无新增；引用文本沿用 `std-cross-ref`。

**测试**：5.2 条下 alpha 列表引用第 3 项 → `label=c)`、`refText=5.2 c)`、`xmlId=li_1`；嵌套 `a) 1)`；未被引用的列项**没有** label（断言 `labels[id]===undefined`）；引用无序列项 → `dangling-xref`；`targetKind:'listItem'` 指向非列项 → `dangling-typed-ref`；HTML 对带引用的文档生成 `id="li_1"`，对不带引用的现有 fixture 快照无差异；`gbT11Strategy.listItem` 的字母进位（`z)`→`aa)`）与罗马数字（`iv)`）。

**子任务**：G4-a（shared：策略、Resolver、映射、测试，M）；G4-b（client：refType 映射的编辑器侧核对——`hasReferenceWithin`（`client/src/utils/textBlockFormat.ts`）等“被引用节点禁止删除/转换”的守卫是否按 `nodeId` 通用识别列项（**未核实**）；粘贴重映射对 `stdListItem` 目标的覆盖；往返测试，S）。

---

### 4.5　G5　术语：领域 `subjectField` 与 `termEntry` 独立 id

**矩阵行**：M-9.2.9-01、M-9.2.1-05。**约定**：C-T-37、C-T-43、C-T-44、G-T-01、G-T-02、R-3、D-S-12/D-T-05（已定 `term_<编号>`）。

**IR 草案**

```ts
export interface IRTermEntry { /* 既有 */ subjectField?: IRInline[] }     // 条目级；不分语言（沿用 C-T-43“写入首个 langSet”）
export interface ResolvedLabel { /* 既有 */ termEntryXmlId?: string }      // 仅术语条目有：term_<编号>
```

**生产 Schema**：`termDef.content` → `termName termNameEn? termSubjectField? termDefinition (…)*`；`termSubjectField`（`inline*`）。放在固定的“头部”位置而不是尾项：`IRTermTailOrderItem`（`types.ts:346-352`）与 `termTailOrder.ts` 只描述主定义之后的尾项，`subjectField` 不进入尾序，避免扩展作者顺序元数据。该位置也与排版习惯一致（领域在定义之前）。

**映射**：`convertTermDef`（`pmToIr.ts:964-1057`）的 `switch` 新增 `case 'termSubjectField'`（非空才写 `entry.subjectField`）；`termToPm`（`irToPm.ts:226-296`）在 `termNameEn` 之后、`termDefinition` 之前输出。诊断：同一条目多个 `termSubjectField` 由 Schema 阻止；PM→IR 看到空节点则忽略（不丢信息）。键盘行为：`term-def.ts` 的 Enter/Tab 以 `findTermField(…,'termDefinition')` 查找字段，不受新节点影响（核对项）。

**Resolver**：`visitTermEntry`（`resolve.ts:321-382`）在 `termEn` 之后 `visitInlines(entry.subjectField, entry.id, ctx)`（`inTerm` 已为真，脚注自动报错）；`setLabel` 增加第 5 个可选参数 `extra`，在 `:331` 写 `{termEntryXmlId: 'term_'+numberPath}`（嵌套条目按其 `numberPath`）。`termRef` 与 `crossRef(targetKind='term')` 的 `refText` 不变。

**输出边界 / 显示**：阻断（§3.4）；显示 `termSubjectField` 前后缀 `〈` `〉` 由 CSS `::before/::after` 添加（原文 9.2.9：附加标点在渲染阶段添加，不入内容）。

**测试**：带/不带领域的术语往返；嵌套术语的 `termEntryXmlId`（`term_3.1.2`）；`sec_3.1` 与 `term_3.1` 并存且互不覆盖；`resolve.test.ts:41` 调整断言；旧术语文档 JSON 与快照不变。

**子任务**：G5-a（shared，S+）；G5-b（client 节点、CSS、测试，S）。

---

### 4.6　G6　引言中的条

**矩阵行**：M-4.3.4-02（※）、M-4.3.4-03（※）。**约定**：C-S-10、X-05、R-7、D-S-10（已倾向扩展 IR）。

**IR 草案**

```ts
front: { foreword: IRBlock[]; introduction: IRBlock[]; introductionClauses?: IRClause[] }
```

**取舍**：不把 `introduction` 的类型放宽为 `(IRBlock | IRClause)[]`（D-M-10）。理由：放宽会让所有消费 `front.introduction` 的代码（`html.ts:624-643`、`docx/body/front.ts:30-34`、`ir/footnotes.ts`、`resolve.ts:709-710`）在编译期被迫处理 `clause`，而它们本就没有这个能力；用兄弟字段，旧消费者不会静默忽略——`front` 字段表（`outputBoundary.ts:25`）不含 `introductionClauses`，HTML/DOCX/XML 一律报 `unsupported-output`。语义约定：`introduction`（块）在前，`introductionClauses`（条）在后；引言中“条之后再出现正文块”视为悬置段（GB/T 1.1 不允许），pmToIr 报 `unsupportedContent`。

**生产 Schema**：**无变化**（`introduction` 的 `block+` 已含 `clause`，`introduction.ts:10`）。

**映射与诊断**：`pmToIr` 的 `case 'introduction'`（`:1705-1711`）改为遍历子节点：`clause` → `convertClause` 追加到 `introductionClauses`；其他节点走 `convertBlock`，若此前已出现 `clause` → `unsupportedContent`（“引言中条之后的正文块无法保存”）。多个 `introduction` 容器的合并规则沿用并对条同样适用。`irToPm`（`:618`）：`introduction.length || introductionClauses?.length` 时输出容器，子节点为“块 + 条”。条的 `level` 为 1（`expectedChildLevel=1`）。

**Resolver**：`resolve()`（`:709-710`）在 `introductionClauses` 非空时用 `visitSectionChildren([...introduction, ...clauses], 'front.introduction', '引言', [0], 1, ctx)` 代替逐块 `visitBlock`——路径首元素为数字 `0`，`gbT11Strategy.clause([0,1])` 得 `0.1`，xmlId `sec_0.1`；同时获得 `hanging-paragraph`、`heading-skip` 检查。无条的引言路径**保持原代码**，快照不变。

**输出边界**：阻断（§3.4）。

**显示**：编辑器已由 `FootnoteLabels` 的 `Decoration`（`footnoteLabels.ts:57-60`，`clauseTitle` 的 owner 为 `clause`）按 Resolver 标签写 `data-resolved-label`，CSS（`standard-nodes.css:782-797`）显示 `0.1`，Resolver 修好即生效；需要改的是 `DocumentOutline.vue:183-186`（`introduction` 分支 `return false` 使引言内的条不进大纲），以及 `docDiff.ts:74-79`（已递归内容，核对）。

**测试**：引言含 2 个条（第 1 条含子条 0.1.1）的往返；标签 `0.1/0.2/0.1.1`、xmlId `sec_0.1`；条后再有正文 → unsupported；无条引言 JSON/快照不变；大纲包含 0.1、0.2；多个 `introduction` 容器含条时的诊断。

**子任务**：G6-a（shared，M）；G6-b（client 大纲、显示核对、测试，S）。

---

### 4.7　G7　罗马列项与注/示例的块内容

**矩阵行**：M-5.7-04、M-5.6-05（※）。**约定**：C-S-31、C-S-32。

#### 4.7.1 罗马列项（G7-a）

- `client/src/extensions/nodes/std-list.ts:18-32`：`StdListType` 加 `roman`；`normalizeStdListType('roman')` 返回 `roman`；`romanUpper` 仍降级为 `numeric`（46687.2 只有 `roman-lower`，`romanUpper` 无取值）。`level` 规则不变——`roman` 为一级（`fixedLevel` 仅 `numeric/dot` 为二级，视觉缩进而已，**未核实**是否应为二级，见 D-M-06 备注）。
- `shared/src/ir/pmToIr.ts:424-432`：`STD_LIST_TYPE_MAP.roman='roman'`；`:438-440` 的降级警告只留给 `romanUpper`。
- `shared/src/ir/irToPm.ts:302-309`：不再拒绝 `roman`（仍拒绝 `romanUpper`）；`typeByList`（`:322`）加 `roman`。
- `standard-nodes.css:656-709`：增加 `.std-list-roman` 的 `lower-roman` 计数器；现有“兼容嵌套 DOM”规则把 `roman` 画成十进制，需删除；`standard-nodes.test.ts:12` 的“不得出现 `lower-roman`”断言改为只禁 `upper-roman`。
- 必改的既有测试（它们都在钉住“旧罗马降级/拒绝”的契约）：`pmToIr.test.ts:286-295`（`roman` 不再降级也不再告警，`romanUpper` 仍降级并保留 1 条告警）、`irToPm.test.ts:127-135`（改为仅 `romanUpper` 被拒，`roman` 往返成功）、`std-list.test.ts:6-7`（`roman` → `roman`）、`standard-nodes.test.ts:9-13`（用例名与断言：`roman` 使用 `lower-roman` 计数器）、`authoringProjection.test.ts:327-341`（见 §3.5）。
- **这是对 WP6/WP7 既有契约的有意反转**（`wp6-model-contract.md:46` 记载“生产列表不支持的 roman/romanUpper … 拒绝”，WP7 DOCX 编号槽 A14/A15 注明“旧罗马类型降级为数字列项”）。动因是 M-5.7-04 为 shall 且 `roman-lower` 是原文明确取值；M-Z 的文档同步必须改写这些记载。遗留文档里 `listType:'roman'` 的列表此前被当作数字列项，之后按罗马列项显示——这是预期变化，须写入 PR 描述。
- 打印出口：见 D-M-06。**现状**是 DOCX 把 `roman` 映射到十进制 `A13`（`docx/numbering.ts:52-54`，且 `numbering.test.ts:187,302` 钉住“不输出罗马数字”），HTML 同（`html.ts:760`、`printCss.test.ts:9-11`）。因为 PM 现在能存罗马列项，沿用现状就等于把 `i)` 静默印成 `1)`；必须二选一：A 真排（HTML 用 `lower-roman`，DOCX 的 A14 抽象编号改 `lowerRoman` 并把 `roman` 映射到 A14，同步 3 处测试）；B 在 `outputBoundary` 对 `list.listType` 为 `roman/romanUpper` 报 `unsupported-output`（旧文档里残留的罗马列项会从“印成数字”变为“导出被阻断”）。**倾向 A**，作为可选子任务 G7-c。
- Resolver：列项标签函数（G4）已含 `roman`；与本任务无其他耦合。

#### 4.7.2 注/示例的块内容（G7-b）

**问题**：生产 `note`/`example` 是 `inline*`（`note.ts:24,103`），只能存单段；IR 的 `IRNote.content: IRBlock[]` 可多块，`irToPm` 对多块直接报错（`irToPm.ts:209-224`）。把 `note` 的内容表达式改成块会让**所有**既有文档失效（它们是“`note` 直接含文字”），需要全库迁移，并牵连 term/table 里复用 `note` 的三处（`term-def.ts:161`、`std-table.ts:402`）与大量编辑逻辑；ProseMirror 同一节点又不能既含行内又含块。因此**采用新增节点、旧节点不动**：

- 新增 `noteBlock`、`exampleBlock`（块组，`(stdParagraph | stdList)+`，带 `nodeId`），只出现在块位置（章/条/附录/前言/引言/单元格）；term、表注行、图内仍使用旧的单段 `note/example`。
- 表/图/公式出现在注中，原文没有写法（C-S-31），因此内容限定为段落与列项。
- **canonical 规则**（保证往返稳定）：`IRNote.content` 恰为一个 id 等于 `${note.id}.p0` 的段落 → 输出旧 `note`（与现状逐字节相同）；其余、且全为 `paragraph/list` → 输出 `noteBlock`；含其他块 → IRToPmError。`pmToIr` 对 `noteBlock` 保留子块各自的 `nodeId`（段落 id 来自 `stdParagraph.nodeId`）。`example` 同理。
- 位置限制：`termToPm`/`tableToPm`/`figureToPm` 直接调用 `noteContent`（不经 `blockToPm`），多块注在这三处继续报错，文案改为“该位置的注/示例只支持单段落”。
- `hasSemanticExtensions`：多块或含 `list` 的 `note/example` 视为语义扩展（§3.1）。
- Resolver 无需改动：`IRNote/IRExample` 仍是同一类型（`resolve.ts:307-315`）。
- **HTML 渲染器小修（必须）**：`renderNote/renderExample`（`html.ts:404-417`）用 `renderBlocksInline` 拼接内容，多段会被连成一行。改为：`content.length>1` 或含非段落块时逐块以块级输出，**单段输出保持字节不变**（快照零变化）。DOCX 已逐块输出（`docx/body/block.ts:167-198`），无需改动。
- 显示：`noteBlock` 用 NodeView（仿 `note.ts:44-71`）：`div.std-note.std-note-editor` + 不可编辑的 `.std-note-marker` + 块级 `contentDOM`；类名与 `data-node-id` 一致，`refreshFootnoteLabels`（`footnoteLabels.ts:12-18`）即可写入 `注：/注n：`。`exampleBlock` 的标签走 `Decoration`，把 `footnoteLabels.ts:59` 的 `node.type.name === 'example'` 扩为包含 `exampleBlock`。
- 联动：`docDiff.ts:171,177`、io `locator.ts` 的 `BLOCK_BY_PM_TYPE`（`noteBlock→note`、`exampleBlock→example`）、`textBlockFormat.ts`/`structureEditing.ts` 中仅识别 `note/example` 的转换命令——**保持不识别 `noteBlock`**（不做编辑交互），但需确认它们遇到 `noteBlock` 时返回“不支持”而不是抛错（**未核实**，列入测试）。

**测试**：多段注、含列项的注、含列项的示例各一条的往返（IR→PM→IR 相等，旧单段注输出与现状一致）；term/表/图内多块注 → 带路径的 IRToPmError；HTML 渲染多段注（新用例）与单段注快照不变；`noteBlock` 的 HTML 往返与粘贴重映射；标签 `注1：/注2：` 在作用域内连续。

**子任务**：G7-a 罗马列项（M）；G7-b 块内容注/示例（L）；G7-c（可选，依 D-M-06 选 A）HTML/DOCX 真排罗马（S）。

---

### 4.8　G8　表：`col` 列宽模型与单元格边框样式

**矩阵行**：M-6.1-03、M-6.3.3.1-01（并覆盖示例级 M-C.1-02 的导入展开）。**约定**：C-T-09、C-T-10、G-T-03、G-T-06、D-T-02。

**IR 草案**

```ts
/** 对应 table/col：width 为主（6.1，百分数）；align/valign 取 6.3.2 取值集合。col/@style 无语义无用例，不建模（导入忽略并告警）。 */
export interface IRTableColumn { width?: IRMeasure; textAlign?: string; verticalAlign?: string }
export interface IRTable { /* 既有 */ columns?: IRTableColumn[] }          // 长度必须等于表格网格列数

export interface IRCellStyle { /* 既有 */
  borderTopStyle?: string; borderRightStyle?: string; borderBottomStyle?: string; borderLeftStyle?: string
}                                                                          // 取值 solid | dashed | dotted | none（6.3.3.2，p24 示例含 none）
```

不新增“分边颜色”字段：6.3.3 只规定样式与宽度，颜色在原文没有写法（矩阵说明里提到的“分边颜色”缺乏条文依据，D-M-15）。

**语义（避免两套列宽打架）**：`columns[i].width` = 源文档给出的**名义**列宽（XML 的 `col/@width`，通常是百分数）；`cell.columnWidths`（px，`pmToIr.ts:649-653`）= 编辑器拖拽结果。两者独立保存，互不推导；显示时 px 优先于名义宽度；导出 `col` 时只取 `columns`，**不**由 px 反推。

**生产 Schema**

- `stdTable` 增 `columns`：`{default:null}`，值为 `{width:number|null, widthUnit:string|null, textAlign:string|null, verticalAlign:string|null}[]`；`parseHTML` 读 `data-columns`（JSON），`renderHTML` 写 `data-columns` 与供样式使用的自定义属性 `--ses-col-<n>`。放在外层 `stdTable` 而不是内层 `table`：内层是 prosemirror-tables 的网格节点，不宜扩展。
- 单元格（`StandardTableCell/Header`，`semantic.ts:584-593` 的 `cellMeasureAttrs` 一带）增 4 个 `stringAttribute`：`borderTopStyle`…。
- 新增极小的 ProseMirror 插件 `tableColumnsSync`（`appendTransaction`）：任何使某个 `stdTable` 的网格列数与 `columns.length` 不再相等的事务，把该表 `columns` 置为 `null`。没有它，用户对表做一次“插入列/删除列”就会让文档永久带着 `unsupportedContent`、所有导出被阻断，而本阶段又没有修复入口（D-M-11）。

**映射与诊断**

- `pmToIr.convertStdTable`（`:623-735`）读取 `columns`：数组逐项校验（宽度为有限正数且带单位，对齐值落在 6.3.2 取值内），长度与首行 `colspan` 之和比较；任一不符 → `unsupportedContent`（带 `nodeId` 与原因），不静默丢弃。`cellStyle()`（`:396-409`）的 `scalarStyle` 键表加入 4 个 `border*Style`，值不在 `solid|dashed|dotted|none` → `unsupportedContent`。
- `irToPm.tableToPm`（`:358-397`）：`columns` 输出为 `stdTable.attrs.columns`（缺省不写）；`cellStyleAttrs`（`:174-181`）本就整体展开 `style`，4 个新字段自动写入；`columns.length` 与网格列数不等 → IRToPmError。
- Resolver 无改动。

**输出边界**：`columns` 与 `style` 均不在 `table/cell` 字段表内，HTML/DOCX/XML 自动阻断（§3.4）。注意 DOCX 仍用 `cell.columnWidths`（px）——两条通路互不影响。

**显示**（含一个必须先做的 spike）

- 单元格：把已有的边框宽度属性（`semantic.ts:584-593`）与新增的样式属性转成内联 CSS（`border-left: <style> <w><unit>`…），否则导入的边框样式在编辑器里看不见——**现状连边框宽度也没有落地为样式**：client 内除分隔线外，没有任何把单元格 `border*` 属性转成 CSS 的代码（对 `borderTop|border-top` 的检索只命中属性定义、测试夹具与无关的界面样式）。
- 列宽：`columns` 为百分数且单元格无 `colwidth` 时，用 CSS 把 `<col>` 宽度设为 `var(--ses-col-n)`（`table-layout: fixed; width:100%`）；有 `colwidth` 的列由 Tiptap `TableView` 写的内联 `width` 自然优先，无需 `!important`。能否生效取决于 `@tiptap/extension-table` 的 `TableView` 如何生成 `colgroup`（**未核实**，本环境无 `node_modules`）。因此 G8-b 的第一步是 spike：验证后若不可行，退而在 `EditorTable` 里子类化 `TableView` 叠加宽度；验收以行为表述：“导入 40%/60% 的两列表，首次显示列宽约 4:6；拖动列边线后 px 生效，`columns` 保持不变”。

**测试**：`columns` 往返（2 列 40%/60%，带 `align/valign`）；列数不符、值非法的诊断；插入列后 `columns` 被清空且无诊断残留（插件）；4 边样式组合（含 `none`）往返；非法样式值 → 诊断；旧表格 JSON 不变；HTML 往返。

**子任务**：G8-a 模型 + 映射 + 同步插件 + 测试（M）；G8-b 显示（含 spike）（M）。

---

### 4.9　M-Z　收尾集成任务（所有组合入后执行）

1. **全要素 fixture**：`client/src/extensions/__fixtures__/wp8m.ts` 汇总 G1～G8 的全部结构于一篇生产 PM 文档（规范性引用章 + 正文 `std` 引用 + 缩略语表 + 带图例/图注/图示例/行内图的图 + 列项引用 + 带领域的术语 + 带条的引言 + 罗马列项 + 多块注/示例 + 带 `col`/边框样式的表 + 自定义参考文献标题），并配套 `shared` 侧的 IR 原生版本。
2. **总往返**：生产 Schema → PM → IR → PM → 保存重开（`Editor` + `replaceEditorDocument`）→ `exportSemanticJson`，两轮后 JSON 相等；Resolver 无 error；`getOutputSupportProblems` 对 HTML/DOCX/XML/XML46687 的结果与 §3.4 表逐项一致。
3. **覆盖断言**：`wp8mMatrixCoverage.test.ts`（§3.6）——32 个矩阵 id 全部被用例引用，`M-7.4-13` 若获批改为 not-applicable 则从清单中移除。
4. **golden**：两个 JSON 字节 golden 与 manifest 中 `fixtures.ts` 的 SHA 不变；`git diff --stat` 对所有 `__snapshots__` 为空（G4 的“被引用列项多 id”只在新用例里出现）。
5. **真实保存重开**：对一次性 API/SQLite 实例执行 opt-in 验收（仿 WP6，使用 `wp8m.ts`），含冷重开；若环境不具备，在 PR 描述中明确写“未执行”。
6. **目视走查**（`run` 技能或 dev server，逐项截图）：规范性引用章、`std` 标记、缩略语表、图例与图注、行内图、术语领域〈〉、引言 `0.1/0.2` 与大纲、`i)` 罗马列项、多段注、列宽 4:6 与边框样式；每项写“正常/异常”。
7. **文档同步**：`docs/wp6-model-contract.md` 增补 WP8.M 一节（§3.1 字段清单与 §3.3 节点总表）；`docs/wp9-authoring-reference.md` 中关于罗马、嵌套列项、图中注的说明（若存在）与 `authoring.ts` 提示文案一致；§6.3 列出的 WP8.1 工件同步由主导人另派。
8. **规模**：M。

---

## 5. 依赖关系与建议执行顺序

### 5.1 依赖

| 关系 | 说明 |
|---|---|
| G3 ← G2（软依赖） | 共用 `IRDefItem` 与 `whereItem` 节点；谁先合入谁定义别名。G3 的图注/行内图/示例不依赖 G2，可先做。 |
| G4 ← 无 | 纯 Resolver + 映射表；可与任何组并行。`roman` 标签函数不依赖 G7-a 的 PM 支持。 |
| G7-a ← 无；G7-c ← G7-a 与 D-M-06 | 可选子任务。 |
| G1、G5、G6、G8 | 彼此独立。 |
| 全部 → 收尾集成任务 M-Z | 汇总 fixture、边界矩阵、覆盖断言、真实保存重开验收、文档同步。 |

### 5.2 合并冲突热点（任务书必须写明“后合入者 rebase”）

`shared/src/ir/types.ts`（G1 G2 G3 G5 G6 G8 都加成员）、`pmToIr.ts`、`irToPm.ts`、`resolve.ts`、`extensions.ts`、`client/src/extensions/editorExtensions.ts`、`nodes/index.ts`、`ensureNodeId.ts`（`NODE_ID_TYPES` 与两张重映射表）、`standard-nodes.css`。各组对这些文件的改动都是“增加条目”，冲突可机械解决，但需要在合入前运行 §3.6 的 golden 回归。

### 5.3 建议波次

| 波次 | 并行任务 | 说明 |
|---|---|---|
| 0 | 评审本设计；决定 D-M-01～D-M-07 | 其中 D-M-01（fn 位置）与 D-M-06（罗马打印）影响后续任务书 |
| 1 | G5-a/b、G6-a/b、G8-a、G4-a/b、G7-a | 改动面最小、互不相交；G8-a 的同步插件先行以便 G8-b 开 spike |
| 2 | G2-a/b、G1-a/b/c、G7-b、G8-b | G2 先于 G3；G7-b 触及 `irToPm.blockToPm` 的 `note` 分支，与 G3 在 `figureToPm` 附近有文本相邻，宜错开合入 |
| 3 | G3-a/b/c、（G7-c） | 依赖 G2 的别名 |
| 4 | M-Z 收尾集成 | 全部合入后执行 |

关键路径：G2 → G3 → M-Z，约 7～9 个工作日（§8）。

---

## 6. 对 WP8.2 / WP8.3 的接口约定

### 6.1 逐组消费表

“导出”= WP8.2 渲染器如何消费；“导入”= WP8.3 导入器应产出什么（IR 形状）；均以矩阵行与约定编号为锚。

| 组 | 矩阵行 | 导出（IR → XML） | 导入（XML → IR） |
|---|---|---|---|
| G1 | M-4.4.2.3-02/-03/-04、M-4.4.2.3.2-01、M-E-06（C-S-24、C-T-54、X-10） | `IRNormRefList` → 规范性引用章内 `ref-list[@content-type="norm-refs"]`；条目 `ref[@id=labels[id].xmlId]`（`ref_<n>`，仅 X-10 约定；是否必写 id 随 D-M-02）；`entryType='std'` → `<std><std-ref>{ref}</std-ref><title>{title}</title></std>`（不写 std-ref 与 title 之间的逗号文本，C-T-54）；`'mixed'` → `<mixed-citation>{content}</mixed-citation>`。`ref` 或 `title` 为空 → 导出问题（std 必含两者）。未结构化的“规范性引用文件”章仍按 `p` 输出并给 warning（C-S-24）。 | `ref-list[@content-type=norm-refs|norm_refs]` → `IRNormRefList`；`ref/std` → `std`（取 `std-ref` 与 `title` 的行内内容，忽略夹在中间的文本）；`ref/mixed-citation` → `mixed`；`ref` 既无 `std` 也无 `mixed-citation` → 错误；`label`、`xlink:type`、`mixed-citation/@id` 忽略。位置不在 `norm-refs` 章 → 错误。 |
| G1 | M-10.2-01/-02、M-10.1.7-01（C-T-54） | `stdRef` mark → `<std><std-ref>{run 文本}</std-ref></std>`；`mixedCitation` → `<mixed-citation>{run 文本}</mixed-citation>`；`tbx:source` 内不加 `std`（9.2.8）。 | 正文 `std` → 对其 `std-ref` 文本加 `stdRef`；`std` 内若还有 `title` → 整个 `std` 内容作为一个 `stdRef` run 并告警“title 已并入标准编号文本”（C-T-54：正文示例只有 `std-ref`）；`mixed-citation` → `mixedCitation`。 |
| G1 | M-4.5.3-02（C-S-27） | `bibliographyTitle ?? 参考文献` → `ref-list[@content-type="bibl"]/title`。 | `ref-list[bibl]/title` 与默认值不同 → 写 `bibliographyTitle`。 |
| G2 | M-10.1.4-01/-03/-04/-05（C-T-51、X-26） | `IRDefList` → `sec` 内 `def-list[@list-content="abbreviation"]`；项 → `def-item` > `term` + `def>p`；`def-item/@id` 取 `labels[id].xmlId`（`abb_<k>`），**仅当被 crossRef 引用时写**。 | `def-list`（含无 `list-content` 者，在 `sec` 内）→ `IRDefList`；`def` 内多个 `p` → 拼接并告警（M-7.3-08 同类）；`def-item/@id` 仅用于解析引用。 |
| G2 | M-10.1.1-04、M-10.1.4-02（C-T-48、C-T-51） | `crossRef(targetKind='abbreviation')` → `xref[@ref-type="abbreviation" @rid=xmlId]`，内容 = `refText`。 | `xref[abbreviation]`，以及 `xref[other]` 指向缩略语项（按目标归类并告警）→ `crossRef(targetKind='abbreviation')`。 |
| G3 | M-8.5-01～06（C-T-31） | `IRFigure.legend` → `fig/legend` > （`title`，若有）+ `def-list[@list-content="figure"]` > `def-item` > `term`、`def>p`；均不写 id（C-T-31）。 | `legend` > `title` → `legend.title`；`def-list[figure]` → `items`；`legend` 内其他结构 → 告警；`fig-group` 级 legend 不接收（D-M-12）。 |
| G3 | M-8.3-02（C-T-27、C-T-29） | `IRInline.image` → `<inline-graphic xlink:href=… [specific-use="size:S|M|L"]/>`；`xlink:href` 命名见 D-M-08（C-T-27 只规定了块级 `graphic` 取所属 fig 的 id，行内图没有 fig）；资源清单必须显式对应。 | `inline-graphic` → `image`（资源按基名匹配清单，缺失即阻止导入）；`size:T` 用在行内图 → 告警并忽略；只允许出现在 `p`（含列项/注/单元格内的 `p`）。 |
| G3 | M-8.2-11、M-8.4-03（C-T-32、X-14/15） | `notes` → `fig/non-normative-note`（`label` + `p`）；`examples` → `fig/non-normative-example`；被引用时才写 `id`（D-S-09）。 | 同一 `fig` 内交错的注/示例 → 规范化为“注在前、示例在后”并告警（D-M-09）；注内多个 `p` → 拼接并告警。 |
| G4 | M-10.1.5-01/-02（C-T-52、X-17、R-9） | `crossRef(targetKind='listItem')` → `xref[@ref-type="list" @rid=xmlId]`，内容 = `refText`；被引用的 `list-item` 写 `@id=labels[id].xmlId`（`li_<k>`）。 | `xref[list]` 的 `rid` 必须解析到某个 `list-item/@id`，否则错误；导入后该列项的 `id` 重映射为稳定内部 id；其余列项 `id`（示例里的 `lis-…`）忽略（C-S-32）。 |
| G5 | M-9.2.9-01（C-T-43、C-T-44） | `subjectField` → 首个 `tbx:langSet` 内的 `tbx:subjectField`（纯文本，不含 `〈〉`）。 | 任一 `langSet` 内的 `subjectField` 并入条目级字段；多个 → 拼接并告警。 |
| G5 | M-9.2.1-05（C-T-37、C-T-45、R-3） | `tbx:termEntry/@id = labels[id].termEntryXmlId`；`termRef` → `tbx:entailedTerm/@target`、`crossRef(targetKind='term')` → `xref[@ref-type="custom" @custom-type="term-entry" @rid]` 均取该值（C-T-45）。 | `termEntry/@id` 不透明；被 `entailedTerm`/`xref` 引用时必须存在。 |
| G6 | M-4.3.4-02/-03（C-S-10、X-05、R-7） | `introductionClauses` 非空 → `sec[@sec-type="intro"]` 的 `id="sec_0"`，其内 `sec id="sec_0.n"`（`label`=`0.n`、`title`）；否则 `id="sec_intro"`。 | 接受两种形态；`sec_intro` + `sec_0.1` 并存的示例形态（C-S-10 示例 2）也接受；条之后的块级正文 → 错误（悬置段）。 |
| G7 | M-5.7-04（C-S-32） | `listType='roman'` → `list[@list-type="roman-lower"]`，项 `label` = Resolver 的 `i)`。 | `roman-lower` → `roman`；`roman-upper`（原文无）→ 拒绝。 |
| G7 | M-5.6-05（C-S-31） | 多块 `IRNote/IRExample` → `non-normative-note/-example` > `label` + （`p` \| `list`）*。 | 块级位置（条/章/附录/前言/引言）的注含多个 `p`/`list` → `IRNote` 多块；term/表/图内的注含多块 → 拼接并告警（这三处只存单段）。 |
| G8 | M-6.1-03、M-C.1-02（C-T-10、D-T-02） | `columns` → `table` 内 `thead` 之前的 `col[@width=N%][@align][@valign]`；非百分数单位 → 告警并省略 `width`。 | `col` 与 `colgroup/col` → `columns`（`colgroup` 展开）；`col/@style` 忽略并告警；数量与网格列数不符 → 错误。 |
| G8 | M-6.3.3.1-01（C-T-09） | 单元格 `style` 的 `border*`（宽度 px 1～5）与 `border*Style` → `style="border-left: solid 1px; border-top: …"`，顺序左、上、右、下，仅输出与表级不同者；非 px 宽度 → 告警。 | 解析 `style`（冒号/等号两种分隔，C-T-09）；样式值落在 `solid|dashed|dotted|none`，其他 → 告警并忽略。 |

### 6.2 WP8.2 必须执行的 `outputBoundary` 白名单增量（8.M 不得提前打开）

仅限 `XML46687`：`doc.bibliographyTitle`；`front.introductionClauses`；块 kind `normRefList`/`normRef`/`defList`；`figure.legend`/`figure.examples`；行内 `image`；mark `stdRef`/`mixedCitation`；`termEntry.subjectField`；`table.columns`；`cell.style`（含 `border*Style`）；`legend` 内的 `IRDefItem`。HTML/DOCX/旧 XML 的白名单不变（D-M-07、D-M-06 的决定另行落实）。

### 6.3 与 WP8.1 工件的同步（不在 8.M 实现任务内，由主导人另派）

`matrix-T.json` 的 `M-7.4-13` 状态；`schemas/gbt46687.2/README.md` 的 `PENDING-block-fn` 与 `body.rng` 注释（D-M-01 定案后）；`docs/wp8.1/README.md` §2 术语行计数；`wp6-model-contract.md` 增补 WP8.M 一节（§3.1 的字段清单）。

---

## 7. 待决事项（需用户/主导人决定）

每项给出选项与倾向；“影响”指不同选择对任务书的改动量。

| 编号 | 事项 | 选项 | 倾向 | 影响 |
|---|---|---|---|---|
| **D-M-01** | **D-T-10：正文脚注 `fn` 的定义位置，本阶段是否解决** | A．行内 `fn` 紧随其 `xref`（同一 `p` 内）——STS 1.2 允许（`schemas/gbt46687.2/README.md` §7 记录的 DTD 兼容检查与 `samples/valid/06-terms-references.xml`），ISO 现行做法也是“at the point of use”（`rules/guidelines_for_coding_iec_and_iso_standards_in_nisosts_ed.2.1…md:3631` 起，旁证；`fn-group` 属其“Legacy tagging”）；B．块级 `fn` 紧随所在段落——需登记为国标扩展（schema 现标 `PENDING-block-fn`）；C．`back/fn-group/fn`——46687.2 全文无此用法，schema 不收。 | **A；并在本设计评审时决定（零代码）** | 模型零改动：`IRInline.footnote` 本就是“引用 + 内容”一对一原位脚注，A 方案导出为 `xref[fn]` + 紧随的 `fn`，导入按 `rid` 配对即可。不决定则 WP8.2 的“正文脚注”仍按 C-T-55 报“未决定结构”，且 WP8.1 的 schema README 保持“待 WP8.M 决定”。落实动作（更新 schema/README/矩阵备注）属 WP8.1 工件同步，见 §6.3。 |
| D-M-02 | xmlId 补缺：列项 `li_<k>`、缩略语项 `abb_<k>`、规范性引用条目 `ref_<n>`（X-10 含义未核实） | 本设计的序号式；或语义式（`abb-<缩写小写>`，示例写法，不唯一也不稳定） | 序号式 | 仅改 Resolver 一处常量与测试期望；原文附录 E 自己说明不宜基于语义 ID |
| D-M-03 | 列项标签括号与 `refText` 形式 | 标签：半角 `a)`（与条文示例、Resolver 脚注 `1)` 一致）／全角 `a）`（与编辑器/DOCX 现有显示一致）。`refText`：容器编号 + 标记（`5.2 a)`）／仅标记（`a)`） | 半角；`5.2 a)` | 仅影响 `gbT11Strategy.listItem` 与测试期望；不影响编辑器/DOCX 的列项符号 |
| D-M-04 | `extensionVersion` | 保持 1／新字段出现时升为 2 | 保持 1 | 升 2 需改 `types.ts:17`、`pmToIr.ts:1672-1676`、`irToPm.ts:666`、`io/documentOps/apply.ts:758`；好处是旧版软件遇到新文档会给出“无法解释扩展版本”而不是 Schema 校验失败 |
| D-M-05 | 注/示例块内容（M-5.6-05，should）的实现方案 | 新节点 `noteBlock/exampleBlock`（本设计）／改 `note` 内容并全库迁移／本阶段不做（保留 should 缺口） | 新节点 | 本设计 G7-b 为 L 级；若选“不做”，整组缩为 G7-a，WP8.3 遇多块注须在导入报告中阻止导入 |
| D-M-06 | 罗马列项的 HTML/DOCX 出口 | A．真排（HTML `lower-roman`，DOCX A14 改 `lowerRoman`，改 3 处钉死“无罗马”的测试）；B．`outputBoundary` 阻断 | A | A 为 G7-c（S）；B 只需在边界加一条规则，但会让残留旧罗马列项的文档从“印成数字”变为“不能导出” |
| D-M-07 | `stdRef`/`mixedCitation` 在 HTML/DOCX 的处理 | 默认阻断（本设计，与 WP6 一致）／放行（打印上无视觉差异，HTML 输出带 `data-type` 的 `span`，DOCX 输出普通文本） | 放行，但在 WP8.2 开工前再确认 | 选“阻断”时，凡含正文标准引用的导入稿都无法导出 DOCX/PDF；选“放行”是把两个 mark 类型加入 `MARKS`（`outputBoundary.ts:50`）并各加一条渲染用例 |
| D-M-08 | 行内图 `xlink:href` 命名（C-T-27 未覆盖行内图） | `inl_<k>`（行内图在文档中的序号）／沿用所在段落 id | `inl_<k>`，由资源清单映射物理文件 | WP8.2 的资源准备一处 |
| D-M-09 | 图中注/示例：PM 固定“注在前、示例在后”；图内注仅单段 | 本设计／允许交错并新增顺序元数据／图内注允许多块 | 本设计 | 交错顺序在导入时被规范化并告警；改动更大的方案需要像 `tailOrder` 那样的元数据 |
| D-M-10 | 引言中的条的 IR 形态 | 兄弟字段 `introductionClauses`（本设计）／放宽 `introduction` 的元素类型 | 兄弟字段 | 放宽类型会迫使所有消费者在编译期处理条，但它们没有该能力 |
| D-M-11 | `stdTable.columns` 与列数变化 | 同步插件在列数变化时清空 `columns`（本设计）／保留并报诊断／在插件里按列映射增删 | 清空 | 属于编辑行为的最小改动；如认为越界，则 G8 退化为“导入时若与列数不符即阻断”，用户无修复途径 |
| D-M-12 | `may` 级缺口是否纳入后续：同 `fig` 多 `graphic`、`fig-group`（D-T-11）、嵌套列项（M-5.7-11）、`tfoot`/`frame` 等 | 全部留作后续／其中“嵌套 list 在 WP8.3 导入时压平成紧随的二级同类列表”（编辑器模型本就如此，`authoring.ts:735-737`）单独评估 | 全部留后续；嵌套列项待 WP8.3 拿到真实样稿再定 | 真实标准里嵌套列项并不少见，WP8.3 需要有明确口径 |
| D-M-13 | M-7.4-13 改 not-applicable（§2.2） | 同意／仍要求实现 | 同意 | 同意则不实现；矩阵与 README 需同步 |
| D-M-14 | 术语领域在 HTML/DOCX 的渲染（定义前输出“〈领域〉”） | 本阶段阻断／随后续排版任务实现 | 后续 | 当前含 `subjectField` 的稿件不能导出 DOCX/HTML |
| D-M-15 | 矩阵中的“分边颜色”（M-6.3.3.1-01 备注、G-T-06）无条文依据 | 不建模（本设计）／加 `border*Color` | 不建模 | 需要时只增 4 个可选字段 |

规格矛盾/需用户确认的点汇总：D-M-01（原文无规定）、D-M-02（WP8.1 内部循环委托）、D-M-13（矩阵状态）、D-M-15（矩阵说明与条文不符）。

---

### 7.1 决定（2026-10-22）

**用户决定**：DOCX/PDF（经 HTML）中，**文字型结构本阶段排版**；版式较复杂的结构暂报 `unsupported-output`，另立排版任务。

| 本阶段排版（HTML 与 DOCX 都放行并渲染） | 暂报 unsupported-output |
|---|---|
| 规范性引用清单 `normRefList`（按 GB/T 1.1 10.3.4 排版）；正文 `stdRef`/`mixedCitation` 两种 mark（按普通文本输出）；自定义参考文献标题 `bibliographyTitle`；缩略语表 `defList`（按 GB/T 1.1 缩略语排版：缩略语与释义同行，释义前空一字）；术语领域 `subjectField`（定义前输出“〈领域〉”，GB/T 1.1 术语条目要求）；罗马列项（`i)`、`ii)`…）；多块注/示例；引言中的条（`0.1` 等，按条标题排版） | 图例 `legend`、图中示例 `examples`、行内图 `image`、表 `columns` 列宽、单元格边框样式 `border*Style` |

`figure.notes` 照原设计放行（渲染器早已支持）。

**主导人决定**（D-M 各项）：

| 编号 | 决定 |
|---|---|
| D-M-01 | 采用 A：正文 `fn` 为行内元素，紧随其 `xref` 放在同一 `p` 内。schema、README 与矩阵备注的同步作为收尾任务 M-Z 的一部分 |
| D-M-02 | 序号式：`li_<k>`、`abb_<k>`、`ref_<n>` |
| D-M-03 | 列项标签用半角括号，如 `a)`；引用文本写作 `5.2 a)` |
| D-M-04 | `extensionVersion` 保持 1 |
| D-M-05 | 新增节点 `noteBlock`、`exampleBlock` |
| D-M-06 | 采用 A，真排：HTML `lower-roman`，DOCX `lowerRoman`。G7-c 由“可选”改为“必做” |
| D-M-07 | 放行，按上表处理 |
| D-M-08 | `inl_<k>` |
| D-M-09 | 按原设计 |
| D-M-10 | 用兄弟字段 `introductionClauses` |
| D-M-11 | 列数变化时清空 `columns` |
| D-M-12 | 全部留作后续；嵌套列项的处理在 WP8.3 拿到真实样稿后再定 |
| D-M-13 | 同意。矩阵与 README 的同步放进 M-Z |
| D-M-14 | 本阶段排版，按上表处理 |
| D-M-15 | 不建模 |

**对任务的影响**：每个“本阶段排版”的组，都须在本组任务内同时完成 HTML（含打印 CSS）与 DOCX 的渲染和测试，并在 `outputBoundary.ts` 中对 HTML/DOCX 放行。允许修改既有快照，但须逐项说明理由。XML46687 的白名单仍留给 WP8.2。

## 8. 工作量估算

规模：S ≈ 0.5 天，M ≈ 1 天，L ≈ 1.5～2 天（README §6 的约定，含实现与审查各一次）。

| 组 | 子任务 | 数量 | 合计 |
|---|---|---|---|
| G1 | G1-a M，G1-b L，G1-c S | 3 | 约 3.5 天 |
| G2 | G2-a M，G2-b M | 2 | 约 2 天 |
| G3 | G3-a L，G3-b M，G3-c S | 3 | 约 3.5 天 |
| G4 | G4-a M，G4-b S | 2 | 约 1.5 天 |
| G5 | G5-a S+，G5-b S | 2 | 约 1.5 天 |
| G6 | G6-a M，G6-b S | 2 | 约 1.5 天 |
| G7 | G7-a M，G7-b L，（G7-c S，可选） | 2（+1） | 约 2.5 天（+0.5） |
| G8 | G8-a M，G8-b M（含 spike） | 2 | 约 2 天 |
| 收尾 M-Z | 汇总 fixture、边界矩阵、覆盖断言、真实保存重开验收、目视走查、文档同步 | 1 | 约 1 天 |
| **合计** | | **18 个子任务 + 1 个收尾（另有 1 个可选）** | **约 18～20 人天（串行）** |

注：与 README §6 的“补模型 6～8 个任务”相符——那是组数（本设计 8 组）；上表是把每组再拆成可独立审查的子任务。按 §5.3 的波次并行后，关键路径（G2 → G3 → M-Z）约 6.5 天，计 rebase 与审查约 7～9 个工作日。

---

## 附录 A　未核实清单

1. 本环境无 `node_modules`，所有关于 Tiptap/ProseMirror 运行期行为的判断均来自阅读源码，未运行：`TableView` 对 `<colgroup>` 的生成（G8 显示）、`block` 组默认填充节点的顺序效应（P3）、textblock 子节点用 `display:inline` 渲染时的光标行为（G1 显示）。
2. `noteBlock` 之外的 ProseMirror 方案（`inline* | block+` 混合内容表达式）是否被 Schema 拒绝：未验证，设计不依赖它。
3. 旧 XML 序列化器是否输出 `figure.notes`：未核实（随 WP8.4 删除，不影响本阶段）。
4. `hasReferenceWithin`、`textBlockFormat.ts`、`structureEditing.ts` 对 `listItem` 目标与 `noteBlock` 的行为：未核实（G4-b、G7-b 测试覆盖）。
5. DOCX 其他测试是否还钉住“罗马列项=十进制”（`numbering.test.ts:187,302` 之外）：未穷举（G7-c 开工时全仓 `roman` 检索，本次检索结果见 §4.7.1 所列）。
6. `ref_<n>` 的“无正文”解读（X-10）：沿用 WP8.1 的“未核实”。
7. D-M-01 方案 A 中“`fn` 内含 `p`、`fn` 位于 `p` 内”被 STS 1.2 DTD 接受：依据 `schemas/gbt46687.2/README.md` 记录的兼容检查结论，本设计未重新运行 `scripts/xml46687/sts_compat.py`。
