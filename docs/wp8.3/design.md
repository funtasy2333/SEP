# WP8.3 GB/T 46687.2 XML 导入设计

设计形成于基线 `65f8cdff6b6e6ea0c4e51fb44433a28a97711e5b`；集成已同步 main `419d334aa66e04706aef53feece8ef6fd742f39f`。本文件描述契约，实际验收结果见 [validation.md](validation.md)。依据 `docs/wp8-xml46687.md`、`docs/wp8.1/{README,conventions-S,conventions-T,source-record}.md`、两份支持矩阵、`docs/wp8.m/design.md` §6.1/7.1、`docs/wp8.2/{design,validation}.md`、`schemas/gbt46687.2/README.md` 和源码。原文引用用条款与印刷页；PDF 页 = 印刷页 + 4。每行出处、路径、约定、处理线索、rejectKind 在 [逐行表](matrix-import.md)。原文核验依赖矩阵的 `verifiedAgainstImage`，不把 OCR 当作独立证明。

## 1. 决策边界与流水线

已定：只支持 GB/T 46687.2；client 和 server 共用无 DOM、无 Node API、无新增依赖的 shared 纯 TS 解析器和映射器；运行时不依赖 Python；失败不修改调用者内容；本阶段不接 UI、不删旧解析/序列化器、不改 exportGuard。server 直接调用 io 是必做，HTTP/MCP 默认 WP8.4，见 §9。安全解析 → 旧格式判别 → 内容模型与语义检查 → 两遍建索引与 XML→IR → `irToPm` → 注入生产 Schema 校验 → `pmToIr` 保真回检 → 返回。任一 error 返回 `{pmDoc:null, problems}`；warning/info 可随成功返回。不得通过丢失内容使转换成功。

方案比较：A 浏览器 DOMParser + Node 解析器会产生双实现和行为差异，排除；B 在 io 引入第三方 XML 库违反依赖约束，排除；C shared 自有严格解析器 + 注入 Schema 校验器，复用现有树及两端生产校验，是建议方案。保留 MathML 的安全校验逻辑而非直接复用其当前字符串解析入口：`packages/shared/src/renderers/xml46687Parts/mathml.ts` 已有严格 MathML 处理，但它并非通用 XML 文档、位置和 namespace 解析器；先评估只提取无副作用的安全规则，避免为复用重构渲染器。

## 2. 严格 XML 解析器契约

输入 UTF-8 文本；接受唯一 XML 1.0 声明且只能出现在文首（允许 BOM），声明编码仅 UTF-8。一个根、良构的开始/结束标签、唯一展开名属性、合法 XML 字符与 QName，拒绝未绑定前缀、重复 namespace 声明或非法 xml/xmlns 绑定。默认命名空间只作用于元素、不作用于无前缀属性；`xml` 固定 URI；所有匹配按 URI+local，`prefix` 仅写出提示。标准主体须无命名空间，TBX `urn:iso:std:iso:30042:ed-1`、MathML `http://www.w3.org/1998/Math/MathML`、XLink `http://www.w3.org/1999/xlink`；前缀任意，但其 URI 须正确。树复用 `packages/shared/src/xml46687/tree.ts`：元素、文本、注释均填起始 1-based 行列及同名兄弟序号路径；属性问题定位到所在元素（现有 `XmlAttr` 无 position）。CRLF/CR 按 XML 换行规则归一，CDATA 转 text，`xml:space` 继承 preserve/default；内容文本不 trim，结构间空白按内容模型识别，不全局折叠。解码数值字符引用与五种预定义实体，校验 Unicode 标量及 XML 合法字符。注释合法但不进入 IR；DOCTYPE、实体声明、外部实体、其余命名实体以及除 XML 声明以外任何 PI 一律 error，绝不联网。

