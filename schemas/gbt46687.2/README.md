# GB/T 46687.2—2026 项目自写 RELAX NG schema（0.1.0）

**性质：项目实现约定，非官方。** 本目录的 schema、样例和 `scripts/xml46687/` 下的校验工具，是 SES 项目依据 GB/T 46687.2—2026 原文与
[WP8.1 支持矩阵](../../docs/wp8.1/README.md) 自行编写的，不是国家标准、不是 NISO 的官方文件，也不等同于官方 NISO STS DTD。

按 [docs/wp8.1/README.md](../../docs/wp8.1/README.md) 3A 的用户决定（D-S-03 / D-T-04 / D-S-04）：**结构校验以本 schema 为主，官方 NISO STS 1.2 DTD 为辅**。
本 schema 是 WP8 的结构验收基准。它最初完全由原文与矩阵推导（因此“不算独立证据”）；官方 DTD
（`schemas/niso-sts-1.2/`，2026-10-21 收录）到手后，用 `scripts/xml46687/sts_compat.py` 做了兼容性检查，
这次检查才是独立证据：见第 8～9 节。

## 1. 文件

| 文件 | 内容 |
|---|---|
| `ses-gbt46687-2.rng` | 主文件：文件头（依据、性质、版本、与 NISO STS 1.2 的关系）、include 各模块、start |
| `common.rng` | 公共属性（id、xlink、xml:lang）、数据类型、行内内容类别（cm.inline/mark/phrase/label/term/citation/subsup）、label/title/p |
| `refs.rng` | xref、ext-link、uri、fn、std、std-ref、mixed-citation、ref-list、ref |
| `metadata.rng` | processing-meta、std-meta（title-wrap、std-ident、std-org、日期、permissions、custom-meta…） |
| `body.rng` | standard/front/body/back 骨架、各类 sec、term-sec、app、index、list、注/示例/警告、摘录、array、代码 |
| `table.rng` | 表（XHTML 模型）：table-wrap、caption、table、col/colgroup、thead/tbody/tr/th/td、table-wrap-foot |
| `figure.rng` | fig、fig-group、graphic、inline-graphic、legend、def-list/def-item |
| `math.rng` | disp-formula、disp-formula-group、inline-formula、mml:math（MathML 3 宽松子 schema） |
| `tbx.rng` | tbx:termEntry/langSet/tig/term/definition/note/example/source/subjectField/entailedTerm/partOfSpeech/… |
| `samples/valid/` | 9 个手写正例：01～06 选用形式；07 “仅导入接受”的异写汇总；08 原文明确写法与 STS 1.2 不一致的情形（国标扩展、示例冲突）；09 格式合法但导入暂拒的写法 |
| `samples/invalid/` | 54 个负例，每个由同一基底文档单点改动生成，文件开头的注释写明违反项 |
| `../../scripts/xml46687/validate.py` | 校验工具（语法 + RELAX NG 双实现 + 语义规则） |
| `../../scripts/xml46687/sts_compat.py` | 官方 NISO STS 1.2 DTD 兼容性检查（已知国标扩展白名单 + 未解释偏差） |
| `../../scripts/xml46687/test_validate.py` | unittest 回归测试 |
| `../../scripts/xml46687/matrix_coverage.py` | 矩阵 → schema 覆盖检查 |
| `../../scripts/xml46687/gen_invalid_samples.py` | 由基底文档单点改动重新生成 `samples/invalid/`（测试确认仓库里的负例与生成结果一致） |

## 2. 设计依据

| 模块 | 原文条款 | 约定 | 矩阵行 |
|---|---|---|---|
| `body.rng`（骨架、章条） | 4.1～4.5、表 1、附录 E | C-S-01、C-S-06～10、C-S-23～28、X-01～26 | M-4.x、M-E-xx |
| `body.rng`（条文块） | 5.2、5.3、5.6、5.7、5.8、5.9、5.10 | C-S-31～33、C-S-35、C-S-36 | M-5.x |
| `common.rng` | 5.1、5.4、5.5、表 D.1 | C-S-29、C-S-30、C-S-34 | M-5.1-xx、M-5.5-xx |
| `metadata.rng` | 4.1 示例、4.3.2、表 C.1、表 F.1、附录 G | C-S-04、C-S-11～22 | M-4.3.2-xx、M-F-xx、M-G-xx、M-C-0x |
| `table.rng` | 第 6 章、附录 C/D | C-T-01～16 | M-6.x、M-C.1-0x |
| `math.rng` | 第 7 章 | C-T-17～25 | M-7.x |
| `figure.rng` | 第 8 章、7.3、10.1.4 | C-T-22、C-T-26～35、C-T-51 | M-8.x、M-7.3-xx、M-10.1.4-xx |
| `tbx.rng` | 第 9 章、附录 C | C-T-36～47 | M-9.x、M-C.1-06～09 |
| `refs.rng` | 4.4.2.3、4.5.3、第 10 章 | C-S-24、C-S-27、C-T-48～56 | M-10.x、M-4.5.3-xx |

