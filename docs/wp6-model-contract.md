# WP6 IR / ProseMirror model contract

状态：WP6 实现与项目契约验收通过（2026-10-05），见 [验收记录](wp6-validation.md)。目标为 `codex/xml-46687-plan` 的 WP6 与 `docs/wp8-xml46687.md` §3.1；不是 GB/T 46687.2 元素合规性声明。外部 XML ID 的最终词法和正式 ID 约定留 WP8.1 核实。

## 保持的旧接口

`IRDoc.schemaVersion`、现有 `IRDocMeta` 字段及类型、章条/附录、段落/列表/表格/图/公式/注/示例/术语/参考文献字段和脚注语义保持。数据库 `DocumentMeta` 的现有设置完整进入 `IRDoc.meta`：`titleCn→title`、`standardNo→stdCode`、`titleEn`、`icsCode`、`ccsCode`、`publishDate`、`implementDate`、`standardType`、`issuer`、`applicant`、`replaces`、`consistency`、`filingNo`、`industryName`、`regionName`、`coverDesignation`，并补 `proposer`、`technicalCommittee`。`stage` 是文档实体状态，不属于正文 IR。

`IRDoc.extensionVersion?: 1` 标记 WP6 语义扩展。旧基础字段仍由既有 DOCX/HTML 消费；新字段必须由消费边界使用或带位置与原因阻断，不能静默忽略。

## IR 字段

| 领域 | IR 字段与形状 | PM 来源 |
|---|---|---|
| 元数据 | `meta.titleParts[] {id,lang?,role?,content}`；`identifiers[] {id,scheme?,value?,parts[]}`，part `{id,kind,position?,content}`；`languages[] {id,tag,usage?}`；`publishers[] {id,name,role?,identifier?}`；`adoptions[] {id,reference,degree?,language?}`；`replacedStandards[] {id,reference,relation?}`；`copyrights[] {id,holder?,year?,language?,statement}` | 顶层 `metadataBlock` 下 `titlePart`、`standardIdentifier/identifierPart`、`language`、`publisher`、`adoption`、`replacedStandard`、`copyright`。`metadataBlock` 优先于根/封面 typed attrs；结构化值不覆盖兼容旧字段。编号组成保持为部件；没有完整 `value` 时不猜组合。 |
| 术语/TBX | `IRTermEntry.languageSets[] {id,language,groups[]}`；group `{id,terms[]}`；variant `{id,content,descriptors[]}`；descriptor `{id,kind,value}`。旧 term fields 保持；定义段各自有稳定 ID，首段写入 `termDefinition.nodeId`，后续段写入 `stdParagraph.nodeId`；来源使用独立无实体 ID 的 `termSource` carrier，旧带来源前缀的段落继续作为输入兼容。`nestedEntries[]` 保持旧 PM 允许的嵌套关系。 | `termDef > tbxLangSet(lang) > tbxTig > tbxTermVariant > tbxTerm + tbxTermDescriptor(type)`。旧 `termName/termNameEn` 只写入旧 `term/termEn` 字段；不得推断语言或伪造描述符。 |
| 公式 | `IRFormula.mathml?` 保存原文；`notes[] {id,content}`；`IRInline.formula {id,mathml?,latex?,source?}`；现有 `latex/sourceInlines/whereList` 保持 | 行间 `formula` attrs `mathml/latex`；`formulaInline` atom；`formulaNote`；`whereItem(id) > whereTerm/whereDefinition`。没有 LaTeX 时保留空编辑源，不从 MathML 反译。 |
| 表格 | `IRTable.width?: IRMeasure`、`unit?:string`、`style?:IRTableStyle`；行 `.style?:IRRowStyle`；单元格 `cellType?/width?/unit?/columnWidths?/style?`。度量统一 `{value:number,unit:string}`，现有 `colwidth` 向量单位固定为 CSS px，样式键显式列举 | `stdTable` 宽度/单位及 style attrs；row/cell 的对应 attrs；既有跨度、表头、注、脚注和内容保持。 |
| 图与资源 | `IRDoc.resources[] {id,mediaType?,name?,encoding,data}`；`IRFigure.resourceId?/imageWidth?/imageHeight?/alt?/title?/unit?/descriptions[]`、`groups[] {id,descriptions[],resourceRefs[]}`；描述 `{id,content}` | `figureImage(resourceId/src/width/height/alt)`、`figure`/`figureGroup > figureDescription/figureResourceRef`、文档级 `figureResource`。resource 引用按内部 ID 校验。 |
| 文本与引用 | `IRInline.style? {fontFamily,fontSize,color,backgroundColor,letterSpacing,baseline,textTransform}`；typed `variable/externalLink/bibRef/termRef` marks；`crossRef.targetKind?`；`IRBlock` 有 `warning/quote/code` kind | StarterKit/custom style marks、`variable`、`externalLink`、`bibRef`、`termRef`；`warning`、`quoteBlock`、`codeBlock`。完整 href/title/target/rel 保留。 |
| 文献 | `IRBibEntry` 保留 `{id,content}`，补 `entryType?`、`fields[] {id,name,value}`、`identifiers[] {id,scheme,value}`、`externalLink?` | `bibEntry` + typed `bibStructured/bibField/bibIdentifier/bibExternalLink`。普通显示文字仍在旧 `content`。 |
| 索引 | `IRDoc.index {id,title?,groups[]}`；group `{id,label?,entries[]}`；entry `{id,term,targets:NodeId[],seeAlso:NodeId[]}` | `indexBlock/indexGroup/indexEntry/indexTerm/indexTarget/indexSeeAlso`。目标和参见统一用稳定内部 ID。 |

