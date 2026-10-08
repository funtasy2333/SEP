# WP6 IR / ProseMirror model contract

状态：WP6 内部模型与项目契约回归已实施，最新复审修复和输出限制见 [方案审计](wp6-plan-audit.md)及 [验收记录](wp6-validation.md)。目标为 `codex/xml-46687-plan` 的 WP6 与 `docs/wp8-xml46687.md` §3.1；不是 GB/T 46687.2 元素合规性声明。外部 XML ID 的最终词法和正式 ID 约定留 WP8.1 核实。

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
- 历史 `2fc726e7` 将非空 `proposer/technicalCommittee` 阻断于所有出口；本轮已纠正 DOCX/HTML 的既有设置回归：DOCX native custom-properties 与 HTML meta 实际保留字段后解除对应阻断。旧 XML 继续拒绝，JSON 保留原值。前言原文不自动重写。
- 空 warning/quote 及其他不满足生产 Schema 最小子项约束的原生 IR 必须返回带 path/nodeId 的 IRToPmError。不得通过创建占位文字或改写稳定 ID 掩盖无法表示的数据。

## 2fc726e7 复审补充（2026-10-06）

- figureResource.data 通过 JSON 字符串编码的 data-resource-payload 属性进行 HTML 序列化/解析，base64、文本、data URL、空值及资源关联均以生产 DOM 路径验证；资源负载不进入可见正文。
- 扩展行内引用在所属元数据/公式/图/术语等实际遍历位置收集，避免后续普通段落抢占首次引用顺序。
- 提出/归口单位的输出能力与限制以 [最新方案审计](wp6-plan-audit.md)为准；不能沿用上一轮“所有出口阻断”的结论。


## a3adb2af 复审契约补充（2026-10-06）

- HTML 解析只把编辑内容槽写回作者数据，题名/机构/版权/编号部件/TBX描述符/文献字段的展示标签不属于字段正文；结构化容器的语言/编号/索引标题也不属于子项。
- 带明确类型的段落、引用和链接 atom 优先匹配其专用规则，保留 Schema 类型与引用字段；无类型的普通 HTML 继续使用通用规则。文本属性不使用 Tiptap 自动数字/布尔转型；position/度量等数值属性保持数值契约。
- 旧生产 PM formulaDescription 解析为 whereList 时保留完整行内样式、marks、MathML/LaTeX公式及脚注引用负载。解析纯文本分隔符与首尾空白的既有规则保持；投影为新 whereList 后生产 Schema 回读保真。此处“旧”指现有 PM 节点，不是新增旧 XML 兼容转换器。


## 296a3fb3 复审契约补充（2026-10-06）

- termSource HTML 只解析 std-term-source-content，展示用“来源：”不属于 source；专用规则优先于通用 p，外部无内容槽的带类型 HTML 可直接解析正文。
- externalLink/bibExternalLink 的 href 是作者数据，不随点击地址过滤被改写。HTML 使用 JSON 字符串编码的 data-external-href 保留原值，href 属性继续采用既有安全过滤；回读优先使用字符串载荷，没有有效载荷时读取普通 href。相对地址、URN、空值及控制字符等不能成为可点击地址时，仍能无损回到作者模型。


## 063f5427 复审契约补充（2026-10-06）

- 无 metadataBlock 时，根/封面结构化元数据 fallback 的 inline 使用 IR 字段契约：crossRef.targetKind 按12种 IRReferenceTargetKind 保留，缺省仍允许；不把 PM 的 bibEntry 别名当作 IR 目标类型。非法类型记录带位置诊断，不能通过丢掉类型而绕过校验。
- 同一入口保留 tableFootnoteRef 的可选 atom ID 和 IRInline.footnote 的稳定 ID/行内内容，脚注中的标记递归读取；无效字段/脚注结构产生 unsupportedContent。保留载荷不代表放宽脚注的位置或嵌套限制，仍由 Resolver 处理。
- 题名、编号部件、机构和版权声明的引用类型经生产 Schema 与 JSON 重开保持。版权持有人等纯字符串 carrier 的富引用仍在 IR 中保留，但 IR→PM 继续明确拒绝，不能静默转为纯文本。


## 81f7814e 复审契约补充（2026-10-07）

