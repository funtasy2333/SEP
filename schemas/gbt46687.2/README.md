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
| `samples/valid/` | 9 个手写正例：01～06 选用形式；07 “仅导入接受”的异写汇总（含按原文 4.1 示例次序写的 std-meta）；08 原文明确写法与 STS 1.2 不一致的情形（国标扩展、示例冲突）；09 已授权导入的扩展结构 |
| `samples/invalid/` | 77 个负例，每个由同一基底文档单点改动生成，文件开头的注释写明违反项 |
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
3. **元素顺序与 std-meta：导出严格、导入宽容（2026-10-21 主导人决定，后改）**：46687.2 原文条文没有规定 `std-meta` 子元素顺序
   （4.1 示例、附录 G、ISO 源指南三处互不相同），4.1 示例自己就把 `ics`、`ccs` 写在 `title-wrap` 之前，按该示例产出的文件是合理输入，
   导入时不能因顺序拒绝；而 SES 导出应与官方 NISO STS 1.2 DTD 的顺序一致。因此分两层：
   - **结构层（RELAX NG）**：`std-meta` 的子元素用 `interleave`，次序不限；**各子元素的出现次数仍按 DTD 收紧**（`title-wrap+`、`std-ident?`、`proj-id?`、
     `page-count?` 等不能重复，`title-wrap` 必须有）。
   - **次序层（`validate.py` 规则 V-12 `STD-META-ORDER`）**：按“导出次序”检查——官方 DTD 的顺序，国标扩展元素按原文 4.3.2、表 C.1、附录 G 的相对位置
     插入最贴近的位置：`std-type` 在最前，`ccs` 紧随 `ics`，`implementation-date`、`equivalence` 紧随 `release-date`，`std-supersedes` 紧邻 `std-xref` 之前
     （理由写在 `metadata.rng` 文件头）。`--profile export` 下乱序是**错误**，`--profile import`（默认）下是**告警**，信息列出实际次序与导出次序。
   - **`sts_compat.py`**：导入档允许的乱序文件会被 DTD 报 `std-meta` 内容模型错误，归入白名单 `CONFLICT-std-meta-order`
     （类别“原文与STS冲突”：4.1 印刷页 2～3 示例次序），不算未解释偏差。
   其余元素（章条、图、表、术语等）在 STS 1.2 能给出确定内容模型而原文没有另行规定的地方，则按 DTD 取顺序，**结构层就拒绝**（见第 9 节）；
   `std-meta` 是唯一把次序下放到 V-12 的元素（原文示例本身用了另一种次序）。
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
8. **import:reject（WP8.3）**：矩阵共 25 行 format reject，包括 DOCTYPE；原 6 行 implementation reject 已改为 accept：引言条、array、disp-formula-group 和共享脚注。格式拒绝包括整体不收与限定上下文拒绝，详见矩阵和 `matrix_coverage.py`。
9. **schema 比标准窄的地方**（来自用户确认的约定，不是原文禁止）：表 C.1 列出的 `tfoot`、`std-doc-meta`、`tbx:see` 及 `issue-agencies`、`fn-group`、
   `tex-math`、`alternatives` 等 format 类 reject 元素不在 schema 中；`list-type` 不收表 D.1 的 `simple`/`symbol`；
   `std-xref/@type` 只收 `revises`；`td/@scope` 只收 `row`；`processing-meta` 六个属性必须齐全且取固定值（导入容忍度属导入器）；
   `ref-list/@content-type`、`title-wrap/@xml:lang`、`named-content/@content-type` 必备。
