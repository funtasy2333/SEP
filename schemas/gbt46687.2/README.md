# GB/T 46687.2—2026 项目自写 RELAX NG schema（0.1.0）

**性质：项目实现约定，非官方。** 本目录的 schema、样例和 `scripts/xml46687/` 下的校验工具，是 SES 项目依据 GB/T 46687.2—2026 原文与
[WP8.1 支持矩阵](../../docs/wp8.1/README.md) 自行编写的，不是国家标准、不是 NISO 的官方文件，也不等同于官方 NISO STS DTD。

按 [docs/wp8.1/README.md](../../docs/wp8.1/README.md) 3A 的用户决定（D-S-03 / D-T-04 / D-S-04）：**结构校验以本 schema 为主，官方 NISO STS 1.2 DTD 为辅**。
本 schema 是 WP8 的结构验收基准，但**不算独立证据**——它由我们依据同一份原文推导，而且推导不出的地方取了宽松形式。
取得官方 DTD 后须另做兼容性检查，偏差记为国标特有扩展。

> 编写时仓库里的 `schemas/niso-sts-1.2/`（官方 DTD，由主导人另行收录）**没有被参考**——这是有意的，为的是让后续的兼容性检查保持独立。
> 本 schema 注释里标了“[未核实]”的内容模型，正是官方 DTD 兼容检查最该核对的地方（第 7 节）。

## 1. 文件

| 文件 | 内容 |
|---|---|
| `ses-gbt46687-2.rng` | 主文件：文件头（依据、性质、版本、与 NISO STS 1.2 的关系）、include 各模块、start |
| `common.rng` | 公共属性（id、xlink、xml:lang）、数据类型（align、orientation）、行内内容模型、label/title/p |
| `refs.rng` | xref、ext-link、uri、fn、std、std-ref、mixed-citation、ref-list、ref |
| `metadata.rng` | processing-meta、std-meta（title-wrap、std-ident、std-org、日期、permissions、custom-meta…） |
| `body.rng` | standard/front/body/back 骨架、各类 sec、term-sec、app、index、list、注/示例/警告、摘录、代码 |
| `table.rng` | 表（XHTML 模型）：table-wrap、caption、table、col/colgroup、thead/tbody/tr/th/td、table-wrap-foot |
| `figure.rng` | fig、fig-group、graphic、inline-graphic、legend、def-list/def-item |
| `math.rng` | disp-formula、inline-formula、mml:math（MathML 3 宽松子 schema） |
| `tbx.rng` | tbx:termEntry/langSet/tig/term/definition/note/example/source/subjectField/entailedTerm/partOfSpeech/… |
| `samples/valid/` | 7 个手写正例（01～06 为选用形式，07 为“仅导入接受”的异写汇总） |
| `samples/invalid/` | 46 个负例，每个由同一基底文档单点改动生成，文件开头的注释写明违反项 |
| `../../scripts/xml46687/validate.py` | 校验工具（语法 + RELAX NG 双实现 + 语义规则） |
| `../../scripts/xml46687/test_validate.py` | unittest 回归测试 |
| `../../scripts/xml46687/matrix_coverage.py` | 矩阵 → schema 覆盖检查 |
| `../../scripts/xml46687/gen_invalid_samples.py` | 由基底文档单点改动重新生成 `samples/invalid/`（测试确认仓库里的负例与生成结果一致） |

## 2. 设计依据

| 模块 | 原文条款 | 约定 | 矩阵行 |
|---|---|---|---|
| `body.rng`（骨架、章条） | 4.1～4.5、表 1、附录 E | C-S-01、C-S-06～10、C-S-23～28、X-01～26 | M-4.x、M-E-xx |
| `body.rng`（条文块） | 5.2、5.3、5.6、5.7、5.9、5.10 | C-S-31～33、C-S-35 | M-5.x |
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
3. **元素顺序**：`std-meta` 的三个来源（4.1 示例、附录 G、ISO 源指南）顺序互不相同，原文没有规定，故 `std-meta` 直接子元素用 `interleave`（顺序不限，基数受限）。
   `title-wrap`、`std-ident`、`table-wrap`、`front`、`back` 等按示例/约定取固定顺序；`fig`、`disp-formula`、`tbx:langSet`、`tbx:tig` 导入接受任意顺序（C-T-26、C-T-17、C-T-43）。
4. **sec-type 与位置**：用不同的 `define` 表达位置约束——`front` 内 `foreword`/`intro`；`body` 顶层 `scope`/`norm-refs`/`terms`（及仅导入接受的 `norm_refs`）；
   其下的条 `numbered-paragraph` 或不写；其他取值（表 D.1 行 13 称“可以采用任何值”）接受，`validate.py` 告警。
   “numbered-paragraph 的 sec 不含 title”这类跨元素规则留给 V-2。