- 行间公式的 formulaContent 是当前可编辑 LaTeX 源，存在时优先于 attrs.latex，包括用户清空后的空字符串；只有缺少内容节点时回退属性，并同时报告最小子项错误。现有正文提取的 trim 规则保持。MathML 原文、富载荷 sourceInlines 和脚注继续保留，不自动派生或同步 MathML。
- IR→PM 对原生 IR 同时提供的 latex/sourceInlines 文本做一致性检查（沿用首尾 trim 规则）；冲突时返回带位置的 IRToPmError，不能用正文优先规则静默覆盖原生 IR 中另一个源。这与编辑后保留旧属性的生产 PM 不同。
- typed crossRef 的目标类型检查依据目标是否真实存在，不依据是否已经分配编号标签；已有无编号段落/公式的错误类型必须报告，且不随引用遍历顺序变化。确实缺失的目标仍由 dangling-xref 报告；正确的显式类型继续支持无编号目标。

## 2026-10-07 模型与生产 Schema 复审补充

- 同一生产文档可有多个 `foreword` 或 `introduction` 容器，而 IR 各自只有一个内容 bucket。PM→IR 保留所有容器中的正文并按出现顺序合并；从第二个同类容器起记录带路径、节点 ID 与原因的 `unsupportedContent`，说明容器边界已不可逆。IR 消费边界仍须按诊断阻断，不能把“正文已合并”解释为完整往返。
- 多个 `coverPage` 时仅第一个作为兼容元数据来源；额外封面的元数据不合并，逐个报告 `unsupportedContent`。IR 目前只表达一份封面。
- `clause.hasTitle=false`（IR `titled=false`）必须对应空标题。生产 PM 中隐藏但非空的 `clauseTitle` 在 PM→IR 产生诊断；原生 IR 在 IR→PM 以带路径和节点 ID 的 `IRToPmError` 拒绝。空标题的无题条仍合法，避免静默丢弃隐藏内容。
- 普通 `hardBreak` 转为 `IRInline.text='\n'` 时保留其可表达的 marks 与 textStyle；脚注负载中带格式的换行继续受现有脚注映射限制并报告为未映射，不因该修复放宽脚注规则。
- `crossRef`、`bibRef`、`termRef` 是附着于实际文本或公式 atom 的语义 mark。空文本 run 没有可承载的生产 PM 节点时，IR→PM 必须用带路径和所属实体 ID 的 `IRToPmError` 拒绝；仅有 footnote atom 也不构成 mark carrier。非空文本、公式 atom 可以承载这些引用；专用 `tableFootnoteRef` atom 仍可独立存在。此约束不扩展为对空格式 marks 的通用校验。
- 生产 Schema 中作者模型的字符串 attrs 使用显式 HTML 属性读取，避免 Tiptap 把 `007`、`true`、`false` 隐式转换成数值或布尔值。范围包括 TBX 描述符类型、公式 `latex/mathml`、封面文本字段、`bibEntry.entryType`、`chapter.secType`、图及图片文本/单位字段、表格文本单位和样式字段。缺省与空字符串按各字段既有默认值契约处理；数值度量/计数和 `formula.numbered` 布尔值继续保持数值/布尔类型。`FigureImage` 的 parse rule 优先于通用 Image 规则，避免同一生产图片被重复解析成两个节点。
- 以上是 WP6 内部 IR 与作者 Schema 的往返契约，不引入 GB/T 46687.2 XML 规则，也不把 46687.1/3 的背景材料转换为技术语义或执行要求。

## 2026-10-07 typed paragraph 与表脚注 HTML 往返补充

- `stdParagraph` 的生产 HTML 使用 `p[data-type="std-paragraph"]`。该专用规则优先于通用 `<p>`，完整 chapter 经两轮 DOM 序列化/解析仍保持 `stdParagraph` 类型、稳定 `nodeId` 和 inline marks；没有类型标记的普通 `<p>` 仍解析为通用 `paragraph`。
- `tableFootnoteEntry` 序列化为带展示编号 `sup[data-table-footnote-label]` 和正文槽 `.std-table-footnote-entry-content` 的 typed `<p>`。正文槽是 ProseMirror content hole 的唯一子节点；解析优先匹配 typed 节点，并只读取正文槽，展示编号不能并入作者正文。兼容没有正文槽的旧 typed `<p>` 时读取其其余行内正文，同时排除展示编号。
- 完整生产表格经连续两轮 DOM 序列化/解析后，`tableFootnoteRow > tableFootnoteEntry` 结构、定义 `nodeId`、正文 marks/crossRef 和 `tableFootnoteRef.targetId` 保持；表脚注引用仍按独立 atom 保存。HTML 往返不扩展到 XML 规则或标准技术语义。

## 2026-10-07 clipboard ID 与 typed 引用契约