用户决定（3A）的落实：`release-date`（发布）+ `implementation-date`（实施），4.1 示例的 `date-type` 写法仅导入接受；
术语条目 id 不限定前缀（导入时 id 不透明），`tbx:termEntry` 用 `term_<编号>` 是导出规则；
注/示例/列项只在被引用时带 id（schema 里 id 一律可选）；`processing-meta` 六个属性值固定为 interchange / 3.0 / xhtml / tbx / mathml / sts；
33 个必做缺口对应的元素（legend、inline-graphic、fig-group、subjectField、ref/std、引言中的条、嵌套列项…）全部收入 schema。

## 3. 设计要点

1. **语法与分模块**：RELAX NG XML 语法（不是 compact 语法），主文件 `include` 各模块；模块只有 `define`，没有 `start`。
2. **命名空间**：STS 元素无命名空间；`xlink`、`mml`、`tbx` 的 URI 与前缀见主文件头。RELAX NG 约束的是 URI，不是前缀名；
   命名空间声明本身不是属性，RELAX NG 无法约束，`validate.py` 在旧格式判别中检查根元素命名空间。
3. **元素顺序（2026-10-21 主导人决定）**：46687.2 原文没有规定 `std-meta` 子元素顺序（4.1 示例、附录 G、ISO 源指南三处互不相同），
   而且它在 NISO STS 1.2 之上修改采用，因此**采用官方 DTD 的顺序，去掉 interleave**。国标扩展元素按原文 4.3.2、表 C.1、附录 G 的相对位置
   插入 DTD 顺序里最贴近的位置：`std-type` 在最前，`ccs` 紧随 `ics`，`implementation-date`、`equivalence` 紧随 `release-date`，
   `std-supersedes` 紧邻 `std-xref` 之前（理由写在 `metadata.rng` 文件头）。
   **已知后果**：原文 4.1 示例（印刷页 3）把 `ics`、`ccs` 写在 `title-wrap` 之前，按那个顺序写的文档会被本 schema 拒绝，需要调整顺序。
   其余元素（章条、图、表、术语等）在 STS 1.2 能给出确定内容模型而原文没有另行规定的地方，也按 DTD 取顺序（见第 9 节）。
4. **sec-type 与位置**：用不同的 `define` 表达位置约束——`front` 内 `foreword`/`intro`；`body` 顶层 `scope`/`norm-refs`/`terms`（及仅导入接受的 `norm_refs`）；
   其下的条 `numbered-paragraph` 或不写；其他取值（表 D.1 行 13 称“可以采用任何值”，STS 1.2 的 `sec-type` 为 cdata）接受，`validate.py` 告警。
   “numbered-paragraph 的 sec 不含 title”这类跨元素规则留给 V-2。
5. **属性取值的两种处理**：约定表写“拒绝”的取值用 `choice` 枚举（`list-type`、`ref-type`、`custom-type`、`app/@content-type`、
   `ref-list/@content-type`、`tbx:partOfSpeech`、`tbx:grammaticalNumber`、`tbx:termType`、`tbx:normativeAuthorization`、`orientation`、`frame`、`rules`、`align`、
   `valign`、`table-wrap/@position`、`specific-use` 的尺寸档位等）；约定表写“告警后保留/忽略”的取值用“已知值 + 其他 token”，由 `validate.py` 告警
   （`named-content/@content-type`、`graphic/@content-type`、`ext-link/@ext-link-type`、未知 `sec-type`）。