5. **属性取值的两种处理**：约定表写“拒绝”的取值用 `choice` 枚举（`list-type`、`ref-type`、`custom-type`、`app/@content-type`、
   `ref-list/@content-type`、`tbx:termType`、`tbx:normativeAuthorization`、`orientation`、`frame`、`rules`、`align`、`valign`、`specific-use` 的尺寸档位等）；
   约定表写“告警后保留/忽略”的取值用 `token`，由 `validate.py` 告警（`named-content/@content-type`、`graphic/@content-type`、`ext-link/@ext-link-type`、
   `tbx:partOfSpeech/@value`、未知 `sec-type`）。
6. **“仅导入接受”的异写**（schema 接受，导出不得使用；schema 注释标 `[仅导入接受]`）：
   `sec-type="norm_refs"`、`ref-list/@content-type` 的 `norm_refs`/`bibr`、`app/@content-type` 的 `inform-annex`/`inform_annex`、
   `release-date/@date-type`、`<monospace>`、`xref/@ref-type` 的 `chem`/`other`、`valign="center"`、`table-wrap/@position`、`std-ref` 内的 `edition`、
   `index/@content-type`，以及 tbx 的五个异写元素名（`term-entry`、`Definition`、`normativeAuthentication`、`normative-Authorization`、`grammatical-Number`）。
   `validate.py` 默认（`--profile import`）对它们告警（规则 `IMPORT-ONLY`），`--profile export` 视为错误，并同时拒绝 DOCTYPE。
7. **MathML 3**：只写了“结构宽松、命名空间严格”的子 schema：`mml:math` 根（`display` 取 block/inline，`id` 为 NCName），其内允许 MathML 命名空间中的任意元素、属性和文本。
   **MathML 内容模型的严格校验留待官方 MathML schema 兼容检查**，本项目不复刻官方 MathML schema。事件属性（`on*`）、`javascript:` 链接等由 `validate.py` V-10 检查。
8. **schema 比标准窄的地方**（来自用户确认的约定，不是原文禁止）：表 C.1 列出的 `tfoot`、`array`、`disp-formula-group`、`std-doc-meta`、`tbx:see`，
   以及 `issue-agencies`、`fn-group`、`tex-math`、`alternatives` 等 `import: reject` 的元素不在 schema 中；`list-type` 不收表 D.1 的 `simple`/`symbol`；
   `std-xref/@type` 只收 `revises`；`td/@scope` 只收 `row`；`processing-meta` 六个属性必须齐全且取固定值；`ref-list/@content-type`、`title-wrap/@xml:lang` 必备。
   因此一份严格按原文其他地方写的文档可能被本 schema 拒绝——这是有意的，决定权在 D-T-01 等待决事项。
9. **id**：`NCName`（无冒号的 Name，与 `xml:id` 一致）。约定表写“Name 产生式”，只差带冒号的 id，实际无影响。

## 4. 与矩阵的对应方式

`scripts/xml46687/matrix_coverage.py` 遍历 `docs/wp8.1/matrix-S.json`、`matrix-T.json`（共 391 行），对 **export 为 required/optional 或 import 为 required/accept** 的 362 行：

- 从行内 `element` 字段解析元素名（去掉括号注释；含中文/空格的片段记为“非元素的说明性条目”），核对 schema 里有对应的 `element`；
- 核对行内 `attributes[]`（宿主为该行的任一元素片段）在 schema 中有对应的 `attribute`，枚举型属性逐值核对；
- 核对 `import: reject` 且整体不收的 13 个元素（`alternatives`、`array`、`col-group`、`disp-formula-group`、`fn-group`、`issue-agencies`、`mtext`、`std-doc-meta`、`target`、`term-display`、`tex-math`、`tfoot`、`tbx:see`）不在 schema 中；
- 其余 12 个 `import: reject` 行是“语境拒绝”（元素本身接受，只在特定位置/取值/个数上拒绝：嵌套表、英文题名、tbx:source 内的 std、`-admn-sts` 取值、嵌套术语条目…），
  由内容模型或 `validate.py` 的 `REJECT` 规则体现，并各有负例（`test_validate.py` 的 `CONTEXT_REJECT_SAMPLES`）。

统计结果（`python3 -I scripts/xml46687/matrix_coverage.py`）：矩阵 391 行，纳入覆盖 362 行；需要覆盖的元素 135 个全部定义（含 `mml:` 通配 7 个）；
需要覆盖的（宿主, 属性）组合 107 个全部定义；枚举取值无遗漏；整体拒绝的 13 个元素均未混入。schema 共定义 126 个元素名。
矩阵 `element` 字段照抄了原文表 F.1 的拼写笔误 `permission`、`std-indent`，覆盖检查按 `permissions`、`std-ident` 处理。