## ID 与错误边界

IR 中属于实体的数据节点用自己的稳定 `id`；纯 inline leaf 和纯 attrs-backed 展示标签不另造 ID。旧表格 row/cell 缺 ID 时继续使用现有确定性派生 ID；新生产 row/cell 带 `nodeId` 时必须保留。

`resolve()` 为新增实体登记 ID，为可引用目标生成 `ResolvedLabel`，校验内部 crossRef、文献/术语引用、索引目标、图资源引用和重复/缺失 ID。Resolver 的 `xmlId` 是 WP6 项目约定；正式标准约定由 WP8.1 对照原文确认。

`externalIdToNodeId(externalId, namespace?)` 是纯函数；外部 ID 到内部 ID 的重映射同时覆盖定义 ID、crossRef/typedRef、索引目标和资源引用。引用目标未完整映射时返回诊断，不能只改定义端。

未知或无法表示的生产 PM 内容写入 `IRDoc.unsupportedContent`（源 nodeId、路径、类型、原因），由 Resolver 以 error 报告。结构化数据不使用全量 PM 快照或不透明 attrs 透传。

## 实际加载与展示

Tiptap `setContent` 仅替换子内容。生产加载、版本回滚与 XML 导入使用 `replaceEditorDocument`，在单事务中替换内容并设置所有已声明根属性；加载旧文档同时清空前一文档的根级回退数据。根属性默认仍为 `null`，不对所有旧文档强加扩展版本。

编辑器编号通过 ProseMirror Decoration 投影，章条大纲、版本文本比对和 JSON 编号共用 Resolver；显示标签不写入 PM JSON。CSS 计数器仅为脱离编辑器插件的旧 DOM 保留。新增结构化属性的逐字段差异展示不在当前版本文本比对契约内。

## PR #45 审查补充（2026-10-06）

- `chapter.secType` 显式持久化；旧文档属性缺省或 null 时继续按中文标题推断，不覆写显式文档角色。
- `formula.numbered` 声明为生产属性；显式 false 保留，属性缺省或 null 时延续旧编号规则及 JSON golden。
- `stdTable.headerRowCount` 独立持久化，不由单元格 header 标志覆盖；旧表格缺省或 null 时按连续表头单元格推断。非法显式角色或表头计数返回 unsupportedContent 诊断。
- 脚注交叉引用与普通行内引用使用一致目标优先级：`targetId ?? refId`；空目标仍拒绝。
- 原生 IR 标准列项中的唯一段落 ID 必须等于 `${item.id}.p0`，否则 IR→PM 拒绝转换。生产列表不支持的 roman/romanUpper、与固定级别冲突的显式 level 同样通过带路径与 nodeId 的 IRToPmError 拒绝；不静默降级或改写稳定 ID。生产标准列表 numeric/dot 固定二级，其余固定一级；此项检查也覆盖嵌套 StarterList 分支。

## 复审补充（2026-10-06）

- `note/example` 及术语注、术语示例、表注只承载一段行内内容；IR 唯一段落 ID 必须等于 `${owner.id}.p0`，否则通过 IRToPmError 返回源段落 nodeId 与路径，避免引用失效。warning/quote 的块段落 ID 仍原样保留。
- 生产 `textStyle` 的七个属性从对应的 inline CSS 回读，渲染与解析使用同一属性映射；CSS 字符串遵循浏览器的规范化，不要求保留相同的颜色字面量拼写。
- 生产表格 td/th 的单位从 `data-unit` 回读，兼容直接 `unit` 属性；带编辑器包装的单元格只解析内容槽，不将展示用单位标签写进正文。普通外部 HTML 单元格仍解析全部内容。

## bd0c6eb3 复审契约补充（2026-10-06）

- `tableFootnoteRef` 是行内 atom，不是生产 mark；一个 IR run 同时带正文/公式与表脚注引用时，投影为正文/公式节点及独立引用 atom，普通 marks 与各引用 ID 保持。回读允许拆为语义等价的多个 IR run。
- `proposer`、`technicalCommittee` 虽完整保存在作者模型中，当前旧 HTML/DOCX/XML 出口没有消费这两个元数据字段。因此字段非空时明确阻断这些出口，缺省或空字符串不额外阻断；JSON 可完整保留。前言中出现同名文字不等于元数据字段已被出口消费。
- 空 warning/quote 及其他不满足生产 Schema 最小子项约束的原生 IR 必须返回带 path/nodeId 的 IRToPmError。不得通过创建占位文字或改写稳定 ID 掩盖无法表示的数据。
