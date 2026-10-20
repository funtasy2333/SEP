# WP8.1 约定表（代理 S 分片）：GB/T 46687.2—2026 前言、第 1～5 章、附录 C～G

范围：前言、第 1～3 章、第 4 章（文档结构）、第 5 章（条文内容）、附录 E（ID 方案）、附录 F（标签名称比较）、附录 G（元数据实例），以及附录 C/D 中与上述章节相关的标签和属性（查漏）。第 6～10 章（表、公式、图、术语、引用/脚注）由代理 T 负责；本分片遇到时只记一行并写“详见 T”。

原文来源、页码换算见 `source-record.md`。逐元素/属性的支持矩阵见 `matrix-S.json`。

## 0. 读法与记号

- 页码写作“印刷页/PDF 页”，例如 `6/10` 表示印刷页 6、PDF 第 10 页。印刷页 = PDF 页 − 4（前置页除外）。
- “性质”只有两种：**原文明确**（原文条文或附录给出的结论）、**项目实现约定**（原文自相矛盾、没有规定或只有示例，由本项目选定一种固定做法）。后者不是官方勘误，也没有取得权威澄清。
- 原文措辞：`应`、`宜`、`可`、`通常` 照原文记录；祈使句没有情态词时写“祈使陈述”，`matrix-S.json` 中记为 `shall` 并在 notes 注明。本标准是指南，全文几乎没有“应”字。第 4～5 章的示例框（“示例：…标记为：…”）属示例，**不是规范性要求**，但可作为结构依据，并已注明。
- “导入接受范围”只列**本标准内确认出现**的写法；同一标准内出现的异写可以接受并规范化，没有出现过的写法一律拒绝。导入时的所有拒绝都要给出元素位置和原因，不得用猜测值替代。
- 旁证材料（`rules/guidelines_for_coding_iec_and_iso_standards_in_nisosts_ed.2.1.pdf`，即本标准修改采用的 IEC/ISO 编码指南 2.1 版，下称“ISO 源指南”）只用于佐证，标注为“旁证”，与 GB 原文冲突时以 GB 原文为准。
- 内部 `NodeId` 与导出 `xmlId` 严格分开：导出的 `id` 由 Resolver 派生；导入的 `id`/`rid` 只作为 XML 内部的关联键，**不据其字面值判断元素类型**（见第 2 节）。

## 1. 约定表

### 1.1 整体结构与处理信息

| 编号 | 问题 | 原文条款/印刷页（PDF页） | 原文各处写法（逐处列出） | 选用形式 | 依据 | 导出规则 | 导入接受范围 | 性质 |
|---|---|---|---|---|---|---|---|---|
| C-S-01 | 整体骨架与根元素 | 4.1 2–4/6–8；4.3.1 5/9；4.5.1 11/15；表 C.1 行 71 60/64；表 F.1 行 1 69/73 | 4.1：“完整的标准文档内容**宜**在根标签 `<standard>` 中标记”；示例骨架：`standard` → `front`（`std-meta`、`sec[@sec-type=foreword]`、`sec[@sec-type=intro]`）、`body`（`sec`…）、`back`（`app-group/app`、`ref-list`）。4.3.1：front 可含标准元数据、前言、引言。4.5.1：“后置页是可选的”。F.1 行 1：本文件根元素为 `standard`（GB/T 37967 为 `basic_info`）。4.5.3.1（12/16）称参考文献“通常是后置页中的最后一个元素”，4.5.4（13/17）称索引“位置在参考文献之后”。 | 根 `<standard>`；子元素顺序：`processing-meta`（见 C-S-04）→ `front` → `body` → `back`。front 内顺序：`std-meta` → 前言 `sec` → 引言 `sec`。back 内顺序：`app-group` → 参考文献 `ref-list` → `index`。没有附录、参考文献、索引时省略整个 `back`。 | 4.1 示例、4.3.1、4.5.1、4.5.4 | 按左栏输出；不输出任何 `basic_info/content/edit/execute`。 | 根元素必须是无命名空间的 `standard`；`front` 内允许缺 `std-meta` 以外内容，`body` 必须有至少一个章（生产 Schema `chapter+`）；`back` 可缺；`index` 位于参考文献之后以外的顺序不接受（原文只出现这一种顺序），拒绝并定位。 | 骨架：原文明确（示例）；`index` 与 `ref-list` 的先后、`processing-meta` 位置：项目实现约定 |
| C-S-02 | XML 声明、编码、DOCTYPE | 4.1 2/6；3.2 缩略语 2/6；5.4 15/19 | 4.1 示例：`<?xml version="1.0" encoding="utf-8"?>`；`<!DOCTYPE standard SYSTEM "NISO-STS-extended-1-mathml2.dtd">`。3.2 列有“UTF-8”。5.4：“特定符号使用 UTF-8 中相应的实体进行编码”。 | 声明 `<?xml version="1.0" encoding="utf-8"?>`（按示例）；**不输出 DOCTYPE**。 | 4.1 正文只对根标签 `standard` 用“宜”，DOCTYPE 仅在示例行内；示例文件名（extended / mathml2）与 `processing-meta` 示例（interchange / 3.0）冲突，见第 3 节；原文没有提供该 DTD 文件。 | 见左栏；字符一律直接用 UTF-8 输出，只转义 `&` `<` `>`（属性内另转义 `"`），不使用命名实体（见 C-S-34）。 | 接受 `<!DOCTYPE standard …>` 声明本身，但解析器**不读取外部子集、不展开外部实体、不联网**；DOCTYPE 含内部子集或实体声明 → 拒绝；编码声明不是 UTF-8（例如 37967 示例的 GB2312）→ 拒绝并说明。 | 声明：原文明确；不输出 DOCTYPE：项目实现约定 |
| C-S-03 | 命名空间声明 | 4.1 2/6；表 C.1 行 54 59/63；4.3.2 示例 2 6/10 | 根上声明 `xmlns:xlink="http://www.w3.org/1999/xlink"`、`xmlns:mml="http://www.w3.org/1998/Math/MathML"`、`xmlns:tbx="urn:iso:std:iso:30042:ed-1"`；没有默认命名空间。属性/元素中还用到 `xml:lang`、`xlink:href`、`xlink:type`、`mml:` 与 `tbx:` 前缀。C 行 54 给出 MathML3、MathML2 两个规范 URL。 | 根上只声明上述三个，前缀固定为 `xlink`、`mml`、`tbx`；NISO STS 元素不属于任何命名空间。 | 4.1 示例（ISO 源指南另声明 `xi`、`xsi`，本标准未给出，不写） | 三个声明始终输出（稳定输出，便于往返）。 | 按命名空间 **URI** 识别 `tbx`/`mml`/`xlink`，前缀名可不同；默认命名空间非空（如 `urn:csbts:std:xml:1.0`）→ 拒绝；使用了未声明的前缀 → XML 格式错误；MathML 命名空间下的内容按 C-S-04 的 `mathml-version` 处理（详见 T 的第 7 章分片）。 | 声明：原文明确（示例）；“只声明这三个”：项目实现约定 |
| C-S-04 | `processing-meta`：位置、属性、内容 | 4.3.2 6/10；4.1 骨架 2–4/6–8；表 C.1 行 63 60/64 | 4.3.2：与 XML 标签集处理相关的信息**宜**用 `<processing-meta>` 标记，“直接置于 `<standard>` 标签下”；属性指明标签集（如 interchange）、公式表示工具版本（如 3.0）、表格模型（如 XHTML）、术语模型（如 TBX）、公式表示方式（如 MathML）、标签集族（如 STS）。示例 2：`<standard> …… <processing-meta base-tagset="interchange" mathml-version="3.0" table-model="xhtml" terminology-model="tbx" math-representation="mathml" tagset-family="sts"><custom-meta-group><custom-meta><meta-name>基于XML的标准文档内容标记指南</meta-name><meta-value>2025</meta-value></custom-meta></custom-meta-group></processing-meta></standard>`（“……”在它之前）。4.1 整体骨架**没有** `processing-meta`。旁证：ISO 源指南把它作为 `standard` 的**第一个**子元素，位于 `front` 前，且说明“没有 processing-meta 时视为按 ed.1.11 标记”。 | `standard` 的第一个子元素；六个属性取示例值（`base-tagset="interchange"` `mathml-version="3.0"` `table-model="xhtml"` `terminology-model="tbx"` `math-representation="mathml"` `tagset-family="sts"`）；内含一个 `custom-meta`：`meta-name`=基于XML的标准文档内容标记指南，`meta-value`=2026。 | 属性值：示例 2 与 ISO 源指南一致，并与附录 C/D 引用的 Tag Library 1.2 相符；`meta-value` 示例为 2025（对应征求意见稿时点），本标准正式号为 2026，故取 2026（需用户确认，见 D-S-02） | 见左栏。`processing-meta` 不属于标准内容，不进入 IR。 | `processing-meta` 可缺；若有：`tagset-family`≠sts、`table-model`≠xhtml、`terminology-model`≠tbx、`math-representation`≠mathml → 拒绝；`mathml-version` 接受 3.0（也接受 C 行 54 同时出现的 2.0，并告警）；`base-tagset` 取 interchange；其他值（原文只在 DOCTYPE 文件名中出现过 extended）→ 告警，由结构校验结果决定是否通过；其内的 `custom-meta` 只做记录，不影响文档内容。 | 六个属性：原文明确（示例）；位置、`meta-value`：项目实现约定 |
| C-S-05 | 不在 XML 中标记的前置页内容 | 4.1 4/8；4.3.2 5/9 | “以下前置页内容不在 XML 中标记：封面；目次；含有文件名称、页码等的页眉和页脚。”注 2：“封面中除格式外的信息记录在标准元数据（`<std-meta>`）中。” | 封面信息只通过 `std-meta` 表达；不输出目次、页眉页脚。 | 4.1 | 目次、页眉页脚不导出（它们不在 IR，也不是内容）。 | 没有对应元素；出现 `toc`、`cover` 一类未知元素 → 按未知元素拒绝。 | 原文明确 |

### 1.2 章的类型、附录性质、无标题条、前言与引言