10. **id**：`NCName`（无冒号的 Name，与 `xml:id` 一致）。约定表写“Name 产生式”，只差带冒号的 id，实际无影响。
    **`id` 在 schema 里一律可选**（`common.rng` 的 `attr.id`）：语义层按 WP8.3 R5–R8 对直接公式 MathML、app、bibl/bibr ref 与 termEntry 要求 id；规范性引用 ref 允许缺 id。
    “哪些元素导出必须写 id”放在语义规则 **V-13 `REQUIRED-ID`**（导出要求完整清单；导入只对 R6–R8 的上下文强制）：
    | 元素 | 何时要求 id | 依据 |
    |---|---|---|
    | `term-sec` | 一律 | 9.2.1（印刷页 35）；M-9.2.1-01/02（shall）；M-E-07 |
    | `tbx:termEntry` | 一律（WP8.3 项目严格导入约定；原文印刷页 38、39 示例省略 id） | 9.2.1；M-9.2.1-04/05（shall）；M-E-08 |
    | `sec` | 有 `label`，或 `sec-type` 为 foreword/intro | 附录 E（印刷页 67）M-E-01/02/04；无 label 的条 id 可选 |
    | `app` | 一律 | M-E-04；M-4.5.2-02 |
    | `ref-list` | `content-type="bibl"`（norm-refs 清单不要求） | M-E-03；M-4.5.3-01 |
    | `index` | 一律 | M-E-03 |
    | `ref` | 在 bibl 参考文献表内，或带 `label` | 4.5.3.1（印刷页 12）M-4.5.3.1-01（shall）；M-E-05；无 label 的规范性引用条目 M-E-06 为可选 |
    | `table-wrap` | 带 `label` | M-E-10；无 label 的表 M-E-11 不适用 |
    | `fig` | 一律 | M-E-12；M-8.2-01 |
    | `disp-formula` | 带 `label`（有编号） | M-E-13；无编号公式不写 id（X-21） |
    | `fn`（`table-wrap-foot` 内） | 一律 | 6.2.3（印刷页 21）M-6.2.3-07（shall）；M-E-18 |
    | `fn`（正文） | 有正文（有 `p` 或文本） | 10.1.8 M-10.1.8-01；M-E-15/16；无正文的 fn M-E-17 为可选 |

    `sec`/`app` 之外的段落、列项、术语注、行内公式、`mml:math` 等不要求 id。

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
矩阵里的非元素说明性条目（XML 声明、DOCTYPE、空格版式、UTF-8 实体、`list-type=…` 取值行等）不是 XML 元素，schema 不表达；
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
| SYN-2 | 语法 | 编码必须是 UTF-8：①整个 XML 声明里的 `encoding`（不限长度；旧实现只看前 400 字节，声明里塞 401 个空格再写 `encoding="ISO-8859-1"` 就检查不到）；②UTF-16/UTF-32 的字节顺序标记；③解析器实际采用的编码（`docinfo.encoding`，兜底）。UTF-8 的 BOM 与 `utf8`/`UTF-8` 等写法接受；`US-ASCII` 也不接受 | C-S-02 |
| SYN-3 | 语法 | 任何 DOCTYPE → 拒绝；实体引用节点 → 拒绝。**按 XML 规则扫描序言来判断真实声明**（跳过注释与处理指令，进入 DOCTYPE 后跳过引号字面量与内部子集里的注释，数出真正的 `<!ENTITY`），所以注释、CDATA、处理指令或转义文本里写着的 `<!DOCTYPE`、`<!ENTITY` 字样不会误报，系统标识符里的 `[` 也不会被当成内部子集；序言扫描只认 ASCII 兼容编码，UTF-16 等由解析器的 `docinfo` 兜底。外部实体与外部 DTD 仍不被加载 | C-S-02、C-S-34 |
| ROOT | 骨架 | 根元素必须是无命名空间的 standard | C-S-01、C-S-03 |
| LEGACY | 旧格式 | GB/T 37967 与 SEP 早期自定义格式的判别特征，命中即拒绝并列出特征与位置，不尝试转换 | conventions-S 第 6 节 |
| RNG | 结构 | lxml RELAX NG 校验（同时调用 xmllint，二者不一致报 CONSISTENCY） | 本 schema |
| REJECT | 拒绝项 | 矩阵 `import: reject` 且 `rejectKind=format` 的元素/用法，给出矩阵行与约定编号 | 各 M-、C- 行 |
| V-1 | 语义 | `id` 合法且唯一；`xref/@rid`、`tbx:entailedTerm/@target` 可解析 | C-S-37、3.5 |
| V-2 | 语义 | `sec-type` 与位置；numbered-paragraph 不含 title；章必须有 title；**`term-sec` 必须位于“术语和定义”章（body 顶层 `sec-type=terms`）之内** | C-S-06、C-S-08、C-S-25、C-T-37 |
| V-3 | 语义 | `app/@content-type` ∈ {informative, normative}；`ref-list/@content-type` ∈ {norm-refs, bibl}；norm-refs 清单必须是 norm-refs 章的直接子元素；**bibl（及别名 bibr）参考文献表必须是 `back` 的直接子元素** | C-S-07、C-S-24、C-S-27 |
| V-4 | 语义 | `release-date`/`implementation-date` 为有效的 YYYY-MM-DD；发布日期、实施日期不得用两种写法重复表达（含 `date-type`） | C-S-12、D-S-01 |
| V-5 | 语义 | `list-type` 取值；无序列项不带 label | C-S-32 |
| V-6 | 语义 | `processing-meta` 六个固定属性值；`title-wrap` 带 `xml:lang` | C-S-04、C-S-13 |
| V-7 | 语义 | 不得出现 `ext_`、`Formula…`、`id-<uuid>`、`p-<数字>` 形式的 id | 2.3、R-5 |
| V-8 | 附加 | 引用类型须匹配目标；custom xref 必须有非空 custom-type，并匹配目标；悬空仍由 V-1 报错（项目严格约定） | C-T-48、C-T-50 |
| V-9 | 附加 | 每个 TBX termEntry 的各 langSet 中合计恰好一个 definition（项目严格约定） | M-9.2.2-01、C-T-43 |
| V-10 | 附加 | MathML 元素不得带事件属性（`on*`）；MathML 元素上的 URL 取值走统一的 URL 检查（见 V-11） | C-T-19 |
| V-11 | 附加 | **所有 URL/URI 取值统一检查**（`url_value_problem`）：含任何 C0 控制字符（tab、换行、回车…）或 DEL 一律拒绝；协议（不分大小写，去掉首尾空格后）须是 http、https、mailto、ftp，相对地址不限。覆盖：任何元素上本地名为 `href`/`src`/`altimg` 的属性（`ext-link`、`graphic`、`inline-graphic`、MathML 的 `xlink:href` 等）和 `uri` 元素的文本；MathML 元素上的同类取值报 V-10 | C-T-56、C-T-19 |
| V-12 | 次序 | 导出须用次序 A；导入接受 A 或 4.1 示例次序 B（B 告警），其他逆序错误；RNG 不限制顺序 | C-S-11、WP8.3 R11 |
| V-13 | 必备 id | 导出按清单要求；导入仅 app、TBX termEntry、bibl/bibr 直接 ref 缺 id 报错，norm-refs 的 ref 不要求 id | WP8.3 R6–R8 |
| V-14 | MathML id | 导出按序写 mml_m&lt;k&gt;；导入公式直接 math 缺 id 报错，合法 id 为不透明键 | WP8.3 R5 |
| V-15 | MathML display | 导入行间缺省可接受，显式只能为 block；行内不得带 display；导出行间须写 block | WP8.3 R4 |
| V-16 | 导出外形 | `EXPORT-FORM`（**仅 export 档**，import 档不报告）：①以 `<?xml version="1.0" encoding="UTF-8"?>` 开头；②根 `standard` 上声明 `xmlns:xlink`、`xmlns:mml`、`xmlns:tbx`（URI 见主文件头）；③有 `processing-meta`（直接置于 `standard` 下） | M-4.1-01、M-4.1-03、M-4.1-T01/T02、M-4.3.2-30（export required） |
| V-17 | 必备部件 | 导入对 body/app 后代 sec 和 table-wrap 非空 label、app 的 annex-type、ext-link-type=uri 强制，其余沿用原告警；导出按矩阵要求 | WP8.3 R1、R3、R10、R12 |
| V-18 | 段落 id | 无命名空间 p 的无命名空间 id 在导入和导出均报错（项目严格约定） | WP8.3 R9、M-E-25 |
| IMPORT-ONLY | 档位 | 仅导入接受的异写（见第 3 节第 6 点）：import 档告警，export 档错误 | 各 C- 行 |
| 已支持结构 | 接收 | 引言条、array、公式组、共享脚注不再报告旧实现拒绝告警 | 各 M- 行 |
| W-* | 告警 | 不阻断：未知 sec-type、named-content/graphic 的非常规取值、`size:T` 用于行内图、有序列项缺 label、annex-type 与 content-type 矛盾、发布日期晚于实施日期、**脚注未被引用（`W-FN-UNREFERENCED`，正文脚注与表脚注都查，无 id 的 fn 按位置报告）**… | 各 C- 行 |

### “定义了但没引用 / 引用了但没定义”的配对检查

PR#55 审查后逐类核对，两个方向都要有结论：

| 配对 | 引用了但没定义 | 定义了但没引用 | 依据 |
|---|---|---|---|
| 正文脚注 `fn` ↔ `xref[fn]` | V-1 悬空（`rid` 不存在）；V-8（目标类型不对） | **`W-FN-UNREFERENCED` 告警（本次新增）**：全部正文 `fn` 与全部 xref 的 `rid` 比对，没有 id 的 fn 同样告警；同一脚注可有多个单目标引用 | C-T-55 |
| 表脚注 `fn` ↔ `xref[table-fn]` | V-1；V-8（须指向同一 `table-wrap` 的表脚注） | **`W-FN-UNREFERENCED` 告警（本次新增）**；同一表脚注在多个单元格引用是正常的，不告警 | 6.2.3、C-T-06 |
| 参考文献 `ref` ↔ `xref[bibr]` | V-1；V-8 | 不告警：原文与约定没有“参考文献必须被引用”的要求 | C-T-53 |
| 术语条目 `tbx:termEntry` ↔ `tbx:entailedTerm`、`xref[custom term-entry]` | V-1；V-8 | 不告警：术语条目不必被引用 | C-T-45、9.2.6 |
| 注/示例 ↔ `xref[custom note/example]` | V-1；V-8 | 不告警：只有被引用的注/示例才写 id | C-T-50 |
| 缩略语 `def-item` ↔ `xref[abbreviation]` | V-1；V-8 | 不告警：缩略语 id 是可选的 | C-T-51 |
| 列项 `list-item` ↔ `xref[list]` | V-1；V-8 | 不告警：只有被引用的列项才写 id | C-T-52 |
| 图/表/公式/章/附录 ↔ `xref[fig/table/disp-formula/sec/app]` | V-1；V-8 | 不告警：原文没有“图表必须在条文中被引用”的格式要求 | 10.1.2 |
| 索引 `see-entry` | 纯文本编号，无 `rid` | — | 4.5.4、C-S-28 |

