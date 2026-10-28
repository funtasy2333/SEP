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

[逐行表](matrix-import.md)覆盖基线 391 行：accept 198、required 156、reject 30（format 24、implementation 6）、not-applicable 7。required 同 accept 均须消费；拒绝行以其上下文判定，不用仅按元素名一刀切。`M-4.3.4-02/03` 实现阶段依用户要求由 implementation reject 改 accept，删除 `validate.py` 中引言专属 W-IMPL-REJECT；原 reject 集合余下 28 行不动；M-4.1-02 则从基线 accept 改为 format reject，目标为 accept 199、required 156、reject 29（format 25 / implementation 4）、not-applicable 7，总数仍 391。本表原始 notes 可能描述导出口径，具体导入口径以下文和 WP8.M §6.1 优先；无 IR 路径不等于允许任意丢弃。

- 元数据：`std-meta` 标识、分段多语言 title、语言、分类、发布机构、版权、日期映射 `IRDoc.meta` 对应字段；`release-date` 是发布日期，`implementation-date` 是实施日期；接收 `release-date` 的 published/implemented 异写并检测重复（4.1 印刷页 2、4.3.2 印刷页 6；C-S-12）。`processing-meta` 是处理信息，校验属性而不进 IR；无 IR 字段的信息仅在约定允许时忽略并报告。元数据顺序 import 宽容（V-12）。
- `front` 的 foreword/intro → `IRDoc.front`；intro 子条 → `introductionClauses`，两种 id 形式均接受且 id 不作为结构语义。`body/sec` → `IRChapter`，子 `sec` → `IRClause`；`numbered-paragraph` 无 title，其他条标题入相应字段，附录 `app` → `IRAppendix`。`norm_refs` 规范化 `norm-refs`，异写给提示；无可保真结构时阻断。
- 段落及样式 → `IRParagraph.content` / `IRInline` marks（bold、italic、underline、sup、sub、monospace 等依矩阵）；外链 URI 校验；换行按 IR 支持转换。`list` → `IRList.listType` / `items`，项含段落/列表；`roman-lower`→roman、`roman-upper` 拒绝。嵌套 PM 的限制与待决见 §9。注/示例在章条等块级位置转 `IRNote/IRExample.content` 多块；术语、表、图只存单段，多段拼接并 warning（WP8.M G7）。警告、摘录及代码按 `IRBlock` 的 `warning`、`quote`、`code` 对应内容保存，语言和来源只能按现有 IR 表达；无法保存的组合报 error。
- `table-wrap` → `IRTable`：标题、编号、方向、宽度、`rows[].cells[]`、rowspan/colspan/header、边框样式；`colgroup/col` 展开为 `columns`，数量不符 error；非百分比宽度及不支持的列 style 告警。`thead` 决定 headerRowCount，`thead` 非 th 依标志处理并告警。`table-wrap-foot` 的 dimension、notes、footnotes 分别保存并处理原顺序与规范化；脚注引用必须指向本表。`tfoot` 依 C-T-02 拒绝，`td@scope` 忽略告警、`frame/rules` 根据单元格边框推断并告警（6.2.2/6.2.3 印刷页 20、6.4 印刷页 24–25；C-T-07/10）。
- `fig` → `IRFigure`，graphic 资源、caption、legend.title 与 `def-list[figure]` 项、notes、examples；图中注/示例交错归一为注在前并告警。`inline-graphic` → `IRInline.image`，仅 p 及其合法上下文；size:T 忽略并告警，资源缺失阻断（8.3、8.5 印刷页 31–32，C-T-27/31）。
- `disp-formula`/`inline-formula` → `IRFormula`/对应行内公式，原生 MathML 保存至 `mathml`，不反译 LaTeX；导出时规范化根 id/display（7.4 印刷页 28–30，C-T-19）。
- `term-sec/tbx:termEntry` → `IRTermEntry`，`langSet` → languageSets、`tig` → groups、term 及 partOfSpeech/termType/normativeAuthorization 等 → descriptors；definition、notes、examples、source 归条目级，非首语言集归并告警；多个 subjectField 合并并告警、写条目级。定义多于一个 error、零个 warning，多个 source 保首个并警告（9.2.1–9.2.9 印刷页 35–43，C-T-43/44；WP8.M G5）。
- 规范性 `ref-list[norm-refs|norm_refs]` → `IRNormRefList`，`ref/std` 的 `std-ref` 与 title → std 项，`mixed-citation` → mixed；正文 `std`/`mixed-citation` → marks，正文 std 带 title 合并并告警；参考文献标题不同于默认时保存 `bibliographyTitle`。缩略语 `def-list` → `IRDefList`，多段 def 合并并告警；索引与参考文献按各 IR 对应集合保存。`xref` 按目标种类映射 crossRef，`entailedTerm` → termRef；正文 fn 一对一配对紧随同段 xref，表 fn 仅本表引用；多次引用同一正文 fn 当前阻断。`xref[other]` 指向缩略语时归类并警告。