| 编号 | 问题 | 原文条款/印刷页（PDF页） | 原文各处写法（逐处列出） | 选用形式 | 依据 | 导出规则 | 导入接受范围 | 性质 |
|---|---|---|---|---|---|---|---|---|
| C-S-06 | 章角色 `sec-type` 取值（scope / norm-refs / terms / foreword / intro） | 4.2 4–5/8–9；表 1 5/9；4.3.3 7/11；4.3.4 7–8/11–12；4.4.2.2 9/13；4.4.2.3.1 9–10/13–14；4.4.2.4 10–11/14–15；表 D.1 行 13 65/69 | 文字：前置页 `foreword`、`intro`；正文 `scope`、`norm-refs`、`terms`（4.2 4/8；表 1 5/9）。**连字符**：4.1 骨架 `sec-type="norm-refs"`（3/7）、4.2 文字与表 1、4.4.2.3.1 “`@sec-type="norm-refs"`”（9/13）、4.4.2.3.2 文字“`@content-type` 属性值为 "norm-refs"”（10/14）。**下划线**：仅 4.4.2.3.2 的“标记为”示例：`<sec id="sec_2" sec-type="norm_refs">` 与 `<ref-list content-type="norm_refs">`（10/14）。D 行 13：`sec-type` “可以采用任何值”。 | `foreword`、`intro`、`scope`、`norm-refs`（连字符）、`terms`；其他章不写 `sec-type`。`sec-type` 只在对应位置识别：front 内识别 foreword/intro，body 顶层 sec 内识别 scope/norm-refs/terms。 | 连字符形式在 5 处文字/表/示例一致出现，下划线仅在 1 个示例的 2 个位置；ISO 源指南亦为 `norm-refs`（旁证） | `IRChapter.secType`：scope→`scope`，norm-refs→`norm-refs`，terms→`terms`，general→不写。 | 接受 `norm_refs`（同一标准 10/14 示例确认），规范化为 norm-refs 并给出“异写已规范化”提示；其他未知取值 → 按 general 处理并告警（原文 D 称可取任意值，但 IR 无处保存，不得静默丢弃）。 | 取值：原文明确；异写处理：项目实现约定 |
| C-S-07 | 附录性质：`<annex-type>` 文本与 `<app>` 的 `content-type` | 4.1 4/8；4.2 4–5/8–9；表 1 5/9；4.5.2.1 11/15；4.5.2.2 12/16；表 D.1 行 3 64/68 | ① 4.1 骨架（4/8）：`<app content-type="inform-annex" id="sec_A">`。② 4.5.2.2 示例（12/16）：`<app content-type="inform_annex" id="sec_A">`。③ 4.2 文字：后置页 `@content-type` 的值“可为 informative、normative 或 bibl”（4/8）；表 1：“informative 或 normative”（5/9）；4.5.2.1：“可为 "informative" 或 "normative"”（11/15）。`<annex-type>`：骨架与示例均为 `<annex-type>（资料性）</annex-type>`（4/8、12/16），无规范性附录示例。D 行 3：`content-type` 属性值只列 bibl、index。ISO 源指南用 `informative`（旁证）。 | `content-type="informative"` / `"normative"`；`<label>附录 A</label><annex-type>（资料性）</annex-type><title>…</title>` 依次排列；annex-type 文本为“（资料性）”/“（规范性）”。 | 三处文字/表一致 + ISO 源指南；两种 `inform-*` 写法各只在一个示例出现。全角/半角括号在扫描图中字形难辨，**未核实**，取 GB/T 1.1 的附录性质写法 | `IRAppendix.normative` → `content-type`；`<label>` 文本 =“附录”+半角空格+字母（与 4/8、12/16、E.1 的“附录 A”一致，字母由 Resolver 给出）；annex-type 与 content-type 同步。 | 接受 `informative`、`normative`；接受 `inform-annex`、`inform_annex`（同一标准 4/8、12/16 确认）并规范化为 informative；规范性附录的异写（原文未出现）不接受，拒绝并定位；annex-type 文本与 content-type 矛盾时以 content-type 为准并告警。`<label>` 文本不作数据，附录字母由 Resolver 重新派生。 | 取值：原文明确；异写接受、label 空格：项目实现约定 |
| C-S-08 | 无标题条（`numbered-paragraph`） | 4.4.2.5 11/15；4.4.2.1 示例 8–9/12–13 | 4.4.2.5：无标题条用 `<sec>` 标记，“不包含 `<title>` 标签”；“**宜**按以下方式标记 `<sec>` 的属性：`@sec-type="numbered-paragraph"`”；示例 `<sec sec-type="numbered-paragraph" id="sec_6.3.4.1"><label>6.3.4.1</label><p>…</p></sec>`。4.4.2.1 示例中的 5.1.1/5.1.2/5.1.3（无标题）写作 `<sec id="sec_5.1.1"><label>5.1.1</label><p>…</p></sec>`，**没有** `sec-type`（9/13）。ISO 源指南同 4.4.2.5，并说明旧文件可能没有该属性（旁证）。 | 无标题条 =`<sec sec-type="numbered-paragraph" id="sec_<编号>">`，含 `<label>`，含 `<p>`，不含 `<title>`。 | 4.4.2.5 | `IRClause.titled=false` → 左栏；子块照常放入。 | 凡 `<sec>` 缺少 `<title>` → 无标题条（带不带 `sec-type` 均可，两种写法都在本标准内出现）；`sec-type="numbered-paragraph"` 但又有 `<title>` → 拒绝（自相矛盾）。旧 SEP 的 `content-type="untitled"` 不接受（见第 6 节）。 | 原文明确（“宜”）；导入宽容：项目实现约定（依据 4.4.2.1 示例） |
| C-S-09 | 前言（含 id、label） | 4.3.3 7/11；4.1 骨架 3/7；表 1 5/9；表 E.1 67/71 | `<sec id="sec_foreword" sec-type="foreword"><title>前言</title>…</sec>`，位于 `front` 内、`std-meta` 之后；无 `<label>`（表 1：front 中“无编号”的 sec）。 | 同左；内容为 `<p>`、列项等块（第 5 章）。 | 4.3.3、4.1 | `IRDoc.front.foreword` 非空时输出；`id` 为固定常量 `sec_foreword`。 | 接受 front 内 `sec-type="foreword"` 的 sec；`<title>` 文本只作校验（不是数据，前言标题固定）；多个 foreword → 拒绝。 | 原文明确 |
| C-S-10 | 引言：无子条与有子条两种形式 | 4.3.4 7–8/11–12；表 1 5/9；表 E.1 67/71 | 文字：“未设置条的引言：`@id="sec_intro"`；设置条的引言：`@id="sec_0"`，引言中的条：`@id="sec_0.1"`”。示例 1：`<sec id="sec_intro" sec-type="intro"><title>引言</title>…`。示例 3（有标题条）：`<sec id="sec_0" sec-type="intro"><title>引言</title><sec id="sec_0.1"><label>0.1</label><title>综述</title>…`（8/12）。示例 2（无标题条的引言）：引言开始处 `<sec id="sec_intro" sec-type="intro">`，“后继的条”写作 `<sec id="sec_0.1">`、`<sec id="sec_0.1.1">`（7/11）——与文字规则不一致。 | 无子条：`sec_intro`；有子条：引言 `sec_0` + 子条 `sec_0.<n>`（含 `<label>0.<n>`）。示例 2 的 `sec_intro` + `sec_0.1` 组合视为示例自相矛盾，不采用。 | 文字规则 + 示例 1、3 | `IRDoc.front.introduction` 目前只有块（无条），只能输出 `sec_intro` 形式；引言内的条需要 IR/PM 扩展（`IRDoc.front.introduction: IRBlock[]` 不含 `IRClause`，见 matrix `M-4.3.4-03`，状态 gap-ir） | 接受两种形式；子条按顺序映射为引言条（需 IR 扩展才能保存，否则告警“引言中的条无法保存”并拒绝）。 | 原文明确（文字规则）；示例 2 的处理：项目实现约定 |

### 1.3 元数据（`std-meta`）

4.3.2（5–6/9–10）规定：元数据**宜**使用 `<std-meta>` 标记，“并附上相关标题、版权声明、日期等内容”，元数据实例见附录 G；`std-meta` 中“**通常可**包含”13 个标签（std-type、ics、ccs、title-wrap、std-ident、std-org-group、std-org-name、content-language、release-date、implementation-date、equivalence、issue-agencies、std-supersedes），版权声明另用 `permissions` 标记。3 个来源的子元素顺序互不相同：4.1 示例（`ics`、`ccs`、`title-wrap`…`permissions`，3/7），附录 G 示例（`title-wrap`、`std-ident`、`std-org`、`content-language`、`std-ref`…`ics`…`permissions`、`custom-meta-group`，71/75），ISO 源指南（旁证，`title-wrap` 在前、`ics` 靠后）。DTD 是否对顺序敏感取决于选用的校验包（见第 3 节），**未核实**。