### xref 的目标集合（V-8，conventions-T 表 6-A）

`xref` 的 `ref-type` 与 `rid` 目标一律互斥地对应（PR#55 审查后逐类型核对）。**表脚注只能用 `table-fn` 引用，正文脚注只能用 `fn` 引用**
（原来 `fn` 的目标是“任意 fn”，`table-fn` 又假定表脚注是 `table-wrap-foot` 的直接子元素；现在表脚注 = `table-wrap-foot` 内任意深度的 `fn`）。
目标不符是错误（两档都是）。`TestXrefTargets` 对一批代表性目标验证“恰好一个 `ref-type` 接受”。

| `ref-type` | 目标（最终） | 与之前相比 / 依据 |
|---|---|---|
| `sec` | `sec`、`term-sec`，以及固定 id 的 `ref-list`（`sec_bibl`）、`index`（`sec_index`） | 不变。附录 E 的固定 id、9.2.1 的 `sec_` 前缀 |
| `app` | `app` | 不变 |
| `fig` | `fig`、`fig-group`（组合图本身有图号） | 不变 |
| `table` | `table-wrap` | 不变 |
| `disp-formula` | `disp-formula` | 不变 |
| `bibr` | `ref`（参考文献条目） | **收紧**：去掉 `mixed-citation`（表 6-A 目标为 `ref`，rid 是条目 id） |
| `fn` | 正文脚注：`fn` 且**不在** `table-wrap-foot` 内 | **收紧**：原来表脚注也接受（C-T-06） |
| `table-fn` | `table-wrap-foot` 内的表脚注 `fn`，且与 `xref` 在**同一** `table-wrap` | **修正**：原来要求表脚注是 `table-wrap-foot` 的直接子元素，嵌在 `p` 里的被误判 |
| `list` | `list-item`（或 `list`） | 不变（C-T-52：IR 无承载，导入时另报 unsupported） |
| `abbreviation` | `def-list[@list-content=abbreviation]` 内的 `def-item` | **收紧**：原来任何 `def-item` 都接受，公式图例（`式中`）里的 `def-item` 不是缩略语 |
| `custom` | 见 `custom-type`：`term-entry` → `tbx:termEntry`/`term-sec`；`note` → `non-normative-note`/`tbx:note`；`example` → `non-normative-example`/`tbx:example`；缺 `custom-type` 取三者并集 | 上一轮已定 |
| `other`（仅导入） | 能按目标类型归类的元素（上面各行的并集 + 术语条目/注/示例） | **收紧**：原来不限定目标；C-T-48“按目标元素类型归类”，归不了类就是错误 |
| `chem`（仅导入） | 不限定 | 无类型语义（C-T-48：按无类型引用接受并告警） |
| `tbx:entailedTerm/@target` | `tbx:termEntry` | 不变（C-T-45） |

### 上下文规则：按任意祖先还是直接父元素

“X 内不得有 Y”这类拒绝规则按**任意祖先**判断（Y 藏在 X 的段落、注、列表里也算在 X 内）；只有本身就是“位置”的规则才看直接父元素。
`validate.py` 的 `has_ancestor()` 是前者的统一入口。逐条清单（PR#55 审查后全量排查）：

| 规则 | 判断方式 | 依据 |
|---|---|---|
| REJECT 嵌套表：`td`/`th` 内的 `table`、`table-wrap` | 任意祖先 | 6.1“不使用嵌套表”；M-6.1-06（原来就是祖先） |
| REJECT 嵌套 `tbx:termEntry` | 任意祖先 | M-9.1-03（原来就是祖先） |
| REJECT 图内的 `fn`（`fig`、`fig-group`） | **任意祖先**（原来只看直接父元素，fn 放进 `caption/p` 就绕过） | M-8.6-02、C-T-32；图题、说明段、图注、图例里的 fn 都是图脚注 |
| REJECT `tbx:source` 内的 `std` | **任意祖先**（原来只看直接父元素） | M-9.2.8-02 |
| 引言中的条 | 接受多级引言条 | M-4.3.4-02/03 |
| 旧格式判别：`foreword`/`intro` 作为 `body`/`front`/`standard` 的子元素 | 直接父元素（有意） | 位置特征，用来识别 SEP 早期格式 |
| V-2 `sec-type` 位置（front 内只能 foreword/intro，body 顶层只能 scope/norm-refs/terms…） | 直接父元素（有意） | 规则本身就是“位置”，C-S-06 |
| V-2 `term-sec` 在术语和定义章之内 | 任意祖先（分组条可以嵌套）：祖先里有 body 顶层的 `sec-type=terms` | 9.1、C-S-25、C-T-37 |
| V-3 `norm-refs` 清单必须是 `sec-type=norm-refs` 的章的直接子元素；bibl/bibr 参考文献表必须是 `back` 的直接子元素 | 直接父元素（有意） | 4.4.2.3.1：章内先引导语再 `ref-list`；4.5.3、C-S-27 |
| V-13 `ref` 的“在 bibl 参考文献表内” | 直接父元素（有意） | `ref` 只能是 `ref-list` 的直接子元素 |
| 标题数、`list-item` 的 `label` 等针对自身子元素的规则 | 自身子元素 | 内容模型本身 |

### URL 取值为什么一律拒绝控制字符

XML 解析器会把 `java&#x9;script:alert(1)` 还原成 `java<TAB>script:alert(1)`。按 WHATWG URL 规范，浏览器解析 URL 时会先删掉 tab、换行、回车再识别协议，
所以它等价于 `javascript:alert(1)`，却能绕过“按字面匹配协议白名单”的检查（同理还有前导 tab/空格、`JaVaScRiPt:` 大小写混写、`javascript&#x0A;:` 等）。
`validate.py` 因此对所有 URL 取值做同一个检查：**含任何 C0 控制字符直接报错**（比“先按规范去掉再匹配”简单且不留解析差异），
其余再按协议白名单（不分大小写）匹配。原文没有任何需要在 URL 中含控制字符的合法用例（`ext-link` 示例是普通 `http://` 链接，10.1.9）。
`uri` 元素的文本首尾的空白是排版缩进，不算 URL 的一部分，先去掉再检查。

### 有位置约束的容器：谁来拒绝

结构层（RELAX NG）能表达的位置由 schema 拒绝；schema 为了容纳合法用法而放宽（`ref-list`、`term-sec` 都可作为条文块出现在任何 `sec`/`app` 里）的地方由语义规则补上。
PR#55 审查后逐个核对：

