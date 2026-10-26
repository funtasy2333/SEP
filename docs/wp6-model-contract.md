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
| 表格 | `IRTable.width?: IRMeasure`、`unit?:string`、`style?:IRTableStyle`、`columns?:IRTableColumn[]`（WP8.M G8 名义列宽，见「WP8.M 补模型契约」）；行 `.style?:IRRowStyle`；单元格 `cellType?/width?/unit?/columnWidths?/style?`。度量统一 `{value:number,unit:string}`，现有 `colwidth` 向量单位固定为 CSS px，样式键显式列举 | `stdTable` 宽度/单位及 style attrs、`columns`（JSON 数组，缺省 null）；row/cell 的对应 attrs；既有跨度、表头、注、脚注和内容保持。 |
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
- 原生 IR 标准列项中的唯一段落 ID 必须等于 `${item.id}.p0`，否则 IR→PM 拒绝转换。生产列表不支持的 romanUpper、与固定级别冲突的显式 level 同样通过带路径与 nodeId 的 IRToPmError 拒绝；不静默降级或改写稳定 ID。生产标准列表 numeric/dot 固定二级，其余固定一级；此项检查也覆盖嵌套 StarterList 分支。
- **WP8.M G7-a 修订（2026-10-22，设计 §4.7.1、§7.1 D-M-06）**：小写罗马列项 `roman` 现为生产 `stdList` 的受支持类型，本节上一条与 `wp6-validation.md`「罗马列项被静默降级」中「roman 也拒绝」的契约就此撤销，**只有 `romanUpper`**（原文没有 roman-upper 取值）仍拒绝（irToPm）/降级为数字列项并告警（pmToIr 读旧文档）。遗留文档里 `listType:'roman'` 的列表此前被当作数字列项，之后按罗马列项显示，这是预期变化。细节见下文「WP8.M 补模型契约」。

## 复审补充（2026-10-06）

- `note/example` 及术语注、术语示例、表注只承载一段行内内容；IR 唯一段落 ID 必须等于 `${owner.id}.p0`，否则通过 IRToPmError 返回源段落 nodeId 与路径，避免引用失效。warning/quote 的块段落 ID 仍原样保留。
- **WP8.M G7-b 修订（2026-10-22，设计 §4.7.2、D-M-05）**：块位置（章/条/附录/前言/引言/单元格）的注/示例新增承载节点 `noteBlock`/`exampleBlock`，因此上一条里「块位置的注/示例遇到非派生段落 id 即拒绝」不再成立；术语条目的注/示例、表注行内的注、图中的注仍用旧的单段节点，多块或非派生 id 在这些位置继续拒绝。细节见下文「WP8.M 补模型契约」。
- **WP8.M G8 修订（2026-10-26，设计 §4.8、D-M-11、D-M-15）**：表新增名义列宽 `IRTable.columns` 与单元格分边边框样式 `border*Style`；`columns` 与既有 `columnWidths`（px）独立保存、互不推导。细节见下文「WP8.M 补模型契约」。
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
- `crossRef`、`bibRef`、`termRef` 是附着于实际文本或公式 atom 的语义 mark。空文本 run 没有可承载的生产 PM 节点时，IR→PM 必须用带路径和所属实体 ID 的 `IRToPmError` 拒绝；仅有 footnote atom 也不构成 mark carrier。非空文本、公式 atom 可以承载这些引用；专用 `tableFootnoteRef` atom 仍可独立存在。本轮后续审查已将此约束扩展到 IR→PM 无法承载的非 atom mark/style：空 carrier、重复非 atom mark 以及与 code 冲突的 mark 现在均以源路径和 owner ID 明确拒绝。
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


## 2026-10-08 StandardDoc 根标准类型投影补充

针对 Codex review 5450305128（审阅提交 e39101daab853a4a926fdc00ff0d4f1d022ca3bb；北京时间 2026-10-08 09:21:44）指出的 StandardDoc 根类型丢失，IR→PM 在 rootType 为 standardDoc 时现在把既有 metaToCover 映射出的 standardType 同时写入 standardDoc 根 attrs 与 coverPage。映射为 gb→national、industry→industry、local→local、group→group、enterprise→enterprise、guide→guidance。