| 编号 | 问题 | 原文条款/印刷页（PDF页） | 原文各处写法（逐处列出） | 选用形式 | 依据 | 导出规则 | 导入接受范围 | 性质 |
|---|---|---|---|---|---|---|---|---|
| C-S-11 | `std-meta` 子元素顺序 | 4.1 3/7；附录 G 71/75 | 见本节引言三处顺序。 | `title-wrap`（zh 在前、en 在后）→ `std-type`（若有）→ `std-ident` → `std-org-group` → `content-language` → `std-ref`（dated、undated）→ `release-date` → `implementation-date` → `std-xref`/`std-supersedes`（若有）→ `equivalence`（若有）→ `comm-ref` → `ics` → `ccs` → `permissions` → `custom-meta-group`。 | 以附录 G 与 ISO 源指南的相对顺序为基础，把原文只在 4.3.2/表 C.1 出现、无示例的中国特有元素放在最贴近语义的位置 | 按左栏；国标扩展元素（ccs、implementation-date、equivalence、std-type、std-supersedes）的确切位置待校验包扩展定稿后再确认。 | 元素顺序不限，按名字取值。 | 项目实现约定 |
| C-S-12 | **发布日期、实施日期各用什么标签** | 4.1 3/7；4.3.2 6/10；表 C.1 行 40 58/62、行 67 60/64；表 F.1 行 4、5 69/73；附录 G 71/75；表 D.1 64–66/68–70；封面 | ① 4.1 示例：两个 `release-date`，`<release-date date-type="published">2020-10-26</release-date>` 与 `<release-date date-type="implemented">2025-02-01</release-date>`。② 4.3.2 列表：`<release-date>`，“记录标准的发布日期”；`<implementation-date>`，“记录标准的实施日期”。③ C 行 40：`<implementation-date>` “记录标准的实施日期”，备注**“中国标准特有”**；C 行 67：`<release-date>` “记录发布和实施时间”。④ F 行 4 发布日期：本文件 `release-date`，37967 `isd`，22373 `data of announcemenet`，46687.1 `issue_date`；**F 行 5 实施日期：本文件“—”**，37967 `efd`，22373 `effective date`，46687.1 `implementation_date`。⑤ 附录 G 的 `std-meta` **没有任何日期元素**，只有 `custom-meta` `issue-date`=2014-12-31。⑥ D.1 的 20 个属性中**没有 `date-type`**。⑦ 封面：2026-04-30 发布，2026-11-01 实施。⑧（旁证）IEC 实例 `release-date date-type="published"`；ISO 实例 `<release-date>` 无属性。 | **发布日期 `<release-date>`（不带 date-type）；实施日期 `<implementation-date>`**。两种语义用两个标签，互不混用。 | 4.3.2 与 C 行 40 明确给出专用标签并标注“中国标准特有”；4.3.2 与 F 行 4 一致认定 `release-date` 为发布日期，故 `release-date` 单独出现时必为发布日期；4.1 示例的 `date-type` 在 D 表中没有定义。该结论与 4.1 示例、C 行 67、F 行 5 不一致，原文自相矛盾，**需用户确认**（D-S-01）。 | `IRDocMeta.publishDate` → `release-date`；`implementDate` → `implementation-date`；日期文本必须是 `YYYY-MM-DD`，否则报告问题，不输出猜测值。**绝不再把实施日期写进 `release-date`**（旧 SEP 的错误映射，见第 6 节）。 | 导入：`release-date`（无 date-type）→ 发布日期；`release-date[@date-type=published]` → 发布日期；`release-date[@date-type=implemented]` → 实施日期（4.1 示例确认）；`implementation-date` → 实施日期；`release-date` 的其他 date-type 值、同一语义重复出现、或同时出现 `implementation-date` 与 `release-date[implemented]` → 拒绝并定位；`custom-meta` 的 `issue-date`（附录 G）→ 不映射为发布日期，按 C-S-22 处理。 | 项目实现约定（原文异写，三种结论各有证据；已明确标注） |
| C-S-13 | 题名 `title-wrap`（多语种、分段） | 4.1 2–3/6–7；附录 G 71/75；表 C.1 行 15、37、44、50、114 | 4.1：`<title-wrap xml:lang="zh"><main>IPv6 网络安全设备技术要求</main><compl>第2部分：Web应用防护系统(WAF)</compl><full>IPv6 网络安全设备技术要求 第2部分：Web应用防护系统(WAF)</full></title-wrap>`，另有 `xml:lang="en"` 的同构一组。附录 G：`main` 标准化工作指南，`compl` 引用文件，`full` 标准化工作指南 第3部分：引用文件。C 行 44 另有 `<intro>`（标题的可选第一部分），行 15 `compl`，行 50 `main`，行 37 `full`（“通常以预先组合的形式…并可能添加标点符号和空格”）。异写：`compl` 在 4.1 含“第2部分：”前缀，在附录 G 不含，而 `full` 在两处都含“第N部分：”。 | 每种语言一个 `title-wrap`，`xml:lang` 取 `IRTitlePart.lang`（zh/en）；子元素顺序 `intro`?、`main`、`compl`?、`full`；`full` 只要有题名就写，内容取全称（`meta.title` 或 role=full 的分段）；`intro`/`main`/`compl` 仅在 IR 有对应 role 的分段时才写；**不拆分、不改写**旧单字符串题名，不补“第N部分：”。 | 4.1、附录 G、C 行 37 | `IRTitlePart.role` ∈ intro/main/compl/full；题名内容只允许 5.1 的七种行内格式；脚注不得出现（Resolver 已禁止）。 | 每个 `title-wrap` → 同语言的若干 `IRTitlePart`；`meta.title` 取 zh 的 `full`；缺少 `full` 时不合成全称，交由 WP6 的元数据优先级规则；缺 `xml:lang` → 告警并保留无语言分段。 | 结构：原文明确；`full` 必写与不拆分：项目实现约定 |
| C-S-14 | 标准编号 `std-ident` 与 `std-ref` | 4.1 3/7；附录 G 71/75；表 C.1 行 29–31、58、61、74、118；表 F.1 行 18、25 | 4.1：`<std-ident><originator>SAC</originator><doc-type>GB/T</doc-type><doc-number>44810</doc-number><part-number>2</part-number><edition/><version>1</version></std-ident>`。G：`originator` SAC，`doc-type` **standard**，`doc-number` 20000，`part-number` 1，`edition` 2，`version` 1；另有 `<std-ref type="dated">GB/T 20000.3—2014</std-ref>` 与 `<std-ref type="undated">GB/T 20000.3</std-ref>`（G 的 `part-number`=1 与 `std-ref` 的 .3 互相矛盾，属示例瑕疵）。C 行 30：`doc-type` 示例为 standard/spec/tr；行 74：`std-ref` 含发起者、编号、可含年份。`std-ident` 内没有年份元素。F 行 25 写作 `std-indent`（排印错误）。 | `std-ident` 子元素：`originator`、`doc-type`、`doc-number`、`part-number`、`edition`、`version`（顺序同 4.1/G），**只写 IR 中确有的组成部分**，不由 `stdCode` 猜测；`doc-type` 取编号前缀（4.1 的 “GB/T”），不取 G 的泛称 “standard”；空元素（4.1 的 `<edition/>`）不写。完整编号（含年号）写成 `<std-ref type="dated">GB/T 46687.2—2026</std-ref>`；`undated` 只在 IR 有显式的 undated 标识时才写。 | 4.1 与 G；“不从未知组成猜测传统 stdCode”与 `types.ts` 注释一致 | `IRIdentifier.parts[].kind` = 元素名；`IRIdentifier.value` + `scheme=dated/undated` ↔ `std-ref`；`meta.stdCode` ← dated 值。 | `std-ident` 各元素 → parts；`std-ref[type=dated|undated]` → identifier 的 value；无 `type` 的 `std-ref`（G 末尾）是相关标准引用，见 C-S-18；不由 parts 合成 `stdCode`。 | 元素：原文明确（示例）；doc-type 取舍、不猜测：项目实现约定 |
| C-S-15 | 发布机构：`std-org-group` / `std-org` / `std-org-name` / `std-org-abbrev` | 4.1 3/7；4.3.2 6/10；附录 G 71/75；表 C.1 行 77–80；表 F.1 行 19 | 4.1：`<std-org-group><std-org std-org-level="1" std-org-role="lead"><std-org-name>国家市场监督管理总局</std-org-name><std-org-name>国家标准化管理委员会</std-org-name><std-org-abbrev>GB</std-org-abbrev></std-org></std-org-group>`。G：`<std-org std-org-type="national"><std-org-abbrev>SAC</std-org-abbrev></std-org>`（无 group、无 name）。4.3.2 另列 `issue-agencies`（“记录标准的发布机构”），表 C.1 没有该标签。D.1 没有 `std-org-level`、`std-org-role`、`std-org-type` 的定义。 | 一个 `std-org-group`；每个 `IROrganization` 对应一个 `std-org`，内含一个 `std-org-name`，有 `identifier` 时再写 `std-org-abbrev`；`std-org-role` 取 `IROrganization.role`（示例值 lead）；**不写** `std-org-level`、`std-org-type`、`issue-agencies`。 | 4.1 的分组结构；`issue-agencies` 无定义、无示例、与 `std-org-group` 语义重复 | 见左栏。 | 接受 `std-org-group/std-org/std-org-name/std-org-abbrev`；每个 `std-org-name` → 一个 `IROrganization`（role ← `std-org-role`；abbrev ← identifier，同一 `std-org` 内多名时只挂在第一个名上）；只有 abbrev 没有 name（G）→ 以 abbrev 作名称并告警；`std-org-level`/`std-org-type`（IR 无对应字段）→ 提示“已忽略”，不得静默；`issue-agencies` → 拒绝（定义缺失）。 | 结构：原文明确（示例）；取舍：项目实现约定；IR 缺口见 matrix |
| C-S-16 | 语言 `content-language` | 4.1 3/7；附录 G 71/75；表 C.1 行 16 | `<content-language>zh</content-language>`（两处一致）。 | 每个 `IRLanguage` 一个 `content-language`，文本为 `tag`（zh/en）。 | 4.1、G | `usage` 无对应元素，非空时报告“未表达”。 | 全部接受；多个允许。 | 原文明确（示例） |
| C-S-17 | `ics`、`ccs` | 4.1 2–3/6–7；附录 G 71/75；表 C.1 行 10、39 | `<ics>33.040.40</ics>`、`<ccs>M 32</ccs>`；G：`<ics>01.120</ics>`。C 行 39：有多个 ICS 号时 `ics` 重复出现；C 行 10：`ccs` 备注“中国标准特有”。 | `icsCode`、`ccsCode` 各一个元素，内容原样。 | 4.1、G、C | 单值输出。 | `ics`/`ccs` 取值原样；多个 `ics`（C 行 39 允许）→ IR 只有单值，拒绝并说明“暂不支持多 ICS 号”，不静默取第一个。 | 原文明确；多值处理：项目实现约定 |
| C-S-18 | 采用关系、代替关系、一致性程度：`equivalence`、`std-supersedes`、`std-xref`、`std-type` | 4.3.2 6/10；表 C.1 行 32、81、82、83；附录 G 71/75；封面 | 4.3.2：`equivalence`“记录标准的一致性程度”，`std-supersedes`“记录标准的替代情况”，`std-type`“标准类型”。C：`equivalence`备注“中国标准特有”；`std-type`“如强制标准、推荐标准、标准化指导性技术文件”；`std-xref`“用于命名相关标准，例如，已被当前标准修订、修正或取代的标准”。G：`<std-xref type="revises"/>` 后面紧跟独立的 `<std-ref>GB/T 20000.3</std-ref>`（`std-xref` 写成空元素，疑似排印错误）。**以上元素都没有内容模型和取值说明，也没有 `std-type`/`equivalence`/`std-supersedes` 的示例。** | `std-supersedes`：每个 `replacedStandards`（relation 为空或 replaces）写一个，文本为 `reference`；`relation=revises` 写 `<std-xref type="revises"><std-ref>…</std-ref></std-xref>`（取 G 的 type 值，嵌套形式取 C 行 83 的“命名相关标准”语义，**结构未核实**）；其他 relation → 报告“无已确认的表达”。`equivalence`、`std-type`：**暂不导出**，已列入 D-S-05 待决，不伪造内容。 | 原文只给了元素名，没有内容模型；强行编出取值属于伪造 | `adoptions`、`standardType` 在 IR 中有数据，导出时必须报告“未表达”而不是静默丢弃（matrix `M-4.3.2-08/-09` 状态均为 not-applicable） | 导入：`std-supersedes` → `replacedStandards`（relation=replaces）；`std-xref[type=revises]` → relation=revises；`equivalence`、`std-type` → 提示“无内容模型，已忽略”并保留原文本在导入报告中；其余 `std-xref` type → 拒绝。 | 项目实现约定（原文未给内容模型，待用户/校验包定稿） |
| C-S-19 | 版权 `permissions` | 4.3.2 6/10；4.1 3/7；附录 G 71/75；表 C.1 行 16–19、62；表 F.1 行 23；附录 B 54/58 | `<permissions><copyright-statement>版权专有 侵权必究</copyright-statement><copyright-year>2020</copyright-year><copyright-holder>国家标准化管理委员会</copyright-holder></permissions>`（4.1、4.3.2 示例 1）；G：holder 为 “Standards Press of China”，year 2015。F 行 23 把标签写作 `permission`（缺 s，排印错误）。B.1：版权声明在元数据中用 `permissions` 标记，删除了“PDF 文件页脚”的限定。 | 一个 `permissions`，子元素顺序 `copyright-statement`、`copyright-year`、`copyright-holder`；只写 IR 中存在的字段。 | 4.3.2 示例 1 | 仅在 `copyrights` 只有 1 项时输出；超过 1 项（多语言版权声明）→ 报告，因为原文没有多份 `permissions` 的写法；`IRCopyright.language` 无对应表达，非空时报告。 | `permissions` → `IRCopyright`（`statement` 缺失时为空数组）；多个 `permissions` → 拒绝并说明。 | 原文明确（示例）；多项处理：项目实现约定 |
| C-S-20 | 归口委员会、秘书处、页数等 | 附录 G 71/75；表 C.1 行 14、60、64、68、70；表 F.1 行 27 | G：`<comm-ref>SAC/TC 286</comm-ref>`、`<secretariat>TC 286</secretariat>`、`<page-count count="8"/>`、`<std-xref type="revises"/>`。C：`comm-ref`（标识负责该标准的技术委员会…）、`secretariat`、`page-count`、`proj-id`、`release-version`、`doc-ref`；F 行 27：委员会 `comm-ref`。4.3.2 的 13 项清单里**没有**这些元素，只在 G 与表 C.1 出现。 | 只导出 `comm-ref`：取 `IRDocMeta.technicalCommittee`（归口）。`secretariat`、`page-count`、`proj-id`、`release-version`、`doc-ref` 不导出（IR 无对应数据；页数由排版产生，不是内容）。 | G、C 行 14 | `technicalCommittee` 非空才写。 | `comm-ref` → `technicalCommittee`；`secretariat`、`page-count`、`proj-id`、`release-version`、`doc-ref` → 提示“已忽略”（非静默）；`std-doc-meta` → 拒绝（附录 B 54/58 说明“功能重叠，故仅保留 std-meta”）。 | `comm-ref` 取舍：项目实现约定 |
| C-S-21 | 自定义元数据 `custom-meta-group` | 4.3.2 6/10；附录 G 71/75；表 C.1 行 20、21、51、52 | 4.3.2 示例 2 的 `custom-meta` 用于 `processing-meta`（见 C-S-04）；G 的 `std-meta` 内 `custom-meta-group` 含 `price-ref-pages`=8、`issue-date`=2014-12-31（名称为小写连字符形式）。 | SES 专有字段用 `custom-meta`：`filing-no`（备案号）、`industry-name`、`region-name`、`cover-designation`、`applicant`、`proposer`；名称取小写连字符，不带 `content-type` 属性。 | G 的命名风格；旧 SEP 的 `custom-meta-group content-type="ses-cover"`（`content-type` 在 D.1 中只给 bibl/index）不沿用 | 只写非空字段；顺序固定；字段的名称集合列入 matrix `M-4.3.2-14`。 | 已知名称映射回对应字段；未知名称（如 `price-ref-pages`）→ 提示“已忽略”，不得静默；同名重复 → 拒绝。 | 项目实现约定 |
| C-S-22 | `xml:lang` 与语言简码 | 4.1 2–3/6–7；附录 G 71/75 | `xml:lang="zh"`、`xml:lang="en"`；`content-language` 同值。 | BCP 47 简码（zh、en），不带地区。 | 示例 | 输出 `IRTitlePart.lang` 原值。 | 接受任意合法 BCP 47 值并原样保存。 | 原文明确（示例） |

### 1.4 正文章条、规范性引用文件、术语章、附录、参考文献、索引

