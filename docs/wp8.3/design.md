# WP8.3 GB/T 46687.2 XML 导入设计（待审）

基线 `65f8cdff6b6e6ea0c4e51fb44433a28a97711e5b`；本文件是设计，不是实现或验收通过声明。依据 `docs/wp8-xml46687.md`、`docs/wp8.1/{README,conventions-S,conventions-T,source-record}.md`、两份支持矩阵、`docs/wp8.m/design.md` §6.1/7.1、`docs/wp8.2/{design,validation}.md`、`schemas/gbt46687.2/README.md` 和源码。原文引用用条款与印刷页；PDF 页 = 印刷页 + 4。每行出处、路径、约定、处理线索、rejectKind 在 [逐行表](matrix-import.md)。原文核验依赖矩阵的 `verifiedAgainstImage`，不把 OCR 当作独立证明。

## 1. 决策边界与流水线

已定：只支持 GB/T 46687.2；client 和 server 共用无 DOM、无 Node API、无新增依赖的 shared 纯 TS 解析器和映射器；运行时不依赖 Python；失败不修改调用者内容；本阶段不接 UI、不删旧解析/序列化器、不改 exportGuard。server 直接调用 io 是必做，HTTP/MCP 默认 WP8.4，见 §9。安全解析 → 旧格式判别 → 内容模型与语义检查 → 两遍建索引与 XML→IR → `irToPm` → 注入生产 Schema 校验 → `pmToIr` 保真回检 → 返回。任一 error 返回 `{pmDoc:null, problems}`；warning/info 可随成功返回。不得通过丢失内容使转换成功。

方案比较：A 浏览器 DOMParser + Node 解析器会产生双实现和行为差异，排除；B 在 io 引入第三方 XML 库违反依赖约束，排除；C shared 自有严格解析器 + 注入 Schema 校验器，复用现有树及两端生产校验，是建议方案。保留 MathML 的安全校验逻辑而非直接复用其当前字符串解析入口：`packages/shared/src/renderers/xml46687Parts/mathml.ts` 已有严格 MathML 处理，但它并非通用 XML 文档、位置和 namespace 解析器；先评估只提取无副作用的安全规则，避免为复用重构渲染器。

## 2. 严格 XML 解析器契约

输入 UTF-8 文本；接受唯一 XML 1.0 声明且只能出现在文首（允许 BOM），声明编码仅 UTF-8。一个根、良构的开始/结束标签、唯一展开名属性、合法 XML 字符与 QName，拒绝未绑定前缀、重复 namespace 声明或非法 xml/xmlns 绑定。默认命名空间只作用于元素、不作用于无前缀属性；`xml` 固定 URI；所有匹配按 URI+local，`prefix` 仅写出提示。标准主体须无命名空间，TBX `urn:iso:std:iso:30042:ed-1`、MathML `http://www.w3.org/1998/Math/MathML`、XLink `http://www.w3.org/1999/xlink`；前缀任意，但其 URI 须正确。树复用 `packages/shared/src/xml46687/tree.ts`：元素、文本、注释均填起始 1-based 行列及同名兄弟序号路径；属性问题定位到所在元素（现有 `XmlAttr` 无 position）。CRLF/CR 按 XML 换行规则归一，CDATA 转 text，`xml:space` 继承 preserve/default；内容文本不 trim，结构间空白按内容模型识别，不全局折叠。解码数值字符引用与五种预定义实体，校验 Unicode 标量及 XML 合法字符。注释合法但不进入 IR；DOCTYPE、实体声明、外部实体、其余命名实体以及除 XML 声明以外任何 PI 一律 error，绝不联网。