6. **“仅导入接受”的异写**（schema 接受，导出不得使用；schema 注释标 `[仅导入接受]`）：
   `sec-type="norm_refs"`、`ref-list/@content-type` 的 `norm_refs`/`bibr`、`app/@content-type` 的 `inform-annex`/`inform_annex`、
   `release-date/@date-type`、`<monospace>`、`xref/@ref-type` 的 `chem`/`other`、`valign="center"`、`table-wrap/@position`、`std-ref` 内的 `edition`，
   以及**唯一保留的术语异写元素名 `tbx:normativeAuthentication`**（9.2.3 印刷页 37 三处真实出现，主导人对照原图确认）。
   `validate.py` 默认（`--profile import`）对它们告警（规则 `IMPORT-ONLY`），`--profile export` 视为错误，并同时拒绝 DOCTYPE。
   其余四个术语异写元素名 `tbx:term-entry`、`tbx:Definition`、`tbx:normative-Authorization`、`tbx:grammatical-Number`
   只在说明文字或附录 C 断行处出现、示例代码从未使用，疑为原文笔误，**已从 schema 删除**，`validate.py` 以 `REJECT` 报“疑为原文笔误”。
7. **MathML 3**：只写了“结构宽松、命名空间严格”的子 schema：`mml:math` 根（`display` 取 block/inline，`id` 为 NCName），其内允许 MathML 命名空间中的任意元素、属性和文本。
   MathML 内容模型的严格校验由官方 DTD 兼容检查承担：NISO STS 1.2 Interchange（MathML3）DTD 已内嵌 MathML 3 的内容模型，
   `sts_compat.py` 对给定文件中的 `mml:math` 一并按该 DTD 校验。本项目不复刻官方 MathML schema。事件属性（`on*`）、`javascript:` 链接等由 `validate.py` V-10 检查。
8. **import:reject 的两类（rejectKind，2026-10-21）**：矩阵里 `import` 为 `reject` 的 30 行都带 `rejectKind`——
   `format`（24 行，格式层面不收：tex-math、alternatives、tfoot、fn-group、issue-agencies、std-doc-meta、tbx:see、term-display、target、col-group、
   无前缀 mtext、四个术语异写元素名，以及“语境拒绝”：嵌套表、caption 内第二个 title、fig 内的 fn、tbx:source 内的 std、嵌套 termEntry、
   `-admn-sts` 取值、`tbx:definition/@target`）：不出现在 schema 中，`validate.py` 报 `REJECT` 错误；
   `implementation`（6 行，格式本身接受、导入器因 IR 缺口暂拒：引言中的条 M-4.3.4-02/03、5.8 的 `array` M-5.8-01/M-C.1-04、
   `disp-formula-group` M-C.1-05、同一脚注多次引用 M-10.1.8-04）：**收入 schema**，`validate.py` 只告警 `W-IMPL-REJECT`/`W-FN-MULTIREF`（样例 09）。
9. **schema 比标准窄的地方**（来自用户确认的约定，不是原文禁止）：表 C.1 列出的 `tfoot`、`std-doc-meta`、`tbx:see` 及 `issue-agencies`、`fn-group`、
   `tex-math`、`alternatives` 等 format 类 reject 元素不在 schema 中；`list-type` 不收表 D.1 的 `simple`/`symbol`；
   `std-xref/@type` 只收 `revises`；`td/@scope` 只收 `row`；`processing-meta` 六个属性必须齐全且取固定值（导入容忍度属导入器）；
   `ref-list/@content-type`、`title-wrap/@xml:lang`、`named-content/@content-type` 必备。
10. **id**：`NCName`（无冒号的 Name，与 `xml:id` 一致）。约定表写“Name 产生式”，只差带冒号的 id，实际无影响。
11. **std-meta 的“必填”**：SES 对 `std-org-group`、`content-language`、`release-date`、`implementation-date` 的必填要求不写进格式 schema
    （避免最小文档也被拒绝）。**更严的导出档不在本任务做，留 WP8.2：由渲染器侧强制 SES 必填元数据**（主导人 2026-10-21 决定）。

## 4. 与矩阵的对应方式

`scripts/xml46687/matrix_coverage.py` 遍历 `docs/wp8.1/matrix-S.json`、`matrix-T.json`（共 391 行），对下列 362 行做检查：
**export 为 required/optional，或 import 为 required/accept，或 import 为 reject 且 `rejectKind` 为 `implementation`**。