建议资源上限：XML UTF-8 16 MiB、元素深度 128、单连续文本节点解码后 1 MiB、总节点 500,000；字符引用累积计入解码长度，合并 CDATA/相邻 text 时重新检查；限制在分配前执行，流式扫描 O(n)，栈 O(depth)，namespace 存储 O(当前可见绑定数 + 所有未退出作用域的声明日志条数)，树 O(n)；用前缀当前绑定哈希表和每层声明变更日志，进入时逐条覆盖并记录旧值，退出时按逆序恢复，避免每层复制整张表。总绑定查找/增删期望 O(n)，内存依赖同时活动的绑定及未退出的覆盖日志；不得将哈希最坏情况称为严格 O(n)。避免正则回溯及字符串重复拼接造成平方复杂度。数值是实现安全上限建议，须用真实样稿容量复核；超限报位置与阈值。JS 字符串输入用 UTF-8 字节计数而非 UTF-16 字符数，ZIP 解压也必须有独立上限。对 MathML 保存其安全的 XML 子树内容及语义，不承诺原始引号、实体、CDATA 或前缀字节原样；去除根 id 并由导出重新派生，保持结构、文本、属性。禁止脚本、事件属性及不安全 URI，与现有 MathML 检查和 V-10/V-11 同口径，不能把任意原始字符串直通输出。

## 3. 结构、语义和问题

维护一个仅导入 profile 的 TS 内容模型表：根 `processing-meta? front body back?`，分上下文检查 `front/std-meta/sec`、`body/sec`、`back/app-group/ref-list/index`，以及 sec、list、table-wrap/table/thead/tbody/tr/cell/foot、fig、formula、TBX、ref/xref/fn 的允许子元素、次序、数量和属性值；未知元素、必需容器缺失、非法嵌套、错误引用类型、缺必要内容不能丢弃，报 error。表网格检查跨度正数、覆盖不重叠、列数一致；引言条后块级正文阻断；日期格式、真实日历日与语义重复检查，发布时间晚于实施给 warning。V-1…V-18 按 `scripts/xml46687/validate.py` 的 import profile 移植，包括 URL、MathML 安全、id/rid、角色与位置、列表、术语、公式上下文；区分 import warning 和 export error，不能把 export profile 的序号/必填口径直接套入。可在测试中用 REQUIRE_XML_VALIDATION=1 调用 `validate.py --profile import` 比较，同步已授权接收项对应的旧 implementation warning；测试仍须区分格式校验与资源/生产模型可导入结论。

第一遍登记每个 XML id 的合法性和唯一性、目标种类、位置及生成的新 NodeId；第二遍解析所有 rid/target 并核对目标类型。XML id 是不透明关联键，绝不从 `sec_…` 等推断内部语义；未被引用、可忽略的 id 不必保留原值。重新导出由 Resolver 生成，生成器注入可确定性测试；每次导入的 id 在结果生命周期稳定，不保证跨导入相等。多目标 rid 见 §9。解析、旧格式、内容模型、日期、引用、保真、资源和 Schema 各有稳定码；单一 owner 维护共享 discriminated union，例如 `xml-syntax`、`xml-namespace`、`xml-forbidden-doctype`、`xml-limit`、`legacy-format`、`xml-content-model`、`xml-unsupported`、`xml-id-duplicate`、`xml-reference-dangling`、`xml-reference-kind`、`xml-date-invalid`、`xml-normalized`、`xml-resource-missing`、`xml-schema-invalid`、`xml-roundtrip-loss`。每个问题含中文 message、severity `error|warning|info`、XML `{line,column,path}` 或 nodeId（必要时附矩阵行），无正文泄露；对应规则测试固定码、级别和位置。

## 4. XML→IR 映射

[逐行表](matrix-import.md)覆盖基线 391 行：accept 198、required 156、reject 30（format 24、implementation 6）、not-applicable 7。目标：六个 implementation reject 全转 accept（M-4.3.4-02/03、M-5.8-01、M-C.1-04/05、M-10.1.8-04），M-4.1-02 DOCTYPE 从 accept 转 format reject；故 accept 203、required 156、reject 25（全为 format）、not-applicable 7，合计 391。shall/should 接收行由 186 增为 188。同步矩阵、相应约定、Python 的引言/array/公式组/多引用 implementation warning 和对应测试；format 拒绝须按上下文，不得误拒 09 的合法 array/colgroup。模型增量与输出契约见 [model-extension.md](model-extension.md)。