建议资源上限：XML UTF-8 16 MiB、元素深度 128、单连续文本节点解码后 1 MiB、总节点 500,000；字符引用累积计入解码长度，合并 CDATA/相邻 text 时重新检查；限制在分配前执行，流式扫描 O(n)，栈/namespace 表 O(depth)，树 O(n)，避免正则回溯及字符串重复拼接造成平方复杂度。数值是实现安全上限建议，须用真实样稿容量复核；超限报位置与阈值。JS 字符串输入用 UTF-8 字节计数而非 UTF-16 字符数，ZIP 解压也必须有独立上限。对 MathML 保存其安全的 XML 子树内容及语义，不承诺原始引号、实体、CDATA 或前缀字节原样；去除根 id 并由导出重新派生，保持结构、文本、属性。禁止脚本、事件属性及不安全 URI，与现有 MathML 检查和 V-10/V-11 同口径，不能把任意原始字符串直通输出。

## 3. 结构、语义和问题

维护一个仅导入 profile 的 TS 内容模型表：根 `processing-meta? front body back?`，分上下文检查 `front/std-meta/sec`、`body/sec`、`back/app-group/ref-list/index`，以及 sec、list、table-wrap/table/thead/tbody/tr/cell/foot、fig、formula、TBX、ref/xref/fn 的允许子元素、次序、数量和属性值；未知元素、必需容器缺失、非法嵌套、错误引用类型、缺必要内容不能丢弃，报 error。表网格检查跨度正数、覆盖不重叠、列数一致；引言条后块级正文阻断；日期格式、真实日历日与语义重复检查，发布时间晚于实施给 warning。V-1…V-18 按 `scripts/xml46687/validate.py` 的 import profile 移植，包括 URL、MathML 安全、id/rid、角色与位置、列表、术语、公式上下文；区分 import warning 和 export error，不能把 export profile 的序号/必填口径直接套入。可在测试中用 REQUIRE_XML_VALIDATION=1 调用 `validate.py --profile import` 比较，外部裁判的 implementation warning 与实际导入拒绝须单独解释，不能假定二者完全相同。

第一遍登记每个 XML id 的合法性和唯一性、目标种类、位置及生成的新 NodeId；第二遍解析所有 rid/target 并核对目标类型。XML id 是不透明关联键，绝不从 `sec_…` 等推断内部语义；未被引用、可忽略的 id 不必保留原值。重新导出由 Resolver 生成，生成器注入可确定性测试；每次导入的 id 在结果生命周期稳定，不保证跨导入相等。多目标 rid 见 §9。解析、旧格式、内容模型、日期、引用、保真、资源和 Schema 各有稳定码；单一 owner 维护共享 discriminated union，例如 `xml-syntax`、`xml-namespace`、`xml-forbidden-doctype`、`xml-limit`、`legacy-format`、`xml-content-model`、`xml-unsupported`、`xml-id-duplicate`、`xml-reference-dangling`、`xml-reference-kind`、`xml-date-invalid`、`xml-normalized`、`xml-resource-missing`、`xml-schema-invalid`、`xml-roundtrip-loss`。每个问题含中文 message、severity `error|warning|info`、XML `{line,column,path}` 或 nodeId（必要时附矩阵行），无正文泄露；对应规则测试固定码、级别和位置。

## 4. XML→IR 映射

[逐行表](matrix-import.md)覆盖基线 391 行：accept 198、required 156、reject 30（format 24、implementation 6）、not-applicable 7。required 同 accept 均须消费；拒绝行以其上下文判定，不用仅按元素名一刀切。`M-4.3.4-02/03` 实现阶段依用户要求由 implementation reject 改 accept，删除 `validate.py` 中引言专属 W-IMPL-REJECT；余下 28 reject 不动。本表原始 notes 可能描述导出口径，具体导入口径以下文和 WP8.M §6.1 优先；无 IR 路径不等于允许任意丢弃。