- 从行内 `element` 字段解析元素名（去掉括号注释；含中文/空格的片段记为“非元素的说明性条目”），核对 schema 里有对应的 `element`；
- 核对行内 `attributes[]`（宿主为该行的任一元素片段）在 schema 中有对应的 `attribute`，枚举型属性逐值核对；
- `rejectKind=format` 的行：其元素若不在任何需要覆盖的行里出现，则必须**不在** schema 中（整体不收，15 个）；
  同时出现在需要覆盖的行里的（嵌套表里的 `table`、`tbx:source` 里的 `std` 等）是“语境拒绝”，由内容模型或 `validate.py` 的 `REJECT` 规则体现，并各有负例
  （`test_validate.py` 的 `CONTEXT_REJECT_SAMPLES`）；
- `rejectKind` 必须覆盖全部 30 个 `import: reject` 行且只出现在这些行上。

统计结果（`python3 -I scripts/xml46687/matrix_coverage.py`）：矩阵 391 行，纳入覆盖 362 行；需要覆盖的元素 133 个全部定义（含 `mml:` 通配 7 个）；
需要覆盖的（宿主, 属性）组合 107 个全部定义；枚举取值无遗漏；整体不收的 15 个 format 类元素均未混入。schema 共定义 124 个元素名。
矩阵里的 21 个“非元素说明性条目”（XML 声明、DOCTYPE、空格版式、UTF-8 实体、`list-type=…` 取值行等）不是 XML 元素，schema 不表达；
XML 声明/编码与 DOCTYPE 由 `validate.py` 的 SYN-2/SYN-3 检查。

## 5. 校验工具与规则

```
python3 -I scripts/xml46687/validate.py [--json] [--profile import|export] [--no-xmllint] file.xml [...]
python3 -I scripts/xml46687/sts_compat.py [--json] [--list-whitelist] file.xml [...]
python3 -I scripts/xml46687/matrix_coverage.py [--json]
python3 -I scripts/xml46687/test_validate.py -v
xmllint --noout --relaxng schemas/gbt46687.2/ses-gbt46687-2.rng schemas/gbt46687.2/samples/valid/*.xml
```

测试也可以写成 `python3 -m unittest scripts/xml46687/test_validate.py -v` 或 `python3 -I -m unittest discover -s scripts/xml46687 -p "test_*.py" -v`。
**注意**：`python3 -I -m unittest scripts/xml46687/test_validate.py` 不能运行——`-I`（隔离模式）不把当前目录放进 `sys.path`，
unittest 把路径转成模块名 `scripts.xml46687.test_validate` 后找不到 `scripts` 包（Python 行为，与测试内容无关）。

退出码：0 = 全部通过；1 = 有文件未通过（包括 lxml 与 xmllint 结论不一致）。`--json` 输出 `{valid, results:[{file, valid, errors, warnings, engines, engines_consistent}]}`。