| 容器 | 位置要求 | 由谁拒绝 | 依据 |
|---|---|---|---|
| `processing-meta` | `standard` 的第一个子元素 | schema（序列） | C-S-04；`W-PM-POSITION` 因此不会再触发，仅留作库使用时的保险 |
| `std-meta` | `front` 的第一个子元素 | schema | C-S-01 |
| 前言/引言 `sec` | `front` 内，且只能是 foreword/intro | schema + V-2 | 4.3.3、4.3.4、C-S-09/10 |
| 章 `sec`（scope/norm-refs/terms） | `body` 顶层；不得嵌套 | schema + V-2 | 表 1、C-S-06 |
| `app-group`/`app` | `back` 内，`app` 只在 `app-group` 里 | schema | 4.5.2、C-S-01 |
| `index` | `back` 内，在 `ref-list` 之后 | schema | 4.5.4、C-S-01 |
| `ref-list`（bibl/bibr，参考文献表） | **`back` 的直接子元素** | schema 允许其出现在条文块里 → **V-3 补上（本次新增）** | 4.5.3、C-S-01、C-S-27 |
| `ref-list`（norm-refs，规范性引用文件） | `sec-type=norm-refs` 章的直接子元素 | V-3（已有） | 4.4.2.3.1 |
| `term-sec` | “术语和定义”章（body 顶层 `sec-type=terms`）之内，可在分组条里 | schema 允许其出现在任何 `sec`/`app` 里 → **V-2 补上（本次新增）** | 9.1 标题“‘术语和定义’章中的条”、C-S-25、C-T-37、M-9.2.1-01 路径 `sec/term-sec` |
| `tbx:termEntry` | `term-sec` 内 | schema | 9.2.1 |
| `ref` | `ref-list` 内 | schema | 4.5.3.1 |
| 表脚注 `fn` | `table-wrap-foot` 内 | schema（`table-wrap-foot` 只在 `table-wrap` 里） | 6.2.3 |
| 正文 `fn` | 原文没有规定定义位置（D-T-10）；WP8.M 已定案（D-M-01，方案 A）：行内元素，写在引用它的 `p` 内、紧随其 `xref[ref-type=fn]` | schema（`sec`/`app` 的块集合不含 `fn`）+ `REJECT`（块级 `fn` 的明确提示） | 10.1.8、C-T-55 |
| 缩略语 `def-list[abbreviation]` | 原文只有示例（`sec_3.2` 里），没有位置要求 | 无 | 10.1.4 |

**两个“实现”并不独立**：lxml（libxml2 2.14.6）与 xmllint（libxml 2.9.14）是同一套 libxml2 RELAX NG 代码的两个版本，二者一致能排除构建/版本差异，
不能替代 jing 之类独立实现（本机没有 jing，也不得新增依赖）。libxml2 的 RELAX NG 报错粗糙（遇到第一处失败即停，信息含元素名但不一定含属性名），
`validate.py` 因此给每条 RNG 报错补上“出错位置”的元素名；语义规则与 `REJECT` 规则同时承担“说明原因”的责任。
真正独立的证据是 `sts_compat.py`（官方 DTD，由 xmllint 的 DTD 校验器执行，与 RELAX NG 路径不同）。

### sts_compat.py：官方 DTD 兼容检查

`sts_compat.py` 用 `xmllint --noout --nonet --dtdvalid schemas/niso-sts-1.2/interchange-mathml3-dtd/NISO-STS-interchange-1-mathml3.dtd` 校验文件，
把报错分成**已知偏差**（命中白名单，列出触发的白名单条目及其依据）和**未解释偏差**（其余全部报错）；有未解释偏差时退出码 1。
白名单（`--list-whitelist`）共 12 条，每条写明类别和原文页码/DTD 事实，见第 8 节表格。
实现上先按白名单对文档副本做规范化（删除国标扩展元素、把异写改成 STS 写法、调整位置），再校验副本：副本上仍存在的报错 = 未解释偏差；
原文档上有、副本上消失的报错 = 已知偏差。行号已映射回原文档。MathML 内容也在此被 DTD 校验。

**引擎失败一律作为错误传播，不会被当成“0 个偏差”**（PR#55 审查后全量排查，列表见下）。`sts_compat.py` 对每一遍 `xmllint --dtdvalid`
（原文档、归一化副本两遍）都核对退出码与输出：只有“退出码 0 且无输出”或“退出码 3 且每一行都是可解析的 validity error、末行是
`Document … does not validate against …`”才可信；DTD 读不到或解析失败（退出码 2）、I/O 错误、退出码异常（含被信号杀死）、
退出码 3 却没有可解析的诊断、看不懂的输出行，都报**未解释偏差 `ENGINE`**（结果里 `engine_error: true`，不给已知偏差），退出码 1。
找不到 xmllint、找不到 DTD 文件、xmllint 不可执行（`OSError`）、超时同样是 `ENGINE`。

| 外部进程/引擎调用 | 失败时 |
|---|---|
| `sts_compat.py`：`xmllint --dtdvalid`（两遍） | `ENGINE` 未解释偏差，退出码 1（本次修复；原来 `proc.returncode` 被丢弃，DTD 损坏时输出 0 个偏差并成功退出） |
| `sts_compat.py`：找不到 xmllint / DTD 文件 | `ENGINE`（原来是 `wellformed=False` 的误导性状态），退出码 1 |
| `validate.py`：`xmllint --relaxng` | 退出码非 0 即“不通过”；与 lxml 结论不同报 `CONSISTENCY`；不可执行/超时报 `ENGINE`（原来会抛异常） |
| `validate.py`：lxml `RelaxNG` 校验器出错 | `ENGINE` 错误（原来会抛异常） |
| `validate.py`：加载 schema（lxml） | `main()` 报“无法加载 RELAX NG schema”，退出码 1；作为库使用时异常向上传播 |
| `validate.py`：找不到 xmllint | `ENGINE` 错误（`--no-xmllint` 才能显式跳过） |
| `validate.py`：`xmllint --version` | 只用于显示版本号，失败显示 `unknown`，不影响结论 |
| `matrix_coverage.py`、`gen_invalid_samples.py` | 不调用外部进程 |

### 导出档强制核对：矩阵 export required 的每一行由谁强制

PR#55 审查反复发现同一类缺口：矩阵写了 export required、obligation 为 shall/should，校验器的 export 档却没有任何东西强制它
（必备 id、`mml:math` 的 id/display、`custom-type` ……）。为了不再逐条打地鼠，`matrix_coverage.py` 新增“导出档强制核对”一节
（数据与逻辑在 `export_enforcement.py`）：

- 对象：矩阵里 `export` 为 `required` 的 **228 行**，以及这些行中 obligation 为 shall/should 且带固定取值的 **61 个属性**，共 289 个单元。
- 每个单元必须登记强制者：**schema 结构必选 / 枚举**，**validate.py 的某条规则**，或**不适用并写明理由**。
  登记的“schema / 规则”都是**真实运行的探针**，不是文字声明：取一个 export 干净的样例，做一处改动（删掉元素/属性、改取值），
  schema 探针要求 RELAX NG 的两个实现都拒绝，规则探针要求 export 档出现该规则的错误，并核对 import 档的行为
  （告警 / 不报告 / 同为错误），即“导出严格、导入宽容”确实成立。
- 出现“无人强制且未注明理由”的行、登记了矩阵里没有的单元、探针没有得到预期结果、探针没人引用，脚本都以退出码 1 失败；
  `test_validate.py` 的 `TestExportEnforcementAudit` 还核对 README 里的这张表与脚本生成结果一致
  （运行 `python3 -I scripts/xml46687/matrix_coverage.py --export-table` 重新生成）。