- 元数据：`std-meta` 标识、分段多语言 title、语言、分类、发布机构、版权、日期映射 `IRDoc.meta` 对应字段；`release-date` 是发布日期，`implementation-date` 是实施日期；接收 `release-date` 的 published/implemented 异写并检测重复（4.1 印刷页 2、4.3.2 印刷页 6；C-S-12）。`processing-meta` 是处理信息，校验属性而不进 IR；无 IR 字段的信息仅在约定允许时忽略并报告。元数据顺序 import 宽容（V-12）。
- `front` 的 foreword/intro → `IRFront`；intro 子条 → `introductionClauses`，两种 id 形式均接受且 id 不作为结构语义。`body/sec` → `IRChapter`，子 `sec` → `IRClause`；`numbered-paragraph` 无 title，其他条标题入相应字段，附录 `app` → `IRAnnex`。`norm_refs` 规范化 `norm-refs`，异写给提示；无可保真结构时阻断。
- 段落及样式 → `IRParagraph.content` / `IRInline` marks（bold、italic、underline、sup、sub、monospace 等依矩阵）；外链 URI 校验；换行按 IR 支持转换。`list` → `IRList.listType` / `items`，项含段落/列表；`roman-lower`→roman、`roman-upper` 拒绝。嵌套 PM 的限制与待决见 §9。注/示例在章条等块级位置转 `IRNote/IRExample.content` 多块；术语、表、图只存单段，多段拼接并 warning（WP8.M G7）。警告、摘录及代码按 `IRBlock` 的 `warning`、`quote`、`code` 对应内容保存，语言和来源只能按现有 IR 表达；无法保存的组合报 error。
- `table-wrap` → `IRTable`：标题、编号、方向、宽度、`rows[].cells[]`、rowspan/colspan/header、边框样式；`colgroup/col` 展开为 `columns`，数量不符 error；非百分比宽度及不支持的列 style 告警。`thead` 决定 headerRowCount，`thead` 非 th 依标志处理并告警。`table-wrap-foot` 的 dimension、notes、footnotes 分别保存并处理原顺序与规范化；脚注引用必须指向本表。`tfoot` 依 C-T-02 拒绝，`td@scope` 忽略告警、`frame/rules` 根据单元格边框推断并告警（6.2.2/6.2.3 印刷页 20、6.4 印刷页 24–25；C-T-07/10）。
- `fig` → `IRFigure`，graphic 资源、caption、legend.title 与 `def-list[figure]` 项、notes、examples；图中注/示例交错归一为注在前并告警。`inline-graphic` → `IRInline.image`，仅 p 及其合法上下文；size:T 忽略并告警，资源缺失阻断（8.3、8.5 印刷页 31–32，C-T-27/31）。
- `disp-formula`/`inline-formula` → `IRFormula`/对应行内公式，原生 MathML 保存至 `mathml`，不反译 LaTeX；导出时规范化根 id/display（7.4 印刷页 28–30，C-T-19）。
- `term-sec/tbx:termEntry` → `IRTermEntry`，`langSet` → languageSets、`tig` → groups、term 及 partOfSpeech/termType/normativeAuthorization 等 → descriptors；definition、notes、examples、source 归条目级，非首语言集归并告警；多个 subjectField 合并并告警、写条目级。定义多于一个 error、零个 warning，多个 source 保首个并警告（9.2.1–9.2.9 印刷页 35–43，C-T-43/44；WP8.M G5）。
- 规范性 `ref-list[norm-refs|norm_refs]` → `IRNormRefList`，`ref/std` 的 `std-ref` 与 title → std 项，`mixed-citation` → mixed；正文 `std`/`mixed-citation` → marks，正文 std 带 title 合并并告警；参考文献标题不同于默认时保存 `bibliographyTitle`。缩略语 `def-list` → `IRDefList`，多段 def 合并并告警；索引与参考文献按各 IR 对应集合保存。`xref` 按目标种类映射 crossRef，`entailedTerm` → termRef；正文 fn 一对一配对紧随同段 xref，表 fn 仅本表引用；多次引用同一正文 fn 当前阻断。`xref[other]` 指向缩略语时归类并警告。

仅接收 conventions 中确认的异写：`norm_refs`、`inform-annex`/`inform_annex`、`normativeAuthentication`、日期形式等，按各上下文处理；`tbx:Definition`、`term-entry`、`normative-Authorization`、`grammatical-Number` 依后续决定和矩阵拒绝，不扩成别名。旧格式先按 `conventions-S.md` §6 特征组合识别：37967 的 `xmlgb.org`、`basic_info`/`technology`/`edit`/`execute`、GB2312；SEP 的 `urn:csbts:std:xml:1.0`、body/foreword、旧术语结构、`pub-date`、`tex-math` 等；报告命中位置，不凭 `standard` 根单独判定。