矩阵里的 21 个“非元素说明性条目”（XML 声明、DOCTYPE、空格版式、UTF-8 实体、`list-type=…` 取值行等）不是 XML 元素，schema 不表达；
XML 声明/编码与 DOCTYPE 由 `validate.py` 的 SYN-2/SYN-3 检查。

## 5. 校验工具与规则

```
python3 -I scripts/xml46687/validate.py [--json] [--profile import|export] [--no-xmllint] file.xml [...]
python3 -I scripts/xml46687/matrix_coverage.py [--json]
python3 -I scripts/xml46687/test_validate.py -v
xmllint --noout --nonet --relaxng schemas/gbt46687.2/ses-gbt46687-2.rng schemas/gbt46687.2/samples/valid/*.xml
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
| REJECT | 拒绝项 | 矩阵 `import: reject` 的元素/用法，给出矩阵行与约定编号 | 各 M-、C- 行 |
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
| IMPORT-ONLY | 档位 | 仅导入接受的异写（见第 3 节）：import 档告警，export 档错误 | 各 C- 行 |
| W-* | 告警 | 不阻断：未知 sec-type、named-content/graphic/ext-link 的非常规取值、partOfSpeech 非四值、`size:T` 用于行内图、有序列项缺 label、annex-type 与 content-type 矛盾、发布日期晚于实施日期、多 rid、同一 fn 多次引用… | 各 C- 行 |

**两个“实现”并不独立**：lxml（libxml2 2.14.6）与 xmllint（libxml 2.9.14）是同一套 libxml2 RELAX NG 代码的两个版本，二者一致能排除构建/版本差异，
不能替代 jing 之类独立实现（本机没有 jing，也不得新增依赖）。libxml2 的 RELAX NG 报错粗糙（遇到第一处失败即停，信息含元素名但不一定含属性名），
因此语义规则与 `REJECT` 规则同时承担“说明原因”的责任。

## 6. 样例

`samples/valid/`（手写，没有逐字复制原文示例——原文示例有已知笔误，见 conventions-S 3.4）：

| 文件 | 内容 |
|---|---|
| `01-minimal.xml` | 最小文档 |
| `02-full-metadata.xml` | processing-meta、双语题名、std-ident、ics/ccs、release-date + implementation-date、std-org、permissions、custom-meta、前言/引言 |
| `03-structure.xml` | 章、条、无标题条、附录（资料性/规范性）、规范性引用文件、参考文献、索引、引言中的条、列项（含嵌套）、注/示例/警告、摘录、代码、变量符号 |
| `04-tables.xml` | 表头、跨行跨列、`col`、单位段、表注/表脚注（`table-wrap-foot`）、单位、横向表 |
| `05-formulas-figures.xml` | disp-formula/inline-formula + mml:math + legend/def-list、公式注、fig（图例、说明段、多图形、图注、尺寸档位）、fig-group、inline-graphic |
| `06-terms-references.xml` | term-sec + tbx:termEntry（多 langSet、多 tig、描述符、subjectField、note/example、entailedTerm）、缩略语、各类 xref、fn、std、mixed-citation |
| `07-import-variants.xml` | 仅导入接受的异写汇总：import 档通过并告警，export 档不通过 |

`samples/invalid/` 的 46 个负例按违反项分组（完整清单与预期规则见 `test_validate.py` 的 `EXPECTED_INVALID`）：
语法 3、旧格式/根 3、矩阵 reject 13、V-1 3、V-2 3、V-3 2、V-4 4、V-5 2、V-6 2、V-7 4、V-8～V-11 4、仅 RELAX NG 3。

## 7. 已知宽松处与未核实处

原文没有给出内容模型（或各处写法不一致）而取宽松形式的地方；官方 DTD 兼容检查时应优先核对：

| 位置 | 宽松/未核实内容 |
|---|---|
| 行内内容（common） | 所有出现行内内容的元素（title、label、p、td…）共用同一个行内集合（含 xref、fn、std、mixed-citation、inline-formula、inline-graphic、行内格式），未限制 bold 内能否再含 xref 等 |
| `std-meta` | 子元素顺序不限；除 `title-wrap` 外都不强制（SES 的“必填”由导出器保证）；`equivalence`、`std-supersedes`、`std-type` 没有内容模型，取行内混合内容；`std-xref` 空元素与内含 `std-ref` 两种写法都收；`std-org` 的 level/role/type 取 token；`secretariat`/`page-count`/`proj-id`/`release-version`/`doc-ref` 仅按附录 G/表 C.1 收 |
| `title-wrap` | `intro`、`main`、`compl`、`full` 均可选，顺序固定 intro→main→compl→full |
| `sec` | 未知 `sec-type` 值接受；`term-sec` 的位置未限制在术语章内；`term-sec/@sec-type` 取 token；引言的条用普通条（`sec_0.<n>`） |
| 块级 `fn` | 正文脚注定义位置原文没有规定（D-T-10）：schema 同时容许 `fn` 作行内元素（在 `p` 内）和作块（在 `sec` 内）；`fn-group` 不收 |
| 块级 `graphic` | 公式替代图在原文示例中是 `disp-formula` 的兄弟元素，矩阵 M-7.4-13 的路径却是 `disp-formula/graphic`，两种都容纳 |
| 注/示例 | 内容取 `p`、`list`、`code`、`disp-formula`（5.6 只说“例如 p、list 等”） |
| `disp-quote` | `attrib`、`permissions` 的位置不限 |
| `legend`、`fig-group` | `legend` 内除 `def-list` 外容许 `p`；`fig-group` 的 id/label/caption 原文未规定，取可选（表 C.1 没有 `fig-group`） |
| `def-list` | `list-type`（simple/bullet/dash/symbol）取表 D.1；`def` 内 `p+`（多个 p 导入时拼接并告警） |
| 表 | `table@width` 取“数字，可带 %”（6.1 只给 33%/66%/100%，附录 D 给“数字”）；`style` 只要求字符串，不检查内部语法（示例冒号/等号混用）；`caption` 可选（附录 E 的无标题表）；`td/@scope` 只收 `row`；`border/frame/rules/cellspacing/cellpadding` 只做形式检查 |
| `tbx:*` | TBX 版本/子集未核实；`partOfSpeech`、`grammaticalNumber` 的取值取 token；`tbx:note` 的 id 只在被引用时出现；`langSet` 内顺序不限；`tbx:definition`/`example`/`note` 的行内内容含 break、entailedTerm、xref |
| `index` | `index-div` 是否嵌套未规定；`see-entry` 取行内内容；`index/@content-type="index"`（表 D.1 行 3）无示例 |
| `ref`/`ref-list` | `ref` 的 id（`biblref_<N>`、`ref_<N>`）形式不限定（导入时 id 不透明）；`ref_<N>`（无 label 的规范性引用条目，X-10）含义未核实；`std` 为混合内容（std-ref、title 与逗号文本） |
| `xref` | `rid` 容许多个标识符（附录 D 行 10），导入器只接受单个；内容容许 bold、label>sup 等示例写法 |
| 日期 | schema 用 `xsd:date`（容许时区后缀），`validate.py` V-4 另做严格的 YYYY-MM-DD 与日历检查 |
| MathML | 只检查命名空间与根；不检查任何 MathML 元素的内容模型 |
| 属性 `p/@content-type` 等 | `p` 的 `id`/`style-type`/`content-type="dimension"`/`specific-use` 是为接受示例中的写法而收，导出不写（附录 E：p 无属性） |

## 8. 与约定表的已知偏离

| 项 | 约定表/矩阵 | 本 schema | 原因 |
|---|---|---|---|
| `processing-meta` | C-S-04 导入：`mathml-version` 接受 2.0 并告警，`base-tagset` 其他值告警 | 六个属性必备且取固定值 | 任务书要求固定属性值；导入器的容忍度应在导入器里实现 |
| `table-wrap/caption` | M-6.2.1-04 export/import 均 required | 可选 | 附录 E 有“无标题”的表（`tab_r`，M-E-11 import accept） |
| `index/@content-type` | M-D-02 required/required 但 status 为 not-applicable，无宿主元素 | 在 `index` 上可选 `content-type="index"` | 表 D.1 行 3 的取值；宿主为推测 |
| 术语条目异写元素 | M-9.2.3-07、M-C.1-06/07、M-9.2.1-08/09 import accept | 作为元素名收入 | 按矩阵执行；但其中 `normative-Authorization`、`grammatical-Number` 疑为附录 C 断行产生的假象，`Definition`/`term-entry` 只在说明文字出现、示例代码从未这样写，见交付报告的待决事项 |
| `release-date`/`implementation-date` | V-4“不得把实施日期放进 release-date” | 只能检出重复表达和发布晚于实施（告警） | 单个 `release-date` 里放的是不是实施日期，从内容无法判断 |
| 引言中的条 | M-4.3.4-02/03 `import: reject`（IR 缺口 gap-ir） | schema 接受 | schema 描述标准，不是当前实现能力；导入器暂拒 |

## 9. 局限与后续

- 本 schema 未经官方 DTD 验证，也没有独立的第三个 RELAX NG 实现交叉核对。
- 取得官方 NISO STS 1.2 interchange（MathML3）DTD 后，应逐项核对第 7 节的宽松处和第 8 节的偏离，把 `ccs`、`implementation-date`、`equivalence` 等偏差记为“国标特有扩展”。
- MathML 内容模型的严格校验同样留待官方 MathML schema 兼容检查。
- 版本号 0.1.0；修改 schema 须同步修改样例与 `test_validate.py` 的预期。