仅接收 conventions 中确认的异写：`norm_refs`、`inform-annex`/`inform_annex`、`normativeAuthentication`、日期形式等，按各上下文处理；`tbx:Definition`、`term-entry`、`normative-Authorization`、`grammatical-Number` 依后续决定和矩阵拒绝，不扩成别名。旧格式先按 `conventions-S.md` §6 特征组合识别：37967 的 `xmlgb.org`、`basic_info`/`technology`/`edit`/`execute`、GB2312；SEP 的 `urn:csbts:std:xml:1.0`、body/foreword、旧术语结构、`pub-date`、`tex-math` 等；报告命中位置，不凭 `standard` 根单独判定。

## 5. io、资源与生产 Schema

建议接口 `importXml46687(xml: string, options: ImportOptions): Promise<{pmDoc: PMJsonNode | null; problems: ImportProblem[]}>`，包接口 `importXml46687Package(bytes: Uint8Array, options: ImportOptions)` 同返回。options 必须由宿主注入 `validateContent: ContentValidator`（现有 `packages/io/src/documentOps/types.ts`）；含图的纯 XML 还需提供只读资源或 resolver；不得让 io import client。client 注入实际生产 Schema 校验；server 注入 `editorContentValidator`，其 `@client/editor-schema` 别名已由 server Jest/webpack 绑定到 Node 可加载的 `createEditorSchema`，见 `packages/server/src/editor-schema/editor-schema.ts` 和 `packages/server/package.json`。生产校验 nodeFromJSON + 根类型 + check + nodeId 规范化，转换错误变问题；不得在缺校验器时退化为只做 IR 校验。`irToPm` 诊断为 error；将生产校验结果 `pmToIr`，比较导入 IR 的语义字段（排除新 id 和明确规范化项），发现不可逆丢失则 error。两端测试同一输入、注入同一生产 Schema，对比剔除新生成 id 的完整结果与问题。

包按已有 `xml46687Package.ts` 格式和已有 jszip 读取 `standard.xml`、`manifest.json`（format/version/xml/entries）和 `resources/<fileName>`。验证唯一条目、basename 安全、manifest 与实体文件一一对应，按 XML href 的基名匹配且歧义 error；禁止绝对路径、`..`、重复/冲突路径或重复清单项。包内图片默认转 data URL，亦可经宿主 resolver 形成可持久化 `src`/resource key；缺必要资源、解码失败、冲突均阻断，不得先替换文档。建议压缩包 64 MiB、解压总量 128 MiB、单资源 32 MiB、资源数 1024。先校验字节长度、ZIP 中央目录、条目数和声明大小；声明大小不可置信。不得对不可信条目调用 JSZip `async()` 后才检查长度：使用 `internalStream('uint8array')` 分块读取，每块累加实际字节，触限立即 pause/丢弃，整个包共享计数；只在限额内拼接。JSZip 内部 inflate 的分块和暂停是否保证输入触限时的最大临时分配须先做实验验证，若无法保证则包导入安全上限尚未满足、阻断实现验收，不宣称已防止分配炸弹。纯 XML 的外部图需提供资源数据或 resolver；无图的文档不需要。资源包默认将受限大小的媒体字节转换为持久 data URL；输入 bytes/options 均不修改。