| 编号 | 问题 | 原文条款/印刷页（PDF页） | 原文各处写法（逐处列出） | 选用形式 | 依据 | 导出规则 | 导入接受范围 | 性质 |
|---|---|---|---|---|---|---|---|---|
| C-S-23 | 章和条：`sec`、`label`、`title`、`p` | 4.4.1 8/12；4.4.2.1 8–9/12–13；5.2、5.3 15/19；表 E.1 67–68/71–72 | “章和条用 `<sec>` 标记”；可含任何类型内容（文本、表、图）和条；编号在 `<label>`、标题在 `<title>`；示例 `<sec id="sec_5"><label>5</label><title>技术要求</title><sec id="sec_5.1">…`。5.2：`label`/`title` 内容“呈现时自动加粗，但斜体和下划线格式需要单独进行标记”；5.3：前言、引言、正文及附录的文本在 `<p>` 中标记。E.1：`<p>` 中无任何 id 或其他属性。 | `<sec id><label/><title/>子条或块</sec>`；章与条同一元素，嵌套表示层级；附录中的条同样用 `sec`，`label` 继承附录字母（A.1、A.1.2）。 | 4.4.2.1、5.2、5.3 | `label` 取 Resolver 的 `label`（章 “5”，条 “5.1.2”，附录条 “A.1”）；标题与 `label` 内不写 `<bold>`（呈现时自动加粗，写了冗余）；`<p>` 不带任何属性。 | `label` 文本只作校验：与 Resolver 重新派生的编号不一致 → 告警（编号会被重排）；`title`/`label` 内的 `<bold>` 导入时剥离，避免往返后不幂等；`<p>` 上的 `id`/其他属性 → 提示“已忽略”（见第 2 节，示例里确有此写法）。 | 原文明确 |
| C-S-24 | 规范性引用文件章与清单 | 4.4.2.3.1–3 9–10/13–14；表 C.1 行 65、72、74；10.1.7 48/52 | `<sec sec-type="norm-refs">`，`@id` 含章编号（“例如 sec_2”）；清单 `<ref-list>`，`@content-type`=norm-refs（文字）；标准化文件：`<ref><std><std-ref>GB/T 20000.1</std-ref>…<title>…</title></std></ref>`；非标准化文件：`<ref><mixed-citation>…</mixed-citation></ref>`（“以其原有格式”）。示例中 `</std-ref>` 与 `<title>` 之间在 10/14 有一个逗号字符，4.5.3.1 的示例（12/16）没有。章内先有 `<p>` 引导语，再有 `<ref-list>`。 | 章：`<sec id="sec_2" sec-type="norm-refs"><label>2</label><title>规范性引用文件</title><p>引导语</p><ref-list content-type="norm-refs">…`；条目的 id 见第 2 节。 | 4.4.2.3.1–3 | **当前 IR/PM 没有规范性引用条目的结构**（`IRChapter.children` 只有块），无法区分引导语与各条目、也无法拆出 `std-ref` 与 `title`（matrix `M-4.4.2.3-03`，gap-both）。可选做法见 D-S-08：①扩展 IR 增加结构化条目；②用启发式拆分；③全部作 `mixed-citation` 输出（有效但弱于“标准化文件宜用 std”）。**在决定前不得声称已完成。** | `ref-list[content-type=norm-refs]` → 无结构化条目时降级为段落（文本 =`std-ref`+空格+`title`），并报告“结构有损”；`std` 内元素之间的逗号文本忽略。 | 原文明确；导出做法待定 |
| C-S-25 | 术语和定义章（4.4.2.4） | 4.4.2.4 10–11/14–15；表 1 5/9 | `<sec id="sec_3" sec-type="terms">`，“`@id` 的值包含章条编号，例如 sec_3”；“术语和定义的条（如术语分组、包含缩写或符号的条）**宜**和其他条一样标记”，细则见第 9 章。 | 章 `sec-type="terms"`；分组与缩略语条为普通 `sec`；术语条目内部（`term-sec`、`tbx:*`）详见 T。 | 4.4.2.4 | 同 C-S-06。 | 同 C-S-06。 | 原文明确 |
| C-S-26 | 附录结构：`app-group`、`app`、条 | 4.5.2.1–2 11–12/15–16；4.1 4/8；表 E.1 | “所有附录都在 `<app-group>` 内使用 `<app>` 标记”；“‘附录’二字和附录的编号使用 `<label>`（不包括其后的破折号）标记，附录标题使用 `<title>`”；附录中的条用 `<sec>`，`<label>` 继承附录字母前缀。示例：`<app content-type=… id="sec_A"><label>附录 A</label><annex-type>（资料性）</annex-type><title>…</title><sec id="sec_A.1"><label>A.1</label><title>…</title><p>…</p></sec></app>`。 | 同左（性质与 label 见 C-S-07）；多个附录放进同一个 `app-group`。 | 4.5.2 | `IRAppendix.children` 同章内容。 | 只接受 `back/app-group/app`；`back` 下直接挂 `app`（原文未出现）→ 拒绝并定位。 | 原文明确 |
| C-S-27 | 参考文献 | 4.5.3.1–3 12–13/16–17；10.1.6 47/51；表 E.1 | `<ref-list content-type="bibl" id="sec_bibl"><title>参考文献</title><ref id="biblref_1"><label>[1]</label><std><std-ref>GB/T 15657-2021</std-ref>,<title>…</title></std></ref><ref id="biblref_2"><label>[2]</label><mixed-citation>张伯奥.中医内科学[M].…</mixed-citation></ref>`；每条含一个 `<std>`（标准化文件）或 `<mixed-citation>`（其他文件）；`<ref>` 属性 `@id="biblref_[label 的值]"`；`<label>` 含方括号；`mixed-citation` 内换行用 `<break/>`，网址用 `<uri>`，示例带 `xlink:type="simple"`（13/17）。异写：10.1.6 示例 2 的清单写作 `<ref-list content-type="bibr" id="sec_bibl">`（47/51，疑似排印错误）。 | 同左；`<title>参考文献</title>` 固定；`xlink:type="simple"` 按示例写在 `mixed-citation` 与 `uri` 上。 | 4.5.3 | `IRBibEntry` 有 `entryType`/`fields` 时按 std/mixed-citation 区分；仅有文本时输出 `mixed-citation`；URL 用 `IRBibEntry.externalLink.href` 写入 `<uri>`，`displayText` 与 href 不同则报告。 | 接受 `content-type="bibl"`，也接受 `bibr`（同一标准 47/51 确认）并告警；`xlink:type` 忽略；`<label>` 文本不作数据（重新编号）。 | 原文明确；`bibr` 接受：项目实现约定 |
| C-S-28 | 索引 | 4.5.4 13–14/17–18；表 C.1 行 41；表 E.1 | `<index id="sec-index"><index-title-group><title>索引</title></index-title-group><index-div><index-title-group><title>B</title></index-title-group><index-entry id="df_1"><term>必备要素</term><see-entry>3.2.5</see-entry><see-entry>6.2.2.1</see-entry>…</index-entry>…</index-div></index>`；“其位置在参考文献之后”。`see-entry` 内是**纯文本编号**（“3.2.5”“表 C.1”），没有 `rid`。表 C.1 只列 `index`，`index-title-group`、`index-div`、`index-entry`、`see-entry` 以及作为索引词的 `term` 都未列入。E.1 给索引的 id 是 `sec_index`，4.5.4 示例写作 `sec-index`。 | `<index id="sec_index">`（取 E.1）；每个 `IRIndexGroup` 一个 `index-div`，标题为 label；每个 `IRIndexEntry` 一个 `index-entry`，`id` 为 `df_<序号>`（示例里唯一的形式），`term` 为索引词，每个 target 一个 `see-entry`，文本取 Resolver 的 `refText`。 | 4.5.4 示例与 E.1 | `IRIndexEntry.seeAlso`（“参见”）在原文没有表达 → 报告；索引词内容允许 5.1 的行内格式。 | 接受 `sec_index`/`sec-index` 两种 id 值（id 不透明）；`see-entry` 文本按 Resolver 的 label/refText 精确匹配唯一目标，匹配不到或不唯一 → 拒绝（`dangling-index-target`）；导入后重新生成 `df_` id。 | 结构：原文明确（示例）；`see-entry` 解析、`df_`：项目实现约定 |

### 1.5 第 5 章条文内容

| 编号 | 问题 | 原文条款/印刷页（PDF页） | 原文各处写法（逐处列出） | 选用形式 | 依据 | 导出规则 | 导入接受范围 | 性质 |
|---|---|---|---|---|---|---|---|---|
| C-S-29 | 行内格式与空白 | 5.1 14–15/18–19；5.2 15/19；表 C.1 行 7、45、55、84–86、116 | “内容布局**不使用**空格和制表符实现。可直接进行格式设置，并会在 XML 中体现，但**仅限于**下列格式设置：粗体 `<bold>`、斜体 `<italic>`、下划线 `<underline>`、删除线 `<strike>`、等宽字体 `<monospace>`、上标 `<sup>`、下标 `<sub>`”。 | 七个元素；`IRMark` 对应：bold、italic、underline、strike、sup、sub；`code` 见 C-S-33；`monospace` 只在导入时接受（见 D-S-07）。嵌套顺序固定（外→内）：bold、italic、underline、strike、sup/sub。混合内容元素内部不插入缩进空白。 | 5.1“仅限于” | `IRInline.style`（字体、字号、颜色、背景色、字距、基线、大小写转换）**在原文中没有任何表达**，导出时若非空必须报告（建议报错并由用户确认丢弃，见 D-S-06），不得静默丢弃；行首空格/制表符不用于版式。 | 接受七个元素；元素之间的纯空白节点忽略，混合内容中的空白原样保留。 | 原文明确；嵌套顺序、style 处理：项目实现约定 |
| C-S-30 | 变量符号 | 5.5 15/19；表 D.1 行 3 64/68 | `<named-content content-type="variable">x</named-content>`；数字上标：`<named-content content-type="variable">x<sup>2</sup></named-content>`；变量下标：`…x<sub>y</sub></named-content>`；**非变量/常量下标：`<named-content content-type="variable">x</named-content><sub>b</sub>`（下标在外）**；“MathML 不提供此功能，因此在 MathML 公式中这些符号未作特别标记”。D.1 行 3 写作 `<name-content>`（排印错误，应为 named-content）。ISO 源指南同（旁证）。 | 带 `variable` 标记的连续文本放入同一个 `named-content`；其内文本若还带 sup/sub 则在内部，不带 `variable` 的 sub/sup 在外部——与上述四行示例自然一致。 | 5.5 | `IRMark.variable` 的 `kind`/`name` 无对应属性，非空时报告；公式内部的变量不处理。 | `named-content[@content-type=variable]` → 其中所有文本带 `variable` 标记；其他 `content-type` 值 → 保留文本、去掉标记并告警。 | 原文明确 |
| C-S-31 | 注、示例、警告 | 5.6 15–16/19–20；表 E.1 68/72；表 C.1 行 56、57 | “条文中的注和示例分别使用 `<non-normative-note>` 和 `<non-normative-example>` 进行标记。警告是带有‘警告’标签且 `@content-type="warning"` 的注释。**它们不编号**。”注：“注的前面有‘注’（多个连续的注则后面跟编号）；示例的前面有‘示例’（…）”；“含有任何序号或标点符号的注、示例或警告，包含在 `<label>` 中”；“注的内容使用 `<sec>` 中的标签进行标记，例如 `<p>`、`<list>` 等”。示例：`<non-normative-note><label>注：</label><p>…</p></non-normative-note>`。表脚注、表注、图注、公式注的写法见第 6～8 章（详见 T）。 | 注：`<non-normative-note><label>注：</label>…`（多个则 `注1：`…，文本取 Resolver 的 `label`，含全角冒号）；示例：`<non-normative-example><label>示例：</label>…`；警告：`<non-normative-note content-type="warning"><label>警告：</label>…`。 | 5.6；警告的元素名原文没有写，按 5.6 措辞（“带有‘警告’标签的注释”）与 ISO 源指南（旁证）取 `non-normative-note`；标签标点未规定，取全角冒号与“注：”保持一致 | 内容块只允许 `<p>`、`<list>`（原文“例如 p、list 等”）；注/示例里出现表、图、公式 → 报告。`id`：不写（见第 2 节），仅被交叉引用者例外。 | `non-normative-note` → `IRNote`；带 `content-type="warning"` → `IRWarning`；`non-normative-example` → `IRExample`；`label` 文本不作数据。 | 元素与 label：原文明确；警告的元素名与标点：项目实现约定 |
| C-S-32 | 列项 | 5.7.1–3 16–18/20–22；5.2 15/19；表 D.1 行 6、7 64/68 | “列项使用 `<list>` 标记，每个列项条目使用 `<list-item>`；列项独立于 `<p>` 标签之外”。有序：`@list-type` “为下列**三个值之一**：alpha-lower、arabic、roman-lower”；无序：“下列**两个值之一**：dash、bullet”；“在 XML 中没有特定标签标识无序列项，需要根据 `@list-type` 属性值来获得”；有序列项的数字/字母“在 `<label>` 标签中体现”，列项文本在 `<p>` 中。示例（16–17/20–21）：`<list list-type="alpha-lower"><list-item><label>a)</label><p>国家标准化文件；</p></list-item>…`。无序示例（18/22）：`<list id="list-7.1-L1" list-type="dash"><list-item id="lis-7.1-L1-1"><p id="p-126">…`，第 2～5 项另有空 `<label/>`，第 1 项没有；列项条目内先 `<p>` 后嵌套 `<list list-type="bullet">`。D.1 行 7：list-type 值“simple、bullet、dash、symbol 等”。 | `alpha`→`alpha-lower`；`number`→`arabic`；`roman`→`roman-lower`；`dash`→`dash`；`dot`→`bullet`；有序项写 `<label>`（`a)`、`1)`…），无序项**不写** `<label>`（空 `<label/>` 视为示例笔误）；嵌套列表放在条目内的 `<p>` 之后。`boxed`、`romanUpper` 在原文没有取值。 | 5.7 | `IRList.listType='boxed'`/`'romanUpper'` → 报告“无原文取值”；list/list-item 不写 `id`（E.1），示例里的 `id` 属示例。**生产 PM 的 `stdList` 不支持嵌套列表**（`irToPm.ts` 的“生产stdList不支持嵌套列表”诊断），嵌套列项为 gap-pm。 | 接受五个 list-type 值；`simple`、`symbol` 或缺省值 → 拒绝（IR 无法无歧义表达）；`<label>` 文本不作数据，与序号不一致 → 告警。 | 原文明确；`label` 取舍：项目实现约定 |
| C-S-33 | 代码 | 5.10 19–20/23–24；表 C.1 行 11 | “…如果在文本行中，**宜**标记为 `<inline-code>`，如果在代码块中，宜标记为 `<code>`。空白符将保留在 `<code>` 或 `<inline-code>` 中。渲染**宜**使用等宽字符。”示例 `<code>simple_line = (…)…;</code>`。表 C.1 有 `code`，**没有** `inline-code`。 | `IRMark.code` → `<inline-code>`；`IRCodeBlock` → `<code>`，内容为纯文本，保留空白。 | 5.10 | `IRCodeBlock.language` 无对应属性，非空时报告。 | `inline-code` → `code` 标记；`code` → 代码块。 | 原文明确 |
| C-S-34 | 字符、实体 | 5.4 15/19；3.2 2/6 | “特定符号使用 UTF-8 中相应的实体进行编码。”未说明是数字字符引用还是直接字符。 | UTF-8 直接字符；仅转义 `&`、`<`、`>`（属性另转义 `"`）；不用命名实体。 | 原文未规定实体集，且禁止外部实体 | XML 1.0 不允许的控制字符 → 报告，不输出。 | 接受数字字符引用与 XML 预定义实体；其他命名实体 → 拒绝（不加载 DTD）。 | 项目实现约定 |
| C-S-35 | 摘录 | 5.9 19/23；表 C.1 行 4、27 | “被缩进的单段文本…使用 `<disp-quote>`。引用的来源可以使用 `<attrib>` 通过 `@specific-use="source"` 来标记，任何权限信息都可以使用 `<disp-quote>` 内的 `<permissions>` 标记。”示例把属性写成 `<attrib @specific-use="source">`（带 `@`，排印错误）。 | `IRQuote` → `<disp-quote>`，内含 `<p>`；来源写 `<attrib specific-use="source">`。 | 5.9 | IR 没有“来源/权限”字段（matrix `M-5.9-03`，gap-ir），不导出 attrib/permissions。 | `attrib`、`permissions` → 无处保存，告警“来源已忽略”，不静默。 | 原文明确 |
| C-S-36 | 特殊文本对齐（array） | 5.8 18–19/22–23；表 C.1 行 3、12、13；表 D.1 行 19 | “按列对齐且没有列或行边框的文本使用包含一个 `<table>` 的 `<array>` 进行标记”，“没有 `<table-wrap>`、`<caption>`、`<title>`、`<label>`”；`@colwidth` 以百分比表示。示例：`<array><table><col-group><col align=center colwidth="40%"/>…</col-group><tbody><tr><td>…`。异写：示例写 `<col-group>`、`colwidth`，表 C.1 行 13 写 `colgroup`，D.1 行 19 与 6.1/6.3 写 `width`（见 T 的第 6 章分片）；`align=center` 缺引号（排印）。 | 不导出（IR 的表总有编号和题名，没有无框对齐文本块）。 | 5.8 | gap-both，状态见 matrix `M-5.8-01`。 | `array` → 拒绝并定位（不降级为带编号的表）。 | 项目实现约定（详见 T） |
| C-S-37 | xmlId 总则与逐类目标 | 附录 E 67–68/71–72；4.3.4、4.4.2、4.5.3.1 等正文；示例见第 2.3 节 | 逐类原文写法、示例偏离及判断见第 2.2、2.3 节（X-01～X-26） | 附录 E 为主，正文文字规定为辅，示例偏离一律判为示例瑕疵；形式见第 2.2 节 | 附录 E 为资料性附录且来自 ISO 附录 F.2（旁证：“不建议基于语义 ID 做任何利用”） | Resolver 派生，按第 2.4 节 R-1～R-9 修改；XML 中不得出现 `ext_`、`id-<uuid>`、`p-<n>`、`Formula…` 等形式 | id 不透明：只检查合法 XML ID、唯一、`rid` 可解析；导入后重新生成内部 NodeId，重新导出时由 Resolver 重新派生 | 附录 E 部分：原文明确（资料性）；异写取舍与未规定项：项目实现约定 |