- 元数据：`std-meta` 标识、分段多语言 title、语言、分类、发布机构、版权、日期映射 `IRDoc.meta` 对应字段；`release-date` 是发布日期，`implementation-date` 是实施日期；接收 `release-date` 的 published/implemented 异写并检测重复（4.1 印刷页 2、4.3.2 印刷页 6；C-S-12）。`processing-meta` 是处理信息，校验属性而不进 IR；无 IR 字段的信息仅在约定允许时忽略并报告。元数据顺序严格执行 [strict-import.md](strict-import.md) 的 A/B 两种上下文次序：仅原文 4.1 示例异写 B 可规范化告警，其他次序 error。
- 元数据多值边界：同一 `permissions` 内重复的 `copyright-statement`、`copyright-year`、`copyright-holder`，以及重复 `comm-ref`，因现有 IR 无法完整表示而在重复项处 error；不合并或覆盖。`custom-meta` 按 C-S-21 对实际名称去重，已知、未知的同名项均拒绝，单个或不同名称的未知项仍告警。
- `front` 的 foreword/intro → `IRDoc.front`；intro 子条 → `introductionClauses`，两种 id 形式均接受且 id 不作为结构语义。`body/sec` → `IRChapter`，子 `sec` → `IRClause`；`numbered-paragraph` 无 title，其他条标题入相应字段，附录 `app` → `IRAppendix`。`norm_refs` 规范化 `norm-refs`，异写给提示；无可保真结构时阻断。
- 段落及样式 → `IRParagraph.content` / `IRInline` marks（bold、italic、underline、sup、sub、monospace 等依矩阵）；外链 URI 校验；换行按 IR 支持转换。`list` → `IRList.listType` / `items`，项含段落/列表；`roman-lower`→roman、`roman-upper` 拒绝。嵌套列表和 bold+code 保留层级/样式，依用户批准的 S0 生产 Schema 补齐。注/示例在章条等块级位置转 `IRNote/IRExample.content` 多块；术语、表、图只存单段，多段拼接并 warning（WP8.M G7）。警告、摘录及代码按 `IRBlock` 的 `warning`、`quote`、`code` 对应内容保存，语言和来源只能按现有 IR 表达；无法保存的组合报 error。
- `table-wrap` → `IRTable`：缺表题映射 `caption=[]` 并告警；`tables.ts:303` 已支持导出空 `caption/title`（caption-empty warning），`resolve.ts:384` 仍对表统一编号。缺 label/无编号与缺题名不同：严格项目契约 R12 将缺 label 作为 error，缺题名仍可接受；其余标题、编号、方向、宽度、`rows[].cells[]`、rowspan/colspan/header、边框样式；`colgroup/col` 展开为 `columns`，数量不符 error；非百分比宽度及不支持的列 style 告警。`thead` 决定 headerRowCount，`thead` 非 th 依标志处理并告警。`table-wrap-foot` 的 dimension、notes、footnotes 分别保存并处理原顺序与规范化；脚注引用必须指向本表。`tfoot` 依 C-T-02 拒绝，`td@scope` 忽略告警、`frame/rules` 根据单元格边框推断并告警（6.2.2/6.2.3 印刷页 20、6.4 印刷页 24–25；C-T-07/10）。
- `fig` → `IRFigure`，主 graphic 与 additionalGraphics 按序保存；`fig-group` → `IRFigureSet` 保留组级 legend 与子图；graphic 资源、caption、legend.title 与 `def-list[figure]` 项、notes、examples；图中注/示例交错归一为注在前并告警。`inline-graphic` → `IRInline.image`，仅 p 及其合法上下文；size:T 忽略并告警，资源缺失阻断（8.3、8.5 印刷页 31–32，C-T-27/31）。
- `array` → 无编号 `IRArray`，表替代图 → `IRTable.alternativeGraphic`；`disp-formula-group` → 保留组级编号和成员顺序的 `IRFormulaGroup`。`disp-formula`/`inline-formula` → `IRFormula`/对应行内公式，原生 MathML 保存至 `mathml`，不反译 LaTeX；导出时规范化根 id/display（7.4 印刷页 28–30，C-T-19）。
- `term-sec/tbx:termEntry` → `IRTermEntry`，`langSet` → languageSets、`tig` → groups、term 及 partOfSpeech/termType/normativeAuthorization 等 → descriptors；definition、notes、examples、source 归条目级，非首语言集归并告警；多个 subjectField 合并并告警、写条目级。定义必须恰好一个（零个或多个均 error），多个 source 保首个并警告（9.2.1–9.2.9 印刷页 35–43，C-T-43/44；WP8.M G5）。
- 规范性 `ref-list[norm-refs|norm_refs]` → `IRNormRefList`，`ref/std` 的 `std-ref` 与 title → std 项，`mixed-citation` → mixed；正文 `std`/`mixed-citation` → marks，正文 std 带 title 合并并告警；参考文献标题不同于默认时保存 `bibliographyTitle`。缩略语 `def-list` → `IRDefList`，多段 def 合并并告警；索引与参考文献按各 IR 对应集合保存。`xref` 按目标种类映射 crossRef，`entailedTerm` → termRef；旧一对一正文 fn 保持兼容；多引用采用共享 `footnoteRef` 与唯一原位置 `footnoteDefinition`，不复制正文，支持定义位于两个引用之后；表 fn 仅本表引用。`xref[other]` 指向缩略语时归类并警告。