## 5. io、资源与生产 Schema

建议接口 `importXml46687(xml: string, options: ImportOptions): Promise<{pmDoc: PMJsonNode | null; problems: ImportProblem[]}>`，包接口 `importXml46687Package(bytes: Uint8Array, options: ImportOptions)` 同返回。options 必须由宿主注入 `validateContent: ContentValidator`（现有 `packages/io/src/documentOps/types.ts`），及纯 XML 图片资源 resolver；不得让 io import client。client 注入实际生产 Schema 校验；server 注入 `editorContentValidator`，其 `@client/editor-schema` 别名已由 server Jest/webpack 绑定到 Node 可加载的 `createEditorSchema`，见 `packages/server/src/editor-schema/editor-schema.ts` 和 `packages/server/package.json`。生产校验 nodeFromJSON + 根类型 + check + nodeId 规范化，转换错误变问题；不得在缺校验器时退化为只做 IR 校验。`irToPm` 诊断为 error；将生产校验结果 `pmToIr`，比较导入 IR 的语义字段（排除新 id 和明确规范化项），发现不可逆丢失则 error。两端测试同一输入、注入同一生产 Schema，对比剔除新生成 id 的完整结果与问题。

包按已有 `xml46687Package.ts` 格式和已有 jszip 读取 `standard.xml`、`manifest.json`（format/version/xml/entries）和 `resources/<fileName>`。验证唯一条目、basename 安全、manifest 与实体文件一一对应，按 XML href 的基名匹配且歧义 error；禁止绝对路径、`..`、重复/冲突路径或重复清单项。图片经宿主 resolver 形成可持久化 `src`/resource key；缺必要资源、解码失败、冲突均阻断，不得先替换文档。设压缩包 64 MiB、解压总量 128 MiB、单资源 32 MiB、资源数 1024 的建议上限；检查大小与累积量，避免 ZIP 炸弹。纯 XML 必须注入 resolver 供图片查找，无资源的文档不需要；输入 bytes/options 均不修改。

## 6. 测试和验收

解析器覆盖 namespace 前缀重命名/默认/属性作用域、未绑定前缀、位置、CRLF、xml:space、CDATA/引用、重复属性、编码、DOCTYPE/实体/PI、超限与输入不变。每个 accept **和 required** 的 shall/should 行有实际运行、标题带 `[M-…]` 的测试，覆盖断言扫描真实测试名而非构造空标题；reject 每行有对应上下文测试。正负样例分别比对 TS 导入诊断与外部 import profile，同时记录允许差异；四份 WP8.2 XML → IR → 生产 Schema → PM→IR → export 字节或事先列出的规范化差异，再次往返幂等；不得修改 golden。验证不同前缀、顺序、id、CDATA/字符引用等规范化，并在问题中说明有损项目。资源负例覆盖缺文件、清单重复、歧义/路径穿越、大小上限与缺失 resolver；失败返回 null 且深比较输入不变。server Jest 从 io 直接导四 golden 和资源包，并与 client Vitest 共享预期、比较语义与问题，不访问数据库。两份锁定夹具和 JSON golden 不动；全部既有测试不得跳过/弱化。

注意四 golden 中 wp82 源含 bold+inline-code 与嵌套列表；`docs/wp8.2/validation.md:123-124,163` 明示生产 PM 无法表达，既有端到端使用删去这两处的变体。原版四 golden 完整通过与不静默丢弃不可兼得，见 §9；不得将变体成功冒充原版通过。真实外部样稿未证实存在：`source-record.md` 是标准 PDF/OCR 来源并非机器可导入标准样稿；`schemas/gbt46687.2/samples` 及 WP8.2 fixtures 为项目自写，不能宣布真实互操作通过。WP8.1 source-record 对附录 F 的完整性修正了更早的 `wp8-xml46687.md` 缺页描述，见 source-record §4，不能重复旧的缺页断言。