## 2. xmlId 约定（附录 E 为主，正文示例为辅）

### 2.1 总原则

1. **附录 E 是资料性附录**（“ID 方案用于在将标准化文件从 Word 类型转换为 XML 类型的过程中，于要素级别间建立联系”，67/71），其原型是 ISO 源指南附录 F.2。ISO 源指南明确写道：“IDs generated in OSD are arbitrary. It is therefore not recommended to base any exploitation of ISO or IEC XML on semantic IDs.”（旁证）。因此：**导出时按附录 E 派生 id；导入时 id 只当 XML 内部的关联键，不据字面值判断元素类型**。
2. 导入：`id` 必须是合法的 XML `ID`（Name 产生式），文档内唯一，否则拒绝；`rid` 必须解析到文档内存在的 `id`，悬空 → 拒绝（D.1 行 10 允许 `rid` 含多个标识符，导入时逐个解析，IR 一次只能引用一个目标，多目标 → 拒绝并说明）。导入后每个被引用/被定义的元素分配新的稳定 `NodeId`，外部 id 只用于建立映射，重新导出时由 Resolver 重新派生。
3. 导出：id 全局唯一，由 Resolver 派生，不得出现 `ext_…`（Resolver 里 `stableExtensionXmlId` 是 WP6 的内部占位，注释已说明“最终外部 XML ID 词表属于 WP8.1”）。**只有两类元素允许带 `id`**：附录 E 或第 4～10 章条文规定了 id 的元素，以及实际被 `xref`/`tbx:see`/`tbx:entailedTerm`/`see-entry` 引用的元素；其余元素一律不写 id。
4. 派生规则里的“编号”取 Resolver 的最终编号：章 `5`，条 `5.1.2`，附录 `A`，附录条 `A.1.2`，附录内的表/图/公式 `A.1`。
5. 对原文示例里偏离附录 E 的 id（UUID 形、`p-125` 形、`Formula1` 形等），**一律判为示例瑕疵或工具生成物，不采用**；逐处清单见 2.3。

### 2.2 逐类目标：原文规定、当前 Resolver 产出与 WP8.2 修改

“当前”指 `packages/shared/src/ir/resolve.ts` 现行产出。

| 编号 | 目标 | 原文规定（附录 E 及条文；印刷页/PDF 页） | 选用形式 | 当前 `resolve.ts` 产出 | WP8.2 需修改 |
|---|---|---|---|---|---|
| X-01 | 章 | E.1：`1 范围`→`sec_1`，`2`→`sec_2`，`3`→`sec_3`，`5`→`sec_5`（67/71）；4.4.2.1 示例 `sec_5`（8/12）；4.4.2.3.1 “含章的编号，例如 sec_2”（10/14） | `sec_<章号>` | `sec_<章号>`（`visitChapter`，第 459 行） | 无 |
| X-02 | 条（有标题） | E.1：`5.2.1`→`sec_5.2.1`（67/71）；4.4.2.1 示例 `sec_5.1`、`sec_5.1.1`（8–9/12–13） | `sec_<编号>` | `sec_<编号>`（`visitClause`，第 451 行） | 无 |
| X-03 | 无标题条 | 4.4.2.5 示例 `sec_6.3.4.1`（11/15）；E.1 无单独行 | `sec_<编号>`，并加 `sec-type="numbered-paragraph"` | `sec_<编号>`（与有标题条同一路径） | id 不变；渲染器输出 `sec-type`（C-S-08） |
| X-04 | 前言 | E.1：`sec_foreword`（67/71）；4.3.3、4.1 示例同（3/7、7/11） | 固定常量 `sec_foreword` | 无（IR 的 `front.foreword` 没有容器 id） | 渲染器常量；前言容器无 NodeId，因此不能成为交叉引用目标 |
| X-05 | 引言 | E.1：`sec_intro`；4.3.4 文字：有条时 `sec_0`，条 `sec_0.1`（67/71、7–8/11–12） | 无子条 `sec_intro`；有子条 `sec_0` + `sec_0.<n>` | 无 | 渲染器常量；引言子条需要 WP6 扩展 IR 后由 Resolver 给 `0.<n>` 编号（C-S-10） |
| X-06 | 附录 | E.1：`附录 A`→`sec_A`，`附录 B`→`sec_B`（67/71）；4.1 骨架、4.5.2.2 示例 `sec_A`（4/8、12/16） | `sec_<字母>` | `sec_<字母>`（`visitAppendix`，第 468 行） | 无 |
| X-07 | 附录中的条 | E.1：`B.1`→`sec_B.1`，`B.1.2`→`sec_B.1.2`（67/71）；示例 `sec_A.1`（12/16） | `sec_<A.1.2>` | `sec_<编号>`，编号路径首元素为附录字母，得 `sec_A.1.2` | 无 |
| X-08 | 参考文献清单 `ref-list` | E.1：`参考文献`→`sec_bibl`（67/71）；4.1、4.5.3 示例（4/8、12/16）同 | 固定常量 `sec_bibl` | 无 | 渲染器常量 |
| X-09 | 参考文献条目 `ref` | E.1：`1`→`biblref_1`（67/71）；4.5.3.1 文字：“`@id="biblref_[label 的值]"`”（12/16）；4.5.3.2、4.5.3.3 示例 `biblref_1`、`biblref_2`（12–13/16–17）；10.1.6 示例 2 的清单 `biblref_1`、`biblref_2`（47/51） | `biblref_<N>`，N =清单序号（与 label “[N]” 的数字一致） | **`bib_<N>`**（`resolveBibliography`，第 519 行） | **改前缀**为 `biblref_`；N 仍取 `bibliographyOrder` 的位置；调用方 `renderers/html.ts` 的 `bibSeq` 与 `renderers/docx/body/bibliography.ts` 的 `bibSeq` 用 `/(\d+)$/` 取数字，无需改；需更新引用 `bib_` 的测试（`resolve.test.ts`、`html.test.ts`、`bibliography.test.ts`、`toc.test.ts`、`xmlCrossRef.test.ts` 等 5 个文件） |
| X-10 | 规范性引用文件条目（无 label 的 `ref`） | E.1 “无正文”行：`ref_5`，说明“如第 5 个引用的参考文献”（67/71）；ISO 源指南 F.2 对应行为 “no text … 5th reference of bibliography”（旁证） | `ref_<N>`，N =该清单内的序号（解读：没有 `<label>` 的条目；“无正文”为原文用语，字面含义不清，**未核实**） | 无 | IR 扩展出规范性引用条目后新增 |
| X-11 | 术语条 `term-sec` | E.1：`3.2`→`sec_3.2`，“位于术语条编号 `<term-sec>` 中”（67/71）；9.1、9.2.1 示例 `sec_3.1.1`、`sec_3.2.2`（34/38、35/39）；9.2.7 示例 `sec_3.41`（42/46） | `sec_<术语编号>` | `sec_<编号>`（`visitTermEntry`，第 331 行） | 无 |
| X-12 | 术语条目 `tbx:termEntry` | **异写**：E.1 `3.2.2`→**`te_3.2.2`**，“位于术语编号 `<tbx:termEntry>` 中”（67/71）；而 9.1、9.2.1 文字与示例一贯用 **`term_<编号>`**：“`<tbx:term-entry>`：`@id` 的前缀为 ‘term_’”（35/39）、`term_3.1.1`、`term_3.2.2`、`term_3.22`、`term_3.1.4`、`term_3.41`、`term_3.1`、`term_3.1.2`，以及 `tbx:entailedTerm target="term_3.11"`、`tbx:see target="term_3.12"`（T 的范围）。ISO 源指南旁证：`term_`为 ISO 方案，`te-` 为 IEC 方案，E.1 的 `te_` 看似 IEC 前缀改成下划线 | `term_<编号>`（正文出现 ≥8 处并有 `target=` 引用；`te_` 仅出现在 E.1 一行） | 无（术语条目只有 `sec_` 一个 id） | **新增** `term_<编号>`：建议在 `ResolvedLabel` 增加可选字段 `termEntryXmlId`（只增不改，符合“已有字段不得改名、改型”）；`tbx:see`、`entailedTerm`、`custom-type="term-entry"` 的目标都指向它 |
| X-13 | 术语条目中的注 | E.1：`3.1.3 注 1`→`nte_3.1.3-1`（67/71）；9.2.5 的 `<tbx:note>` 示例没有 id（40–41/44–45；PDF 45 页仅据 OCR，图像未逐页复核，属 T 的范围） | 仅被引用时输出 `nte_<术语编号>-<k>`，k = 该术语内注的序号 | 全局序号 `note_<n>`（`labelNotesAndExamples`，第 489 行） | 术语作用域内的注改用 `nte_` 形式（作用域 key 已是术语条目的 id，可直接派生）；其余见 X-14 |
| X-14 | 一般注 | E.1：“常规注中无 id 属性”（68/72）；表注、图注“`<non-normative-note>` 中无 id 属性”（67–68/71–72）。**矛盾**：10.1.3 的交叉引用示例 `<xref ref-type="custom" custom-type="note" rid="note_1">注 1</xref>`（45/49）需要被引用的注有 id | 默认不写 id；**仅当有 `xref` 引用它时**才写 `note_<n>` | 所有注都得到全局 `note_<n>`（第 495 行） | Resolver 可继续赋号（稳定、全局唯一），**渲染器**根据实际引用集合决定是否输出 `id`（D-S-09） |
| X-15 | 示例（`non-normative-example`） | E.1：“示例中无 id 属性”（68/72）；10.1.3 允许 `custom-type="example"` 引用（44/48） | 同 X-14，形式 `example_<n>` | 全局 `example_<n>`（第 496 行） | 同 X-14 |
| X-16 | 警告、摘录、代码块 | E.1、5.6、5.9、5.10 均无 id | 不写 id | `ext_<十六进制>`（`registerExtendedData` 给所有带 `id` 的对象赋占位 id，第 623–625 行） | 渲染器不得输出 `ext_`；若某元素被引用却没有原文规定的 id 方案 → 报告问题，不输出猜测 id |
| X-17 | 列项、列项条目 | E.1：“任何 `<list>` 或 `<list-item>` 中无 id 属性”（68/72）。示例中有 id（18/22，见 2.3）；10.1.5 示例引用 `rid="id-6304d1e4-…"`（46/50，示例性质） | 不写 id | 不赋 label（无 `xmlId`） | 无。IR 的 `IRReferenceTargetKind` 没有 list，列项交叉引用不可表达（详见 T 的第 10 章分片） |
| X-18 | 段落 `<p>` | E.1：“`<p>` 中无任何 id 或其他属性”（68/72，250 dpi 复核）。示例中有 `p-125…p-135`、`p-183…p-185`、`p-105`、`p-65`、`p-490` 等（2.3） | 不写 id | 不赋 label | 无；`crossRef.targetKind='paragraph'` 无法导出（无 id 可指向）→ 报告 |
| X-19 | 表 | E.1：`表 1`→`tab_1`；“无标题”→`tab_r`，“可使用任何与附录编号无关的字母”（67/71）；6.2.1 示例 `tab_1`（20/24）；6.2.3 示例 `tab_3`（21/25）；10.1.2 示例 `tab_2`（45/49）。“与附录编号无关”暗示附录内的表 id 带附录字母，ISO 源指南 F.2 同（旁证）。**示例瑕疵**：6.2.5 把“表 C.1”写作 `tab_4`（23/27） | `tab_<编号>`；附录表 `tab_<A.n>`（IR 的表一律有编号，`tab_r` 不适用） | `tab_<编号>`，附录内 `tab_A.1`（`labelFigureOrTable`，第 172 行） | 无 |
| X-20 | 图 | E.1：`图 1`→`fig_1`（67/71）；8.2 示例 `fig_1`（31/35）；B.1 行 8.2：“图形文件的名称宜与图的 `@id` 属性相匹配，如图 1 表示为 fig_1”（55/59）。**示例瑕疵**：8.5、8.6 的 `id-2a2aa2f4-…`、`id-d6dbd95d-…`（32/36、33/37）为工具生成 | `fig_<编号>`；附录图 `fig_<A.n>` | `fig_<编号>` | 无；资源文件名取该 id（详见 T 的第 8 章分片） |
| X-21 | 显示公式 | E.1：`(1)`→`formula_1`；“无正文”行 id 为“—”（67/71）。**异写**：7.1 示例 1 `Formula_1`（27/31）；7.3、7.4 示例 `Formula1`、`Formula5`（28/32、29/33）。7.1 另称“公式编号宜从引言开始一直连续到附录之前…附录中的公式宜以附录编号中的字母作为前缀从头开始编号”（27/31） | `formula_<编号>`（取 E.1；`Formula…` 判为示例瑕疵）；附录公式 `formula_<A.n>`；**无编号公式不写 id** | 有编号：`formula_<编号>`；无编号：`ext_…` | 无编号公式不再输出 `ext_` id |
| X-22 | 公式内 `mml:math`、行内公式 | E.1：“行内公式没有 ID”（67/71）；7.1：“使用 `<mml:math>` 中的 `@id` 进行行内公式 ID 的编制”（27/31）；7.4：“`@id` 的前缀为 ‘mml_m[number]’，[number] 表示文件中的 `<mml:math>` 标签序列”（28–29/32–33）；示例 `mml_m1`（27/31、28/32）、`mml_m5`（29/33）、行内 `m1`（27/31，与 7.4 文字不符，示例瑕疵）。ISO 源指南旁证同 | 每个 `mml:math`（显示或行内）带 `id="mml_m<k>"`，k 为按输出顺序的文档内序号；`inline-formula`、`disp-formula` 之外不再另写 | 行内公式 `ext_<十六进制>` | 渲染器在输出 `mml:math` 时按序分配；`inline-formula` 无 id（详见 T 的第 7 章分片） |
| X-23 | 脚注 | E.1：`1`→`fn_1`；`*`→`fn_2`，“符号被放置于标签中；id 编号按顺序继续”；“无正文”行 `fn_1`（67/71）；10.1.1、10.1.8 示例 `fn_1`（44/48、48/52） | `fn_<k>`，k 为文档内连续序号，与标签字符无关 | `fn_<seq>`（`visitInlines`，第 130 行） | 无 |
| X-24 | 表脚注 | E.1：`1`→`table-fn_1.1`，“表 1 的第 1 个注”；`a`→`table-fn_2.1`，“表 2 的第 1 个注”（67/71）；6.2.3 标记示例 `<fn id="table-fn_3.1">`（21/25）。**异写**：6.2.3 文字写 `table_fn_3.1`（21/25）。ISO 源指南“Table footnotes”一节为 `table-fn_[表号].[序号]`（旁证） | `table-fn_<表号>.<k>`，k 为该表内脚注序号（a→1，b→2…）；附录表用 `table-fn_<A.n>.<k>`（原文未给附录表的例子，**项目实现约定**） | `tabfn_<表的 xmlId>_<字母>`，如 `tabfn_tab_1_a`（第 154 行） | **改形式**；调用方 `renderers/html.ts` 第 221 行用 `startsWith('tabfn_')`，`client/src/serializer/xmlSerializer.ts` 第 1160 行用 `/^tabfn_.+_[a-z]+$/`（该文件将在 WP8.4 整体替换）；含 `tabfn_` 的文件共 6 个：源码 `resolve.ts`、`html.ts`、`client/src/serializer/xmlSerializer.ts`，测试 `shared/src/renderers/__tests__/footnotes.test.ts`、`client/src/serializer/xmlFootnotes.test.ts`、`client/src/serializer/xmlCrossRef.test.ts` |
| X-25 | 索引与索引条目 | E.1：`索引`→`sec_index`（67/71）；4.5.4 示例：`<index id="sec-index">`、`<index-entry id="df_1">`…`df_4`（14/18）。**异写**：`sec-index`（连字符）仅此一处 | `sec_index`；条目 `df_<序号>`（原文里唯一的条目 id 形式，附录 E 未规定） | 索引根及条目均为 `ext_<十六进制>` | 渲染器常量 `sec_index`；条目按输出顺序 `df_<k>` |
| X-26 | 缩略语 `def-item`、公式“式中” `def-item` 等 | 10.1.4 示例 `abb-adc`、`abb-agc`、`abb-ct`（45–46/49–50）；E.1 无规定 | 详见 T | `ext_…` | 详见 T |

