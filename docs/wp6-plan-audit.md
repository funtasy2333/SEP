# WP6 调整方案对照审计

日期：2026-10-06。审计对象：PR #45，`codex/wp6-json-model`。远端 `main` 已重新 fetch，基线为 `e0e9ab09`（PR #46 已合入调整后的方案）。开发的最初代码基线仍为 `e4690a32`，二者不能混称。

依据为 main 的 `docs/dev-plan-phase-5.5.md` §2.6/WP6，以及 `docs/wp8-xml46687.md` §1.1/3.1/4.1/6；先读 main 文件，再核对本分支实现与生产入口。历史记忆只作索引，不代替当前方案。

## 结论与完成范围

开发遵循调整后的 **JSON 渲染迁移 + 新国标内部文档数据模型补齐**。没有按初版实施“旧 XML 渲染迁移”，没有新增 xml37967、旧 XML 转换器、独立 NISO STS 入口或第1/3部分的技术对象/属性/关系及规则执行能力。

当前能验收的是项目内部模型、生产 Schema、JSON、引用和转换错误边界。不能据此声称新国标 XML、所有新增内容的打印排版、完整的新要素操作面板或标准符合性已经完成。复审修复通过本地测试后仍需 PR 审阅；本记录不是 Codex 自动复审批准。

## WP6 逐项证据

| 调整后要求 | 实际实现与核验入口 | 结论 |
|---|---|---|
| JSON 渲染迁入 shared；client 薄壳；编号消费 Resolver | `shared/src/renderers/json.ts`、`client/src/serializer/jsonExporter.ts`；两组 `jsonExporter.test.ts` byte golden 及源文件哈希固定 | 已实现；已披露的三种异常层级/附录编号行为采用 Resolver，不声称任意异常输入字节一致 |
| 补齐元数据并保留现有文件设置 | `IRDocMeta`、metadata 节点、`ir/meta.ts`、PM 双向映射；titleParts/identifiers/languages/publishers/adoptions/replacedStandards/copyrights；库/根/封面优先级在模型契约记录 | 已实现内部表达与保存契约；不凭编号部件猜完整编号 |
| 多语言 TBX、多组/变体/描述符、定义/注/例/来源及引用 | languageSets/groups/terms/descriptors 与生产 TBX 节点；词性、采用、类型、领域、来源是显式 kind/value | 已实现项目作者模型；不从中英文名称伪造描述符，也不宣称已通过正式 TBX 校验 |
| 原生 MathML、LaTeX、行内/行间、公式注/式中/引用 | `IRFormula/IRInlineFormula`、`FormulaInline/FormulaNote/WhereList`、双向映射与 `wp6Roundtrip.test.ts` | 原文和可用编辑源保留；MathML 不强制反译。全部原生 MathML 的数学视觉显示及打印交付尚未完成 |
| 表格类型/跨度/单位/注脚注/样式宽度方向、图组说明资源 | typed table/row/cell、figure descriptions/groups 与独立 `IRDoc.resources`；逐属性 `wp6Projection.test.ts` 与生产 HTML 回读 | 已实现内部表达；本轮补修复制粘贴时资源负载丢失；XML+资源包归 WP8 |
| 样式/变量/警告/引文/代码、类型化文献/外链、术语引用、索引 | semantic nodes/marks、IR typed fields、索引目标/参见；生产 fixture 和两向往返 | 已实现内部表达，原来会降级丢失的内容改为保留类型或明确拒绝 |
| 稳定内部 ID、Resolver 引用及统一标签、外部 ID 同时映射定义和引用 | `externalIds.ts`、Resolver、编辑器 Decoration、大纲/版本文本/JSON 共用 labels；Resolver/external-ID tests | 已实现项目约定；本轮修复扩展字段引用顺序。正式 XML ID 词法留 WP8.1 |
| 生产 Schema → PM → IR → PM → 保存重开；明确版本与非法结构诊断 | `createEditorExtensions`、`irToPm/pmToIr`、`wp6Projection/wp6Roundtrip/wp6Labels`；实际根属性加载入口 `replaceEditorDocument`；extensionVersion 1 | 自动回归覆盖生产结构和加载。SQLite/浏览器真实冷重开证据来自 2026-10-05，本轮未重复，不以本轮单测冒充冷重开 |
| 盘点 XML 入口与 XML 依赖存储，只读盘点旧存量 | `wp6-storage-xml-inventory.md`、EditorView/VersionPanel/serializer 与 Document/Version entity | 已盘点；主数据库历史统计注明日期，目标部署切换前须重新盘点。旧 XML 路径未统一切换，这是 WP8.4 工作 |
| 新信息在输出边界保持或明确报告 | `outputBoundary.ts`、DOCX/HTML/XML 真实入口、错误显示和源码复制/下载保护 | 已实现诊断边界；拒绝输出不是新增排版支持。DOCX/HTML 既有提出/归口设置的回归已纠正，详见下节 |