改动只在 IR→PM 的 standardDoc 根投影。production StandardDoc schema 的 national 默认值、pmToIr 对显式根类型优先于 cover 的既有规则和默认 doc 根分支均不变；默认 doc 根继续只在 coverPage 表达标准类型。周边检查未发现同一投影路径上其他非空默认值被覆盖的问题；缺失属性和空字符串继续沿用现有归一化行为。

回归使用真实 StandardDoc topNode schema（StarterKit 的 document 节点关闭后加入 StandardDoc），验证 IR 投影后的 JSON 重开，以及 exportSemanticJson 输出再次经该 schema 重开。测试检查根与封面类型一致、非空元数据、extensionVersion、typed crossRef 和 source 不变；不声称 JSON 字节完全相等，也不改变空值契约。该投影修复不扩展 XML 映射或标准符合性范围。

## 2026-10-08 脚注与行内投影及打印边界补充

针对 Codex review `5452133440`（审阅提交 `9c1565b9acc724b9b13b8361d70b5f0a4af54ffe`，北京时间 2026-10-08 13:51:24；[P2 comment 4215335293](https://github.com/funtasy2333/SEP/pull/45#discussion_r4215335293)），本轮把 IR→PM 可表示范围与反向 `pmToIr` 的既有 canonical 脚注子集对齐。正文脚注负载 `IRInline.footnote.content` 和 `IRTable.footnotes` 共用同一纯 canonical 校验；native IR 不满足回读规则时，以脚注源路径、脚注 ID 和具体原因返回 `IRToPmError`。不放宽 `pmToIr` 的内容、位置和嵌套限制，也不把已有 PM 的 raw/semantic JSON 纠错路径改成 IR 投影路径。

行内投影对生产 Schema 与既有 PM→IR 规则无法无损往返的组合给出精确诊断：code 与其他 marks/style 冲突、重复的非 atom mark、没有文本或公式载体的非 atom mark/style 均拒绝；已有空 crossRef carrier 诊断保持精确路径。生产 Schema 的 12 种 mark 矩阵覆盖 sub/sup 注册；新增普通上标 `<sup>` 解析规则排除 `<sup data-type="footnote-ref">` 与 `<sup data-type="table-footnote-ref">` 两种专用脚注 atom，避免普通上标规则抢走 atom 并丢失 ID。脚注内容位于 attrs JSON，ProseMirror 节点 content schema 不会检查它；其可回读性仍由 canonical 脚注校验决定，既有规则支持 sub/sup marks。

直接 native HTML/DOCX renderer 保留 run 的 host text（沿用转义、换行、普通 marks 与 crossRef 的原有处理），随后输出 body footnote atom 和全部 `tableFootnoteRef` atoms；普通 marks 只格式化 host text，不继承到独立 atom。含多个 crossRef 的同一 run、或带 crossRef 的换行文本，在 HTML/DOCX 输出边界精确拒绝；native IR 的 crossRef 换行另由 IR→PM 拒绝。DOCX 还会在同一实际输出文本同时带 sub 与 sup 时拒绝，实际输出文本包括非空 host text 或有非空 `refText` 的空文本 crossRef；单独 sub/sup、空 crossRef+sub 仍可用，HTML 继续保留该组合和 label。

raw/semantic PM JSON 仍保留已有 PM 内容以供纠错；native `renderJson(IRDoc, labels)` 经过 `irToPm`，因此不可投影的 native IR 会得到明确错误。UI 语义 JSON 仍由 `exportSemanticJson → renderSemanticJson` 消费原 PM 文档和 Resolver labels，本轮不把它描述成全量 PM→IR→`renderJson` 流水线。VersionPanel 的 JSON-only snapshot fallback 保持。

以上是 WP6 JSON 与作者 IR 的双向投影/输出边界收紧，不新增 XML 或 MathML 打印能力。旧 XML 实现移除与新国标 XML 统一切换归 WP8，不重建旧转换器；不扩展标准技术语义或新增工具栏。

## 2026-10-08 引用目标输出一致性补充

PM crossRef 的活动目标遵循 `targetId ?? refId`：canonical `targetId` 存在时优先，空字符串也算已提供的 canonical 值，不回退到 legacy `refId`。PM→IR 对空目标仍按无效目标处理；HTML 不为它生成内部链接。

`setCrossRef({ refId, refType })` 保持旧调用方式，写入新的 `refId` 并将 `targetId` 清为 null；canonical 调用写入 `targetId` 并将 `refId` 清为 null。两个字段同时传入时按 nullish 优先级选目标，包括空字符串 canonical 值。该更新规则使已存在 mark 的新目标能替换旧活动目标。

legacy XML 的内部引用只映射到现有带 ID 的定义载体：`sec`、`term-sec`、`app`、`table-wrap`、`fig`、`disp-formula`、`ref` 和 `fn`。对这些载体，定义 `id` 与 `xref rid` 共用同一 Resolver 候选 ID；不为 paragraph、note、example、list 等无 ID 载体新增消费能力，无支持的目标继续精确拒绝。自动脚注引用及本轮覆盖的普通 crossRef 脚注目标都有实际定义 ID 对照；该范围不重建 legacy 转换器，也不新增 GB/T 46687.2 映射，后者属于 WP8。

HTML 在同一实际渲染路径收集候选锚点。screen 输出只为唯一且实际输出的目标生成内部链接；隐藏、重复、空或未输出的目标不生成内部链接。有 resolved label 时保留其 `refText`（包括空值）及其他 marks；没有 label 时保留作者原文及其他 marks，均渲染为无内部链接的 span。print 输出不生成内部 href。Resolver 未为 list/item/row/cell/where 提供实际标签的场景仍不视为生产交叉引用支持；相应 renderer carrier 单测使用调用方提供的 labels，不改变 Resolver。

## debcda72 术语内容顺序复审

Codex review 5458048776 于北京时间 2026-10-08 22:20:19 审阅提交 debcda7255138f61934d1f8cede4bc06b4acce49，提出唯一 P2：[生产 TBX 术语内容顺序在 PM↔IR 与 Resolver 中被重排](https://github.com/funtasy2333/SEP/pull/45#discussion_r4220111944)。审阅起点是 debcda72；本节描述基于该起点的修复工作树，最终提交 hash 以 PR head 记录为准。

生产 Schema 允许 termDef 中的定义续段、来源、注、例、嵌套 termDef 和 TBX 语言集合法交错。原 PM→IR 转换把这些子项归入多个数组，随后 IR→PM、Resolver 的固定类别顺序会改变其相对位置；不同 variant/descriptor 上的 bibRef 首次出现顺序也可能随之变化，导致书目收集及标签顺序偏离作者顺序。问题属于作者模型顺序保真，不是生产 Schema 拒绝合法文稿。

IRTermEntry 增加可选的 typed tailOrder。每项由 kind 与对应尾数组的零基 index 表示，涵盖 definition、source、note、example、nestedEntry、languageSet 六类；definition 的 index 0 指向主定义之后的 definition[1]，首个主定义仍固定在尾序之前。该数组不引用节点 ID，外部 ID 重映射不把它当定义或引用。

PM→IR 只在术语含嵌套术语或 TBX 语言集、且实际完整尾序不同于 PM 既有规范序时生成 tailOrder。转换会严格验证每类索引完整覆盖、无重复、无越界，并拒绝未知 kind、额外字段、空洞、错误形状及非法 index。IR→PM、Resolver 和输出边界使用同一校验；不合格输入产生定位诊断。无 metadata 的原生 IR 与不含嵌套术语/语言集的旧术语继续采用已有 PM、Resolver 和 HTML 默认顺序；普通 native IR 显式携带 tailOrder 会被拒绝，以免往返后静默丢失。

Resolver 按有效作者尾序遍历定义续段、来源、注、例、嵌套术语及语言集中的 variant/descriptor，因此其 bibliography first-reference 收集遵循生产 PM 的可见顺序。IR/source 不被排序或改写；稳定 ID 重映射只改相应实体 ID 和 typed 引用。

输出边界将 tailOrder 作为元数据校验，而不递归扫描其条目。非法 metadata 在 DOCX、HTML、XML 三类边界均精确诊断；合法 metadata 仅当其 definition/source/note/example 可打印子序列与对应格式固定顺序不同时，HTML 或 DOCX 才额外报告无法保留顺序。HTML 固定为定义→来源→注→例，DOCX 固定为定义→例→注→来源，所以合法 metadata 并非一律阻断。XML 对合法 tailOrder 不额外报告顺序专属诊断；非法 metadata 仍精确诊断。嵌套术语与 TBX 语言集仍受现有非 JSON 扩展字段边界限制，不因此增加 XML/TBX 能力。

本轮不改生产 Schema、JSON golden、manifest 或 HTML snapshot，不增加标准技术语义、打印顺序支持或 XML 能力。

## 8dd9b3bf 规范术语顺序复审

Codex review 5464603293 于北京时间 2026-10-09 09:02:49 针对审阅起点 8dd9b3bf0366a5ef14ba6e1214a1f8cbdc9c8f7a 提出一项 P2（[comment 4225661148](https://github.com/funtasy2333/SEP/pull/45#discussion_r4225661148)）。标题中的 8dd9b3bf 是审阅起点，不是修复提交；最终修复提交以 PR #45 最终 head 为准。

本节取代 debcda72 术语顺序复审中“只在实际顺序偏离 PM canonical 时才保存 tailOrder”的规则。适用范围仍限于至少含一个 nestedEntries 或 languageSets 的术语：当实际尾序与 PM 投影默认顺序或 Resolver 默认顺序任一不同时，pmToIr 保存完整 tailOrder。若实际尾序与两个默认顺序都一致，就不生成 metadata。无 metadata 的原生 IR、纯旧术语及历史 fullFixture 的默认行为保持；不改全局 Resolver fallback，不扩大 plain term 的 metadata 适用范围。

问题出在 PM canonical 为定义→来源→注→例→嵌套术语→TBX 语言集，而旧 Resolver fallback 为定义→例→注→来源→嵌套术语→TBX 语言集。含嵌套术语或 TBX 的作者内容若按 PM canonical 写成来源→注→例，旧条件会省略 tailOrder，Resolver 因而改变文献首次引用次序。冻结复现确认来源 B、注 C、例 A 得到 bibliographyOrder B、C、A，标签分别为 B[1]、C[2]、A[3]，且源 PM 未改变；证据为 output/wp6-canonical-order-2026-10-12/reproduction.json。

本次只调整 PM→IR 的 metadata 生成条件及其测试，不改变 IR 字段形状、生产 Schema、Renderer 默认顺序或 HTML/DOCX/XML 输出能力。完整方案边界见[方案审计](wp6-plan-audit.md#8dd9b3bf-规范术语顺序复审)，冻结验收见[验收记录](wp6-validation.md#8dd9b3bf-规范术语顺序复审)。

## WP8.M 补模型契约（2026-10-26 收尾汇总）

依据 [WP8.M 设计](wp8.m/design.md)（§3 跨组共性、§4 各组、§7.1 决定），目标是关闭 [WP8.1 支持矩阵](wp8.1/README.md) 的 33 行必做（shall/should）缺口：G1～G8 共 32 行改为 `mapped`，`M-7.4-13`（公式图片）改为 `not-applicable`，`docs/wp8.1/matrix-S.json`、`matrix-T.json` 已同步。范围只含“模型 + 显示”：IR、生产 Schema、PM↔IR 双向、Resolver 编号与标签、保存重开无损、编辑器正确显示；**不含**新增结构的插入菜单与属性面板（后续交互任务），也不含新 XML 的导出与导入（WP8.2/8.3）。本节是 G1～G8 字段、节点与规则的唯一汇总处；上文三处 G7/G8 修订只保留对旧契约的更正。

### 设计原则（摘自设计 §1.3）

IR 新字段一律可选，既有字段不改名、不改型（P1）；既有 PM 节点新增的属性一律 `default: null`，`renderSemanticJson` 剔除 null 属性，所以两个 JSON 字节 golden 与 `fixtures.ts` 的 SHA 不变，旧文档不需要迁移（P2）；新扩展追加在 `createEditorExtensions()` 里 `inlineFormulaEditing` 之后（P3）；新增带 `id` 的 IR 对象一律在 Resolver 主遍历里登记（P4）；PM 节点、`pmToIr`、`irToPm` 与往返测试同一次落地（P5）；非 JSON 出口默认阻断，放行必须有理由与测试（P6）；**不改任何既有 xmlId**，只对新结构增加标签（P7）；复用既有节点与类型（`whereItem/whereTerm/whereDefinition`、`resourceId`、`IRBibField` 的做法）（P8）。`IRDoc.extensionVersion` 保持 `1`（D-M-04）：新字段是否出现由 `hasSemanticExtensions` 判定，`extensions.ts` 的 `semanticKeys` 增加 `introductionClauses`、`bibliographyTitle`、`subjectField`、`columns`、`image`、`legend`，`semanticMarks` 增加 `stdRef`、`mixedCitation`，`semanticKinds` 增加 `defList`、`normRefList`；同名冲突的字段按 kind 专门判断（`figure.examples`，`list.listType==='roman'`，非 canonical 的 `note/example` 内容）。

### IR 字段清单（全部新增，全部可选）

| 组 | 矩阵行 | IR 字段与形状 | 说明 |
|---|---|---|---|
| G1 | M-4.4.2.3-02/-03/-04、M-4.4.2.3.2-01、M-E-06 | 块 `IRNormRefList {kind:'normRefList', id, entries: IRNormRef[]}`；`IRNormRef = {kind:'normRef', id, entryType:'std', ref: IRInline[], title: IRInline[]} \| {kind:'normRef', id, entryType:'mixed', content: IRInline[]}` | 规范性引用文件清单，只能是 `secType==='norm-refs'` 章的直属块，且全文至多一个；不复用 `IRBibEntry`（后者参与 `[n]` 编号与 `bibRef` 类型检查）。 |
| G1 | M-10.2-01/-02、M-10.1.7-01 | `IRMark` 增 `{type:'stdRef'}`、`{type:'mixedCitation'}` | 被标记的文本即 `std-ref` / `mixed-citation` 的内容；两者互斥（`diagnoseInlineProjection` 报冲突）。 |
| G1 | M-4.5.3-02 | `IRDoc.bibliographyTitle?: IRInline[]` | 仅标题不是默认“参考文献”时存在；标题内禁止脚注。 |
| G2 | M-10.1.4-01/-03/-04/-05 | `IRDefItem {id, term: IRInline[], definition: IRInline[]}`（公式“式中”、缩略语、图例共用；`IRFormula.whereList: IRDefItem[]` 仅是类型别名替换，JSON 形状不变）；块 `IRDefList {kind:'defList', id, items: IRDefItem[]}` | 目前只用于缩略语表；缩略语项内禁止条文脚注。 |
| G2/G4 | M-10.1.1-04、M-10.1.5-01 | `IRReferenceTargetKind` 增 `'abbreviation'`、`'listItem'` | 沿用既有 `crossRef.targetKind`。 |
| G3 | M-8.5-01～06 | `IRFigure.legend?: IRLegend {id, title?: IRInline[], items: IRDefItem[]}` | 图例项不赋 label / xmlId，不可被引用（C-T-31）。 |
| G3 | M-8.4-03、M-8.2-11 | `IRFigure.examples?: IRExample[]`；`IRFigure.notes` 早已存在，现在生产 `figure` 能保存 | 图中注 / 示例只支持单段；PM 固定“注在前、示例在后”（D-M-09）。 |
| G3 | M-8.3-02 | `IRInline.image?: IRInlineImage {src, resourceId?, alt?, size?: 'S'\|'M'\|'L'}` | 行内叶子，`text` 恒为空，不带 marks / style，不另造实体 id；`resourceId` 沿用既有资源引用校验；只允许出现在 `IRParagraph.content`，且不在术语条目、脚注内（Resolver 校验）。 |
| G5 | M-9.2.9-01 | `IRTermEntry.subjectField?: IRInline[]`（条目级，规范形式） | 旧的术语级 `IRTermDescriptor{kind:'subjectField'}` 保留不迁移；WP8.2 导出时条目级优先，缺失时仅当所有术语级取值一致才提升为条目级（设计 §7.1 G5 补充决定）。 |
| G5 | M-9.2.1-05 | `ResolvedLabel.termEntryXmlId?: string` | 只由 Resolver 产生（`term_<编号>`），渲染器不得自行拼接。 |
| G6 | M-4.3.4-02/-03 | `IRDoc.front.introductionClauses?: IRClause[]` | 兄弟字段而非放宽 `introduction` 的元素类型（D-M-10）；块在前、条在后，条之后再出现的块（悬置段）pmToIr 报 `unsupportedContent`。 |
| G7 | M-5.7-04 | `IRList.listType` 既有取值 `'roman'` 现可由生产模型保存 | `romanUpper` 仍拒绝 / 降级。 |
| G7 | M-5.6-05 | `IRNote.content` / `IRExample.content`（既有 `IRBlock[]`）可为多块 | canonical 判定函数 `isInlineNoteContent`（`extensions.ts`），`irToPm` 与 `hasSemanticExtensions` 共用。 |
| G8 | M-6.1-03、M-C.1-02 | `IRTable.columns?: IRTableColumn[]`，`IRTableColumn {width?: IRMeasure, textAlign?: string, verticalAlign?: string}` | 名义列宽；长度必须等于网格列数。 |
| G8 | M-6.3.3.1-01 | `IRCellStyle.border{Top,Right,Bottom,Left}Style?: string`（`solid\|dashed\|dotted\|none`） | 不建模分边颜色（D-M-15）。 |
| 共用 | — | `IRProblem.code` 增 `'trailing-punctuation'`（warning）；`NumberingStrategy.listItem?(listType, index)`（可选，策略没有该方法时 Resolver 用内置同款函数） | 规范性引用条目末尾有标点：只告警，不剥离、不阻断。 |

### 生产 PM 节点与 mark 总表（12 个新节点、2 个新 mark）

所有新节点 `parseHTML` 用 `data-type` 并设 `priority: 51`；带 IR 实体 id 的节点在 `NODE_ID_TYPES` 里（粘贴时重映射 `nodeId`）；`inlineImage` 的 `resourceId` 在粘贴重映射的两张引用表里。

| 节点 / mark | 组 | group | content | attrs（新增属性均 default null） | HTML `data-type` |
|---|---|---|---|---|---|
| `normRefList` | G1 | block | `(normRefStd \| normRefMixed)+` | nodeId | `norm-ref-list` |
| `normRefStd` | G1 | — | `normRefStdRef normRefStdTitle` | nodeId | `norm-ref-std` |
| `normRefStdRef` / `normRefStdTitle` | G1 | — | `inline*` | — | `norm-ref-std-ref` / `norm-ref-std-title` |
| `normRefMixed` | G1 | — | `inline*` | nodeId | `norm-ref-mixed` |
| mark `stdRef` / `mixedCitation` | G1 | — | — | — | `std-ref` / `mixed-citation` |
| `defList` | G2 | block | `whereItem+` | nodeId | `def-list`（`dl`） |
| `figureLegend` | G3 | —（只在 `figure` 内） | `figureLegendTitle? whereItem+` | nodeId | `figure-legend` |
| `figureLegendTitle` | G3 | — | `inline*` | — | `figure-legend-title` |
| `inlineImage` | G3 | inline，atom | — | src、resourceId、alt、size | `inline-image`（`img`） |
| `termSubjectField` | G5 | — | `inline*` | — | `term-subject-field` |
| `noteBlock` / `exampleBlock` | G7 | block | `(stdParagraph \| stdList)+` | nodeId | `note-block` / `example-block` |

既有节点只放宽、不迁移（旧文档全部仍合法）：`figure` 内容表达式尾部追加 `figureLegend? note* example*`；`termDef` 在 `termNameEn?` 之后插入 `termSubjectField?`；`stdList.listType` 增 `roman`（一级）；`stdTable` 增 `columns`（JSON 数组 `{width, widthUnit, textAlign, verticalAlign}[]`）；`tableCell` / `tableHeader` 增 `borderTopStyle` 等四个字符串属性；`introduction` 的 `block+` 本来就含 `clause`，**Schema 无变化**，只补 `pmToIr` / `irToPm` 映射；`crossRef.refType` 增 `abbreviation`、`listItem`。新增 PM 插件 `tableColumnsSync`：列数变化时把该表 `columns` 置 null（D-M-11）。

### 映射与诊断要点

- `bibliographyTitle`：`pmToIr` 仅当标题不等于单个无格式的“参考文献”时才写入；`irToPm` 缺省回到“参考文献”。
- 注 / 示例 canonical 规则（G7-b）：`content` 恰为一个 id 等于 `${owner.id}.p0` 的段落 → 旧 `note` / `example`（与此前逐字节相同）；其余且全为段落 / 列项 → `noteBlock` / `exampleBlock`，子块各自保留 nodeId；含表 / 图 / 公式等其他块 → IRToPmError。`term`、表注行、图内三处直接调用单段转换，多块在这些位置继续报错。
- `figure`：`irToPm` 不再拒绝 `notes`，输出 `note*`、`example*`、`figureLegend`；`pmToIr` 反向对应，`legend.items` 为空、`image` 带 marks / style 等不可表达的组合记 `unsupportedContent` 或 IRToPmError，不静默丢弃。
- 表：`columns` 长度须等于网格列数，每项宽度为有限正数且单位是字母或 `%`，`textAlign ∈ left|center|right|justify`，`verticalAlign ∈ top|middle|bottom|baseline`，边框样式 ∈ `solid|dashed|dotted|none`；任一不符 pmToIr 记 `unsupportedContent`，irToPm 抛 IRToPmError。`columns[i].width` 是源文档给出的名义列宽（通常是百分数），单元格 `columnWidths`（PM `colwidth`，CSS px）是编辑器拖拽的结果，二者独立保存、互不推导；显示时 px 优先，DOCX 仍只消费 `columnWidths`，将来导出 `col` 只取 `columns`。
- 引言：`pmToIr` 把 `introduction` 内的 `clause` 收进 `introductionClauses`；条之后的块（悬置段）仍留在 `introduction`，同时记 `unsupportedContent`（`irToPm` 拒绝，不静默重排）。
- 罗马列项：`roman` 为 `stdList` 的一级类型；`romanUpper` 仍降级为数字列项并告警（读旧文档）/ 拒绝（irToPm）。列项标记统一为全角右括号 `a）`、`1）`、`i）`，引用文字 `5.2 a）`（D-M-03 修订）。

### Resolver：新增标签、xmlId 与校验

均在主遍历内登记，不触发 `ext_` 占位（`ext_` 不得进入 XML，R-5）。**不改任何既有 xmlId**（`bib_<n>` 等仍归 WP8.2）。

| 目标 | `label` | `xmlId` | `refText` | 何时产生 |
|---|---|---|---|---|
| 规范性引用条目（G1） | `''` | `ref_<清单内序号>` | 文件编号 + 名称（std）或内容前 40 字（mixed） | 总是 |
| 缩略语项（G2） | 缩略语文本 | `abb_<全文序>` | 同 label | 总是；类型为 `abbreviation` |
| 图例项（G3） | — | — | — | 不赋标签；图中的注 / 示例沿用 `注：/注n：`、`示例：/示例n：`，作用域为该图，xmlId 沿用全局 `note_<n>` / `example_<n>` |
| 有序列项（G4/G7，`alpha/number/roman`） | `a）` `1）` `i）` | `li_<被引用列项的文档序>` | 容器编号 + 空格 + 标记路径，如 `5.2 a）`、`5.2 a）1）` | **仅被 crossRef 引用者**；无序列项与 `romanUpper` 不赋标签，引用它们报 `dangling-xref` |
| 术语条目（G5） | 既有 | 既有 `sec_<编号>`；另有 `termEntryXmlId = term_<编号>`（嵌套条目 `term_3.1.2`） | 既有 | 总是 |
| 引言中的条（G6） | `0.n`、`0.n.m` | `sec_0.n` | 同 label | 总是；参与悬置段与跳级检查 |

校验：规范性引用清单不在 norm-refs 章，或全文出现多个清单（`ref_<n>` 会重复）→ `unsupported-content` error；行内图出现在段落之外的位置（标题、图表题、术语名、脚注、文献、索引等）→ `unsupported-content` error；缩略语项内的脚注 → `invalid-footnote`（容器 `'定义列表'`）；`crossRef.targetKind` 与目标类型不符 → `dangling-typed-ref`；规范性引用条目末尾有标点 → `trailing-punctuation` warning；参考文献标题内的脚注 → error。

### 输出边界（`outputBoundary.ts`，设计 §3.4 + §7.1）

| 结构 | HTML | DOCX | 旧 XML | XML46687（现在） |
|---|---|---|---|---|
| 规范性引用清单、`stdRef` / `mixedCitation`、自定义参考文献标题（G1） | 排版并放行（10.3.4；mark 按普通文本） | 同左 | 阻断 | 阻断 → WP8.2 放开 |
| 缩略语表 `defList`（G2）、术语领域（G5）、引言中的条（G6） | 排版并放行 | 同左 | 阻断 | 阻断 → WP8.2 放开 |
| 罗马列项（G7，D-M-06） | `lower-roman` 真排 | `lowerRoman` 真排 | **阻断**（旧序列化器会把 `i)` 降为 `1)`，静默降级） | 放行（`roman-lower`） |
| 多块注 / 示例（G7） | 逐块输出 | 逐块输出 | 放行 | 放行 |
| 图注 `figure.notes`（G3） | 放行（渲染器早已逐条输出） | 放行 | 放行 | 放行 |
| 对列项 / 缩略语的 `crossRef`（G2/G4） | 放行（输出 `refText`） | 放行 | 由旧序列化器的目标检查拒绝 | 放行 |
| 图例、图中示例、行内图（G3）；表 `columns`、单元格 `border*Style`（G8） | **暂报 unsupported-output**（另立排版任务） | 同左 | 阻断 | 阻断 → WP8.2 放开 |

机制：新 kind / 新字段不进 `BASE_FIELDS`，由 `EXTRA_FIELDS`（HTML、DOCX 各自引入）放行，其余字段按 `report(field)` 自动阻断；`XML46687` 的字段表与旧 `XML` 相同，**WP8.M 不打开 XML46687 的任何白名单**（WP8.2 的增量清单见设计 §6.2）。`XML` 与 `XML46687` 唯一有意的分叉是罗马列项。

**Resolver `unsupported-content` error 阻断非 JSON 出口（M-Z-a，设计 §7.1 主导人决定 2026-10-26）**：`getOutputSupportProblems` 对 Resolver 产生的 `code==='unsupported-content' && severity==='error'` 问题，对 HTML、DOCX、XML、XML46687 一律追加 `unsupported-output`（路径 `resolver.problems[unsupported-content]`，带 nodeId 与 Resolver 原文案）；其余 error 代码（如 `dangling-xref`）与 warning 保持既有导出口径。Resolver 对 `doc.unsupportedContent` 与术语 `tailOrder` 无效的重述按文案识别后跳过（边界已按各自路径阻断，不重复报告）。Resolver 产生 `unsupported-content` 的位置共 5 处：行内图位置非法、清单不在 norm-refs 章、多个清单（这三类是新增阻断）；术语 `tailOrder` 无效、`doc.unsupportedContent` 重述（含引言悬置段，早已阻断）。

### 编辑器显示与联动

`DocumentOutline` 遍历 `introduction` 内的条，使 `0.n` 进入大纲；`FootnoteLabels` 的 Decoration 对 `exampleBlock`、引言条、图内注 / 示例按 Resolver 作用域写标签；`noteBlock` 用 NodeView（与 `Note` 一致的标记）；`defList` 与图例复用 `WhereListEditing` 的 Enter / Tab 行为；`docDiff`、io 的 `locator`（`noteBlock→note`、`exampleBlock→example`，`normRefList` / `defList` 不可单独寻址）、`authoring.ts` 的 `IR_ONLY_FIELDS` 与中文字段标签均已补齐；写作层（`normalizeAuthoringFragment` / `irFragmentToPm`）**不**因此放开这些结构（`FRAGMENT_BLOCK_KINDS` 不增加，符合“不做插入”）。边框宽度 / 样式落成单元格内联 CSS；名义列宽靠 stdTable 外层的 `--ses-col-<n>` 自定义属性与样式表给 `<col>` 设 width（第 1～40 列），内联 px 自然优先（已在真实 Chrome 中核实 `TableView` 为每个网格列生成一个 `<col>`，无需子类化）。

### 测试与回归

全要素 fixture：生产 PM `client/src/extensions/__fixtures__/wp8m.ts`（复用各组 `wp8m-g*.ts`）与 IR 原生版 `shared/src/ir/__tests__/wp8mFixtures.ts`；`wp8mIntegration.test.ts` 覆盖 Schema、两版一致、Resolver 无 error、生产 Schema → PM → IR → PM → 保存重开（`Editor` + `replaceEditorDocument`）→ `exportSemanticJson` 两轮 JSON 相等、HTML 往返，以及四种格式的边界结论；`wp8mMatrixCoverage.test.ts` 内置 32 个矩阵 id，断言每个 id 出现在至少一个 `wp8m*.test.ts` 的标题里，并核对两份矩阵 JSON 已同步。`jsonExporter.test.ts` 的两个字节 golden 与 manifest 里 `fixtures.ts` 的 SHA 不变；HTML / DOCX 快照与 golden 相对 WP8.M 之前（`db33945`）只有 G7 的 3 个文件有变化：`html.test.ts.snap`（罗马列项与多块注 / 示例的样式）和两个 DOCX `numbering.xml` golden（`lowerRoman` 抽象编号），其余为 0。