首次核对补上的缺口：V-16（XML 声明、根上的命名空间声明、processing-meta）、V-17（label、title、annex-type、graphic、list-content、
ext-link-type、named-content 取值、无标题条的 sec-type、注/示例正文、std 的 std-ref 与 title）、V-18（p 不带 id）、
V-9（术语条目的定义，导出档）、V-14/V-15（mml:math）。注明理由的“不适用”有：内容依赖、章的角色、原文只有示例、
id 取值样式、SES 必填元数据（留 WP8.2）、表 F.1 对照行、是否编号、被引用才写 id、文字版面、processing-meta 里的 custom-meta、
xml:lang 取值、警告注、术语分组条。

<!-- BEGIN export-enforcement（由 matrix_coverage.py --export-table 生成，勿手工修改） -->
| 强制者 | 矩阵行（`行#属性` 为带固定取值的属性） |
|---|---|
| schema：app 必须有 content-type | M-4.2-07、M-4.5.2-02、M-4.5.2-02#content-type |
| schema：app 必须放在 app-group 里 | M-4.5.2-01 |
| schema：app 必须有 title | M-4.4.2.1-03、M-4.5.2-05、M-5.2-02 |
| schema：standard 必须有 body（至少一个章） | M-4.1-05、M-4.4.2.1-01 |
| schema：章（body 顶层 sec）必须有 title | M-4.4.2.1-03、M-5.2-02 |
| schema：colspan 必须是正整数 | M-6.4-01、M-6.4-02、M-6.4-02#colspan |
| schema：def-item 必须有 def | M-7.3-06 |
| schema：def 必须有 p | M-7.3-07 |
| schema：def-item 必须有 term | M-7.3-05 |
| schema：p/@content-type 只收 dimension | M-6.2.5-02、M-6.2.5-02#content-type、M-8.6-01#content-type |
| schema：tbx:entailedTerm 必须有 target | M-9.2.6-01、M-9.2.6-01#target |
| schema：ext-link 必须有 xlink:href | M-10.1.9-01、M-10.1.9-02 |
| schema：fig 必须有 caption | M-8.2-05 |
| schema：图中单位说明 p/@content-type 只收 dimension | M-6.2.5-02#content-type、M-8.6-01、M-8.6-01#content-type |
| schema：fig/@orientation 只收 portrait/landscape | M-8.2-03 |
| schema：caption 必须有 title | M-5.2-02、M-8.2-06 |
| schema：fn 必须有 p | M-6.2.3-09 |
| schema：前言 sec 必须有 title | M-4.3.3-01 |
| schema：disp-formula 必须有 mml:math | M-7.1-01、M-7.1-02、M-7.4-01、M-7.4-02 |
| schema：standard 必须有 front | M-4.1-04 |
| schema：front 内的 sec 必须带 sec-type=foreword/intro | M-4.2-01、M-4.2-02、M-4.3.4-01 |
| schema：graphic 必须有 xlink:href | M-8.2-08、M-8.2-08#xlink:href、M-8.2-09、M-8.2-09#xlink:href |
| schema：inline-formula 不带 id（附录 E） | M-E-14 |
| schema：tbx:termEntry 必须有 tbx:langSet | M-9.2.1-06、M-9.2.1-07 |
| schema：tbx:langSet 必须有 xml:lang | M-9.2.1-06、M-9.2.1-06#xml:lang、M-9.2.1-07、M-9.2.1-07#xml:lang |
| schema：list 必须有 list-item | M-5.7-08 |
| schema：list-item 必须有内容 | M-5.7-10 |
| schema：list 必须有 list-type | M-5.7-01、M-5.7-01#list-type、M-5.7-02、M-5.7-02#list-type、M-5.7-03、M-5.7-03#list-type、M-5.7-04、M-5.7-04#list-type、M-5.7-05、M-5.7-05#list-type、M-5.7-06、M-5.7-06#list-type、M-D-03 |
| schema：list-type 只收 alpha-lower/arabic/roman-lower/dash/bullet | M-5.7-01、M-5.7-01#list-type、M-5.7-02、M-5.7-02#list-type、M-5.7-03、M-5.7-03#list-type、M-5.7-04、M-5.7-04#list-type、M-5.7-05、M-5.7-05#list-type、M-5.7-06、M-5.7-06#list-type、M-D-03 |
| schema：named-content 必须有 content-type | M-5.5-01、M-5.5-01#content-type |
| schema：table-wrap/@orientation 只收 portrait/landscape | M-6.6-01、M-6.6-01#orientation |
| schema：摘录必须有 p | M-5.9-02 |
| schema：ref 必须含 std 或 mixed-citation | M-4.4.2.3-03、M-4.4.2.3-04、M-4.5.3-05、M-4.5.3-06、M-4.5.3.1-03、M-4.5.3.1-06 |
| schema：ref-list 必须有 content-type | M-4.2-09、M-4.4.2.3-02、M-4.4.2.3-02#content-type、M-4.5.3-01、M-4.5.3-01#content-type、M-D-02、M-10.1.6-02、M-10.1.6-02#content-type、M-4.4.2.3.2-01、M-4.4.2.3.2-01#content-type |
| schema：根元素必须是 standard | M-F-01 |
| schema：rowspan 必须是正整数 | M-6.4-01、M-6.4-03、M-6.4-03#rowspan |
| schema：正文文本必须放在 p 里，不能直接放在 sec 下 | M-4.4.2.1-04 |
| schema：front 必须有 std-meta | M-4.1-07、M-4.3.2-01 |
| schema：table-wrap 必须有 table | M-6.1-01 |
| schema：table 必须有 tbody | M-6.2.5-01 |
| schema：tr 必须有单元格 | M-6.4-01 |
| schema：tbx:tig 必须有 tbx:term | M-9.2.3-02 |
| schema：term-sec 必须有 tbx:termEntry | M-9.2.1-01、M-9.2.1-02 |
| schema：tbx:langSet 必须有 tbx:tig | M-9.2.3-01 |
| schema：std-meta 至少有一个 title-wrap | M-4.3.2-04、M-4.3.2-32 |
| schema：title-wrap 必须有 xml:lang | M-4.3.2-04、M-4.3.2-32 |
| schema：tbody 必须有 tr | M-6.2.2-02 |
| schema：xref 必须有 ref-type | M-6.2.3-10、M-6.2.3-10#ref-type、M-9.2.6-02、M-9.2.6-02#ref-type、M-9.2.6-02#custom-type、M-9.2.6-02#rid、M-10.1.1-01、M-10.1.1-02、M-10.1.2-01、M-10.1.2-01#ref-type、M-9.2.7-02、M-9.2.7-02#ref-type、M-10.1.2-02、M-10.1.2-02#ref-type、M-10.1.2-03、M-10.1.2-03#ref-type、M-10.1.2-04、M-10.1.2-04#ref-type、M-10.1.6-01、M-10.1.6-01#ref-type、M-10.1.3-01、M-10.1.3-01#ref-type、M-10.1.3-01#custom-type、M-10.1.3-02、M-10.1.3-02#ref-type、M-10.1.3-02#custom-type、M-9.2.6-03、M-9.2.6-03#ref-type、M-9.2.6-03#custom-type、M-10.1.1-03、M-10.1.1-03#ref-type、M-10.1.5-01、M-10.1.5-01#ref-type、M-10.1.1-04、M-10.1.1-04#ref-type、M-6.2.3-11、M-6.2.3-11#ref-type |
| schema：ref-type 只收 13 个取值 | M-6.2.3-10#ref-type、M-10.1.1-01、M-10.1.1-02、M-10.1.2-01、M-10.1.2-01#ref-type、M-9.2.7-02、M-9.2.7-02#ref-type、M-10.1.2-02、M-10.1.2-02#ref-type、M-10.1.2-03、M-10.1.2-03#ref-type、M-10.1.2-04、M-10.1.2-04#ref-type、M-10.1.6-01、M-10.1.6-01#ref-type、M-10.1.1-03#ref-type、M-10.1.5-01、M-10.1.5-01#ref-type、M-10.1.1-04、M-10.1.1-04#ref-type、M-6.2.3-11#ref-type |
| schema：xref 必须有 rid | M-6.2.3-10、M-9.2.6-02、M-9.2.6-02#ref-type、M-9.2.6-02#custom-type、M-9.2.6-02#rid、M-10.1.1-01、M-10.1.1-02、M-10.1.2-01、M-9.2.7-02、M-10.1.2-02、M-10.1.2-03、M-10.1.2-04、M-10.1.6-01、M-10.1.3-01、M-10.1.3-01#ref-type、M-10.1.3-01#custom-type、M-10.1.3-02、M-10.1.3-02#ref-type、M-10.1.3-02#custom-type、M-9.2.6-03、M-9.2.6-03#ref-type、M-9.2.6-03#custom-type、M-10.1.1-03、M-10.1.5-01、M-10.1.1-04、M-6.2.3-11 |
| V-17（import 同为错误）：app 的 annex-type | M-4.5.2-04 |
| V-3（import 同为错误）：bibl 参考文献表须在 back 直下 | M-4.5.3-01、M-4.5.3-01#content-type、M-10.1.6-02、M-10.1.6-02#content-type |
| V-17（import 告警）：bibl 参考文献表的 title | M-4.5.3-02 |
| V-8（import 同为错误）：custom 型 xref 的 custom-type | M-9.2.6-02、M-9.2.6-02#ref-type、M-9.2.6-02#custom-type、M-9.2.6-02#rid、M-10.1.3-01、M-10.1.3-01#ref-type、M-10.1.3-01#custom-type、M-10.1.3-02、M-10.1.3-02#ref-type、M-10.1.3-02#custom-type、M-9.2.6-03、M-9.2.6-03#ref-type、M-9.2.6-03#custom-type |
| V-1（import 同为错误）：rid 必须能解析到目标 | M-6.2.3-10、M-9.2.6-02、M-9.2.6-02#ref-type、M-9.2.6-02#custom-type、M-9.2.6-02#rid、M-10.1.1-01、M-10.1.1-02、M-10.1.2-01、M-9.2.7-02、M-10.1.2-02、M-10.1.2-03、M-10.1.2-04、M-10.1.6-01、M-10.1.3-01、M-10.1.3-01#ref-type、M-10.1.3-01#custom-type、M-10.1.3-02、M-10.1.3-02#ref-type、M-10.1.3-02#custom-type、M-9.2.6-03、M-9.2.6-03#ref-type、M-9.2.6-03#custom-type、M-10.1.1-03、M-10.1.5-01、M-10.1.1-04、M-6.2.3-11 |
| V-16（import 不报告）：XML 声明 | M-4.1-01 |
| V-9（import 同为错误）：术语条目的定义 | M-9.2.2-01 |
| V-1（import 同为错误）：id 唯一 | M-D-01、M-D.1-01 |
| SYN-2（import 同为错误）：编码只收 UTF-8 | M-4.1-01、M-5.4-01 |
| V-8（import 同为错误）：entailedTerm 指向术语条目 | M-9.2.6-01、M-9.2.6-01#target |
| V-11（import 同为错误）：URL 协议白名单 | M-10.1.9-01、M-10.1.9-02 |
| V-17（import 同为错误）：ext-link-type=uri | M-10.1.9-01、M-10.1.9-01#ext-link-type |
| V-17（import 告警）：fig 的 graphic | M-8.2-08 |
| W-FN-UNREFERENCED（import 告警）：脚注须被引用 | M-10.1.1-03、M-10.1.8-01 |
| V-13（import 同为错误）：app 必须有 id | M-4.5.2-02、M-E-04 |
| V-13（import 告警）：fig 必须有 id | M-E-12、M-D-01、M-D.1-01、M-8.2-01、M-8.2-02 |
| V-13（import 告警）：正文脚注必须有 id | M-E-15、M-E-16、M-10.1.8-01 |
| V-13（import 告警）：表脚注必须有 id | M-E-18、M-6.2.3-07 |
| V-13（import 告警）：带编号的行间公式必须有 id | M-E-13、M-7.1-01、M-7.1-02 |
| V-13（import 告警）：index 必须有 id | M-E-03 |
| V-13（import 同为错误）：bibl 的 ref 必须有 id | M-4.5.3-03、M-4.5.3-03#id、M-E-05、M-4.5.3.1-01、M-4.5.3.1-01#id |
| V-13（import 告警）：bibl 参考文献表必须有 id | M-4.5.3-01、M-E-03、M-10.1.6-02 |
| V-13（import 告警）：有编号的章条必须有 id | M-4.4.2.1-01、M-4.4.2.2-01、M-4.4.2.2-01#id、M-4.4.2.3-01、M-4.4.2.4-01、M-4.4.2.4-01#id、M-4.5.2-06、M-E-01、M-E-04、M-D-01、M-D.1-01、M-9.1-01 |
| V-13（import 告警）：前言/引言必须有 id | M-4.2-01、M-4.2-02、M-4.2-02#id、M-4.3.4-01、M-4.3.4-01#id、M-E-02 |
| V-13（import 告警）：带编号的表必须有 id | M-E-10、M-6.2.1-01、M-6.2.1-02 |
| V-13（import 同为错误）：tbx:termEntry 必须有 id | M-E-08、M-9.2.1-04、M-9.2.1-04#id、M-9.2.1-05、M-9.2.1-05#id |
| V-13（import 告警）：term-sec 必须有 id | M-E-07、M-9.2.1-01、M-9.2.1-01#id、M-9.2.1-02、M-9.2.1-02#id |
| V-17（import 告警）：app 的 label | M-4.5.2-03 |
| V-17（import 告警）：图的 label | M-5.2-01、M-8.2-04 |
| V-17（import 告警）：表脚注的 label | M-6.2.3-08 |
| V-17（import 告警）：有序列项的 label | M-5.2-01、M-5.7-09 |
| V-17（import 告警）：bibl 的 ref 的 label | M-4.5.3-04、M-4.5.3.1-02 |
| V-17（import 同为错误）：章条的 label | M-4.4.2.1-02、M-4.4.2.5-01、M-4.5.2-06、M-5.2-01 |
| V-17（import 同为错误）：表的 label | M-6.2.1-03 |
| V-17（import 告警）：term-sec 的 label | M-9.2.1-03 |
| V-17（import 告警）：公式“式中”列表的 list-content | M-7.3-03、M-7.3-03#list-content |
| V-15（import 不报告）：行间 mml:math 的 display=block | M-7.4-03 |
| V-15（import 同为错误）：行内 mml:math 不带 display | M-7.1-05 |
| V-14（import 同为错误）：mml:math 的 id=mml_m<k> | M-7.4-01、M-7.4-02、M-7.4-02#id、M-7.1-05、M-7.1-05#id |
| V-17（import 告警）：named-content 只能是 variable | M-5.5-01、M-5.5-01#content-type |
| V-3（import 同为错误）：norm-refs 清单须在 norm-refs 章内 | M-4.2-04、M-4.4.2.3-01、M-4.4.2.3-01#sec-type、M-4.4.2.3-02、M-4.4.2.3-02#content-type、M-4.4.2.4-01#sec-type、M-9.1-01#sec-type、M-4.4.2.3.2-01、M-4.4.2.3.2-01#content-type |
| V-17（import 告警）：注/示例必须有正文（p 或列项） | M-5.6-01、M-5.6-02、M-5.6-03、M-5.6-05、M-5.6-06、M-6.2.3-06 |
| V-16（import 不报告）：根上声明 mml | M-4.1-03、M-4.1-T01 |
| V-16（import 不报告）：根上声明 tbx | M-4.1-T02 |
| V-16（import 不报告）：根上声明 xlink | M-4.1-03 |
| V-17（import 不报告）：无标题条须 numbered-paragraph | M-4.4.2.5-01、M-4.4.2.5-01#sec-type |
| V-18（import 同为错误）：p 不带 id | M-E-25 |
| V-16（import 不报告）：processing-meta | M-4.3.2-30、M-4.3.2-T01、M-4.3.2-T02 |
| V-6（import 同为错误）：processing-meta 六个属性取固定值 | M-4.3.2-T01、M-4.3.2-T02 |
| V-17（import 告警）：std 必须含 std-ref | M-4.4.2.3-03、M-4.5.3-05、M-4.5.3.1-03、M-4.5.3.1-04、M-10.2-01、M-10.2-02 |
| V-17（import 告警）：参考文献条目里的 std 必须含 title | M-4.4.2.3-03、M-4.5.3-05、M-4.5.3.1-03、M-4.5.3.1-05 |
| V-17（import 告警）：表题 caption/title | M-5.2-02、M-6.2.1-05 |
| V-2（import 同为错误）：term-sec 须在术语章内 | M-4.2-05、M-4.4.2.3-01#sec-type、M-4.4.2.4-01、M-4.4.2.4-01#sec-type、M-9.1-01、M-9.1-01#sec-type |
| V-8（import 同为错误）：表脚注只能用 table-fn 引用 | M-6.2.3-10、M-6.2.3-10#ref-type、M-6.2.3-11、M-6.2.3-11#ref-type |
| V-8（import 同为错误）：xref 的 ref-type 与目标一致 | M-9.2.6-02、M-9.2.6-02#ref-type、M-9.2.6-02#custom-type、M-9.2.6-02#rid、M-10.1.1-01、M-10.1.1-02、M-10.1.2-01、M-10.1.2-01#ref-type、M-9.2.7-02、M-9.2.7-02#ref-type、M-10.1.2-02、M-10.1.2-02#ref-type、M-10.1.2-03、M-10.1.2-03#ref-type、M-10.1.2-04、M-10.1.2-04#ref-type、M-10.1.6-01、M-10.1.6-01#ref-type、M-10.1.3-01、M-10.1.3-01#ref-type、M-10.1.3-01#custom-type、M-10.1.3-02、M-10.1.3-02#ref-type、M-10.1.3-02#custom-type、M-9.2.6-03、M-9.2.6-03#ref-type、M-9.2.6-03#custom-type、M-10.1.1-03、M-10.1.1-03#ref-type、M-10.1.5-01、M-10.1.5-01#ref-type、M-10.1.1-04、M-10.1.1-04#ref-type |
| 不适用：取决于 IR 内容：只有文档含这种内容时才输出该元素，格式层面没有“每份文档都必须出现”的要求；渲染器按 IR 映射保证 | M-4.3.3-01、M-4.4.2.1-04、M-4.4.2.3-04、M-4.5.2-01、M-5.1-01、M-5.1-02、M-5.1-03、M-5.1-04、M-5.1-06、M-5.1-07、M-5.5-02、M-5.6-01、M-5.6-02、M-5.6-03、M-5.6-06、M-5.7-11、M-5.9-01、M-5.10-01、M-5.10-02、M-6.2.1-01、M-6.2.1-02、M-6.2.2-01、M-6.2.4-01、M-6.5-02、M-6.2.3-03、M-6.2.3-04、M-6.2.4-02、M-7.1-04、M-7.3-02、M-7.3-04、M-8.2-11、M-9.2.8-01、M-9.2.7-01、M-4.5.3.3-02、M-10.2-01、M-10.2-02、M-10.1.7-01、M-10.1.8-02、M-6.2.3-12、M-6.2.3-13、M-7.3-09、M-9.2.6-04 |
| 不适用：原文只在示例中出现（obligation=example-only），没有“应/宜”约束；写法由约定固定，格式不另行强制 | M-4.5.3-06、M-8.2-10、M-4.5.3.1-06 |
| 不适用：术语分组条是普通 sec，是否分组取决于内容；位置约束见 V-2（term-sec 须在术语章内） | M-9.1-02 |
| 不适用：id 的取值样式（sec_<n>、fig_1 …）交 Resolver；格式只检查合法 XML ID 与唯一（V-1，C-S-37：id 不透明），id 是否必须出现由 V-13 强制 | M-4.2-02#id、M-4.3.4-01#id、M-4.4.2.2-01#id、M-4.4.2.4-01#id、M-4.5.3-03#id、M-9.2.1-01#id、M-9.2.1-02#id、M-9.2.1-04#id、M-9.2.1-05#id、M-4.5.3.1-01#id |
| 不适用：只有被引用的注/示例/列项才写 id（C-T-50、C-T-52）；是否被引用取决于文档内容，引用目标的 id 缺失由 V-1 报悬空 | M-E-19、M-E-20、M-E-22、M-E-23、M-E-24 |
| 不适用：SES 必填元数据（std-org-group、content-language、release-date、implementation-date、title-wrap/full 等）：主导人 2026-10-21 决定更严的导出档留 WP8.2，由渲染器侧强制（README 第 3 节第 11 点） | M-4.3.2-06、M-4.3.2-07、M-4.3.2-10、M-4.3.2-11、M-4.3.2-21 |
| 不适用：label 的有无取决于该结构是否编号（公式的 numbered 标志、连续注/示例才编号，C-S-31），不是每个实例都必须有 | M-5.2-01、M-5.6-04、M-6.2.3-05、M-7.1-03、M-7.2-02 |
| 不适用：processing-meta 内的 custom-meta 只做记录，不属于标准内容（C-S-04）；meta-value 的年份待用户确认（D-S-02） | M-4.3.2-31 |
| 不适用：章的角色（scope / norm-refs / terms）由内容决定，格式不规定哪一章必须带哪个 sec-type；含 norm-refs 清单或术语条的章是否带对应 sec-type 由 V-3、V-2 约束，sec-type 取值开放（表 D.1 行 13） | M-4.2-03、M-4.2-04、M-4.2-05、M-4.4.2.2-01、M-4.4.2.3-01、M-4.4.2.3-01#sec-type、M-4.4.2.4-01、M-4.4.2.4-01#sec-type、M-D-04、M-9.1-01、M-9.1-01#sec-type |
| 不适用：表 F.1 是与 GB/T 37967 的元素对照行，只表示对应关系；要求由对应的正文行承担 | M-F-04、M-F-05、M-F-06、M-F-07、M-F-08、M-F-09、M-F-10、M-F-11、M-F-12、M-F-13、M-F-14、M-F-15、M-F-16、M-F-17、M-F-19、M-F-21、M-F-22、M-F-24 |
| 不适用：文字版面（空格、制表符）不是 XML 结构，无法在文档层面检查；由渲染器保证 | M-5.1-08 |
| 不适用：是否是“警告”注取决于 IR 内容；schema 不限制 non-normative-note 的 content-type 取值 | M-5.6-03#content-type |
| 不适用：xml:lang 必须出现（schema），具体语言代码由内容决定（zh、en 只是示例） | M-9.2.1-06#xml:lang、M-9.2.1-07#xml:lang |
<!-- END export-enforcement -->

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
| `07-import-variants.xml` | 仅导入接受的异写汇总，以及按原文 4.1 示例次序写的 `std-meta`（`ics`、`ccs` 在 `title-wrap` 之前）、4.4.2.1 写法的无标题条（不带 `sec-type`）：import 档通过并告警（`IMPORT-ONLY`、V-12），export 档不通过（另有 V-17） |
| `08-original-forms-vs-sts.xml` | 原文明确写法与 STS 1.2 不一致的情形（5 个国标扩展元素、std-org 多名、xref 内 label、langSet 内 note 在 tig 之后、graphic 在 table-wrap-foot 之后；正文 fn 写成行内、紧随其 xref）；两个档位都通过，`sts_compat.py` 列为已知偏差 |
| `09-import-pending.xml` | 引言条、array、disp-formula-group、同一脚注多次引用，均已授权接收 |