## 6. 测试和验收

解析器覆盖 namespace 前缀重命名/默认/属性作用域、未绑定前缀、位置、CRLF、xml:space、CDATA/引用、重复属性、编码、DOCTYPE/实体/PI、超限与输入不变。每个 accept **和 required** 的 shall/should 行有实际运行、标题带 `[M-…]` 的测试，覆盖断言扫描真实测试名而非构造空标题；reject 每行有对应上下文测试。正负样例分别比对 TS 导入诊断与外部 import profile，同时记录允许差异；四份 WP8.2 XML → IR → 生产 Schema → PM→IR → export 字节或事先列出的规范化差异，再次往返幂等；不得修改 golden。验证不同前缀、顺序、id、CDATA/字符引用等规范化，并在问题中说明有损项目。资源负例覆盖缺文件、清单重复、歧义/路径穿越、大小上限与缺失 resolver；失败返回 null 且深比较输入不变。server Jest 从 io 直接导四 golden 和资源包，并与 client Vitest 共享预期、比较语义与问题，不访问数据库。两份锁定夹具和 JSON golden 不动；全部既有测试不得跳过/弱化。

注意四 golden 中 wp82 源含 bold+inline-code 与嵌套列表；`docs/wp8.2/validation.md:123-124,163` 明示生产 PM 无法表达，既有端到端使用删去这两处的变体。原版四 golden 完整通过与不静默丢弃不可兼得，见 §9；不得将变体成功冒充原版通过。真实外部样稿未证实存在：`source-record.md` 是标准 PDF/OCR 来源并非机器可导入标准样稿；`schemas/gbt46687.2/samples` 及 WP8.2 fixtures 为项目自写，不能宣布真实互操作通过。WP8.1 source-record 对附录 F 的完整性修正了更早的 `wp8-xml46687.md` 缺页描述，见 source-record §4，不能重复旧的缺页断言。

## 7. 基线样例与约定冲突

2026-10-28 在本 worktree 调用 `validate.py --profile import --json`，用本地 xmllint 20914 + lxml，检查顶层 `results[]` 而非将汇总 `valid` 当每份结果：9 个 valid 全为格式有效，78 个 invalid 中 65 拒绝、13 接受。此为外部格式校验基线，**不证明 TS 导入实现**；`09-import-pending.xml` 含 `array`、`disp-formula-group` 和同脚注多引用，矩阵仍为 implementation reject（M-5.8-01/M-C.1-04、M-C.1-05、M-10.1.8-04），校验只告警而实际导入应阻断。用户所要求 valid 全能导入与现有拒绝项冲突，不能删样例或改警告掩盖。

13 个 import 接受的 invalid 文件逐项如下（`validate.py` 的既有行为；语义不能表达时导入器仍需按保真约束报告，不自动收紧格式约定）：

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

## 8. 实现拆分和集成契约

所有任务执行者：单独 worktree，首步 `git reset --hard <分支>` 并核对主导指定 SHA；无 node_modules 时 frozen install；只本地分阶段中文 commit、不 push、不 PR、不切主工作树；禁止派生子代理；不得修改 package manifest/lock、锁定夹具、JSON golden，不新增依赖、不弱化已有测试、shared 禁参数属性/enum/namespace。主导 cherry-pick、冲突取并集并跑全量验证。每项按原任务书完整列必跑命令、快照说明和未派生确认。若任务涉及用户未决项，先停在该边界并报告。