仅接收 conventions 中确认的异写：`norm_refs`、`inform-annex`/`inform_annex`、`normativeAuthentication`、日期形式等，按各上下文处理；`tbx:Definition`、`term-entry`、`normative-Authorization`、`grammatical-Number` 依后续决定和矩阵拒绝，不扩成别名。旧格式先按 `conventions-S.md` §6 特征组合识别：37967 的 `xmlgb.org`、`basic_info`/`technology`/`edit`/`execute`、GB2312；SEP 的 `urn:csbts:std:xml:1.0`、body/foreword、旧术语结构、`pub-date`、`tex-math` 等；报告命中位置，不凭 `standard` 根单独判定。

## 5. io、资源与生产 Schema

建议接口 `importXml46687(xml: string, options: ImportOptions): Promise<{pmDoc: PMJsonNode | null; problems: ImportProblem[]}>`，包接口 `importXml46687Package(bytes: Uint8Array, options: ImportOptions)` 同返回。options 必须由宿主注入 `validateContent: ContentValidator`（现有 `packages/io/src/documentOps/types.ts`）；含图的纯 XML 还需提供只读资源或 resolver；不得让 io import client。client 注入实际生产 Schema 校验；server 注入 `editorContentValidator`，其 `@client/editor-schema` 别名已由 server Jest/webpack 绑定到 Node 可加载的 `createEditorSchema`，见 `packages/server/src/editor-schema/editor-schema.ts` 和 `packages/server/package.json`。生产校验 nodeFromJSON + 根类型 + check + nodeId 规范化，转换错误变问题；不得在缺校验器时退化为只做 IR 校验。`irToPm` 诊断为 error；将生产校验结果 `pmToIr`，比较导入 IR 的语义字段（排除新 id 和明确规范化项），发现不可逆丢失则 error。两端测试同一输入、注入同一生产 Schema，对比剔除新生成 id 的完整结果与问题。

包按已有 `xml46687Package.ts` 格式和已有 jszip 读取 `standard.xml`、`manifest.json`（format/version/xml/entries）和 `resources/<fileName>`。验证唯一条目、basename 安全、manifest 与实体文件一一对应，按 XML href 的基名匹配且歧义 error；禁止绝对路径、`..`、重复/冲突路径或重复清单项。包内图片默认转 data URL，亦可经宿主 resolver 形成可持久化 `src`/resource key；缺必要资源、解码失败、冲突均阻断，不得先替换文档。建议压缩包 64 MiB、解压总量 128 MiB、单资源 32 MiB、资源数 1024。先校验字节长度、ZIP 中央目录、条目数和声明大小；声明大小不可置信。不得对不可信条目调用 JSZip `async()` 后才检查长度：使用 `internalStream('uint8array')` 分块读取，每块累加实际字节，触限立即 pause/丢弃，整个包共享计数；只在限额内拼接。JSZip 内部 inflate 的分块和暂停是否保证输入触限时的最大临时分配须先做实验验证，若无法保证则包导入安全上限尚未满足、阻断实现验收，不宣称已防止分配炸弹。纯 XML 的外部图需提供资源数据或 resolver；无图的文档不需要。资源包默认将受限大小的媒体字节转换为持久 data URL；输入 bytes/options 均不修改。

## 6. 测试和验收

