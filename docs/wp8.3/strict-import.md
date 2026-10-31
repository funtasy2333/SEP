# WP8.3 严格导入：13 个历史 export 负例

状态：**已落实到 TS 运行时、Python 导入档、约定及测试的项目契约**。用户要求“不区分”，随后明确“全部 valid 可导入优先，扩模型接收这些结构”。以下是统一、与文件名无关的语义规则；它收紧 WP8.1 既有 import 约定，不意味着原标准将所有这些限制规定为强制。警告码相同不等于上下文与顺序相同；本方案在当前 9 valid 和 13 项历史 import 宽容负例上区分。规范性 ref 缺 id 与参考文献 ref 缺 id 也须分上下文，不能全局套用。2026-10-31 用户另确认 ID 不透明：两个仅改变合法 ID 的导出负例在导入档接受，不引入按文件名判断的产品规则。

## 一致规则及影响

下列每条在 XML 解析、namespace 和旧格式检查之后、资源解析/PM 转换之前执行；严重度均为 error，包含中文消息、行列与路径。13 个错误码是稳定专码候选，P1 为问题码唯一 owner 并定稿；原 V 规则可作为 issue 的 `rule` 和矩阵依据保留。必须要求实际输入结构与值匹配规则，**不得使用样例路径、文件名或任意字段组合给夹具开例外**。缺少必需图片是独立 error，所有样例分类测试均注入有效完整、确定性资源，不能用缺图冒充格式拒绝。