| 规则 | 层次 | 内容 | 依据 |
|---|---|---|---|
| SYN-1 | 语法 | 格式良好（禁止 DTD 加载、外部实体、联网：`resolve_entities=False, load_dtd=False, no_network=True`） | C-S-02、C-S-34 |
| SYN-2 | 语法 | XML 声明编码必须是 UTF-8 | C-S-02 |
| SYN-3 | 语法 | DOCTYPE 含内部子集/实体声明 → 拒绝；外部 DOCTYPE 只告警（export 档为错误）；实体引用节点 → 拒绝 | C-S-02、C-S-34 |
| ROOT | 骨架 | 根元素必须是无命名空间的 standard | C-S-01、C-S-03 |
| LEGACY | 旧格式 | GB/T 37967 与 SEP 早期自定义格式的判别特征，命中即拒绝并列出特征与位置，不尝试转换 | conventions-S 第 6 节 |
| RNG | 结构 | lxml RELAX NG 校验（同时调用 xmllint，二者不一致报 CONSISTENCY） | 本 schema |
| REJECT | 拒绝项 | 矩阵 `import: reject` 且 `rejectKind=format` 的元素/用法，给出矩阵行与约定编号 | 各 M-、C- 行 |
| V-1 | 语义 | `id` 合法且唯一；`xref/@rid`、`tbx:entailedTerm/@target` 可解析 | C-S-37、3.5 |
| V-2 | 语义 | `sec-type` 与位置；numbered-paragraph 不含 title；章必须有 title | C-S-06、C-S-08 |
| V-3 | 语义 | `app/@content-type` ∈ {informative, normative}；`ref-list/@content-type` ∈ {norm-refs, bibl}；norm-refs 清单必须在 norm-refs 章内 | C-S-07、C-S-24、C-S-27 |
| V-4 | 语义 | `release-date`/`implementation-date` 为有效的 YYYY-MM-DD；发布日期、实施日期不得用两种写法重复表达（含 `date-type`） | C-S-12、D-S-01 |
| V-5 | 语义 | `list-type` 取值；无序列项不带 label | C-S-32 |
| V-6 | 语义 | `processing-meta` 六个固定属性值；`title-wrap` 带 `xml:lang` | C-S-04、C-S-13 |
| V-7 | 语义 | 不得出现 `ext_`、`Formula…`、`id-<uuid>`、`p-<数字>` 形式的 id | 2.3、R-5 |
| V-8 | 附加 | `xref/@ref-type`（及 `custom-type`、`table-fn` 须同表）与目标元素类型一致；`entailedTerm` 指向 termEntry | C-T-48、C-T-50 |
| V-9 | 附加 | 每个术语条目有且仅有一个定义（跨 langSet；0 个告警） | 附录 C 行 92 |
| V-10 | 附加 | MathML 元素不得带事件属性、`javascript:` 等协议 | C-T-19 |
| V-11 | 附加 | `ext-link` 的 `xlink:href` 协议白名单（http、https、mailto、ftp；相对地址不限） | C-T-56 |
| IMPORT-ONLY | 档位 | 仅导入接受的异写（见第 3 节第 6 点）：import 档告警，export 档错误 | 各 C- 行 |
| W-IMPL-REJECT 等 | 告警 | rejectKind=implementation：格式合法、导入暂拒（引言中的条、array、disp-formula-group），同一 fn 多引用为 W-FN-MULTIREF | 各 M- 行 |
| W-* | 告警 | 不阻断：未知 sec-type、named-content/graphic/ext-link 的非常规取值、`size:T` 用于行内图、有序列项缺 label、annex-type 与 content-type 矛盾、发布日期晚于实施日期、多 rid… | 各 C- 行 |

**两个“实现”并不独立**：lxml（libxml2 2.14.6）与 xmllint（libxml 2.9.14）是同一套 libxml2 RELAX NG 代码的两个版本，二者一致能排除构建/版本差异，
不能替代 jing 之类独立实现（本机没有 jing，也不得新增依赖）。libxml2 的 RELAX NG 报错粗糙（遇到第一处失败即停，信息含元素名但不一定含属性名），
`validate.py` 因此给每条 RNG 报错补上“出错位置”的元素名；语义规则与 `REJECT` 规则同时承担“说明原因”的责任。
真正独立的证据是 `sts_compat.py`（官方 DTD，由 xmllint 的 DTD 校验器执行，与 RELAX NG 路径不同）。

### sts_compat.py：官方 DTD 兼容检查

`sts_compat.py` 用 `xmllint --noout --nonet --dtdvalid schemas/niso-sts-1.2/interchange-mathml3-dtd/NISO-STS-interchange-1-mathml3.dtd` 校验文件，
把报错分成**已知偏差**（命中白名单，列出触发的白名单条目及其依据）和**未解释偏差**（其余全部报错）；有未解释偏差时退出码 1。
白名单（`--list-whitelist`）共 12 条，每条写明类别和原文页码/DTD 事实，见第 9 节表格。
实现上先按白名单对文档副本做规范化（删除国标扩展元素、把异写改成 STS 写法、调整位置），再校验副本：副本上仍存在的报错 = 未解释偏差；
原文档上有、副本上消失的报错 = 已知偏差。行号已映射回原文档。MathML 内容也在此被 DTD 校验。

## 6. 样例

`samples/valid/`（手写，没有逐字复制原文示例——原文示例有已知笔误，见 conventions-S 3.4）：