解析器覆盖 namespace 前缀重命名/默认/属性作用域、未绑定前缀、位置、CRLF、xml:space、CDATA/引用、重复属性、编码、DOCTYPE/实体/PI、超限与输入不变。每个 accept **和 required** 的 shall/should 行有实际运行、标题带 `[M-…]` 的测试，覆盖断言扫描真实测试名而非构造空标题；reject 每行有对应上下文测试。正负样例分别比对 TS 导入诊断与外部 import profile，同时记录允许差异；四份 WP8.2 XML → IR → 生产 Schema → PM→IR → export 字节或事先列出的规范化差异，再次往返幂等；不得修改 golden。验证不同前缀、顺序、id、CDATA/字符引用等规范化，并在问题中说明有损项目。资源负例覆盖缺文件、清单重复、歧义/路径穿越、大小上限与缺失 resolver；失败返回 null 且深比较输入不变。server Jest 从 io 直接导四 golden 和资源包，并与 client Vitest 共享预期、比较语义与问题，不访问数据库。两份锁定夹具和 JSON golden 不动；全部既有测试不得跳过/弱化。

注意四 golden 中 wp82 源含 bold+inline-code 与嵌套列表；`docs/wp8.2/validation.md:123-124,163` 明示生产 PM 无法表达，既有端到端使用删去这两处的变体。用户已批准最小 Schema 扩展保留两者；原版四 golden 是验收目标，不得将变体成功冒充原版通过。真实外部样稿未证实存在：`source-record.md` 是标准 PDF/OCR 来源并非机器可导入标准样稿；`schemas/gbt46687.2/samples` 及 WP8.2 fixtures 为项目自写，不能宣布真实互操作通过。WP8.1 source-record 对附录 F 的完整性修正了更早的 `wp8-xml46687.md` 缺页描述，见 source-record §4，不能重复旧的缺页断言。

## 7. 基线样例与约定冲突

2026-10-28 在本 worktree 调用 `validate.py --profile import --json`，用本地 xmllint 20914 + lxml，检查顶层 `results[]` 而非将汇总 `valid` 当每份结果：9 个 valid 全为格式有效，78 个 invalid 中 65 拒绝、13 接受。此为外部格式校验基线，**不证明 TS 导入实现**。用户最后明确要求全部 valid 可导入优先，且已授权扩模型接收：03 的嵌套列项、05 的多 graphic/fig-group、08 的表替代图、09 的 array/公式组/同脚注多次引用，以及引言条。实现须保留每个内容及关联，详见 [模型增量](model-extension.md)；不得以删减样例、拆分结构或复制脚注正文冒充无损。

样例范围实查：01 是最小 title-wrap；02 多语言/多机构与完整元数据；03 包含混合列表并有 alpha→dash 嵌套；04 含表格列项、两个表脚注；05 含单图、同 fig 两图和带 legend 的两子图组；06 含 TBX、脚注和单图；07 含已定异写、V-12 顺序告警和无 id 的规范性 ref；08 含表替代 graphic；09 含引言条、共享脚注、array 和两成员公式组。图片均须注入确定性资源。四份原始 golden 的 XML 只读盘点：wp82 有 2 个嵌套 list、1 处 bold+inline-code、8 个图引用与 6 个 MathML；fullRenderer 2 图/2 MathML；wp6 1 图/2 MathML；wp8m 9 图/0 MathML，后三者无上述嵌套样式。实际 roundtrip 仍须测试，不能用计数代替验收。

历史基线中 13 个 import 接受的 invalid 文件逐项如下（仅为现有代码的历史行为；**旧豁免已由严格项目契约取代**，目标全部 error，具体上下文见 [strict-import.md](strict-import.md)）：

| 文件 | import 接受原因 / 告警 |
|---|---|
| app-without-annex-type.xml | V-17：缺导出必需 annex-type，导入 warning |
| custom-xref-no-type.xml | V-8：按 rid 的目标种类推断 custom-type，warning |
| ext-link-without-type.xml | V-17 对缺省属性导入接受且不告警，按 URI 处理 |
| mathml-display-inline-in-disp-formula.xml | V-15：根据容器判行间，display 异常 warning |
| mathml-id-missing.xml | V-14：缺导出 MathML id warning，导出重生成 |
| missing-app-id.xml | V-13：缺 id warning，不透明生成 NodeId |
| missing-ref-id.xml | V-13：缺 id warning，未被引用可生成 NodeId |
| missing-term-entry-id.xml | V-13：缺 id warning；若被引用则需要有效目标 |
| p-with-id.xml | V-18：不需 id warning，导入不保留 XML id 的语义 |
| sec-without-label.xml | V-17：缺 label warning，编号由 Resolver 派生 |
| std-meta-wrong-order.xml | V-12：导入顺序宽容并 warning |
| table-wrap-without-label.xml | V-17：缺 label warning，编号由 Resolver 派生 |
| term-entry-without-definition.xml | W-TERM-NODEF：零定义 warning，多于一个才 error |