### 2.3 原文示例中出现的各种 id/rid 形式（逐处）与判断

“规定”指附录 E 或条文文字给出的形式；“示例”不具规范性，只作结构依据。

| 形式 | 出现位置（印刷页/PDF 页） | 判断 |
|---|---|---|
| `sec_foreword`、`sec_intro`、`sec_1`、`sec_2`、`sec_3`、`sec_A`、`sec_bibl`、`sec_0`、`sec_0.1`、`sec_0.1.1`、`sec_5`、`sec_5.1`、`sec_5.1.1/2/3`、`sec_6.3.4.1`、`sec_A.1` | 3/7、4/8、7–9/11–13、10–12/14–16 等 | 规定/示例一致，采用 |
| `sec-index` | 4.5.4 示例 14/18 | 与 E.1 的 `sec_index` 冲突，判为示例瑕疵；导入时不据此判断 |
| `sec-7.1`（5.7.3 示例中的章） | 17/21 | 示例瑕疵（与 `sec_<编号>` 不符） |
| `p-125…p-135`、`p-183/184/185`、`p-105`、`p-65`、`p-490`，以及 `id-…` 形的 `p` | 17–18/21–22、28/32、42/46、46/50、48/52 | 与 E.1“`<p>` 中无任何 id”冲突，判为示例（疑为转换工具的自动 id）；不采用，导入时忽略 |
| `list-7.1-L1`、`lis-7.1-L1-1…5`、`list-7.1-L1-3-sub`、`id-a6d8f5d0-e0c8-4387-d008-97f8a551bb16`（及另 4 个同形） | 18/22 | 与 E.1“list/list-item 无 id”冲突，判为示例；不采用 |
| `id-2a2aa2f4-554c-4359-c583-24cfce9ff7ab`、`id-c9243a79-30ec-43f3-fc83-b051d6ea839a`、`id-484f-b7a1-c79f78fecb5b`、`id-41d5-89cd-bd228ade8bd0`、`id-4b9e-acd6-33d47ee4f357`、`id-d6dbd95d-2f55-412a-a2b1-f8a0ffeaceb4`、`id-975b481c-2dc1` | 32/36、33/37 | 工具生成（部分段落被截短，不是合法 UUID）；与 `fig_<编号>` 冲突，判为示例；不采用 |
| `id-6304d1e4-f20d-418b-cacb-4e2149bafb661`（`rid`，末段 13 位十六进制） | 46/50 | 示例，且自身格式不合 UUID；10.1.5 列项引用没有 id 方案 |
| `bibrref_1`、`bibrref_4`（`rid`） | 9/13、47/51 | 疑似排印错误（目标应为 `biblref_N`）；不采用 |
| `bibl_1`（`rid`） | 47/51（10.1.6 示例 1） | 与 `biblref_N` 冲突，判为示例瑕疵 |
| `biblref_1`、`biblref_2`、`biblref_4`/`biblref_5`（清单与 `rid`） | 12–13/16–17、47/51 | 规定，采用 |
| `Formula_1`、`Formula1`、`Formula5`、`mml_m1`、`mml_m5`、`m1` | 27/31、28/32、29/33 | `Formula…` 与 E.1 的 `formula_<n>` 冲突，判为示例瑕疵；`mml_m<k>` 采用；行内 `m1` 与 7.4 文字不符 |
| `tab_1`、`tab_3`、`tab_2`、`tab_4`（表 C.1） | 20/24、21–23/25–27、45/49 | `tab_<编号>` 采用；`tab_4`（表 C.1）与附录表应带附录字母的暗示不符，判为示例瑕疵 |
| `table-fn_3.1`（标记）、`table_fn_3.1`（文字） | 21/25 | 标记与 E.1 一致，采用；文字为排印错误 |
| `fig_1` | 31/35、55/59 | 规定，采用 |
| `fn_1` | 44/48、48/52 | 规定，采用 |
| `note_1`（`rid`） | 45/49 | 为引用而写的示例；与 E.1“注无 id”矛盾，见 X-14 |
| `term_3.1.1`、`sec_3.1.1`、`term_3.22`、`term_3.41`、`term_3.1`、`term_3.1.2`、`term_6.13`、`term_3.11`、`term_3.12`、`term_8.4` | 34–43/38–47（T 的范围） | `term_<编号>` 采用（见 X-12） |
| `con-3.1.6`（`rid`，custom-type=term-entry） | 42/46（T 的范围） | 与 `term_<编号>` 不符，疑为 ISO 源指南（IEC 方案）遗留，判为示例瑕疵 |
| `rid="sec_A"`（`ref-type="app"`） | 42/46（T 的范围） | 与 E.1 的 `sec_A` 一致，采用 |
| `abb-adc`、`abb-agc`、`abb-ct` | 45–46/49–50（T 的范围） | 示例，归 T |
| `df_1…df_4` | 14/18 | 示例中唯一的索引条目形式，采用（C-S-28） |
| `ref_5` | 67/71 | 规定（E.1），含义见 X-10 |
| `te_3.2.2`、`nte_3.1.3-1` | 67/71 | `te_` 不采用（见 X-12）；`nte_` 采用（X-13） |

### 2.4 WP8.2 需修改的 Resolver 规则清单