| 文件 | 内容 |
|---|---|
| `01-minimal.xml` | 最小文档 |
| `02-full-metadata.xml` | processing-meta、双语题名、std-ident、ics/ccs、release-date + implementation-date、std-org、permissions、custom-meta、前言/引言（STS 顺序） |
| `03-structure.xml` | 章、条、无标题条、附录（资料性/规范性）、规范性引用文件、参考文献、索引、列项（含嵌套）、注/示例/警告、摘录、代码、变量符号 |
| `04-tables.xml` | 表头、跨行跨列、`col`、单位段、表注/表脚注（`table-wrap-foot`）、单位、横向表 |
| `05-formulas-figures.xml` | disp-formula/inline-formula + mml:math + legend/def-list、公式注、fig（图例、说明段、多图形、图注、尺寸档位）、fig-group、inline-graphic |
| `06-terms-references.xml` | term-sec + tbx:termEntry（多 langSet、多 tig、描述符、subjectField、note/example、entailedTerm）、缩略语、各类 xref、行内 fn、std、mixed-citation |
| `07-import-variants.xml` | 仅导入接受的异写汇总：import 档通过并告警，export 档不通过 |
| `08-original-forms-vs-sts.xml` | 原文明确写法与 STS 1.2 不一致的情形（5 个国标扩展元素、std-org 多名、xref 内 label、langSet 内 note 在 tig 之后、graphic 在 table-wrap-foot 之后、块级 fn）；两个档位都通过，`sts_compat.py` 列为已知偏差 |
| `09-import-pending.xml` | 格式合法但导入暂拒（rejectKind=implementation）：引言中的条、array、disp-formula-group、同一脚注多次引用；只告警 |

`samples/invalid/` 的 54 个负例按违反项分组（完整清单与预期规则见 `test_validate.py` 的 `EXPECTED_INVALID`）：
语法 3、旧格式/根 3、矩阵 format 类 reject 16（含 4 个术语异写元素名）、V-1 3、V-2 3、V-3 2、V-4 4、V-5 2、V-6 2、V-7 4、V-8～V-11 4、仅 RELAX NG 8
（含按 STS 1.2 收紧后新增的 std-meta 顺序、含子条的条再放段落、partOfSpeech 取值、named-content 缺 content-type、空 table-wrap-foot）。

## 7. 官方 DTD 对照后：`[未核实]` 清单的复核结论（2026-10-21）

最初的 schema 对下列内容取了宽松形式并标“[未核实]”。取得 STS 1.2 DTD 后逐项复核；**DTD 能给出确定内容模型且原文未另行规定的，已按 DTD 收紧并移出本清单**。