`samples/invalid/` 的 78 个负例按违反项分组（完整清单与预期规则见 `test_validate.py` 的 `EXPECTED_INVALID`）：
语法 4、旧格式/根 3、矩阵 format 类 reject 17（含 4 个术语异写元素名、1 个 fn 藏在 caption 段落里的图脚注）、D-M-01 定案的块级正文 fn 1（`block-level-fn.xml`）、V-1 3、V-2 4、V-3 3、V-4 4、V-5 2、V-6 2、V-7 4、V-8～V-11 11（含 2 个 custom 型 xref 的目标错误、2 个脚注/表脚注引用类型互串、3 个 URL 里的控制字符）、仅 RELAX NG 7
（含按 STS 1.2 收紧后新增的含子条的条再放段落、partOfSpeech 取值、named-content 缺 content-type、空 table-wrap-foot）、
**历史 13 个仅 export 负例现按 WP8.3 严格导入约定在 import 档同样拒绝；语义及上下文详见 [R1–R13](../../docs/wp8.3/strict-import.md)。**

## 7. 官方 DTD 对照后：`[未核实]` 清单的复核结论（2026-10-21）

最初的 schema 对下列内容取了宽松形式并标“[未核实]”。取得 STS 1.2 DTD 后逐项复核；**DTD 能给出确定内容模型且原文未另行规定的，已按 DTD 收紧并移出本清单**。