- HTML 剪贴按当前单个 ProseMirror slice 收集定义。slice 中唯一定义的 ID 若与目标文档定义冲突，则为副本生成新 ID，并只同步改写有明确模型字段的内部引用；片外目标不改，剪切后移动且原定义已离开目标文档时保留原 ID。
- 映射范围包括 `crossRef`、`bibRef`、`termRef` marks，`figureImage.resourceId`、`figureResourceRef.targetId`、`indexTarget/indexSeeAlso.targetId`、`tableFootnoteRef.targetId`，以及脚注内容 `footnoteRef.attrs.content` 中的 typed 引用。封面/根 `MetadataFields` fallback 只遍历声明的实体数组与 typed inline carrier，包含其中的公式/脚注定义 ID；不扫描或重写任意作者字符串。
- slice 内同一 ID 有多个定义且其关系含歧义时，或重复定义与目标文档冲突时，`handlePaste` 发出可见诊断并拒绝，不提交事务；唯一内部引用目标若会被普通段落合并丢弃，也依据 ProseMirror 实际替换预览拒绝。拒绝时文档、选区和撤销历史保持不变。

## 2026-10-08 typed-reference 输出边界补充

- `resolve()` 产出的 `severity='error' && code='dangling-typed-ref'` 表示 typed crossRef/bibRef/termRef 与目标实际类型不一致。HTML、DOCX、legacy XML 统一输出边界必须拒绝该错误，即使 renderer 收到空或伪造的 labels；PDF 经 HTML 内容出口受同一边界保护。JSON semantic/raw 输出继续保留源数据。
- 输出诊断保留 Resolver 原 message 与引用所属实体的 `nodeId`，并使用 `resolver.problems[dangling-typed-ref]` 说明诊断来源。`IRProblem` 不提供引用 mark 的 field path，因此不把该来源标识伪装成精确字段路径。只阻断此 error code，不据此扩大到其他 Resolver warnings/errors。
- 正确显式 targetKind、合法无编号 paragraph/formula 目标和未声明 targetKind 的旧 crossRef 继续可输出；实际不存在的目标仍由已有 `dangling-xref` 单独诊断，本修复不改变其处理策略。错误 typed refs 位于脚注、note 等递归内容时同样经过统一 boundary。
- renderer full tests 使用独立 `fullRendererFixture()` 对历史全要素 fixture 的五个已知引用目标明确赋类型；该 helper 只修改深拷贝，不改变 `fullFixture()` 默认内容、JSON goldens 或产品类型推断规则。
- 本轮没有修改 `resolve()` 的类型语义，没有扩展 legacy XML 转换器。VersionPanel 的既有 JSON-only snapshot fallback 保持；旧 XML 实现移除与新国标 XML 统一切换归 WP8，不重建旧转换器。

## 2026-10-08 公式注（IRFormulaNote）与无类型 crossRef 契约补充

- 公式注（`IRFormulaNote`）形状是 `{ id, content }`，没有 `kind` 属性。Resolver 遍历公式 `notes` 时只登记该现有 ID 的 target kind 为 `note`；通用扩展扫描继续负责同一对象既有的 ID、stable label 与遍历/引用文本。不得为修复类型判断重复注册 ID、生成新编号或改变脚注序号。
- `targetKind:'note'` 指向公式注是合法 Resolver 引用；其他 targetKind 仍按实际类型报告错误，引用 owner 不变。真正不存在的 target 由 `dangling-xref` 定位引用者，而不是“实际类型不匹配”。Resolver 可解析引用不意味着 renderer 消费公式注正文：非空 `formula.notes` 目前仍被 HTML、DOCX、legacy XML 输出边界拒绝，JSON 路径保留完整公式注和引用。
- IR crossRef 未声明 `targetKind` 时，IR→PM 在 production mark attrs 中写 `refType:''`，避免 schema 缺省把它变成 `chapter`；PM→IR 对空字符串不生成 `targetKind`。历史 PM JSON 若完全省略 refType 仍依 CrossRef schema 的 `chapter` 默认值解释。显式 chapter、figure、note 类型映射保持。
- PM crossRef `refType` 若显式为非字符串，不解释为缺省/未类型；转换产生位置诊断，非 JSON 输出不可绕过。semantic JSON 为 `crossRef.refType:null` 保留原值用于纠错；既有其他属性的 null 清理及 JSON goldens 不变。
- renderer 的 `fullRendererFixture()` 属于 `renderers/__tests__`，从通用 fixture 深拷贝后只给打印回归的明确目标标注类型。`ir/__tests__/fixtures.ts` 本身保持字节锁定 SHA `cc6b19157952576cb3ec69dc15a124dfbc6851901c227605758425bb0aef531d`；不按 ID 前缀推断产品 target kind，不更新 manifest 或 golden。