表内路径相对 `packages/`，文档路径相对仓库根。字段、默认值及 PM 来源的完整清单见 [模型契约](wp6-model-contract.md)；历史与本轮验证分别见 [验收记录](wp6-validation.md)。

## 审计发现与纠正

上一轮 `2fc726e7` 为避免丢信息，把非空 `proposer/technicalCommittee` 在所有出口都阻断。它们属于既有文件设置，这会使原来正常使用的新建/复制稿不能输出 DOCX。只修改测试接受阻断，不能作为“既有文档输出未受影响”的证据。

本轮 DOCX 实际生成 `docProps/custom.xml`，通过包根 relationship 和 content-type 注册两个 `ses-*` 自定义属性；HTML 在 head 中生成对应 meta。解除阻断仅适用于这两种已实际消费字段的出口；JSON、正文和人工编辑的前言不改写。测试从生产 DOCX ZIP 解包后用 XML parser 读取字段，并覆盖库设置、嵌入元数据、新建、复制、特殊字符和多行内容。不凭前言中恰好出现同名文字推断 metadata 已消费。

旧 XML 仍不消费这些新进入 IR 的字段，继续明确阻断，避免为了 WP6 扩展旧交换格式。含这些字段的旧 XML 导出可用性改变已明确披露；它不等于新国标 XML 已完成。

## 尚未完成与实际影响

- 新国标 XML 双向转换、固定 DTD/XSD、正式 ID/原文约定、唯一 XML 菜单与旧实现删除、配套资源包、独立互操作均属于 WP8，当前没有实现。
- 新元数据/TBX/MathML/图组/资源/完整样式/索引等的 DOCX/HTML 完整输出仍未实现，非空未消费字段返回 unsupported-output。某些旧生产属性（如表格 colwidth）现在会进入保真 IR，因此对应旧稿也可能被输出边界阻断；不能将旧 byte golden 的 JSON 通过解释成所有旧打印工作流无变化。
- DOCX 自定义属性保留 metadata；HTML meta 保留 metadata。它们不自动生成责任语句，不代表 PDF 文件能保留这些结构化元数据，也不代表新字段已获得正文排版能力。
- 新增节点已进入生产 Schema 并能加载/保存，但完整的新增要素插入、属性编辑面板和所有 MathML 数学显示未逐项验收。后续必要交互补齐仍须按 WP6/WP8 责任清单跟踪，不能以“JSON 存得住”宣称整个编辑器产品交付完成。
- 原生 IR 的部分结构（例如 note/example 的独立段落 ID、罗马列项、带 marks 的纯字符串 carrier）无法无损投影时明确拒绝，不能冒充已支持。WP8 映射须遵守已记录的生产契约或继续补齐 Schema。
- VersionPanel 仍保留一般 XML 失败后存 JSON 快照的旧 fallback（脚注错误除外）；WP8.4 必须统一修改。普通正文 JSON 保存和 JSON 回滚不依赖 XML。
- 本轮没有重做真实浏览器、SQLite 冷重开或 Microsoft Word 打开验收；DOCX 变更的证据是生产导出 ZIP、属性 XML 与关联注册测试。没有把这类证据升级为真实稿件或排版验收。

因此，按调整后的 WP6 开发方向和内部模型要求可以继续审阅；将本 PR 宣称为“全部新要素已完成编辑/打印/新 XML 交付”不成立。最终合并尚未执行。


## 后续复审跟进（2026-10-06）

`a3adb2af` 的题名标签污染和自由公式说明富文本丢失已修复，并检查相邻 metadata/TBX/bibliography/index 内容槽与通用 p/a 规则冲突、文本属性自动转型。完整生产 HTML 文本往返与 Schema 投影证据见 [最新验收记录](wp6-validation.md)。本轮1227项回归通过；上述未完成范围仍适用，不因此宣称新增交互、打印或新XML交付已经完成。


## 前一轮复审跟进（2026-10-07，review 5441631826）

PR #45 前一轮 Codex review ID `5441631826` 针对审阅提交 `c24181ca77fa77bdb73923d26f498bed265bf7b3`（北京时间 2026-10-07 19:31）指出公式源行内格式可能在 HTML、DOCX 和 legacy XML 输出时被静默丢弃。复核按三层边界补齐：IR allowlist 与实际 renderer 消费保持一致；生产 Schema 的 HTML 解析/序列化保留作者模型类型及表脚注语义；编辑器加载、保存、恢复和 clipboard 路径在不能保真时保持 dirty、返回诊断或拒绝事务。具体复现、代码入口和上一轮 1,331 项回归证据见[上一轮验收记录](wp6-validation.md#c24181ca-复审修复验收2026-10-07)。

复审覆盖 PR 改动的 JSON/IR 渲染、HTML/DOCX/legacy XML 生产出口及其相邻编辑器入口，不是全仓库无缺陷证明。legacy XML 的本轮改动只增加经验证的精确阻断，不扩展其映射；GB/T 46687.2 新 XML、正式互操作、Word 排版和真实标准稿件仍按 WP8/后续验收处理。验证对象为基于 `c24181ca` 的本轮修复；最终提交与远端状态以 PR 记录核验。本记录不表示新一轮 Codex 审查已批准或 PR 已合并。