| 项 | 原先 | DTD 事实 | 结论 |
|---|---|---|---|
| 行内内容集合 | 所有行内位置共用一个集合 | 各元素的内容集合不同（bold 等不含 break；ext-link、xref 不含引用/脚注/公式；label 不含 ext-link/std；term/see-entry 不含 break/std） | 已收紧：`cm.inline/mark/phrase/label/term/citation/subsup` 七类 |
| std-meta 子元素顺序 | interleave | 固定顺序 | 结构层保持 interleave（出现次数按 DTD 收紧），次序下放到 V-12：导出错误、导入告警（第 3 节第 3 点；2026-10-21 改） |
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
| 块级 `fn` | 行内与块都收 | `sec`/`app` 内容不含 `fn`；行内（p 内）允许 | 位置原文未规定；**D-T-10 已由 WP8.M 设计评审定案（D-M-01，方案 A）**：正文 `fn` 是行内元素、紧随其 `xref` 放在同一 `p` 内（STS 1.2 允许，不是国标扩展）；块级 `fn` 不再收（schema 与 `REJECT` 规则拒绝），“待决扩展”类已清空 |

## 8. 46687.2 相对 STS 1.2 的偏差（`sts_compat.py` 白名单）

“类别”：国标特有扩展 = 原文标注“中国标准特有”或 4.3.2/表 C.1 列出而 DTD 未声明的元素；原文与STS冲突 = 原文明确的写法与 STS 1.2 内容模型冲突，以原文为准；（曾有第三类“待决扩展”——原文未规定、待决定；D-T-10 由 WP8.M 定案后已清空，白名单里不再有这一类。）

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
| CONFLICT-std-meta-order | 原文与STS冲突 | `std-meta` 子元素次序不同于 STS 1.2 的有序内容模型（如 `ics` 在 `title-wrap` 之前） | 4.1 示例（印刷页 2～3）把 `ics`、`ccs` 写在 `title-wrap` 之前；原文条文未规定次序，附录 G（印刷页 71）又是另一种次序；DTD 为固定次序；导入接受（V-12 告警），导出须按 STS 1.2 次序 |
| CONFLICT-xref-label | 原文与STS冲突 | `xref` 内含 `label` | 10.1.8 示例（印刷页 48）；DTD 的 xref 内容不含 label |
| CONFLICT-langSet-order | 原文与STS冲突 | `tbx:langSet` 内描述性元素（如 tbx:note）在 `tbx:tig` 之后 | 9.2.3 示例 2（印刷页 37）；DTD：描述性元素必须全部在 tig 之前 |
| CONFLICT-table-wrap-graphic-after-foot | 原文与STS冲突 | `table-wrap` 内 `graphic` 在 `table-wrap-foot` 之后 | 6.2.3 示例（印刷页 21）；DTD：graphic 等块在 table-wrap-foot 之前 |