| 编号 / 负例 | 上下文统一规则；对应建议错误码 | 9 valid 命中 | 旧 import 变化和依据 |
|---|---|---|---|
| R1 `app-without-annex-type.xml` | 每个 `app` 必有直接子元素 `annex-type`；缺失报 `xml-annex-type-required`。附录性质异写仍照 C-S-07 识别、规范化；`annex-type` 与 content-type 冲突依既有约定另判。 | 无 | V-17 原 warning 改 error；4.5.2.1（印刷页 11）、M-4.5.2-04、C-S-07。 |
| R2 `custom-xref-no-type.xml` | `xref[@ref-type=custom]` 必须有非空 `custom-type`，只收既定 term-entry/note/example 且与目标类型一致；缺失 `xml-xref-custom-type-required`。目标 id 仍不透明。 | 无 | V-8 原按目标推断并 warning，改缺失 error；10.1.1（印刷页 45）、C-T-48/50，原文对该属性有“可选”措辞，本条为项目严格约定。 |
| R3 `ext-link-without-type.xml` | `ext-link` 必须有 `ext-link-type="uri"`；缺失或其他值 `xml-ext-link-type-invalid`，同时保留 V-11 URI 安全检查。 | 无 | V-17 原缺失不报告、其他值 warning，改 error；10.1.9（印刷页 48）、M-10.1.9-01、C-T-56。原文示例缺此属性也将被此项目严格口径拒绝，须明确记作兼容性收窄。 |
| R4 `mathml-display-inline-in-disp-formula.xml` | `disp-formula` 的直接 `mml:math` 若写 display 必须为 `block`；`inline-formula` 的直接 `mml:math` 不得有 display；反向或其他值报 `xml-math-display-invalid`。行间未写仍接受：7.1/7.3 示例允许缺省。按 URI 判断 MathML，不按前缀。 | 无 | V-15 原反向值 warning，改 error；7.4（印刷页 28–29）、C-T-19/21。 |
| R5 `mathml-id-missing.xml` | 每个作为公式直接子元素的 `mml:math` 须有非空、XML 合法且文档唯一的 id；缺失 `xml-math-id-required`，合法但非 `mml_m<k>` 的 id 仍作不透明键，重新导出派生，不校验语义前缀或序号。 | 无 | V-14 原缺失 warning 改 error；M-7.4-02/M-7.1-05、C-T-18；不把 export 的固定 id 格式当 import 规则。 |
| R6 `missing-app-id.xml` | `app` 须有非空合法唯一 id，缺失 `xml-app-id-required`；值不解析语义。 | 无 | V-13 原 warning 改 error；附录 E 印刷页 67、M-E-04。 |
| R7 `missing-ref-id.xml` | 仅 `ref-list[@content-type=bibl or bibr]` 的直接 `ref` 必须有非空合法唯一 id；缺失 `xml-bibl-ref-id-required`。规范性 `ref-list[norm-refs|norm_refs]/ref` 不强制 id。 | 无；03 与 07 的规范性 ref 无 id，**允许** | V-13 对 bibl/ref 原 warning 改 error；4.5.3.1 印刷页 12、M-4.5.3.1-01；不会误拒 valid/07 第 29 行。 |
| R8 `missing-term-entry-id.xml` | 每个 TBX URI 的 `termEntry` 须有非空合法唯一 id；缺失 `xml-term-id-required`，不按 XML id 猜内部编号。 | 无 | V-13 原 warning 改 error；9.2.1 印刷页 35、M-9.2.1-05。 |
| R9 `p-with-id.xml` | 无命名空间 `p` 不得有无命名空间 `id`；出现则 `xml-paragraph-id-forbidden`，不先忽略再导入。其他 id/rid 不改变。 | 无 | V-18 原忽略并 warning 改 error；附录 E 印刷页 67、M-E-25。 |
| R10 `sec-without-label.xml` | `body` 或 `app` 后代中无命名空间 `sec` 必须有直接 `label`，且其 string-value 非空白；缺失/空值 `xml-section-label-required`。`front` 的 foreword/intro 及其子条不套此规则；前置引言条是否有 label 由既有引言规则处理。无标题条仍允许（合法 label 不等于 title）。 | 无 | V-17 原缺 label warning 改 error；4.4.2.1 印刷页 8、M-4.4.2.1-02。该规则不拒绝 valid/07 中有 label、无 title/numbered-paragraph 的 4.4.2.1 异写。 |
| R11 `std-meta-wrong-order.xml` | 每个 `std-meta` 的子元素序列必须符合下节 A 或 B 的非降序；其他已允许值、可选缺项及重复策略按既有约定，顺序违规 `xml-meta-order-invalid`。B 接受已确认的 4.1 `ics/ccs` 在 title-wrap 前；不因 V-12 码将其误拒。 | 无；07 用 B | V-12 原所有乱序 warning，改为仅 A/B 接受、B 可 warning 规范化，其他 error；C-S-11 / 4.1 印刷页 2–4。这是项目收窄，不是原文规定了所有字段的必定顺序。 |
| R12 `table-wrap-without-label.xml` | 每个 `table-wrap` 必须有直接非空 `label`，缺失 `xml-table-label-required`；缺 caption/title 不由此拒绝，仍允许空表题 `IRTable.caption=[]`。 | 无 | V-17 原缺 label warning 改 error；6.2.1 印刷页 20、M-6.2.1-03；可能收窄原文附录 E 无编号/无标题表的进口兼容性，不能误写成“空表题无法保存”。 |
| R13 `term-entry-without-definition.xml` | 每个 TBX URI 的 `termEntry` 在其各 `langSet` 内汇总 `definition` 必须恰好一个，零个或多个 `xml-term-definition-count`；不得将空定义伪造为正文。 | 无 | V-9 零定义原 `W-TERM-NODEF` 改 error，多个继续 error；9.2.2 与附录 C 行 92（印刷页 35、61），M-9.2.2-01。 |

所有 XML id 的合法性/唯一性继续由 V-1 检查，R5–R8 只是针对缺失的上下文要求，**不按 XML id 推断 NodeId**。R10 只针对 body/app 内章条，不针对前言/引言容器、术语 `term-sec` 或无编号 array；多目标 rid、旧格式、安全实体等既有拒绝不变。对上述规则之外的导入宽容项，不能据此扩大拒绝集。

## std-meta 次序算法

A 是 `scripts/xml46687/validate.py:712` 的 `STD_META_EXPORT_ORDER`，同秩 `std-org`/`std-org-group`：