已定覆盖旧记录：C-S-02、M-4.1-02 允许无内部子集 DOCTYPE，而本次用户明确要求全部拒绝；C-T-19 的字面 `mml:` 前缀要求与本次按 URI 判断冲突。实施任务须同步相应约定、矩阵和测试，按本次要求实现；`validate.py` 的 `check_rejects` 用 namespace URI 判断无命名空间 MathML 的 `_UNPREFIXED_MATHML`，不是对正确 URI 的所有替代前缀字面拒绝；须增加不同前缀和默认 MathML namespace 的实测，检查 RNG 是否还有限制。不得把无 namespace 的 `<mtext>` 当合法 MathML。其他冲突：matrix M-9.2.8-02 notes 写 warning 去包装，但 import=reject/format、`validate.py` 明确拒绝 `tbx:source/std`；依拒绝状态处理并登记修正 notes。C-T-38 旧表曾写接受异写，后续决定、矩阵和脚本明确拒绝四项，以上述后续决定为准。

### 7.1 严格导入策略

按用户“不区分”及 valid 优先决定，9 个 valid 全部可导入；2026-10-31 用户确认保留不透明 ID，因此 `invalid/uuid-id.xml`、`invalid/formula-id.xml` 为导入正例、导出负例，其余 76 个 invalid 拒绝。产品不按文件名特判。采用 [strict-import.md](strict-import.md) 的 R1–R13 统一上下文规则取代上表旧 import 豁免。它们是项目导入规则，不是把标准中的所有示例或“宜/可”改称强制。有效资源映射同时供正反例使用，缺资源单独测试，不能以缺图伪装格式拒绝。原文 4.1 的 ics/ccs 在 title-wrap 前用 B 次序接受；bibl/ref 缺 id 与 norm-refs/ref 缺 id 按不同上下文处理。

已对 9 valid、13 目标 invalid 和四 golden 做 lxml 节点扫描：9 valid 与四 golden 对 R1–R13 均零命中，每个目标 invalid 仅命中相应规则。原 import profile 已拒的另外 65 个 invalid 仍须完整回归；这只是规则可行性证据，不是导入器或真实互操作通过。不得按文件名分类。

## 8. 实现拆分和集成契约

公共规则与逐任务命令见 `/workspace/wp83-coordination/common.md`；所有代理独立 worktree、先核对 HEAD、分阶段本地提交、不再派生；不得修改依赖清单/lock、两份锁定夹具或 JSON golden，不弱化测试。主导 cherry-pick 并统筹验收。

P0 严格解析器可与 S0（code+bold 与嵌套列表）并行，两者独占各自文件。S0 合入之后 M-core 单一 owner 顺序负责 `types.ts`、生产 Schema/扩展注册、`irToPm.ts`/`pmToIr.ts`、Resolver、outputBoundary、XML 导出和资源收集公共文件，合同及详细节点见 [模型增量](model-extension.md)；不得与 S0 同时写适配器。P1 统一导入合同/问题码/调度唯一 owner，在 P0/M-core 对应契约集成后冻结；P2 内容模型、判旧及严格导入 R1–R13 的 TS 实现唯一 owner；P3 结构/文本、P4 表图公式、P5 TBX/引用仅各写独立模块和测试，可在合同冻结后并行，不能写公共文件。P6 io 与包在 P1–P5 后；P7 client/server 一致性；P8 唯一 owner 同步矩阵、约定、Python import profile、对应测试及覆盖计数并验证全部样例；P1 唯一 owner 负责共享问题码，P2/P8 分属独立文件且按同一契约检验。不同 owner 修改相同公共文件必须串行并通过主导集成，不直接跨工作树共享写入。

## 9. 已定与需主导核实

已定：保留嵌套列表、扩模型接收全部 valid 所需结构；多目标单个 rid、tfoot、附录 term-sec 继续拒绝，frame/rules 与 td@scope 按既有警告；server 直接调用 io，HTTP/MCP 与 UI 留 WP8.4。无损比较覆盖图组、表替代图、公式组、共享脚注身份与原位置。历史 13 个 import 豁免已被严格契约 R1–R13 取代；ID 取值仅校验合法、唯一、引用可解析，导入不套用导出 ID 拼写。两个 ID 样例的档位差异见 §7.1，不能通过缺资源伪装拒绝。