| 编号 | 规则 | 位置 | 影响 |
|---|---|---|---|
| R-1 | 参考文献 id 由 `bib_<n>` 改为 `biblref_<n>`（n 不变） | `resolve.ts` 第 519 行 | 5 个测试文件需改期望（`resolve.test.ts`、`html.test.ts`、`docx/body/bibliography.test.ts`、`docx/toc.test.ts`、`client/.../xmlCrossRef.test.ts`）；`bibSeq`（html、docx）无需改 |
| R-2 | 表脚注 id 由 `tabfn_<tab>_<字母>` 改为 `table-fn_<表号>.<k>`（k 为表内脚注序号，不随标签字符变化） | `resolve.ts` 第 154 行 | `html.ts` 第 221 行判断前缀需改；3 个测试文件需改期望（见 X-24）；`xmlSerializer.ts` 第 1160 行随 WP8.4 一起删除 |
| R-3 | 为术语条目增加 `tbx:termEntry` 的 id（`term_<编号>`），建议 `ResolvedLabel` 增加可选字段，不改既有字段 | `resolve.ts` 第 331 行、`types.ts` 的 `ResolvedLabel` | 与 T 的第 9 章分片对齐 |
| R-4 | 术语作用域内的注改派生 `nte_<术语编号>-<k>`；一般注/示例继续赋全局稳定号，是否输出 `id` 由渲染器按“是否被引用”决定 | `resolve.ts` 第 480–498 行 | 渲染器需要“被引用目标集合”（可由 IR 中所有 `crossRef` 的 `targetId` 得到） |
| R-5 | 不让 `ext_…` 进入 XML：无编号公式、行内公式、警告、摘录、代码、列项、索引条目等不输出占位 id；`mml_m<k>`、`df_<k>` 由渲染器按输出顺序分配 | `resolve.ts` 第 556–558 行、第 623–625 行 | 增加“XML 输出中不得出现 `ext_`”的断言/测试 |
| R-6 | 固定常量 id（`sec_foreword`、`sec_intro`/`sec_0`、`sec_bibl`、`sec_index`）不属于 Resolver 编号，但须纳入 xmlId 唯一性检查 | 渲染器 | 新增 xmlId 唯一性校验：现行 `registerId` 只检查 NodeId，不检查生成的 xmlId 是否重复 |
| R-7 | 引言子条：Resolver 为 `front.introduction` 的条给 `0.<n>` 编号并派生 `sec_0.<n>` | 需 WP6 扩展 IR | 当前 IR 不含此结构 |
| R-8 | 规范性引用条目：`ref_<n>`（n 为清单内序号） | 需 WP6 扩展 IR | 当前 IR 不含此结构 |
| R-9 | 交叉引用 `rid` 只能指向“有 id 方案”的目标；`targetKind` 为 `paragraph` 或列项时导出报告 | `checkXrefs`、`checkTypedReferences` | 与 T 的第 10 章分片对齐 |

不变更：章、条、无标题条、附录、附录条、术语条（`sec_<编号>`）、表（`tab_<编号>`）、图（`fig_<编号>`）、有编号公式（`formula_<编号>`）、脚注（`fn_<序号>`）。

## 3. 校验包需求

### 3.1 原文给出的版本线索（逐处）

| 线索 | 位置（印刷页/PDF 页） | 内容 |
|---|---|---|
| DOCTYPE 示例 | 4.1 2/6 | `<!DOCTYPE standard SYSTEM "NISO-STS-extended-1-mathml2.dtd">`：extended 标签集、MathML 2 |
| `processing-meta` 示例 | 4.3.2 6/10 | `base-tagset="interchange"` `mathml-version="3.0"` `table-model="xhtml"` `terminology-model="tbx"` `math-representation="mathml"` `tagset-family="sts"`：interchange 标签集、MathML 3.0 |
| 标签库版本 | 表 C.1 引言 56/60；表 D.1 引言 64/68 | “更多关于标签/属性的描述参见 https://www.niso-sts.org/TagLibrary/niso-sts-TL-1-2-html/index.html”：**NISO STS 1.2** 标签库 |
| MathML | 表 C.1 行 54 59/63 | `mml:math` 为 MathML 标签集文档，规范页 https://www.w3.org/TR/MathML3/ 或 https://www.w3.org/TR/MathML2/ |
| 命名空间 | 4.1 2/6 | `xlink` = `http://www.w3.org/1999/xlink`；`mml` = `http://www.w3.org/1998/Math/MathML`；`tbx` = `urn:iso:std:iso:30042:ed-1` |
| TBX | 9.2.1 注 35/39（T 的范围） | TBX 元素说明页 https://www.iso.org/schema/nisosts/v0.2/doc/tbx/index.html |
| 表格模型 | 6.1 20/24；表 D.1 行 12 65/69；3.2 | 采用 XHTML 标记表；`rules` 属性“定义在 XHTML 1.1 表格的行和列之间绘制的规则” |
| 旁证（ISO 源指南） | `rules/guidelines_for_coding_iec_and_iso_standards_in_nisosts_ed.2.1.pdf` | “This document applies to NISO STS 1.2 (2022)”；`processing-meta` 示例与本标准完全相同（interchange / 3.0 / xhtml / tbx / mathml / sts）；`processing-meta` 是 `standard` 的首个子元素 |

### 3.2 结论：WP8 需要固定的 schema

- **NISO STS 1.2（2022）· interchange 标签集 · MathML 3.0 · XHTML 表格 · TBX**。依据：`processing-meta` 示例（原文唯一以属性形式声明标签集与 MathML 版本之处）、附录 C/D 的 Tag Library 版本号 1.2、ISO 源指南的同一组声明。
- 4.1 示例的 DOCTYPE 文件名（extended、mathml2）与上述声明**互相矛盾**，**不沿用**（`docs/wp8-xml46687.md` §2 已要求“不能仅复制示例文件名”）。这是对原文冲突的取舍，不是原文的直接规定，需主导人/用户确认（D-S-03）。
- 原文没有给出可下载的 DTD/XSD 及其文件名。按示例文件名的命名规律，interchange + MathML 3 的 DTD 文件名可能是 `NISO-STS-interchange-1-mathml3.dtd`，**未核实**。
- 本环境无外网（访问 `www.niso-sts.org` 返回 `ENOTFOUND`），因此**没有取得任何 schema 文件，也没有做过任何结构校验**；第 1 节中涉及“DTD 是否接受某元素/顺序”的结论均标为“未核实”。

### 3.3 需要取得的文件与来源

| 文件 | 用途 | 原文是否给出来源 | 状态 |
|---|---|---|---|
| NISO STS 1.2 interchange DTD（MathML 3 变体），可选对应 XSD/RNG | 结构校验（语法之上的元素位置、属性、基数） | 只给标签库说明页（https://www.niso-sts.org/TagLibrary/niso-sts-TL-1-2-html/index.html）和站点（ISO 源指南：https://www.niso-sts.org/）；**没有下载页或文件名** | 未取得，需要联网环境或用户提供，并记录文件哈希与版本 |
| MathML 3.0 DTD/XSD（W3C） | `mml:math` 校验 | 只给规范页 https://www.w3.org/TR/MathML3/，不是 schema 文件 | 未取得 |
| TBX 模块 | `tbx:*` 校验 | 只给说明页（见 3.1）；NISO STS DTD 是否内含 TBX 定义**未核实** | 未取得 |
| 国标扩展 schema | 覆盖原文使用、但 NISO STS 未必定义的元素/属性 | 原文没有，需项目自写并标注“项目实现约定，非官方” | 需编写；清单见下 |

国标扩展需要覆盖的内容（以选定 DTD 实测为准：用 DTD 对 matrix 中每个“导出 required/optional”的元素逐个试验，实测不通过者才进入扩展）：
- 表 C.1 备注“中国标准特有”：`ccs`、`implementation-date`、`equivalence`。
- 4.3.2 / 表 C.1 出现、是否属于 NISO STS **未核实**：`std-type`、`std-supersedes`、`std-org-group`、`std-org-level`、`std-org-role`、`std-org-type`。
- 位置：4.1 示例把 `ics`、`ccs` 放在 `title-wrap` 之前，附录 G 与 ISO 源指南相反，所选 DTD 是否对 `std-meta` 子元素顺序敏感**未核实**。
- 由 T 负责的元素（`colwidth`、`custom-type`、`ext-link-type`、`graphic` 的 `content-type`、`fig-group` 等）不在本分片范围内。

### 3.4 原文示例不能直接当校验样例

以下写法在 XML 层面不合法或与原文其他位置冲突，所有 fixture 必须由实现重新生成，不得逐字复制原文示例：`align=center`（属性值无引号，5.8，18–19/22–23）；`<attrib @specific-use="source">`（5.9，19/23）；`<std-xref type="revises"/>` 之后独立的 `<std-ref>`（附录 G，71/75）；`<ref-list content-type="bibr">`（47/51）；`sec-type="norm_refs"`（10/14）；`<edition/>` 空元素（3/7）；`<label/>` 空元素与缺失并存（18/22）；4.5.3.3 示例里 `ref id="biblref_1"` 对应的 label 是 `[5]`（13/17）。

### 3.5 校验层次与本分片可检查的语义规则

1. 语法：XML 1.0 格式良好、UTF-8、命名空间。
2. 结构：用选定 DTD/XSD + 国标扩展，记录工具与版本。**当前不可执行**（缺文件）。
3. 语义（本分片给出的可检查规则，不依赖 DTD）：
   - V-1：`id` 唯一，符合 XML Name；`rid` 全部可解析。
   - V-2：`sec-type` 取值与位置（front：foreword/intro；body 顶层：scope/norm-refs/terms；`numbered-paragraph` 的 `sec` 无 `title`）。
   - V-3：`app/@content-type` ∈ {informative, normative}；`ref-list/@content-type` ∈ {norm-refs, bibl}。
   - V-4：`release-date`、`implementation-date` 为 `YYYY-MM-DD`，不得把实施日期放进 `release-date`，两者不得同时用 `date-type` 重复表达。
   - V-5：`list/@list-type` ∈ {alpha-lower, arabic, roman-lower, dash, bullet}；无序列项不带 `label`。
   - V-6：`processing-meta` 五个固定属性值符合 C-S-04；`std-meta` 内 `title-wrap` 均带 `xml:lang`。
   - V-7：XML 内不得出现 `ext_` 开头的 id；不得出现 `Formula`、`id-<uuid>`、`p-<数字>` 形式的 id。
4. 往返与互操作：由 WP8.3/8.5 负责。

## 4. 原文自相矛盾与排印疑点清单（本分片范围）

处理方式见括号内的约定编号。凡未写“T”的均属第 4～5 章与附录 C～G。