| 项 | 原先 | DTD 事实 | 结论 |
|---|---|---|---|
| 行内内容集合 | 所有行内位置共用一个集合 | 各元素的内容集合不同（bold 等不含 break；ext-link、xref 不含引用/脚注/公式；label 不含 ext-link/std；term/see-entry 不含 break/std） | 已收紧：`cm.inline/mark/phrase/label/term/citation/subsup` 七类 |
| std-meta 子元素顺序 | interleave | 固定顺序 | 已收紧（第 3 节第 3 点） |
| `std-xref` | 空元素与嵌套 std-ref 都收 | 内容必须含 `std-ref`（或 std-ident），`type` 必备 | 已收紧：只收嵌套 std-ref |
| `std-org` | name*/abbrev* 任意顺序 | `std-org-name?, std-org-abbrev*, std-org-loc*` | 顺序按 DTD；name 多个是原文 4.1 示例的写法，登记为偏差 |
| `std-org` 的 level/role/type | token | cdata | 确认（token 即可） |
| `permissions` 子元素 | interleave | 顺序固定、各可重复 | 已收紧为顺序 |
| 只含文本的元素 | 行内混合 | originator、doc-type、doc-number、part-number、comm-ref、secretariat、proj-id、release-version、doc-ref、meta-name、annex-type、ics、content-language、copyright-year、subjectField 为 #PCDATA；edition、version、std-org-name、std-org-abbrev、copyright-holder 含文本与 sub/sup | 已收紧 |
| `sec`/`app` 内容 | 块与子条任意混排 | 块 *，然后（子条或 term-sec）+ 及其后的注/示例/清单；`(label, title?) | title` | 已收紧（块在子条之前；子条之后只能再放注、示例、清单） |
| `fig` 内容 | interleave | `label? caption? legend*` 之后是块的任意混排 | 已收紧为顺序 |
| `fig-group` | interleave | `label? caption? legend*` 之后 `fig+` | 已收紧：legend 在分图之前 |
| `legend` 内 p | 容许 p [未核实] | legend 允许含 p | 确认 |
| `table-wrap` 内 graphic、`table-wrap-foot` | foot 之后；可为空 | graphic 等块在 foot 之前；foot 至少一个子元素 | graphic 两种位置都收（原文 6.2.3 示例，登记偏差）；foot 已收紧为非空 |
| `table-wrap/@position` | token | 枚举 anchor/background/float/margin | 已收紧 |
| `table@width`、`style` | 宽松 | cdata | 确认（本就不限格式） |
| 表的 caption 可选、thead 单独成表 | caption 可选；tbody 必备 | caption 可选；`tbody+` | 确认 |
| `tbx:tig` 顺序与 `tbx:partOfSpeech`、`tbx:grammaticalNumber` 取值 | interleave；token | 顺序 term、partOfSpeech、grammaticalNumber、normativeAuthorization、termType；枚举 noun/verb/adj/adv 与 singular/plural | 已收紧；原 C-T-40 的导出顺序（grammaticalNumber 在最后）无原文依据，改为 DTD 顺序 |
| `tbx:langSet` 内顺序 | interleave | 描述性元素全部在 tig 之前 | **保持 interleave**：原文 9.2.3 示例 2（印刷页 37）把 note 写在 tig 之后，以原文为准，登记偏差 |
| `index`/`index-div` 可为空 | 可空 | 至少一个 `(index-entry | index-div)` | 已收紧；`index/@content-type` 无依据，已删除（主导人决定） |
| `disp-quote` 内 attrib/permissions 位置 | 任意 | `块* , (attrib | permissions)*` | 已收紧 |
| 块级 `graphic`（公式图片）、`disp-formula/graphic` | 两处都容纳 | 两处都允许 | 确认 |
| 注/示例内容 | p、list、code、disp-formula | G2 块集合更大（含表、图等） | 本 schema 是其子集，不再标“未核实” |
| `xref` 内容与 `rid` 多值 | 宽松；多值 | 内容为 phrase 一类，不含 label；`rid` 为 idrefs | 内容已收紧；label 是原文 10.1.8 示例的写法，登记偏差；多值确认 |
| 日期 | xsd:date | #PCDATA | 确认（V-4 另做严格检查） |
| MathML | 宽松 | DTD 内嵌 MathML 3 内容模型 | 仍不写进本 schema；`sts_compat.py` 对给定文件按 DTD 校验 |
| **仍未核实** | | | |
| `equivalence`、`std-supersedes`、`std-type` 的内容模型 | 行内混合 | DTD 未声明这三个元素 | 仍无内容模型，取宽松形式（登记为国标扩展） |
| `ref_<N>`（无 label 的规范性引用条目）id 的含义 | — | DTD 不规定 id 形式 | 仍未核实（X-10） |
| 块级 `fn` | 行内与块都收 | `sec`/`app` 内容不含 `fn`；行内（p 内）允许 | 位置原文未规定，**D-T-10 待 WP8.M 决定**，暂两种都收，登记为“待决扩展” |

## 8. 46687.2 相对 STS 1.2 的偏差（`sts_compat.py` 白名单）

“类别”：国标特有扩展 = 原文标注“中国标准特有”或 4.3.2/表 C.1 列出而 DTD 未声明的元素；原文与STS冲突 = 原文明确的写法与 STS 1.2 内容模型冲突，以原文为准；待决扩展 = 原文未规定、待决定。