实现另接受已约定的 `processing-meta@mathml-version="2.0"` 并告警，导出仍为 3.0；原生公式的备选图在 MathML 和资源均有效时按 M-7.4-13 告警忽略。XML 资源沿既有导出层接受合法 `image/*`，不局限 PNG/JPEG 等短名单，非图片及无效 MIME 仍拒绝。

ZIP 的 128 MiB 总量和 32 MiB 单资源限制约束留存与拼接；JSZip/pako 正处理的输入块在 pause 后可能继续同步产生输出，回调立即丢弃，不能声称解码器瞬时停产或进程 RSS 有同样硬上界。已核对 16 KiB 输入/输出块、32 KiB 解码窗口及不累计后续块的实现，并以伪报大小的 48 MiB 资源实测拒绝。具体证据与限制记录在验收文档。

## 10. 上限与基线证据

主导只读分析四份 golden：最大深度 12、最大文件 28,020 字节 / 25,435 字符、最大 622 元素；9 个 valid 最大深度 11、最大 7,438 字节。§2 所设 128 层、16 MiB 等对这些夹具有余量，但不能推断真实样稿上界。仓库 `rules`、`docs`、`output` 未发现有真实来源的 XML/ZIP；真实样稿未取得，互操作与真实规模验证未通过亦未声称通过。

基线执行环境：HEAD 如上；`pnpm install --frozen-lockfile` 默认 `/home/agent/.local/share/pnpm` 不可写，改用 `XDG_DATA_HOME=/tmp/wp83-pnpm-data`、`--store-dir /tmp/wp83-pnpm-store`；pnpm 11 不再读取 root package.json 的 `onlyBuiltDependencies`，生成 workspace 的 allowBuilds 占位并以 ignored builds 退出；随后采用 `--ignore-scripts` 补足依赖，生成的 pnpm-workspace.yaml 改动已还原。缺 native 构建的影响见本节验证结果。测试 PATH 增加 `/workspace/wp83-tools/xml/usr/bin`，xmllint 20914；这是本地工具，不改仓库配置。

### 10.1 并行接口与保真比较细则

以下是建议的冻结契约，P1 为唯一 owner，类型定义位置为 shared `xml46687/import/contracts.ts`、io `xml46687Import.ts`；最终以编译后导出类型为准：

```ts
type XmlLocation = { line: number; column: number; path: string }
type ImportProblem = { code: string; severity: 'error' | 'warning' | 'info'; message: string; xml?: XmlLocation; nodeId?: string; path?: string; matrixId?: string; detail?: { hostCode?: string } }
type ParseResult = { tree: XmlDocument | null; problems: ImportProblem[] }
type ValidationResult = { problems: ImportProblem[] }
type MappingResult = { ir: IRDoc | null; problems: ImportProblem[] }
function parseXml46687(xml: string): ParseResult
function validateXml46687(tree: XmlDocument): ValidationResult
type ResolvedResource = { src: string; resourceId?: string; mediaType: string }
type PreparedResources = ReadonlyMap<string, Readonly<ResolvedResource>> // XML href → identity
function mapXml46687(tree: XmlDocument, context: { nodeIdsByPath: ReadonlyMap<string, string>; resources: PreparedResources }): MappingResult
type ResourceRequest = { href: string; basename: string; kind: 'graphic' | 'inline-graphic'; location: XmlLocation; bytes?: Uint8Array; mediaType?: string }
type ResourceResolver = (request: Readonly<ResourceRequest>) => Promise<ResolvedResource | null>
type ImportOptions = { validateContent: ContentValidator; resources?: PreparedResources; resolveResource?: ResourceResolver; generateId?: () => string }
type ImportResult = { pmDoc: PMJsonNode | null; problems: ImportProblem[] }
function importXml46687(xml: string, options: ImportOptions): Promise<ImportResult>
function importXml46687Package(bytes: Uint8Array, options: ImportOptions): Promise<ImportResult>
```