| # | 位置（印刷页/PDF 页） | 现象 | 处理 |
|---|---|---|---|
| 1 | 表 1，5/9 | 第 4 行首格写作“〈sec〉〈body〉编号为 2 的〈sec〉”，疑为“〈body〉编号为 2 的〈sec〉”之误排 | 不影响取值（norm-refs） |
| 2 | 4.1 骨架 4/8 与 4.5.2.2 示例 12/16 | 附录性质写作 `inform-annex`、`inform_annex`，而 4.2、表 1、4.5.2.1 文字为 `informative`/`normative` | C-S-07 |
| 3 | 4.4.2.3.2 示例 10/14 | `sec-type="norm_refs"`、`content-type="norm_refs"` 用下划线，其余 5 处为连字符 | C-S-06 |
| 4 | 4.4.2.1 示例 9/13 与 4.4.2.5 11/15 | 同属无标题条，前者没有 `sec-type="numbered-paragraph"` | C-S-08 |
| 5 | 4.3.4 示例 2 7/11 | 引言含无标题条时写 `sec_intro`，后继条却是 `sec_0.1`，与文字规则不符 | C-S-10 |
| 6 | 4.1 2/6 与 4.3.2 6/10 | DOCTYPE 为 extended/mathml2，`processing-meta` 为 interchange/3.0 | 第 3 节、D-S-03 |
| 7 | 4.1 骨架 2–4/6–8 | 整体骨架不含 `processing-meta`，4.3.2 只说“直接置于 standard 下”，示例 2 的“……”在它之前 | C-S-04、D-S-02 |
| 8 | 4.1 3/7 与附录 G 71/75 | `std-meta` 子元素顺序不同；4.1 示例 `<edition/>` 空元素 | C-S-11、C-S-14 |
| 9 | 4.1 3/7、4.3.2 6/10、表 C.1 行 40/67 58/62、60/64、表 F.1 行 4–5 69/73、附录 G 71/75 | 实施日期有三种写法/结论：`release-date[date-type=implemented]`、`implementation-date`、表 F“—”；表 D.1 没有 `date-type` | C-S-12、D-S-01 |
| 10 | 4.3.2 6/10 | 列表含 `issue-agencies`、`std-org-name`，表 C.1 无 `issue-agencies`；`std-type`、`equivalence`、`std-supersedes` 无内容模型与示例 | C-S-15、C-S-18 |
| 11 | 表 C.1 行 31 57/61 与 58/62、表 F.1 行 25 69/73、行 23 | `std-indent`（应为 `std-ident`）；`permission`（应为 `permissions`） | 按正确名称处理 |
| 12 | 表 C.1 行 112、113 63/67 | `title` 重复列出两行 | 无影响 |
| 13 | 表 D.1 行 3 64/68 | 备注写作 `<name-content>`（应为 `named-content`）；`content-type` 属性值只列 bibl、index，而正文用了 informative、normative、norm-refs、variable、warning、dimension、disp_table、image 等 | 以正文为准 |
| 14 | 表 D.1 行 9 65/69 与 10.1.1 44/48（T） | `ref-type` 值 D 表列 9 个，10.1.1 列 abbreviation、app、bibr、custom、disp-formula、fig、fn、sec、table、table-fn（D 表缺 abbreviation、app、custom；有 chem、list） | 详见 T |
| 15 | 表 D.1 | 没有 `date-type`、`std-org-level`、`std-org-role`、`std-org-type`、`xml:lang`、`std-ref/@type`、`std-xref/@type`、`page-count/@count`、`custom-type`、`ext-link-type`、`colwidth`、`border`、`display` 等正文或示例中使用的属性 | D 表不完整，不能作为属性白名单 |
| 16 | 表 C.1 | 没有 `named-content`、`inline-code`、`index-title-group`、`index-div`、`index-entry`、`see-entry`、`issue-agencies`、`col-group`、`fig-group`（表 F.1 行 15 用到），`std-ident` 写法见 #11；表 C.1 行 13 为 `colgroup`，而 5.8 示例为 `col-group` | C 表不完整，不能作为元素白名单 |
| 17 | 附录 G 71/75 | `doc-type` 为 `standard`（4.1 为 `GB/T`）；`part-number` 为 1 而 `std-ref` 为 .3；`<std-xref type="revises"/>` 后另有独立 `<std-ref>`；日期以 `custom-meta` `issue-date` 表达 | C-S-14、C-S-18、C-S-21 |
| 18 | 4.5.3.1 12/16 与 4.5.4 13/17 | 参考文献“通常是后置页中的最后一个元素”，索引却“位置在参考文献之后” | C-S-01 |
| 19 | 4.4.2.3.2 10/14、4.5.3.2 13/17 与 4.5.3.1 12/16、10.1.6 47/51 | `std-ref` 与 `title` 之间有的有逗号文本，有的没有 | C-S-24 |
| 20 | 10.1.6 示例 47/51（T） | `ref-list content-type="bibr"`；`rid="bibrref_4"`、`rid="bibl_1"` 与目标 `biblref_N` 不符；4.4.2.1 示例 9/13 也写 `bibrref_1` | C-S-27、2.3 |
| 21 | 4.5.4 示例 14/18、5.7.3 示例 17/21 | `sec-index`、`sec-7.1` 用连字符，E.1 为 `sec_index`、`sec_<编号>` | 2.3 |
| 22 | 5.7.3 示例 18/22 | 无序列表第 1 项无 `<label>`，第 2～5 项为空 `<label/>`；list/list-item/p 带 id，与 E.1 相反 | C-S-32、2.3 |
| 23 | 附录 E 67–68/71–72 与 10.1.3 45/49（T） | E.1 称注、示例、段无 id，10.1.3 的交叉引用示例却需要注有 id | X-14、D-S-09 |
| 24 | 附录 E 67/71 | “无正文”行（参考文献、公式、脚注、表脚注）字面含义不清 | X-10、X-23 |
| 25 | 附录 E 67/71 与 9.1、9.2.1 35/39 | 术语条目 id：`te_`（E.1）与 `term_`（正文）；`con-3.1.6`（9.2.6，T） | X-12 |
| 26 | 6.2.3 21/25（T） | 表脚注 id 文字写 `table_fn_3.1`，标记写 `table-fn_3.1`，E.1 为 `table-fn_…` | X-24 |
| 27 | 7.1、7.3、7.4 27–29/31–33（T） | 公式 id 写 `Formula_1`、`Formula1`，E.1 为 `formula_1`；行内 `m1` 与 7.4 文字 `mml_m[number]` 不符 | X-21、X-22 |
| 28 | 6.2.5 23/27（T） | “表 C.1”写作 `tab_4` | X-19 |
| 29 | 5.8 18–19/22–23、5.9 19/23 | `align=center` 无引号；`<attrib @specific-use=…>` 带 `@`；`col-group`/`colwidth` 与表 C.1/D.1（`colgroup`/`width`）不一致 | C-S-35、C-S-36 |
| 30 | 前言 III/3 | 前言称“删除了资料性附录 A、附录 B、附录 D、附录 E”“增加了附录 C、D、F”，而现文件有附录 A～G，其中 A、B、E、G 的来源未在前言交代 | 无影响 |
| 31 | 附录 B 55/59 与 8.2 31/35（T） | B.1 称 8.2 增加“图形文件的名称宜与图的 @id 属性相匹配，如图 1 表示为 fig_1”，8.2 正文没有这句 | 详见 T；`fig_<编号>` 采用 |

## 5. 需主导人/用户决定的事项

| 编号 | 事项 | 选项 | 本分片倾向 | 影响 |
|---|---|---|---|---|
| D-S-01 | 实施日期的 XML 形式（C-S-12） | A：`release-date`（发布）+ `implementation-date`（实施）；B：两个 `release-date`，用 `date-type="published"`/`"implemented"` 区分 | A（4.3.2 与表 C.1 明确给出专用标签并标“中国标准特有”；D.1 没有 `date-type`）；导入同时接受 B | 原文自相矛盾，无权威澄清；改选 B 只需改渲染器一处与校验规则 V-4 |
| D-S-02 | `processing-meta` 的位置与 `custom-meta` 的值（C-S-04） | 位置：standard 首个子元素 / 末尾；`meta-value`：2025 / 2026 | 首个子元素；2026 | 低 |
| D-S-03 | 固定 STS 标签集与 MathML 版本（第 3 节） | interchange + MathML 3.0 / extended + MathML 2（DOCTYPE 示例） | interchange + MathML 3.0 | 决定校验包与 `mml:math` 的转换目标 |
| D-S-04 | 国标扩展 schema 的编写与责任（第 3.3 节） | 项目自写并标注非官方；或等待官方 DTD | 项目自写，且必须在取得 DTD 后实测再定范围 | 结构校验验收（WP8.5）的前提 |
| D-S-05 | `equivalence`、`std-type`、`std-xref/std-supersedes` 的内容模型（C-S-18） | 暂不导出并报告“未表达”；或由用户给出样稿/官方说明 | 暂不导出并报告 | `adoptions`、`standardType`、`replacedStandards` 的导出保真 |
| D-S-06 | `IRInline.style` 在导出时的处理（C-S-29） | 报错阻断；或提示后允许用户确认丢弃 | 报错并给出位置，由用户确认后才允许丢弃 | 影响“颜色/字号”等现有编辑能力的 XML 导出 |
| D-S-07 | `monospace` 的导入归并（C-S-29、C-S-33） | 归并为 `code` 标记（再导出变 `inline-code`）；或拒绝 | 归并并告警 | 语义轻微变化 |
| D-S-08 | 规范性引用文件的结构化（C-S-24） | ①扩展 IR 增加结构化条目；②对段落做启发式拆分 `std-ref`/`title`；③一律 `mixed-citation` | ① | 与 WP6 的 IR 扩展对齐；③有效但弱于“标准化文件宜用 std” |
| D-S-09 | 一般注/示例的 `id`（X-14、X-15） | 全部输出；或仅被引用者输出 | 仅被引用者输出 | 同时满足 E.1 与 10.1.3 |
| D-S-10 | 引言中的条（C-S-10） | 扩展 IR；或暂不支持并拒绝导入 | 扩展 IR | 与 WP6 对齐 |
| D-S-11 | 多值元数据（多 ICS 号、多份版权声明）（C-S-17、C-S-19） | 拒绝并说明；或约定分隔符 | 拒绝并说明 | 避免伪造 |
| D-S-12 | 术语条目 id 前缀（X-12） | `term_`（正文）/ `te_`（附录 E） | `term_` | 与 T 的分片一致 |
| D-S-13 | `custom-meta` 的 SES 专有字段名称（C-S-21） | 小写连字符名称（建议）；或带前缀 | 小写连字符 | 低 |

## 6. 旧格式判别特征

目的：新格式导入必须**明确拒绝**旧格式，不尝试转换（`docs/wp8-xml46687.md` §1、§6）。两种旧格式都使用 `standard` 根元素，旧解析器 `packages/client/src/serializer/xmlParser.ts` 第 57 行只检查 `root.tagName === 'standard'`，因此**不能根据 `.xml` 扩展名或根元素名判别**。

### 6.1 GB/T 37967—2019（真正的 37967）

依据：`rules/GBT+37967-2019.pdf_by_PaddleOCR-VL-1.6.md`（表 1 命名空间前缀、表 2～7 元素、附录 A 结构、附录 C 实例；OCR 稿，仅作特征识别）。

| 特征 | 内容 |
|---|---|
| 顶层结构 | 根 `<standard>` 之下的一级元素是 **`content`、`edit`、`execute`**（附录 A 的结构说明与附录 C 的 GB/T 15799 实例：`<standard><content>…</content>…`，`edit`、`execute` 分别承载编制信息与实施信息） |
| 命名空间 | 表 1 的前缀与 URI：`content` = `http://www.xmlgb.org/xcontent`，`edit` = `http://www.xmlgb.org/xedit`，`execute` = `http://www.xmlgb.org/xexecute` |
| 元素名风格 | 全部为下划线小写：`basic_info`（含 `cn`、`en lang="en"`、`ics`、`ccs`、`gbn`、`isd`、`efd`）；`auxiliary_info`（`catalogue`、`clg_item`、`clg_id`、`clg_name`、`preface`、`introduction`、`scope`、`normativereference`、`n_docum`、`appendix`/`append`、`apd_item`、`apd_id`、`apd_body`）；`term`（`t_item`、`t_id`、`t_cn`、`t_en`、`t_def`、`t_note`、`t_exp`）；`technology`（`tech_item`、`tech_itid`、`tech_itname`、`tech_paragraph`、`tech_paraid`、`tech_paraname`、`tech_part`、`tech_ptid`、`tech_ptname`、`tech_ptbody`）；`edit`（`mode`、`time`、`expert`、`ep_name`…）；`execute`（`feedback`、`fb_source`、`fb_info`）；`pic src=…` |
| 其他 | 正文用 `<![CDATA[…]]>` 包裹；示例的 XML 声明为 `encoding="GB2312"`（附录 C）或 `"GB 2312"`（附录 A） |

### 6.2 SEP 早期自定义格式

依据：`packages/client/src/serializer/xmlSerializer.ts`（第 373–374、462–545、547–558、700、1050 行等）与夹具 `packages/client/src/serializer/__fixtures__/sample-standard.xml`。

| 特征 | 内容 |
|---|---|
| 命名空间 | `<standard xmlns="urn:csbts:std:xml:1.0">`，**默认命名空间**，全部元素都在该命名空间内 |
| 前言/引言位置 | `<body>` 内以 `<foreword>`、`<intro>` **元素**出现；新格式是 `front` 内带 `sec-type` 的 `sec` |
| `std-meta` | 直接含 `<std-ref>`；`<std-ident>` 内放 `<ics>`/`<ccs>`；`<title-wrap lang="zh">`（属性名为 `lang`，无 `xml:` 前缀，仅含 `<main>`）；`<pub-date>`；`<release-date>`（实为**实施日期**）；`<std-type>national</std-type>`（英文枚举值）；`<std-org><std-org-name>`（无 `std-org-group`）；`<custom-meta-group content-type="ses-cover">` |
| 章条 | `<sec id>` 没有 `<label>`、没有 `sec-type`；无标题条写 `content-type="untitled"`（新格式为 `sec-type="numbered-paragraph"`） |
| 术语 | `<term-sec id="term_…">` 内含 `<term><preferred><term-name>`、`<admitted>`、`<def><p>`、`<term-note>`、`<term-example>`（非 TBX，无 `tbx:` 命名空间） |
| 附录与参考文献 | `<app id="app_A" content-type="normative|informative">`，没有 `label`、`annex-type`；`<ref-list>` 没有 `content-type`/`id` |
| 其他 | 公式用 `<tex-math><![CDATA[…]]></tex-math>`；表脚注 `<fn fn-type="table">`；`<caption lang="en">`；id 形式 `app_<字母>`、`bib_<n>`、`tabfn_…`（均不属于新格式） |

### 6.3 新格式的正向特征（必须同时成立）

1. 根元素 `standard`，**无默认命名空间**；含 `tbx:`/`mml:`/`xlink:` 内容时，对应前缀必须绑定到 C-S-03 规定的 URI。
2. 根的子元素只能是 `processing-meta?`、`front`、`body`、`back?`；不得出现 `content`、`edit`、`execute`。
3. `front` 内是 `std-meta` 与带 `sec-type="foreword"`/`"intro"` 的 `sec`；`body` 内全是 `sec`（章），不得出现 `foreword`、`intro` 元素。
4. `title-wrap` 带 `xml:lang`；章/条有 `label`；无标题条为 `sec-type="numbered-paragraph"`；术语为 `term-sec` 内的 `tbx:termEntry`；公式为 `mml:math`。
5. 不得出现旧特征：`pub-date`、`std-type` 的英文枚举值、`fn-type`、`tex-math`、`content-type="untitled"`、`preferred`/`term-name`、`term-note`/`term-example`、`urn:csbts:std:xml:1.0`、`xmlgb.org` 命名空间、`basic_info` 等下划线元素、非 UTF-8 编码声明。

判别顺序建议：安全解析（禁外部实体） → 命名空间与编码检查 → 顶层结构检查 → 旧特征命中表（命中即报“旧格式 XML（GB/T 37967 或 SEP 早期自定义格式），本版本不再支持”，并说明命中的特征及位置） → 固定 schema 与语义校验。验证“拒绝”的负例夹具：`__fixtures__/sample-standard.xml`（SEP 早期格式）与 37967 附录 C 实例（37967），**不得**作为新格式 golden。