原先“4.1 示例的 `ics`、`ccs` 次序被 schema 拒绝”的做法已改为“导出严格、导入宽容”（第 3 节第 3 点），该次序现在是白名单中“原文与STS冲突”类的一条（CONFLICT-std-meta-order）。

属性层面：schema 允许的全部属性在 DTD 中都有声明（`xml:lang`、`xlink:href` 等按命名空间核对），枚举取值只有 `valign="center"` 超出 DTD。

## 9. 按 STS 1.2 收紧的 schema 项（对应第 7 节）

1. `std-meta` 各子元素的出现次数按 DTD（次序由 V-12 检查，结构层不限）；`std-xref` 必含 `std-ref`；`std-org` 的 name/abbrev 顺序；`permissions` 顺序。
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

## WP8.3 勘误

本节优先于上文历史导入口径：所有 DOCTYPE 拒绝；V-8、V-9、V-12–V-15、V-17、V-18 对 R1–R13 的上下文报 error，例外次序 B 接受并告警，norm-refs 的 ref 无 id 接受。RNG 仍保留可选结构，严格约定由语义检查实现。原六个 implementation reject 行改为 accept，不再输出 W-IMPL-REJECT/W-FN-MULTIREF。原表记载的标准出处与导出要求保留；本段只修订导入行为。