`mapXml46687` 是同步纯函数，不调用外部 resolver 或随机源。io 在合法树上遍历可寻址节点，由 `generateId` 分配不重复 NodeId 并建立路径表；相同 tree 和两张只读表映射结果相同。缺位置或 ID、重复 ID 为 error；相同 XML id 通过索引指向同一预分配 NodeId。io 对纯 XML 按 href 先查 `resources`，缺失时可异步调用 `resolveResource`；对包，校验 manifest 和文件后默认以媒体类型构造 data URL，填同一只读资源表，无须宿主 resolver；若宿主提供 resolver，传入拷贝的 bytes 与 mediaType，结果为可持久 `src`，禁止临时 blob URL。资源不存在、MIME 缺失或解析失败为 error。P0 的 parser-local 诊断由 P1 facade 唯一转换为公共 `ImportProblem`；P1 不需要提前写入 P0 文件。解析/校验失败禁止调用 map；map 的 error 禁止转换 PM；validator `{ok:false,message,code,path,nodeId}` 映射 `xml-schema-invalid`，保留宿主 code 于 `detail.hostCode`、JSON Pointer 与 nodeId，成功可使用 `content ?? candidate`，预期无效文档不抛异常，意外异常保留传播。id 生成器异常不作格式问题伪装。

`pmToIr` 比较语义 IR：以文档遍历位置建立双向 id 对应，替换引用目标，不直接丢掉 id 而遗漏引用指向；比较所有文本、marks、容器顺序、资源、语义属性、引用种类与目标。排除随机 NodeId 值、XML id、PM 缺省属性、XML 源行列和声明，以及 §4 明确且已有 warning 的顺序/异写/字节层规范化；资源地址按同一资源清单身份对照，不忽略资源内容。每项可排除差异需可追溯具体问题码及测试；不相等且无白名单时 `xml-roundtrip-loss` error。

MathML 抽取基于已经展开 URI 的树，不截取可能依赖祖先 namespace 声明的原始文本：复制 math 子树，按 URI 重建独立 `xmlns:mml`、必要 `xmlns:xlink` 与 XML 命名空间，以现有 writer 正确转义生成可独立解析字符串，再存 `mathml`。根 id 作为关联键后去掉；display 由公式上下文规范化。现有 `mathml.ts` 会去掉 TeX annotation、合并 semantics、丢弃元素间格式空白；这些并不等同保留源字节或全部语义。对可见或不可逆数据先阻断并定位，除非已有明确批准的规范化与 warning；不能声称任何 MathML 都可字节原样往返。

本工作树基线实测结果（仅是现有代码基线，不代表 WP8.3 实现）：

| 命令 | 结果 |
|---|---|
| `REQUIRE_XML_VALIDATION=1 pnpm --filter @ses/shared test` | exit 0，115 文件、2909 测试通过 |
| `pnpm --filter @ses/shared exec tsc --noEmit` | exit 0 |
| `REQUIRE_XML_VALIDATION=1 pnpm --filter @ses/io test` | exit 0，30 文件、448 测试通过 |
| `pnpm --filter @ses/client exec vitest run --maxWorkers=2` | exit 0，114 文件通过、2 文件跳过；1421 通过、2 跳过 |
| `pnpm --filter @ses/client build` | exit 0，存在 Vite chunk 大小警告 |
| `cd packages/server && NODE_OPTIONS=--experimental-vm-modules npx jest --runInBand` | 初次因安装未构建 better-sqlite3 无法连接测试库；以 `/tmp` 缓存执行该已列入根 package.json 的依赖原生安装后重跑，exit 1：20/21 suite、761/762 测试通过，`mcp-e2e.spec.ts` 5c PDF 失败；无快照。最小 `vivliostyle build` 独立复现 `ENOENT mkdir /home/agent/.cache/vivliostyle/browsers`，服务端可用性探测只检测 CLI 和 poppler，故 reported ready 后执行失败；不能把本基线标成全通过。 |
| `python3 scripts/xml46687/test_validate.py` | exit 0，259 测试通过 |

没有修改任何快照、黄金、锁定夹具、依赖清单或测试；安装生成的 workspace 配置占位已还原。不得用该设计任务的测试基线声称导入功能已实现。

终审环境复核：以 `/tmp/wp83-viv-cache`、`--executable-browser /usr/bin/chromium` 并在探针进程中清除代理变量，最小 Vivliostyle PDF 能成功；保留原代理时 localhost viewer 返回 403。server 现有调用没有 executable-browser 参数，临时 cwd 下配置文件必须包含 `entry`，这会改变被测输入，空 entry 被校验拒绝；因此未用该配置冒充原测试，未重新宣称 server 全量通过。未下载浏览器或改 HOME、源码和测试。