| 顺序/任务 | 唯一可写文件归属和接口 | 前置、交付 |
|---|---|---|
| P0 解析器 | shared 新增 `xml46687/parse.ts` 与专属测试；只导出 `parseXml46687` 结果树及 parser-local 诊断，公共 index 留 P1 合并 | 最先独立交付，安全/位置/复杂度测试；不改 MathML 渲染器 |
| P1 契约与核心 | shared 新增 import 契约、问题联合、统一 facade/index、树校验调度、测试覆盖契约；公共问题码和测试计数唯一 owner | P0 后确定不可变接口、id 分配及问题规范；其他任务只提交各自模块，不写公共文件 |
| P2 内容模型与判旧 | shared 独立 `import/validate.ts`、`legacy.ts` 与专属测试 | P1 契约后；依 conventions/V-1…18，包含前缀/DOCTYPE 更新；公共表与问题类型由 P1 集成 |
| P3 结构和文本 | shared 独立 `import/structure.ts`、`inline.ts` 及测试 | P1 后；元数据、章条、段落、列表、注和基础 marks；调度由 P1 合并 |
| P4 表、图、公式 | shared 独立 `import/table.ts`、`media.ts` 与测试 | P1 后可与 P3/P5 并行；资源查询只经契约接口，嵌套列表/多图选择不擅自裁决 |
| P5 TBX、引用 | shared 独立 `import/terms.ts`、`refs.ts` 与测试 | P1 后可与 P3/P4 并行；只读共享 ID 索引；跨引用交 P1 集成 |
| P6 io 与包 | io 新增导入编排/包模块和测试；io index 由此任务独占 | P1–P5 集成后；校验器注入、资源和 roundtrip 回检 |
| P7 server 验证 | server 专属 Jest 测试、必要 Jest 配置；不触碰 db；client 专属一致性测试 | P6 后；生产 Schema 两端相同输入；HTTP/MCP 默认不接 |
| P8 约定同步与收尾 | 唯一 owner 修改矩阵、`validate.py`、相关约定与测试、覆盖契约计数 | 用户决定后，含引言两行放开、DOCTYPE/URI 已定覆盖；主导整合、统一验证 |

P2–P5 并行仅在 P1 约定冻结后，各自不同文件；均不得修改 shared 的 `index.ts`、公共问题类型/合同测试/码数或其他任务文件。P1/P8 顺序处理共享文件；必要的 API 调整由主导转给唯一 owner。按基线 186 条 `shall/should` 且 import accept|required，放开两条引言后预期 188；覆盖器需按源矩阵实际集合动态断言，标题有多行引用时分别计数。

## 9. 用户待决与建议（不能静默更改既有约定）

1. 嵌套列项 M-5.7-11：D-M-12 明确真实样稿后再决定。建议先以 error 保真阻断，或批准将可表达的嵌套压平为紧随的二级同类列表并报告丢失层级；需决定，并与 golden 的 Schema 扩展一并考虑。
2. 一个 `rid` 多目标：IR 一次一个目标。建议 error 并定位，不截取第一个；若选拆成多个引用，需定义显示文本分配与往返规则。
3. `tfoot` / `frame/rules` / `td@scope`：当前 C-T-02 拒 `tfoot`、C-T-07 接受 scope 后忽略并 warning，G-T-06 的 frame/rules 按边框推断并 warning。是否变更这些约定或扩模型？未决定之前保持既有口径。
4. 同 fig 多 graphic / fig-group：D-M-12 暂留后续；建议保真阻断，若允许扩模型则需明确组级 legend、资源与编号。
5. 附录 `term-sec`：V-2 目前将术语条限定 terms 章；建议保持拒绝。是否修改约定接受附录？
6. server HTTP/MCP 是否提前：直接调用 io 必做；默认接口留 WP8.4。提前接入则需额外 API/MCP 契约、资源和事务测试，不改变本阶段 UI 边界。
7. 9 valid 全导入与 09 的现有 implementation reject；78 invalid 全拒与其中 13 为 import 接受的 export 负例：建议分别定义格式有效、保真可导入和导出负例三类验收，保留样例/约定；如坚持全通过/全拒，先决定扩模型或改变 import 契约及相应既有测试。
8. 四 golden 原版经生产 Schema 往返：建议最小补齐 Schema 对 `bold+code` 及嵌套列表的保真表达，并同步 PM↔IR 及两端测试；这超出原设计仅导入范围，需确认扩 scope。若不扩，原版对应输入必须 error 且验收记录明确未达成；不能用已裁剪变体充数。

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