| 白名单 | 类别 | 内容 | 依据（46687.2 原文印刷页 / DTD 事实） |
|---|---|---|---|
| EXT-ccs | 国标特有扩展 | 元素 `ccs`（中国标准文献分类号） | 表 C.1 行 10 备注“中国标准特有”（印刷页 56）；4.3.2（印刷页 5）；DTD 未声明 |
| EXT-implementation-date | 国标特有扩展 | 元素 `implementation-date`（实施日期） | 表 C.1 行 40 备注“中国标准特有”（印刷页 58）；4.3.2（印刷页 6）；DTD 未声明 |
| EXT-equivalence | 国标特有扩展 | 元素 `equivalence`（一致性程度） | 表 C.1 行 32 备注“中国标准特有”（印刷页 58）；4.3.2（印刷页 6）；DTD 未声明 |
| EXT-std-type | 国标特有扩展 | 元素 `std-type`（标准类型） | 4.3.2（印刷页 5）、表 C.1 行 82（印刷页 61）；表中未标“中国标准特有”，经核实 DTD 未声明 |
| EXT-std-supersedes | 国标特有扩展 | 元素 `std-supersedes`（替代情况） | 4.3.2（印刷页 6）、表 C.1 行 81（印刷页 61）；经核实 DTD 未声明（相近语义用 std-xref） |
| ALIAS-normativeAuthentication | 原文与STS冲突 | 元素 `tbx:normativeAuthentication`（采用级别的异写名） | 9.2.3 印刷页 37 三处说明文字；DTD 只有 `tbx:normativeAuthorization`；仅导入接受，导出写 normativeAuthorization |
| CONFLICT-valign-center | 原文与STS冲突 | 属性 `valign="center"` | 6.4 示例（印刷页 25）；DTD 枚举 top/middle/bottom/baseline；仅导入接受，当作 middle |
| CONFLICT-std-org-multi-name | 原文与STS冲突 | 一个 `std-org` 内有多个 `std-org-name` | 4.1 示例（印刷页 3），C-S-15 导入约定接受；DTD：`std-org-name?` |
| CONFLICT-xref-label | 原文与STS冲突 | `xref` 内含 `label` | 10.1.8 示例（印刷页 48）；DTD 的 xref 内容不含 label |
| CONFLICT-langSet-order | 原文与STS冲突 | `tbx:langSet` 内描述性元素（如 tbx:note）在 `tbx:tig` 之后 | 9.2.3 示例 2（印刷页 37）；DTD：描述性元素必须全部在 tig 之前 |
| CONFLICT-table-wrap-graphic-after-foot | 原文与STS冲突 | `table-wrap` 内 `graphic` 在 `table-wrap-foot` 之后 | 6.2.3 示例（印刷页 21）；DTD：graphic 等块在 table-wrap-foot 之前 |
| PENDING-block-fn | 待决扩展 | `sec`/`app` 的直接子元素 `fn` | 正文 fn 的定义位置原文未规定（10.1.8，D-T-10，待 WP8.M 决定）；DTD 的 sec/app 内容不含 fn |

另有一条**被放弃的原文写法**（不在白名单里，因为 schema 已拒绝）：4.1 示例（印刷页 3）把 `ics`、`ccs` 写在 `title-wrap` 之前，
按主导人决定改用 DTD 顺序后，这个顺序的文档会被 schema 拒绝。

属性层面：schema 允许的全部属性在 DTD 中都有声明（`xml:lang`、`xlink:href` 等按命名空间核对），枚举取值只有 `valign="center"` 超出 DTD。

## 9. 按 STS 1.2 收紧的 schema 项（对应第 7 节）

1. `std-meta` 顺序（去 interleave）；`std-xref` 必含 `std-ref`；`std-org` 的 name/abbrev 顺序；`permissions` 顺序。
2. `sec`/`app`：块在前，子条/术语条在后，其后只能再放注、示例、清单；`label` 与 `title` 至少要有一个。
3. `fig`：`label? caption legend?` 然后是 `graphic`/`p`/注/示例；`fig-group`：`label? caption? legend? fig+`。
4. `table-wrap`：`graphic` 在 `table-wrap-foot` 之前（原文示例的“之后”也收，登记偏差）；`table-wrap-foot` 非空；`@position` 枚举。
5. `tbx:tig` 顺序；`tbx:partOfSpeech`、`tbx:grammaticalNumber` 取值枚举；`tbx:subjectField` 只含文本。
6. 行内内容分七类（`common.rng`）；`named-content/@content-type` 必备；只含文本/sub-sup 的元数据元素。
7. `disp-quote`：`p+` 然后 `(attrib | permissions)*`；`index`/`index-div` 非空；删除 `index/@content-type`。
8. 新增 `array`、`disp-formula-group`（rejectKind=implementation）；删除四个术语异写元素名。

## 10. 局限与后续

- 本 schema 的内容模型仍有原文与 DTD 都不能确定的地方（第 7 节“仍未核实”），其中 `equivalence`、`std-supersedes`、`std-type` 无任何权威内容模型。
- 兼容性检查只覆盖 schema 允许的文档子集：`sts_compat.py` 对样例零未解释偏差；对 schema 随机生成的 700 余个文档（开发期间一次性检查，工具未入库）
  同样零未解释偏差（MathML 内容除外，因 schema 对 MathML 故意宽松）。
- 没有独立的第三个 RELAX NG 实现交叉核对（不引入 jing 等新依赖，主导人 2026-10-21 决定）。
- 版本号 0.1.0；修改 schema 须同步修改样例与 `test_validate.py` 的预期。