`std-type → title-wrap → proj-id → release-version → std-ident → std-org|std-org-group → content-language → std-ref → doc-ref → release-date → implementation-date → equivalence → comm-ref → secretariat → ics → ccs → page-count → std-supersedes → std-xref → permissions → custom-meta-group`。

B 在 A 的顺序中只将 `ics → ccs` 这两组移至 `title-wrap` 前、`std-type` 后，其余相对次序与 A 一致。对实际出现的已知、无命名空间子元素取秩，允许可选项缺失、同秩重复时非降序；若未知子元素则交内容模型报错，不能在此忽略。分别计算 A 与 B，任一非降序接受；仅 B 非降序时保留规范化 warning。`valid/07-import-variants.xml:15-21` 是 `ics, ccs, title-wrap, release-date, release-date`，符合 B；`invalid/std-meta-wrong-order.xml:18-19` 的 `release-date` 在 `content-language` 前，A/B 都不允许。B 是项目对 4.1 示例（印刷页 2–3）的具体实现约束，不能把它包装成标准对所有元数据字段的完整规定。

## 只读样例扫描证据

本次对基线 9 个 `valid/*.xml` 和 13 个目标 `invalid/*.xml` 用 lxml 解析，逐节点执行上述上下文谓词（包含两种次序），并独立扫描 4 份黄金 XML；没有调用 io、生产 Schema 或真实导入器，不是运行时实现通过证明。每项结果如下，“0”仅表示这 13 个谓词均未命中，不代表其他结构或资源已经可导入。

| valid 样例 | 13 个谓词命中 |
|---|---|
| 01-minimal.xml | 0 |
| 02-full-metadata.xml | 0 |
| 03-structure.xml | 0 |
| 04-tables.xml | 0 |
| 05-formulas-figures.xml | 0 |
| 06-terms-references.xml | 0 |
| 07-import-variants.xml | 0；次序符合 B，norm_refs 的 ref 无 id 被允许 |
| 08-original-forms-vs-sts.xml | 0 |
| 09-import-pending.xml | 0 |

13 个目标负例分别命中 R1–R13 的对应单条，实际节点行依次为 108、24、32、81、81、108、117、39、112、85、9、54、39；每个都未命中其余 12 条。原始四 golden `wp82`、`fullRenderer`、`wp8m`、`wp6` 也均为 0 命中。该证据说明这组规则**可以在现有样例上区分**，不能推出对所有第三方文件的兼容性或互操作通过；严格规则可能拒绝现有约定以前接受的第三方文件。

## 测试与资产同步（实现阶段）

- `scripts/xml46687/test_validate.py:152-168` 的 13 个 export-only 档案和相关 import warning 断言须逐项改为上述 error，同时保留 export 档错误、目标语义定位及非本规则的反例。重点复核 V-12 测试 `:573-621`、V-13 `:662-772`、custom-type `:800` 附近、V-14/15 `:1623-1720`、V-17/18 `:1724-1883`；不能删除或跳过原测试，以更强真实拒绝替换旧口径。
- `schemas/gbt46687.2/README.md` 的 V-8/V-9/V-12～15/V-17/V-18 说明及 `docs/wp8.1/conventions-S.md`、`conventions-T.md` 对应导入规则同步，保留原文依据和“项目严格约定”的差别；不要改 13 个 XML 样例内容。RELAX NG 原有可选结构是否继续留给语义校验由 P8 决定，TS 与 Python 必须同一口径。
- 为 A、B 两顺序各写实际通过测试；对 B 外的 `release-date`/`content-language` 逆序写真正失败测试，并用 valid/07 整份文档守护。针对 bibl/ref 与 norm-refs/ref 缺 id 建配对测试。每条规则覆盖空值、错误上下文、合法对应值及行列，图相关样例使用完整资源；另外测试缺资源独立 error。
- 实现代理先将严格策略与有效样例扩模型的契约集成；按本契约同步实施任务书、Python 和既有约定；本轮设计文档已更新；TS 生产导入、Python import profile、相关文档和测试一次性按统一口径收尾。四 golden 和全部 valid 必须与这些规则一起回归；9 valid 仅是项目自写样例，真实样稿与互操作仍未验证。