## 2026-10-08 typed-reference 出口复核

review `5443480187`（comment `4207853177`，提交于北京时间 2026-10-07 22:02:30）指出：已有 Resolver `dangling-typed-ref` 的错误类型引用仍可绕过 allowlist 进入 HTML/DOCX。此轮将唯一已确认的 Resolver 错误代码接入 HTML、DOCX、legacy XML 共享非 JSON 输出边界，PDF 经 HTML 出口同样受保护；既有 EditorView 菜单与源码入口显示原始诊断并避免错误格式复制/下载。JSON semantic/raw 继续保留原作者数据，没有新增操作面板。

该变更是 WP6 内部作者模型和输出错误边界收紧，不修改 Resolver 目标类型规则、不统一阻断 Resolver 其他 warnings/errors、不改变 legacy XML schema/映射。VersionPanel 现有 JSON-only snapshot fallback 保留。旧 XML 实现移除与新国标 XML 统一切换归 WP8，不重建旧转换器；正式互操作、Word 排版仍属于 WP8 或相应人工验收，不因本轮自动测试通过而视为完成。验证范围及 1,339 项总计见[验收记录](wp6-validation.md#72e127b5-typed-reference-输出边界复审-2026-10-08)。该 review 修复未宣称已获下一轮 Codex 批准。

## 2026-10-08 公式注（IRFormulaNote）与无类型引用复审（review 5450144611）

针对复审提交 `2fa9787240634a022dab33ce5ffd61d793babd04` 的 P2 `4213525717`，修复边界仍属于 WP6 内部作者模型与既有 Resolver：公式注没有独立 kind 字段，因此在遍历公式注时登记已有 `note.id` 的类型，不新增 ID/序号/label 算法，也不把 JSON 保真误认为打印支持。对不存在的目标保留 dangling-xref；非空公式注在当前 HTML/DOCX/legacy XML 中仍不被消费，继续精确阻断。

同一审查补齐 IR→PM 属性 carrier：未声明 `targetKind` 的 IR crossRef 显式投影为空 `refType`，使生产 Schema 不会静默补成 chapter；旧 PM 缺省属性的 chapter 默认保持。生产Schema重开、typed/untyped labels/source 保真和实际图目标 HTML/DOCX 输出均有回归。PM 显式非字符串 refType 单独诊断；semantic JSON 只为 `crossRef.refType:null` 保留纠错值，原有其他 null 过滤及 goldens 保持。

打印 full fixture helper 已迁到 renderer 测试目录，恢复被 client JSON 源 SHA 锁定的通用 fixture 文件（恢复 SHA `cc6b19157952576cb3ec69dc15a124dfbc6851901c227605758425bb0aef531d`）。冻结后统一验收 shared 46 files/958 tests、client 51 passed+1 skipped/376 passed+1 opt-in skipped、server 23 tests，合计 1,357 项通过；具体日志与限制见[本轮最终验收](wp6-validation.md#2fa97872-公式注与无类型引用复审2026-10-08)。fixture SHA 消费者重跑未改变 manifest、snapshot 或 golden。该复审不扩展 WP8、Word 排版或 MathML 打印，也不表示获得 Codex 批准。


## 最新 StandardDoc 根类型复审（2026-10-08，review 5450305128）

Codex review 5450305128 针对审阅提交 e39101daab853a4a926fdc00ff0d4f1d022ca3bb 提出一项 P2（[comment 4213672349](https://github.com/funtasy2333/SEP/pull/45#discussion_r4213672349)，北京时间 2026-10-08 09:21:44）：当 IR 标准类型不是 gb 时，irToPm 只在 coverPage 写入映射值，而生产 StandardDoc 根 schema 默认补 national；pmToIr 又优先读取根属性，因而重开时会把行业、地方、团体、企业或指导性技术文件类型改成国家标准。

修复沿用既有 metaToCover 类型映射，仅在 rootType 为 standardDoc 时将同一 standardType 写入根 attrs 与 coverPage：gb→national、industry→industry、local→local、group→group、enterprise→enterprise、guide→guidance。PM schema 默认、pmToIr 根优先规则和默认 doc 根分支都不变；普通 doc 仍由 coverPage 表达标准类型。相邻检查未发现同一投影路径中另有非空值被默认覆盖，缺失值和空字符串继续按现有归一化规则处理；本轮不声称字节级相等或重新定义空值契约。

验证使用真实 StandardDoc topNode schema，覆盖原始 PM JSON reload 与 exportSemanticJson 后再次 schema reload，并检查 root/cover 类型、非空元数据、extensionVersion、typed crossRef 及源 IR 不变。最终冻结验收与未覆盖的正式 XML、Word、浏览器和 SQLite 检查见[最新验收记录](wp6-validation.md#e39101da-standarddoc-根类型复审)。本修复仍属于 WP6 的作者模型投影，不改变 WP8 边界。
