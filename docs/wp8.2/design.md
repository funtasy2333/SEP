# WP8.2 导出设计：`renderXml46687`（GB/T 46687.2—2026 XML 导出）

状态：设计稿，2026-10-27，基线 `99fb694`（= `claude/wp8.2-xml-export` = `main`）。**只含设计，没有改动任何源码、测试、夹具、golden、依赖或 lockfile。**
规格依据：[WP8 实施方案](../wp8-xml46687.md)、[Phase 5.5 主计划 §3 WP8](../dev-plan-phase-5.5.md)、[WP8.1 总索引](../wp8.1/README.md)（§3、§3A 为用户决定）、[conventions-S](../wp8.1/conventions-S.md)、[conventions-T](../wp8.1/conventions-T.md)、`matrix-S.json`/`matrix-T.json`（391 行）、[WP8.M 设计](../wp8.m/design.md)（§3.2、§3.4、§6、§7.1）与[验收记录](../wp8.m/validation.md)、[WP6 模型契约](../wp6-model-contract.md)、`schemas/gbt46687.2/`、`scripts/xml46687/`。

## 阅读说明

- 页码写作“印刷页 N（PDF N+4）”。原文是扫描件，OCR 稿只用于定位；本文中**亲自渲染页图核对**的点有：印刷页 16（5.7.2 列项 `label`，PDF 20）、印刷页 27（7.1 公式 `label` 与行内公式 id，PDF 31）、印刷页 45（10.1.4 缩略语 `def-list`，PDF 49）、印刷页 47（10.1.6 对文献的引用，PDF 51）、印刷页 48（10.1.8 脚注引用、10.1.9 外链，PDF 52）、印刷页 67（表 E.1 ID 方案，PDF 71）；其余结论沿用 WP8.1 已对照图像的约定表，标“沿用”。
- “文件:行”指基线 `99fb694`。“未核实”表示没有运行或没有原文依据。
- **实测**指在隔离副本上做的试验：`git archive HEAD` 导出到 scratchpad（`…/scratchpad/lab`，不在仓库内、不入库），在副本里 `pnpm install --frozen-lockfile`（2 秒，未改 lockfile）后运行 vitest 与 Python。工作树里没有 `node_modules`，所以任何“某改动会让哪些测试失败”的结论都来自副本上的真实运行，不是推断。命令与结果汇总在附录 A。
- 严重度分三档，贯穿全文：**error**（阻断导出，`renderXml46687` 抛错）、**warning**（导出继续，问题随结果返回）、**info**（仅记录，如“标准类型未表达”）。
- 待决事项编号 `D-X-nn`（本文新增，第 8 节）；沿用的既有编号保持原样（D-S-、D-T-、D-M-）。

## 摘要

1. **开工前复查结论**：七条矩阵行的 `export` 列全部仍是 WP8.1 时代的 `not-applicable`，与 WP8.M 落地后的 IR 不一致，需改（1.1）。其中 5 行建议改 `required`、2 行改 `optional`；改 `required` 会让 `matrix_coverage.py` 要求在 `export_enforcement.py` 登记强制者（给出了现成可复用的登记，1.1）。
2. **G5 描述符规则**可以完整落到渲染器：条目级 `subjectField` 优先；缺失时仅当所有术语级描述符取值一致才提升；不一致报错；问题码 `term-subjectfield-duplicate`、`term-subjectfield-promoted`、`term-subjectfield-conflict`（1.2）。
3. **白名单**：实测 `getOutputSupportProblems(wp8m 夹具, 'XML46687')` 恰为 31 条，与设计 §6.2 的 11 类放行项逐条对应；但 §6.2 **不够**——WP6 夹具在 XML46687 下有 57 条，涉及元数据、行内标记类型、块 kind（警告、摘录、代码三者对**四种格式**都阻断）、公式、表/图字段、术语语言集、文献字段、索引、资源等 §6.2 没列的项（1.3 给出完整放行表与处置分类）。`outputBoundary.ts` 还有两处会让“放行”落空的实现细节：mark 对象的 `kind` 字段被当成节点 kind 读取（`outputBoundary.ts:156`），以及行内公式对 XML 家族一律提前拦截（`:237`）。`outputBoundaryXml46687.test.ts` 的“完全一致”测试要改写成**显式差异集合**断言，并且比现在更严（1.3.4）。
4. **Resolver 剩余差距**（实测）：R-1（`bib_`）、R-2（`tabfn_`）、R-4（`note_` 之于术语注）仍未做；R-3、R-7、R-8 已由 WP8.M 完成；R-5、R-6、R-9 本质在渲染器侧。**另有两个 WP8.1 没列的差距**：公式注没有 `label`/`note_<n>`（R-10）和未被引用的有序列项没有标记（R-11，XML 的 `<label>` 需要它）。R-1/R-2/R-4/R-10 合并实测：shared 5 个测试文件（7 项）、client 4 个测试文件（6 项）、`html.test.ts.snap` 两个快照失败；DOCX 快照、JSON golden、io 全部零变化。R-2 若只改 Resolver 不改 `html.ts:232`、`renderers/footnotes.ts:17`、旧序列化器 `xmlSerializer.ts:1173`，会让 shared 7 个文件 20 项、client 4 个文件 22 项失败（1.4）。
5. **渲染器关键设计点**：行内标记按固定嵌套序构建并预先判定可表达性（对 schema 逐组合实测，2.3.2）；“仅被引用时写 id”不靠预扫描，而是“建树时登记待补 id、写出每个 `xref` 时登记目标、建完后补写”，使 id 与实际写出的引用严格一一对应（3.2）；`mml_m<k>` 在整棵树建完后按输出文档序后置赋值，`df_<k>` 按索引条目序、`inl_<k>` 按 IR 文档序由与 T2.5 共用的纯函数给出（3.3）；xmlId 唯一性、`rid` 可解析性、无 `ext_` 在渲染器内做收尾检查（3.4）。
6. **实测发现的两个“全要素夹具无法按 46687.2 导出”的点**：WP8.M 夹具 `g1-ch3-p2` 有一个同时带 `crossRef` 与 `stdRef` 的 run（`xref` 与 `std` 在 schema 中互不包含，实测拒绝），WP6 夹具的术语描述符 `partOfSpeech='名词'` 不在 `noun/verb/adj/adv` 枚举内。渲染器必须报错而不是静默改写；WP8.2 需要自己的全要素夹具（7）。
7. **T2.5 放 `packages/io`**，不放 client：io 已有 `jszip`、`katex`（0.16.44 精确版本）、`formulaOmml.ts`、`imageResources.ts`、`docx.ts`，是与 DOCX 对称的平台无关准备层（5）。
8. **验证环境实测**：本机 `python3 3.13.17`、`lxml 6.1.3`、`xmllint`（libxml 20914）齐备；`validate.py --profile export` 单文件约 0.14 秒；vitest（node 环境）里 `spawnSync('python3', …)` 可用并能拿到 JSON；`test_validate.py` 259 项 11 秒通过，`matrix_coverage.py` 2 秒通过。**仓库里没有任何 CI 配置**（无 `.github`），`ENVIRONMENT.md` 把 Python 列为“可选”，所以“CI 是否有 python3”无从核对，必须在验收任务里明确（7.4、D-X-18）。
9. **任务拆分**：T2.0（矩阵与校验脚本同步）、T2.3、T2.4a（先合“契约子 PR”）、T2.4b、T2.4c、T2.5、T2.6（测试验收）；T2.4b/T2.4c/T2.5 在 T2.4a 之后并行；热点文件按“每个任务只改自己的文件”拆开（6）。
10. **待决事项** 20 项（第 8 节），其中影响面最大的是：D-X-02（SES 必填元数据缺失是 error 还是 warning，决定版本快照在草稿上会不会失败）、D-X-03（拖拽过列宽的表是否仍可导出）、D-X-07/08（有序列项 `<label>` 的括号与来源）、D-X-13（术语语言集合并规则）。

## 1. 开工前复查

### 1.1 七条矩阵行的导出列

方法：读矩阵行、对照 `types.ts`、`resolve.ts`、`pmToIr.ts`、`outputBoundary.ts` 与 `schemas/gbt46687.2/*.rng`，并用 `validate.py` 对相关嵌套做了真实校验。

| 矩阵 id | 条款/印刷页 | 现 export | WP8.M 落地后的 IR 事实 | 建议 | 渲染器输出 |
|---|---|---|---|---|---|
| M-10.2-01 | 10.2 / 49 | not-applicable | mark `{type:'stdRef'}`（`types.ts:610`）；PM `stdRef` mark；Resolver 不产生标签；输出边界对 HTML/DOCX 放行、对 XML46687 阻断（`outputBoundary.ts:108-109`） | `required` | 被标记的 run → `<std><std-ref>文本</std-ref></std>`；`std-ref` 只允许文本（`refs.rng:131`），格式标记必须在 `std` 外层 |
| M-10.2-02 | 10.2 / 49 | not-applicable | 同上，“被标记文本即 std-ref 内容” | `required` | 同上；与 M-10.2-01 同一输出 |
| M-10.1.7-01 | 10.1.7 / 48 | not-applicable | mark `{type:'mixedCitation'}`（`types.ts:612`）；与 `stdRef` 互斥（`inlineProjectionDiagnostics`） | `required` | `<mixed-citation>文本</mixed-citation>`，内容可含格式、`xref`（`cm.citation`） |
| M-10.1.1-04 | 10.1.1 / 44 | not-applicable | `crossRef.targetKind='abbreviation'`（`types.ts:617`）；缩略语项 `abb_<k>`（`resolve.ts:427`） | `required` | `<xref ref-type="abbreviation" rid="abb_k">refText</xref>`；目标 `def-item/@id` 因被引用而输出 |
| M-10.1.5-01 | 10.1.5 / 46 | not-applicable | `crossRef.targetKind='listItem'`；只给被引用的有序列项赋标签 `li_<k>`（`resolve.ts:697-709`） | `required` | `<xref ref-type="list" rid="li_k">refText</xref>`；目标 `list-item/@id` 输出 |
| M-8.3-02 | 8.3 / 31 | not-applicable | `IRInline.image`（`types.ts:574`）；`IRInlineImage{src,resourceId?,alt?,size?}`；Resolver 校验位置（`resolve.ts:158-168`） | `optional` | `<inline-graphic xlink:href="inl_<k>" [specific-use="size:S\|M\|L"]/>`；`href` 命名 `inl_<k>`（D-M-08），由资源清单对应物理文件；`alt` 无 XML 属性（warning） |
| M-6.1-03 | 6.1 / 20 | not-applicable | `IRTable.columns?: IRTableColumn[]`（`types.ts:235`）；长度必须等于网格列数；与 `columnWidths`（px）独立 | `optional` | `table` 内 `thead` 之前的 `<col width="N%" [align][valign]/>`；非百分数单位 → warning 并省略 `width` |

**取值依据**。`export` 在矩阵里没有成文定义；按已有行的用法归纳：`required` = 导出器遇到对应 IR 内容必须输出，且 export 档校验有机制强制（须在 `export_enforcement.py` 登记，否则 `matrix_coverage.py` 失败）；`optional` = 只在 IR 有数据时输出，不要求校验器强制。WP8.M 新增的“可有可无的结构”一律是 `optional`（图例 M-8.5-01～06、缩略语 M-10.1.4-01、术语领域 M-9.2.9-01、引言条 M-4.3.4-02/03、单元格边框 M-6.3.3.1-01），所以 `inline-graphic`、`col` 取 `optional`；三类正文引用与两类 `xref` 在 46687.2 中是“凡有则必须这样标”（`std`/`mixed-citation` 为 shall），且与已有的 M-10.1.1-01～03 同构，取 `required`。备选 B：七行全部 `optional`（零脚本改动），见 D-X-01。

**需要改的东西**（均属 T2.0，本任务不改）：

1. `docs/wp8.1/matrix-T.json` 七行的 `export` 与 `notes`（`notes` 里 M-10.2-01 已写“export 列沿用 WP8.1 取值，WP8.2 开工时按设计 §6.1 复核”，复核结论即本表）。`status`、`irPath`、`pmNode` 不变。
2. `scripts/xml46687/export_enforcement.py`：`units()`（`:404-414`）会把 `export==required` 的行及其 shall/should 且带固定取值的属性都列为待登记单元。五个 `required` 行新增的单元与建议登记：
   - `M-10.2-01`、`M-10.2-02`：`_reg("M-10.2-01 M-10.2-02", "R-std-ref", "NA:content")`（`R-std-ref` 探针是 V-17“`std` 必须含 `std-ref`”，已存在于 `PROBES`）；
   - `M-10.1.7-01`：`_reg("M-10.1.7-01", "NA:content")`（`mixed-citation` 无必备子结构，与 M-4.4.2.3-04 的写法一致）；
   - `M-10.1.1-04`、`M-10.1.5-01`：并入 `:346-347` 与 `:394-395` 的 `xref` 登记列表（`S-xref-ref-type`、`S-xref-rid`、`R-dangling-rid`、`R-xref-target`），属性单元 `M-10.1.1-04#ref-type`、`M-10.1.5-01#ref-type` 并入 `_areg("M-10.1.2-01#ref-type …")` 一行。
   登记后运行 `python3 -I scripts/xml46687/matrix_coverage.py --write-readme` 重新生成 `schemas/gbt46687.2/README.md` 里“导出档强制核对”表（`test_validate.py::TestExportEnforcementAudit` 核对该表与脚本一致）。`optional` 两行不进 `units()`，无需登记，但它们会被 `matrix_coverage.py` 的第一节“schema 覆盖检查”纳入（`export` 为 `required/optional`），`inline-graphic`、`col` 及 `width/align/valign/style/xlink:href/specific-use` 在 schema 里均已定义（`figure.rng:84-91`、`table.rng:116-127`），不会新增失败。
3. 顺带发现、**不属于 WP8.2** 的两行：`M-4.3.4-02/-03`（引言条）`import` 仍为 `reject`（rejectKind=implementation），IR 已能保存，WP8.3 应改 `accept`。

### 1.2 G5 `subjectField` 描述符规则 → 渲染器与问题码

规则出处：WP8.M 设计 §7.1“G5 补充决定”（主导人 2026-10-22）。背景事实：旧的术语级描述符 `IRTermDescriptor{kind:'subjectField'}` 已存在（WP6 夹具里有，`term-domain-zh`），只能存纯文本；条目级 `IRTermEntry.subjectField?: IRInline[]`（`types.ts:434`）是规范形式。TBX 的 `tbx:subjectField` 在 schema 里**只含文本**（`tbx.rng:61-65`）且位于 `langSet`，不在 `tig`。

渲染器规则（实现位置：T2.4c 的 `terms.ts`，函数 `resolveSubjectField(entry): {text?:string; problems:Problem[]}`）：

| 情形 | 输出 | 问题码（severity，定位） |
|---|---|---|
| 条目级字段存在且非空 | 首个 `langSet` 内一个 `<tbx:subjectField>`（纯文本） | 同时存在 `kind==='subjectField'` 的术语级描述符 → 每个各报 `term-subjectfield-duplicate`（warning，nodeId=描述符 id，path=`…languageSets[i].groups[j].terms[k].descriptors[m]`）并忽略 |
| 条目级缺失，术语级有且**所有**取值的纯文本（trim 后）一致 | 提升为条目级，同上输出 | 一条 `term-subjectfield-promoted`（warning，nodeId=条目 id），消息列出被提升的描述符数量 |
| 条目级缺失，术语级取值不一致 | 不输出 | `term-subjectfield-conflict`（**error**，nodeId=条目 id，消息列出各取值与描述符 id） |
| 两者都没有 | 不输出 | — |
| 取值含 marks（如 `化学` 加粗；WP8.M 夹具 `g5-t332`） | 取纯文本输出 | `mark-dropped-in-text-only`（warning，D-X-05）：`tbx:subjectField` 只含文本 |

补充：①术语级 `subjectField` 描述符**无论如何都不在 `tig` 里输出**（`tbx:tig` 没有该元素）；②领域内不得含 `〈〉`（渲染阶段添加，原文 9.2.9，印刷页 43），导出时如取值本身带 `〈〉`，原样输出并 warning `term-subjectfield-brackets`；③WP8.3 导入一律写入条目级字段（设计 §7.1）；④输出边界：`termEntry.subjectField` 放行（1.3 表）；描述符本身属 `languageSets` 内容，随 `languageSets` 放行；⑤矩阵行 M-9.2.9-01；测试标题带 `[M-9.2.9-01]`，覆盖四种情形与 marks 情形，并用 `validate.py` 确认输出被 export 档接受。

### 1.3 XML46687 输出边界：放行清单与 `outputBoundary.ts` 改法

#### 1.3.1 机制与实测基线

机制（`outputBoundary.ts`）：`getOutputSupportProblems` 对每个对象按 `kind`（无 `kind` 时按父键推断的 shape）查 `BASE_FIELDS`（`:20-48`）加该格式的 `EXTRA_FIELDS`（`:79-92`，`XML46687: NO_EXTRA_FIELDS`，`:91`）；kind 不在表内 → 报 `kind`（`:220`）；字段不在表内且非空 → 报该字段（`:231-234`）；mark 类型不在 `MARKS_BY_FORMAT`（`:109`，XML 家族是 `MARKS`，`:50`）→ 报 `type`（`:235`）。它先于渲染器运行：`renderXml46687` 入口按约定先 `assertFootnoteReferences(doc, labels)`，再 `assertOutputSupported(doc,'XML46687')`，出问题抛 `UnsupportedOutputError`（问题带 nodeId 与 IR 路径）。

**实测基线**（副本，`getOutputSupportProblems(doc,'XML46687')`，按 `path` 去掉下标后分组）：

| 文档 | XML46687 问题数 | 说明 |
|---|---|---|
| `fullRendererFixture()`（fullFixture 的渲染器变体） | 0 | 已可直接导出，是 T2.4a 骨架的第一个黄金样例 |
| WP8.M 全要素 IR（`createWp8mIrDoc()`） | **31** | 与 `wp8m/validation.md` “XML46687 31”一致。分布：`front.introductionClauses` 1、行内 `image` 6、块 kind（`normRefList` 1、`defList` 3）4、`subjectField` 4、`stdRef/mixedCitation` 的 mark `type` 6、`legend` 2、`examples` 2、单元格 `style` 2、`columns` 2、`bibliographyTitle` 1、`resources` 1 |
| WP6 夹具（`createWp6Fixture()` 经 `pmToIr`） | **57** | 见 1.3.3：多数不在设计 §6.2 里 |

WP8.M 的 31 条恰为设计 §6.2 的 11 类，说明 §6.2 对“WP8.M 新增结构”是完整的；但 WP8.2 要导出的是**整份标准**，WP6 时代的字段（元数据、术语语言集、文献字段、索引、资源、公式、行内标记类型）同样被现状阻断，§6.2 没有覆盖。

#### 1.3.2 设计 §6.2 逐项 → 改法

“改法”都发生在 `outputBoundary.ts` 与新文件 `renderers/xml46687Boundary.ts`（T2.4a 新建，只做汇总）：每个领域把自己要放行的字段/shape/mark 作为导出常量放在**自己的** `renderers/xml46687Parts/<域>.ts` 里（`tables.ts`、`figures.ts`、`formulas.ts`、`terms.ts`、`refs.ts`、`meta.ts` 等，T2.4a 先建成只含空常量的桩），`xml46687Boundary.ts` 把它们并入 `EXTRA_FIELDS.XML46687` / `MARKS_BY_FORMAT`，`outputBoundary.ts` 只改一次接线。这样 T2.4b/T2.4c 各改自己的文件，不在 `outputBoundary.ts` 与同一个常量表里冲突（6.3）。

| §6.2 放行项 | 现阻断位置 | 改法 | 需要同步的细节 | 归属 |
|---|---|---|---|---|
| `doc.bibliographyTitle` | `doc` 字段表（`:21`）无此项 | `EXTRA.doc` 加 `'bibliographyTitle'` | 标题内容按 `inline` shape 递归（默认），无需新 shape | T2.4c |
| `front.introductionClauses` | `front` 字段表（`:25`） | `EXTRA.front` 加 `'introductionClauses'` | 条对象自带 `kind:'clause'`，沿用 `clause` 字段表 | T2.4a |
| 块 kind `normRefList` / `normRef` | `BASE_FIELDS` 无该 kind（`:179`→`:220`） | 并入常量 `GROUP_G1`（`:61-64`，HTML/DOCX 已在用） | `entries` 的子对象带 `kind:'normRef'`；`ref/title/content` 走默认 `inline` shape | T2.4c |
| 块 kind `defList` | 同上 | 并入 `DEF_LIST_FIELDS`（`:58`） | `items` 在 `kind==='defList'` 时取 `where` shape（`:254`，已有） | T2.4c |
| `figure.legend`、`figure.examples` | `figure` 字段表（`:35`） | `EXTRA.figure` 加 `'legend'`、`'examples'` | **新 shape `legend`**（字段 `id,title,items`）；`:252-257` 的 childShape 链要加 `key==='legend' → 'legend'`，并把 `:254` 改为 `kind==='defList' \|\| kind==='legend' ? 'where' : 'item'`；`examples` 元素自带 `kind:'example'`，不需要 shape | T2.4b |
| 行内 `image` | `inline` 字段表（`:42`） | `EXTRA.inline` 加 `'image'` | **新 shape `inlineImage`**（字段 `src,resourceId,alt,size`）；childShape 链加 `key==='image' → 'inlineImage'`；位置限制（只允许段落）由 Resolver 保证（已有 `unsupported-content`，并被边界转为 `unsupported-output`，`:293-310`） | T2.4b |
| mark `stdRef` / `mixedCitation` | `MARKS`（`:50`） | `MARKS_BY_FORMAT.XML46687 = PRINT_MARKS ∪ XML 扩展集`（见 1.3.3 的 mark 行） | `PRINT_MARKS`（`:108`）已含这两个 | T2.4c |
| `termEntry.subjectField` | `termEntry` 字段表（`:40`） | `EXTRA.termEntry` 加 `'subjectField'` | 取值为 `IRInline[]`，默认 shape | T2.4c |
| `table.columns` | `table` 字段表（`:32`） | `EXTRA.table` 加 `'columns'` | **新 shape `column`**（`width,textAlign,verticalAlign`）与 `measure`（`value,unit`）；childShape 链加 `key==='columns' → 'column'`、`key==='width' → 'measure'`（目前 `width` 没有 shape） | T2.4b |
| `cell.style`（含 `border*Style`） | `cell` 字段表（`:34`） | `EXTRA.cell` 加 `'style'` | **新 shape `cellStyle`**（`textAlign,verticalAlign,backgroundColor,border{Top,Right,Bottom,Left},border*Style,padding*`），其下 `border*`/`padding*` 用 `measure` | T2.4b |
| `legend` 内 `IRDefItem` | 无需 | `where` shape 已含 `id,term,definition`（`:37`） | — | — |

#### 1.3.3 §6.2 之外必须处置的字段（WP6 夹具 57 条的归类）

处置三类：**放行（消费）**＝渲染器有确定输出；**放行并告警**＝IR 有数据、XML 无定义表达，渲染器报 warning/info，内容不丢（JSON 仍完整）；**保持阻断**＝丢弃会改变内容含义，或有用户已定决议。分类原则与 D-S-05、D-S-06 一致，具体取舍列入 D-X-03/04/05。

| IR 字段或对象 | 处置 | XML 去向/问题码 | 出处与理由 | 需要的 shape/改法 |
|---|---|---|---|---|
| `meta.titleParts/identifiers/languages/publishers/copyrights/replacedStandards` | 放行（消费） | `title-wrap`/`std-ident`+`std-ref`/`content-language`/`std-org-group`/`permissions`/`std-supersedes`（2.1） | C-S-13～19 | 新 shape：`titlePart,identifier,identifierPart,language,publisher,copyright,replacedStandard`，字段取自 `types.ts:85-139` |
| `meta.proposer` / `meta.technicalCommittee` | 放行（消费） | `custom-meta proposer` / `comm-ref` | C-S-20/21（现状 `PRINT_META_FIELDS` 只给 HTML/DOCX，`:49`） | `EXTRA.XML46687.meta` |
| `meta.adoptions` | 放行并告警 | `meta-not-expressed`（warning） | C-S-18：`equivalence` 无内容模型，D-S-05“暂不导出并报告”；WP6 夹具里有，阻断会使其无法导出 | 新 shape `adoption` |
| `meta.standardType`（必有字段，`base` 已放行） | 放行并 info | `meta-not-expressed`（info，每次导出一条） | `std-type` 无内容模型（C-S-18） | — |
| `doc.index` | 放行（消费） | `index` 整棵（2.11） | C-S-28 | 新 shape `index,indexGroup,indexEntry`；`seeAlso` 非空 → warning `index-seealso-not-expressed`（M-4.5.4-07） |
| `doc.resources` | 放行（消费，仅校验） | 不输出字节；清单对应由 `ResourceManifest` 承担（4.3） | 渲染器只读资源 id/媒体类型，不读 `data` | 新 shape `resource` |
| 块 kind `warning`、`quote`、`code`（**四种格式现在都阻断**：`BASE_FIELDS` 里没有这三个 kind，实测 HTML、DOCX、XML、XML46687 对 WP6 夹具都报 `…children[5].kind` 等三条） | 放行（仅 XML46687，消费） | `non-normative-note[@content-type="warning"]`、`disp-quote`、`code`（2.5） | M-5.6-03、M-5.9-01、M-5.9-02、M-5.10-01；HTML/DOCX 保持原状，不属本阶段 | 整体登记三个新 kind：`warning: kind,id,content`、`quote: kind,id,content`、`code: kind,id,language,text`（与 `GROUP_G1` 同写法），放在 `xml46687Parts/blocks.ts`，归 T2.4a |
| 行内 `style`（颜色、字号…） | **保持阻断** | 边界 `unsupported-output`（位置明确） | D-S-06：5.1 只允许七种格式，丢弃须用户确认 | 不改 |
| 行内 `formula` | 放行（消费） | `inline-formula>mml:math`（2.8） | 现状对 XML 家族一律提前拦截（`:237`）；改为：对 XML46687 放行，**文本型容器**（`termEntry.source`、`termEntry.subjectField`、`normRef.ref`、文献 `fields[].value`）内出现 → error `formula-in-text-only` | 删/改 `:237`；容器判定沿用 `INLINE_FORMULA_CONTAINERS` 的“父 kind.键”写法（`:56`）反向建表 |
| mark 类型 `strike`、`code`、`variable`、`externalLink`、`bibRef`、`termRef`、`stdRef`、`mixedCitation` | 放行（消费） | `strike`/`inline-code`/`named-content`/`ext-link`/`xref`/`xref` 或 `tbx:entailedTerm`/`std`/`mixed-citation`（2.3） | 现状 `MARKS` 只有 7 个（`:50`），HTML/DOCX 也不放行前六个；XML46687 需要自己的集合 | `MARKS_BY_FORMAT.XML46687` |
| mark 字段 `href`（`externalLink`） | 放行（消费） | `ext-link/@xlink:href`（V-11 协议白名单由渲染器预检） | C-T-56 | `mark` 字段表加 `'href'` |
| mark 字段 `title`、`target`、`rel`（`externalLink`） | 放行并告警 | `link-attr-not-expressed`（warning） | G-T-20：无对应 STS 属性 | 同上 |
| mark 字段 `kind`、`name`（`variable`） | 放行并告警 | `variable-attr-not-expressed`（warning） | C-S-30；**实测陷阱**：`visit` 用 `typeof object.kind === 'string' ? object.kind : shape`（`:156`），带 `kind` 的 variable mark 被当成“kind 为 symbol 的节点”，直接报 `…marks[i].kind`（WP6 夹具实测：`marks[].kind` 1 条）。须改为 `shape==='mark' ? 'mark' : …` | 改 `:156` |
| `formula.mathml`、`formula.notes` | 放行（消费） | `mml:math`（来自 `mathml` 映射，不读此字段）、公式注 `non-normative-note`（2.8） | 4.4 | `EXTRA.formula`；新 shape `formulaNote`（`id,content`）；`inlineFormula` shape 加 `'mathml'`,`'source'` |
| `formula.sourceInlines` 检查（`:227`） | 保留 | 仍要求“仅纯文本等价”（LaTeX 是 MathML 转换输入） | 与 HTML/DOCX 同口径 | 不改 |
| `table.unit` | 放行（消费） | `table-wrap-foot/p[@content-type="dimension"]` | C-T-03 | `EXTRA.table` |
| `table.width` | 放行并告警 | 仅 33/66/100 % 时写 `@width`，否则 `table-width-not-expressed`（warning） | C-T-10 | `measure` shape |
| `table.style`、`row.style` | 放行并告警 | `table-style-not-expressed`（warning；`row.style.textAlign/verticalAlign` 例外，写入 `tr/@align`、`tr/@valign`，2.6） | C-T-10：导出的 `table` 不带 border/frame/rules | 新 shape `tableStyle`、`rowStyle` |
| 单元格 `unit` | 放行（消费） | 表头单元格：`th` 内第二个 `p`（C-T-04）；非表头单元格 → error `cell-unit-unsupported`（原文无规定，D-X-03 附带） | 6.2.4（印刷页 22） | `EXTRA.cell` |
| 单元格 `cellType`、`width` | 放行并告警/info | `cell-attr-not-expressed`（info） | 无 XML 属性 | `EXTRA.cell` |
| 单元格 `columnWidths`（px） | 放行并 info（**D-X-03，现状阻断**） | `px-width-ignored`（info） | 矩阵 M-6.1-03 的 notes：“导出 col 时只取 columns，不由 px 反推”；若保持阻断，用户拖拽过一次列宽的表永远不能导出 XML | `EXTRA.cell` |
| `table.headerRowCount` 检查（`:222-226`） | 保留 | 仅在与“前导全表头行推断值”一致时放行 | thead 与 `th` 的对应关系，C-T-16 | 不改（`isXmlFormat` 已含 XML46687） |
| `figure.resourceId`、`figure.descriptions`、`figure.unit` | 放行（消费） | 资源对应（2.7）、`p`（说明段）、`caption/p[@content-type="dimension"]` | C-T-26/33 | `EXTRA.figure`；新 shape `figureDescription`（`id,content`） |
| `figure.alt`、`figure.title`、`figure.imageWidth/imageHeight` | 放行并告警 | `figure-attr-not-expressed`（warning） | `graphic` 无对应属性（`figure.rng:62-81`）；`@specific-use` 只有 T/S/M/L 档位（G-T-14） | 同上 |
| `figure.groups` | **保持阻断** | 边界 `unsupported-output`：`fig-group`/同 `fig` 多 `graphic` 本阶段不做（D-T-11、D-M-12） | 8.4 | 不改 |
| `termEntry.languageSets` | 放行（消费） | `tbx:langSet/tbx:tig/…`（2.9） | C-T-43 | 新 shape `languageSet,termGroup,termVariant,termDescriptor` |
| `termEntry.nestedEntries` | **保持阻断** | D-T-09：不拍平 | 9.1 | 不改 |
| `bibEntry.entryType/fields/identifiers/externalLink` | 放行（消费） | `std`/`mixed-citation`/`uri`（2.10） | C-S-27 | 新 shape `bibField,bibIdentifier,bibExternalLink`；`bibliography[]` 元素自带 `kind:'bibEntry'` |
| `IRFormulaNote`、`IRFigureDescription`、`IRTermDescriptor` 等无 `kind` 的对象 | 靠 shape | 同上 | 默认 shape 是 `inline`，字段表不匹配会逐字段误报 | 每个新增对象类型都必须在 childShape 链登记，**并有一条“放行后零问题”的单元测试**（防止 shape 漏登记时整棵子树被误报） |

#### 1.3.4 `outputBoundaryXml46687.test.ts` 的改写（不得弱化）

现状：整个文件的前提是“XML46687 与 XML 完全一致，唯一例外是罗马列项”（`:11-18`、`:76-121`）。一旦放行任何字段，这句话就不成立，**不能**靠放宽断言（例如把 `toEqual` 改成 `toContain`）来过关。改写方案：

1. **常量 `XML46687_DECLARED_DIFFERENCES`**（运行时数据，**导出自 shared 的 `renderers/xml46687Boundary.ts`**，由各领域文件里的分段常量拼成，shared 与 client 的测试都从 `@ses/shared` 引用它）：数组，每项 `{ pathSuffix: string, kind: 'field'|'kind'|'markType', matrixIds: string[], task: 'T2.4a'|'T2.4b'|'T2.4c', reason: string }`，穷举 XML46687 比 XML 多放行的全部字段（罗马列项保留为一项，`pathSuffix:'.listType'`，原因同现状）。
2. **差异集合断言（核心，比现状更严）**：对“富文档”（扩充后覆盖全部已声明差异的字段）分别取 XML 与 XML46687 的问题路径集合 `A`、`B`：断言 `A \ B` 的**路径后缀集合恰好等于** `XML46687_DECLARED_DIFFERENCES` 的 `pathSuffix` 集合（不多不少），且 `B \ A` 为空（XML46687 不得比 XML 多阻断）。新增任何放行而不登记，或登记了却没有真正放行，测试都失败。
3. **逐项正例**：对每个已声明差异，构造只含该字段的最小文档，断言 XML 报 ≥1 条（路径以该后缀结尾）、XML46687 报 0 条（`it.each(XML46687_DECLARED_DIFFERENCES)`，标题带矩阵 id）。
4. **仍阻断清单**：常量 `XML46687_STILL_BLOCKED`（行内 `style`、`figure.groups`、`termEntry.nestedEntries`、`languageSets` 中无法表达的取值由渲染器报而非边界…），逐项断言 XML46687 仍报且 nodeId/路径精确。
5. **消息规范化**：保留现有 `asXml()` 把 `XML46687` 换成 `XML` 的逐字比较，用于“未声明差异的问题与 XML 逐字相同”。
6. 已有的其余用例（打印元数据 `proposer/technicalCommittee`、`headerRowCount`、类型错误引用、`assertOutputSupported` 抛错）按声明差异调整预期：`proposer/technicalCommittee`、`columnWidths` 变为差异项；`headerRowCount` 与类型错误引用保持“与 XML 相同”。
7. 拆分文件：核心 `outputBoundaryXml46687.test.ts`（T2.4a 持有常量与全局断言）+ 每域一个 `outputBoundaryXml46687.<域>.test.ts`（T2.4b/T2.4c 各持有自己的“逐项正例”）；常量用“域分段”的数组展开写法，避免同一行冲突。

#### 1.3.5 其他把“XML46687 == XML”或“XML46687 阻断”钉住的测试

放行任何字段都会让下列文件失败，须在对应任务内改写（改成“XML46687 对该字段放行、旧 XML 仍阻断”，并保留旧 XML 的阻断断言）：

| 文件（行） | 钉住的内容 | 归属 |
|---|---|---|
| `shared/src/renderers/__tests__/wp8mG1.test.ts:54-92,125` | 清单 kind、两个 mark、标题被 XML46687 阻断；`:74-75` 与旧 XML 逐条相同 | T2.4c |
| `…/wp8mG2Boundary.test.ts:36-68,115` | `defList` 被阻断；与旧 XML 相同 | T2.4c |
| `…/wp8mG3Boundary.test.ts:47-49,149` | `legend/examples/image` 被阻断 | T2.4b |
| `…/wp8mG5Boundary.test.ts:42-68,94` | 带领域的术语被阻断 | T2.4c |
| `…/wp8mG6.test.ts:49-` | `introductionClauses` 被阻断 | T2.4a |
| `…/wp8mG8Boundary.test.ts:65-68,114-117,135` | `columns`、单元格 `style` 被阻断 | T2.4b |
| `…/wp8mG4Boundary.test.ts`、`wp8mG7.test.ts:51-78,227`、`wp8mResolverBoundary.test.ts`、`wp8mZdB.test.ts` | 注释或“放行”断言，预计不受影响 | 各任务改完后复跑确认 |
| `client/src/extensions/wp8mIntegration.test.ts:422-440,477` | “XML46687 与 XML 一致，仅差罗马列项”“XML 与 XML46687 之差恰为 2” | **T2.4a-1**（改成“差集恰等于 `XML46687_DECLARED_DIFFERENCES`”，之后 b/c 放行字段不再改它，6.3） |
| `client/src/extensions/wp8mG1.test.ts:401-408`、`wp8mG6.test.ts:158,266-273` | 同上（来自生产 PM） | T2.4c / T2.4a |
| `client/src/extensions/wp8mPersistence.acceptance.test.ts:334-339,361,410` | opt-in 验收基线“XML−XML46687=2” | **T2.4a-1**（同上改为计算值，并在 `docs/wp8.2/validation.md` 记录） |
| `io/src/wp8mG2.test.ts:5`、`wp8mG1.test.ts:160` | 只是旧 XML 阻断，不受影响（`exportGuard` 在 WP8.4 之前仍把 `xml` 映射到旧 `XML`，`io/src/exportGuard.ts:57`） | — |

### 1.4 Resolver 相对 X/R 约定的剩余差距（实测）

#### 1.4.1 X-01～X-26 现状核对

方法：在副本上对三份夹具（WP8.M、fullRenderer、WP6）跑 `resolve()`，按对象种类取 `labels`；同时读 `resolve.ts`。

| 约定 | 现状（实测） | 结论 |
|---|---|---|
| X-01 章 `sec_<n>` | `sec_1`（`resolve.ts:630`） | 一致 |
| X-02 条 | `sec_4.1`（`:618`） | 一致 |
| X-03 无标题条 | 与有标题条同一路径，`sec_<编号>` | 一致；渲染器加 `sec-type="numbered-paragraph"` |
| X-04/05/08/25 `sec_foreword`、`sec_intro`/`sec_0`、`sec_bibl`、`sec_index` | Resolver 不产生 | 渲染器常量（R-6，3.2）；引言条 `sec_0.1`、`sec_0.1.1` 已由 R-7 实现（实测 `sec_0.1\|0.1`） |
| X-06/07 附录、附录条 | `sec_A`、`sec_A.1`（`:639`） | 一致 |
| **X-09 `biblref_<n>`** | **`bib_1`（`:730`）** | **未做（R-1）** |
| X-10 `ref_<n>` | `ref_1`、`ref_2`（`:457`，实测） | 已做（R-8）；“无正文”含义仍未核实。印刷页 67 该行的说明是“如第 5 个引用的参考文献”（亲验），与“没有 label 的规范性引用条目”的解读并不矛盾，也不能证实；沿用 D-M-02 的序号式 |
| X-11/12 `sec_<n>` + `term_<n>` | `sec_3.1\|…\|term_3.1`（实测，`ResolvedLabel.termEntryXmlId`） | 已做（R-3） |
| **X-13 术语注 `nte_<术语号>-<k>`** | **`note_<n>`（全局序号，`labelNotesAndExamples`，`:664`）** | **未做（R-4）** |
| X-14/15 一般注、示例 | `note_<n>`、`example_<n>` | Resolver 继续赋号，渲染器决定是否输出（D-S-09） |
| X-16 警告/摘录/代码 | `ext_…`（实测：`warning`、`quote`、`code` 均有 ext_ 标签，`:835`） | 渲染器不读这些标签的 `xmlId`（R-5） |
| X-17 列项 | 只给被引用的有序列项 `li_<k>`（`:697`） | 一致；但缺 R-11（下） |
| X-18 `<p>` | 无标签；**对段落的类型化 crossRef 会被补 `ext_` 标签且无任何问题**（实测：`crossRef(targetKind:'paragraph')` 得 `ext_70_32`，`problems=[]`） | R-9 的事实依据；渲染器须报错 |
| X-19/20 表、图 | `tab_1`、`tab_A.1`、`fig_1`、`fig_A.1`（实测） | 一致 |
| X-21 公式 | 有编号 `formula_1`、`formula_A.1`；**无编号公式没有任何标签**（实测 `labels['f-un']===undefined`） | 一致，且比 conventions-S 写的“无编号：`ext_…`”更好（该处表述已过期） |
| X-22 行内公式、`mml:math` | 行内公式 `ext_66_6f…`（`:172`）；`mml_m<k>` 不属 Resolver | 渲染器后置赋值（3.3） |
| X-23 脚注 | `fn_<seq>`（`:183`） | 一致 |
| **X-24 表脚注** | **`tabfn_tab_1_a`（`:207`）** | **未做（R-2）** |
| X-26 缩略语 `def-item` | `abb_<k>`（`:427`） | WP8.M 补缺（D-M-02），一致 |

#### 1.4.2 R-1～R-9 与新增 R-10、R-11

| 编号 | 内容 | 状态 | 改法（T2.3） |
|---|---|---|---|
| R-1 | `bib_<n>` → `biblref_<n>` | 未做 | `resolve.ts:730` 一处；`bibSeq`（`html.ts:627`、`docx/body/bibliography.ts:53`）用 `/(\d+)$/` 取序号，无需改 |
| R-2 | `tabfn_<tab>_<字母>` → `table-fn_<表号>.<k>` | 未做 | `resolve.ts:207`：`k` 取 `++scope.seq`（与字母标签同一计数，不随字符变化），表号取 `labels[tableId].xmlId` 去掉 `tab_` 前缀（附录表为 `A.1`）。**必须同时改** `html.ts:232`（`startsWith('tabfn_')`）、`renderers/footnotes.ts:17`（`xmlId.endsWith('_'+marker)` 校验）、旧序列化器 `client/src/serializer/xmlSerializer.ts:1173`（正则）——旧序列化器虽在 WP8.4 删除，但 WP8.2 期间它的测试仍在跑，不改会失败 |
| R-3 | `term_<n>` | **已做** | `termEntryXmlId`（`resolve.ts:495`） |
| R-4 | 术语内注 `nte_<术语号>-<k>` | 未做 | `labelNotesAndExamples`（`:664`）：作用域键对应术语条目（`ctx.kinds.get(key)==='term'`，此时已登记）时，注的 `xmlId=nte_${条目 label}-${序号}`，**不占用全局 `note_<n>` 计数**（D-X-19，使其余 `note_<n>` 连续）；示例仍 `example_<n>`（`tbx:example` 在 schema 里没有 `id`，渲染器遇到对术语示例的引用报错，2.9） |
| R-5 | `ext_` 不得进入 XML | 渲染器侧 | 实测 `ext_` 标签覆盖：行内公式、`warning/quote/code`、元数据各实体、`languageSets/groups/terms/descriptors`、公式注、图说明/图组、文献字段、索引、资源；渲染器**只对 3.1 表里列出的对象读 `xmlId`**，输出树收尾断言“任何 `id`/`rid`/`target` 不以 `ext_` 开头”（3.4） |
| R-6 | 常量 id 纳入唯一性检查 | 渲染器侧 | 现行 `registerId` 只查 NodeId（`resolve.ts:97`）；xmlId 唯一性在渲染器收尾检查（3.4）。Resolver 不加（会改变所有出口的 problems） |
| R-7 | 引言条 `sec_0.n` | **已做** | `resolve.ts:924-931` |
| R-8 | 规范性引用条目 `ref_<n>` | **已做** | `resolve.ts:457` |
| R-9 | 对无 id 方案目标的引用报告 | 渲染器侧 | Resolver 对 `paragraph`、`code`、`warning` 等目标的 crossRef **静默通过**（实测 `problems=[]`，且补 `ext_` 标签）。渲染器报 `xml-xref-target-unsupported`（error，D-X-06） |
| **R-10（新）** | **公式注没有 `label`/`xmlId`** | 未做 | `resolve.ts:403-408` 只 `ctx.kinds.set(note.id,'note')`，随后被 `registerExtendedData` 补成 `label:''` + `ext_` 标签（`formulaNoteTypedReferences.test.ts` 把 `label:''` 与 `ext_…` 钉死）。C-T-23、M-7.2-02 要求公式注 `<label>` 由 Resolver 按作用域编号。改法：在该循环里 `ctx.scope(block.id).notes.push({id:note.id})`，使其与表注、图注同机制得到“注：/注n：”与 `note_<n>`。实测只影响 2 个测试文件（下） |
| **R-11（新）** | **未被引用的有序列项没有标记** | 未做 | XML 的 `list-item/label`（M-5.7-09，export required）需要每个有序项的标记；`labels` 里只有被引用者（`resolve.ts:697-709`，且 `wp8mG4Resolve.test.ts` 钉死“未被引用的列项没有 label”）。改法见 D-X-08：从 `resolve.ts` 导出纯函数 `computeOrderedListMarkers(doc, strategy?): Record<NodeId,string>`，把 `visitBlock` 里 D-M-17 的“渲染时确有该标识”判定（`:295-306`）抽出来，`resolve()` 自己也调它，XML 渲染器用默认策略调同一函数——判定只有一份，编号逻辑仍只在 Resolver 模块 |

#### 1.4.3 实测：各改动波及的测试与快照

副本上逐项套用并跑 shared（89 文件 2102 项）、io（25 文件 363 项）、client（114 文件 + 2 跳过，1420 项）全量，基线全绿。

| 改动 | shared 失败 | client 失败 | io | 快照/golden |
|---|---|---|---|---|
| R-1 仅 `resolve.ts:730` | `ir/__tests__/resolve.test.ts`（1，`:139`）、`ir/__tests__/wp8mG1.test.ts`（2，`:131-132,494`）、`renderers/__tests__/html.test.ts`（2，快照） | `extensions/wp8mG1.test.ts`（1，`:149`）、`serializer/xmlCrossRef.test.ts`（2，`:169,177,395`） | 0 | `renderers/__tests__/__snapshots__/html.test.ts.snap`（screen 与 print 各 1，共 5 处 `bib_1/bib_2`→`biblref_…`）；DOCX 快照/golden 0 |
| R-2 完整（含 `html.ts`、`footnotes.ts`、旧序列化器） | `renderers/__tests__/footnotes.test.ts`（1，`:51-52` 字面 `tabfn_tab_1_a`） | `serializer/xmlCrossRef.test.ts`（1，`:269` `toMatch(/^tabfn_/)`）、`serializer/xmlFootnotes.test.ts`（1，`:107-108`） | 0 | 0 |
| R-2 **只改 Resolver** | 7 个文件 20 项：`footnotes.test.ts`、`htmlAnchors.test.ts`、`nativeIrFootnoteAtoms.test.ts`、`docx/__tests__/footnotes.test.ts`、`docx/body/tableContinuation.test.ts`、`inlineFormula.test.ts`、`outputBoundary.test.ts` | 4 个文件 22 项：`wp6FootnoteCanonicalProjection.test.ts`、`docxTableFootnotes.test.ts`、`xmlCrossRef.test.ts`、`xmlFootnotes.test.ts` | 0 | — |
| R-4 | `renderers/__tests__/html.test.ts`（2，快照） | 0 | 0 | `html.test.ts.snap`（术语 1 的注 `note_1`→`nte_3.1-1`，其后各注序号前移） |
| R-10 | `ir/__tests__/formulaNoteTypedReferences.test.ts`（1） | `extensions/wp6FormulaNoteTypedReference.test.ts`（1） | 0 | 0 |
| **R-1+R-2+R-4+R-10 合并** | **5 个文件 7 项** | **4 个文件 6 项** | **0** | **仅 `html.test.ts.snap`；DOCX 快照/golden、JSON golden 全 0** |

结论：T2.3 的改动面是确定的、可一次提交的；`docx` 渲染器与 JSON golden 完全不受影响（`docx` 只用 `fn_N` 和 `bibSeq` 的尾部数字，`docx/body/inline.ts:108`、`docx/render.ts:127`、`docx/body/bibliography.ts:54`）。conventions-S 对 R-1 写的“5 个测试文件”、对 R-2 写的“3 个测试文件”都偏少：实际 R-1 是 4 个测试文件 + 1 个快照（`bibliography.test.ts`、`toc.test.ts` 里的 `bib_1` 是手写 labels 桩，不调 Resolver，不会失败，可顺手统一字面量），R-2 还有 3 处必须同步的**源码**。

## 2. 元素 → IR 逐行映射

### 2.0 读表约定与通用规则

**列含义**：①XML 路径与属性（`@` 表示属性；`tbx:`、`mml:`、`xlink:` 为前缀）；②IR 来源；③id/rid 来源（`R:` = Resolver 的 `labels[...]` 字段，`K:` = 渲染器常量，`S:` = 渲染器按文档序分配，`—` = 不写 id）；④矩阵行与约定编号（矩阵行写全称，便于第 2.13 节的脚本核对）；⑤错误/告警条件（问题码见 4.4 的目录；未写“error/warning/info”处默认为 error 的条件才会抛错，其余只记录）。矩阵里 `export` 为 `required/optional` 的行（含 1.1 要改的七行，及 obligation 为 may/示例的行）都进了本节；`not-applicable` 的行不映射（它们“不输出”的原因写在对应行的说明里）。

**2.0.1 渲染管线（单文件 `xml46687.ts` 内的阶段，不拆成多个对外函数）**

| 阶段 | 内容 | 失败方式 |
|---|---|---|
| P0 入口断言 | `assertFootnoteReferences(doc, labels)`（返回按 `fn_<n>` 排序的正文脚注）→ `assertOutputSupported(doc,'XML46687')`；校验 `options.mathml`、`options.resources` 的形状（不是 `undefined`、键为字符串） | 抛 `Error`/`UnsupportedOutputError`（与 HTML/DOCX 渲染器一致） |
| P1 预扫描 | 一次遍历 IR，建三张静态表：`targets: Map<NodeId, TargetInfo>`（每个可被引用的对象的真实种类，2.11）、`orderedMarkers`（有序列项标记，D-X-08）、`images`（行内图与块图的 href 清单，3.3，与 T2.5 共用 `collectXml46687ImageRefs`） | 收集问题，不抛 |
| P2 构建 | 按 2.1～2.12 的分派表自顶向下构建 `XmlElement` 树；每个领域一个函数，签名统一为 `(node, ctx) => XmlElement[]`；问题写入 `ctx.problems`；**凡写出的 `xref`/`tbx:entailedTerm` 都把目标 NodeId 记入 `ctx.emittedRefs`**，“仅被引用时写 id”的元素（注、示例、列项、缩略语项、术语注）先不带 id，只把 `(NodeId → 元素)` 登记进 `ctx.pendingIds`（3.2） | 收集问题 |
| P3 后置赋值 | ①对 `emittedRefs ∩ pendingIds` 的元素补写 `id`；②按文档序对整棵树的 `mml:math` 赋 `id="mml_m<k>"`（3.3） | — |
| P4 收尾检查 | 全树 `id` 唯一；每个 `xref/@rid`、`tbx:entailedTerm/@target` 在树中可解析；没有以 `ext_` 开头的 `id`/`rid`/`target`；每个 `xlink:href`（`graphic`、`inline-graphic`）可在 `resources` 清单里定位（3.4） | 产生 error 问题 |
| P5 写出 | 有 error 问题 → 抛 `XmlExportError`（携带全部问题）；否则 `writeXml(doc, {namespaces, indent:'  ', preserveSpace})` | `XmlWriteError` 被包装为 `xml-write-failed` |

**2.0.2 构建规则（全表适用）**

1. **命名空间**：`standard` 之下的 STS 元素 `ns=null`；TBX 元素用 `qname('urn:iso:std:iso:30042:ed-1', local, 'tbx')`；MathML 用 `MATHML_NS` + `mml`；`xlink:href` 用 `XLINK_NS`。`writeXml` 的 `namespaces` 固定为 `{mml, tbx, xlink}` 三项（写在根上，前缀字典序，`validate.py` V-16 只查绑定，不查顺序；4.1 示例的声明顺序是 xlink、mml、tbx，无校验含义）。
2. **XML 声明**：由写出器固定输出 `<?xml version="1.0" encoding="UTF-8"?>`（矩阵 M-4.1-01 的属性值写作 `utf-8`，`validate.py` V-16 与写出器均取大写 `UTF-8`，两者等价，见附录 B 第 7 项）；**不写 DOCTYPE**（M-4.1-02 的导出列是 `not-applicable`）。
3. **属性顺序**（确定性）：`id` → `sec-type` / `content-type` / `list-type` / `ref-type` / `custom-type` → `rid` → `orientation` → `list-content` → `colspan` → `rowspan` → `align` → `valign` → `style` → `xlink:href` → `specific-use`；每个元素只输出非空属性。
4. **文本节点**：UTF-8 直接字符，只转义 `&`、`<`、`>`（属性另转义 `"`），不使用命名实体（M-5.4-01 · C-S-34）；原样输出（不裁剪、不规范空白），空串不生成节点，相邻文本合并；`'\n'` → `<break/>`（仅在允许 `break` 的容器内，见 2.3.4）；XML 1.0 不允许的控制字符由写出器拒绝，包装为 `xml-write-failed`（C-S-34）。
5. **缩进与混合内容**：`preserveSpace(el)` 对“含内容文本或行内元素的元素”返回 `true`（判定看**树结构**：任一子节点是非空文本，或子元素属于行内集合 `{bold, italic, underline, strike, sup, sub, named-content, inline-code, inline-graphic, break, xref, ext-link, fn, std, mixed-citation, inline-formula, uri, tbx:entailedTerm}`），于是 `p`、`title`、`label`、`td/th`（行内形式）、`term`、`tbx:*` 等一律逐字写出；`sec`、`list`、`table`、`def-list` 等只含元素子节点的容器照常缩进。这样纯元素内容的 `p`（例如只含一个行内公式）不会被塞进缩进空白（M-5.1-08“内容布局不使用空格和制表符实现”）。`code` 元素的文本含换行，原样保留。
6. **问题对象**：`{code, severity, nodeId?, path, message}`；`path` 是 IR 路径（与 `getOutputSupportProblems` 同一写法，如 `doc.body[0].children[2].content[1]`），不是 XML 路径（4.2）。
7. **标签读取**：只读 `labels[id].label/xmlId/refText/termEntryXmlId`，**不拼接、不推算**任何编号；允许的纯字符串变换仅两处：附录标签“附录A”→“附录 A”（插入半角空格，C-S-07）、有序列项标记的全角括号转半角（D-X-07）。
8. **标题与 label 内不写 `bold`**（C-S-23）；`p` 不带任何属性（M-E-25，V-18）。

**2.0.3 标题类内容模型（行内构造器的“容器”参数）**：`inline`（`cm.inline`）、`term`（`cm.term`）、`phrase`、`label`、`citation`、`subsup`、`text`（纯文本），定义见 2.3.3。不允许的构造按 2.3.3 末的规则处置。

### 2.1 根、处理信息、前置页

| XML 路径与属性 | IR 来源 | id/rid 来源 | 矩阵行 · 约定 | 错误/告警条件 |
|---|---|---|---|---|
| 序言 `<?xml …?>` | — | — | M-4.1-01 · C-S-02 | 写出器固定输出；M-4.1-02（DOCTYPE）不输出 |
| `standard`；根上声明 `xmlns:xlink/mml/tbx` | `IRDoc` | — | M-4.1-03、M-4.1-T01、M-4.1-T02、M-F-01 · C-S-01/03 | 无 |
| `processing-meta`（第一个子元素）六个固定属性：`base-tagset=interchange`、`mathml-version=3.0`、`table-model=xhtml`、`terminology-model=tbx`、`math-representation=mathml`、`tagset-family=sts` | 常量 `PROCESSING_META` | — | M-4.3.2-30、M-4.3.2-T01、M-4.3.2-T02 · C-S-04 | 无 |
| `processing-meta/custom-meta-group/custom-meta`：`meta-name`=“基于XML的标准文档内容标记指南”，`meta-value`=“2026” | 常量（D-S-02） | — | M-4.3.2-31 · C-S-04 | 无 |
| `front` | `IRDoc.meta` + `IRDoc.front` | — | M-4.1-04 · C-S-01 | 无 |
| `front/std-meta`（子元素按 V-12 的导出次序，见下表） | `IRDoc.meta` | — | M-4.1-07、M-4.3.2-01、M-F-17 · C-S-11 | 次序由本节固定写死，不依赖输入顺序 |
| `front/sec[@sec-type=foreword]`：`@id=sec_foreword`；`title`=“前言”；其后为 `front.foreword` 各块 | `IRDoc.front.foreword`（非空才输出） | `K: sec_foreword`（R-6） | M-4.2-01、M-4.3.3-01、M-E-02、M-F-06 · C-S-09 | 标题固定、不读 IR；没有 `label` |
| `front/sec[@sec-type=intro]`：无引言条时 `@id=sec_intro`；有引言条时 `@id=sec_0`；`title`=“引言”；先写 `introduction` 各块，再写 `introductionClauses` 各条（`sec`，规则同 2.2） | `IRDoc.front.introduction`、`introductionClauses?` | `K: sec_intro` 或 `K: sec_0`；条：`R: labels[条].xmlId`（`sec_0.1`，R-7 已做） | M-4.2-02、M-4.3.4-01、M-4.3.4-02、M-4.3.4-03、M-F-07 · C-S-10 | 引言正文与条都为空 → 不输出；引言块出现在条之后 → error `xml-block-after-subsec`（`pmToIr` 已拒绝，渲染器再保险） |
| `body`：每章一个 `sec` | `IRDoc.body` | — | M-4.1-05 · C-S-01 | `body` 为空 → error `xml-body-empty`（schema 要求至少一章，`validate.py` V-2） |
| `back`：`app-group`、`ref-list[bibl]`、`index` 依次写；三者皆无则整个 `back` 省略 | `IRDoc.appendices/bibliography/index` | — | M-4.1-06 · C-S-01 | 无 |

**std-meta 子元素（V-12 导出次序：std-type, title-wrap, proj-id, release-version, std-ident, std-org|std-org-group, content-language, std-ref, doc-ref, release-date, implementation-date, equivalence, comm-ref, secretariat, ics, ccs, page-count, std-supersedes, std-xref, permissions, custom-meta-group）**

| XML | IR 来源与规则 | 矩阵行 · 约定 | 错误/告警条件 |
|---|---|---|---|
| `std-type` | 不输出（无内容模型，C-S-18） | M-4.3.2-09（export not-applicable） | `meta-not-expressed`（info，`meta.standardType` 恒存在，每次导出一条） |
| `title-wrap xml:lang=…`：子元素顺序 `intro?`、`main?`、`compl?`、`full` | 语言键 = `titleParts[].lang`；`zh` 排第一、`en` 第二、其余按首次出现；每语言：按 `role` 取 `intro/main/compl/full`（无 `role` 视为 `full`）；`full` 缺失时用旧字段 `meta.title`（zh）/`meta.titleEn`（en）；`content` 用 `inline` 容器（脚注 Resolver 已禁止） | M-4.3.2-04、M-4.3.2-19、M-4.3.2-20、M-4.3.2-21、M-4.3.2-22、M-4.3.2-32、M-F-24 · C-S-13/22 | **没有任何题名** → error `meta-required-missing`（schema 要求至少一个 `title-wrap`）；分段缺 `lang` → 同码；`role` 取值不在四值内 → `meta-not-expressed`（warning）并跳过该分段 |
| `std-ident`（至多一个） | `identifiers[]` 里**第一个有 `parts` 的**；`originator/doc-type/doc-number/part-number/edition/version` 按 schema 顺序，同类按 `position`；只写 IR 里有的，空元素不写；`edition/version` 用 `subsup` 容器，其余 `text` 容器 | M-4.3.2-05、M-4.3.2-23～M-4.3.2-28、M-F-20、M-F-25、M-G-08 · C-S-14 | 其余 `identifiers[].parts` 与未知 `kind` → `meta-not-expressed`（warning）；`parts[].content` 带 `subsup` 之外的 marks → `mark-dropped-in-text-only`（warning） |
| `std-org-group/std-org[@std-org-role]/std-org-name[,std-org-abbrev]` | `publishers[]`：`role`→`@std-org-role`，`name`→`std-org-name`（`subsup`），`identifier`→`std-org-abbrev`；无 `publishers` 时用旧字段 `meta.issuer` 生成一个无 role 的 `std-org` | M-4.3.2-06、M-4.3.2-29、M-F-19 · C-S-15 | 两者都缺 → `meta-required-missing`（D-X-02，SES 必填但 schema 可选）；`std-org-level/type` 无 IR 字段，不输出 |
| `content-language`（每个一个） | `languages[].tag`（trim） | M-4.3.2-07、M-F-21 · C-S-16 | 无 `languages` → `meta-required-missing`（D-X-02）；`usage` 非空 → `meta-not-expressed`（warning） |
| `std-ref type="dated"` / `"undated"` | `identifiers[].value`（`scheme` 为 `dated`/`undated`）；无标识符值时用旧字段 `meta.stdCode`（`dated`）；不由 `parts` 推断 | M-F-18、M-G-02 · C-S-14 | 其他 `scheme` → `meta-not-expressed`（warning）；`stdCode` 与 dated 值不一致 → 以标识符为准，`meta-not-expressed`（warning）说明 `stdCode` 未输出 |
| `release-date`（不带 `date-type`） | `meta.publishDate`，必须是真实日历日 `YYYY-MM-DD` | M-4.3.2-10、M-F-04 · C-S-12 | 缺失 → `meta-required-missing`（D-X-02）；格式或日历非法 → error `xml-date-invalid`（不输出猜测值）；**发布日期晚于实施日期** → warning `meta-date-order`（`validate.py` 的 `W-DATE-ORDER` 同口径） |
| `implementation-date` | `meta.implementDate`，同上 | M-4.3.2-11、M-F-05 · C-S-12 | 同上；**绝不写入 `release-date`**（V-4） |
| `equivalence` | 不输出（`adoptions`、`consistency`） | M-4.3.2-08、M-F-26（export not-applicable） · C-S-18 | `adoptions` 非空或 `consistency` 非空 → `meta-not-expressed`（warning） |
| `comm-ref` | `meta.technicalCommittee`（非空才写） | M-F-27、M-G-03 · C-S-20 | 无 |
| `ics`、`ccs` | `meta.icsCode`、`meta.ccsCode`（原样，单值） | M-4.3.2-02、M-4.3.2-03、M-F-02、M-F-03 · C-S-17 | 无 |
| `std-supersedes`（每个一个） | `replacedStandards[]`（`relation` 空或 `replaces`）：文本=`reference`；`replacedStandards` 为空且 `meta.replaces` 非空时用旧字段 | M-4.3.2-13 · C-S-18 | `relation` 为其他值 → `meta-not-expressed`（warning） |
| `std-xref type="revises"/std-ref` | `replacedStandards[]`（`relation==='revises'`） | M-G-06 · C-S-18（结构“未核实”） | 无 |
| `permissions/copyright-statement,copyright-year,copyright-holder` | `copyrights` **恰有一项**时输出：`statement`（`phrase` 容器）、`year`（`text`）、`holder`（`subsup`） | M-4.3.2-15、M-4.3.2-16、M-4.3.2-17、M-4.3.2-18、M-F-23 · C-S-19 | 多于一项 → 全部不输出，`meta-not-expressed`（warning，原文无多份 `permissions` 的写法）；`language` 非空 → 同码 |
| `custom-meta-group/custom-meta`：`filing-no`、`industry-name`、`region-name`、`cover-designation`、`applicant`、`proposer`（固定顺序，非空才写） | 同名 IR 字段（`filingNo`、`industryName`、`regionName`、`coverDesignation`、`applicant`、`proposer`），`meta-value` 用 `term` 容器写纯文本 | M-4.3.2-14 · C-S-21 | 无 |

**不输出**：`proj-id`、`release-version`、`doc-ref`、`secretariat`、`page-count`（M-C-01～M-C-03、M-G-04、M-G-05 的 export 列均 `not-applicable`）；`issue-agencies`（M-4.3.2-12）。

**SES 必填元数据的口径（D-X-02）**：`metadata.rng` 文件头写明“`std-org-group`、`content-language`、`release-date`、`implementation-date` 的必填要求属导出器约定，**留待 WP8.2 在渲染器侧强制**”（2026-10-21 主导人决定）。两种做法：A（倾向）一律 error，阻断导出，理由：导出档的目的是产出合规文件，而版本快照在发版时元数据本应齐全；B 为 warning，草稿也能导出。`title-wrap`（至少一个）不在此列——它是 schema 硬要求，缺失恒为 error。

### 2.2 章、条、附录与后置页

| XML 路径与属性 | IR 来源 | id/rid 来源 | 矩阵行 · 约定 | 错误/告警条件 |
|---|---|---|---|---|
| `body/sec`（章）：`@id`、`@sec-type`（`scope`/`norm-refs`/`terms`；`general` 不写）；`label`；`title`；内容 | `IRChapter`：`secType`、`title`；`label` 取 Resolver | `R: labels[章].xmlId`（`sec_1`） | M-4.4.2.1-01、M-4.4.2.1-02、M-4.4.2.1-03、M-4.2-03、M-4.2-04、M-4.2-05、M-4.2-06、M-4.4.2.2-01、M-4.4.2.3-01、M-4.4.2.4-01、M-9.1-01、M-D-04、M-E-01、M-F-08、M-F-09、M-F-16 · C-S-06/23/24/25 | `title` 为空 → warning `title-missing` 并输出空 `<title/>`（schema 要求章有 title，V-2）；`label` 缺失 → error `xml-label-missing` |
| `sec`（条，任意深度）：`@id`；`label`；`title`；内容 | `IRClause`（嵌套由树结构表达，`level` 不使用） | `R: labels[条].xmlId`（`sec_5.1.2`） | M-4.4.2.1-01、M-4.4.2.1-02、M-4.4.2.1-03、M-E-01、M-F-16、M-9.1-02（术语章内的分组条、缩略语条与普通条同写法） · C-S-23、C-S-25 | 同上 |
| 无标题条：`sec[@sec-type="numbered-paragraph"]`，有 `label`，**没有 `title`** | `IRClause{titled:false}` | 同上 | M-4.4.2.5-01 · C-S-08 | `titled:false` 但 `title` 非空 → warning `title-ignored`（标题不输出，V-2 禁止 numbered-paragraph 带 title） |
| `sec` 内容次序：块在前，然后是子条/术语条，最后是尾部的注、示例、`ref-list` | `children` 按原序处理，三态：①块；②遇到第一个子条或术语条后进入“子条态”；③子条态下只接受 `note`/`example`/`normRefList` | — | M-4.4.2.1-04（p）· C-S-23；schema `cm.sec-content` | 子条之后出现其他块（段落、表、图、列项…）→ error `xml-block-after-subsec`（`hanging-paragraph` 是 Resolver 已有的同类 error，此处再保险） |
| `p`：行内内容，**无任何属性** | `IRParagraph.content` | — | M-4.4.2.1-04、M-E-25、M-10.1.9-03 · C-S-23 | 段落内含 `id`（IR `NodeId`）不输出，`style-type`（M-10.1.9-03 示例的 `align-center`）也不输出；`p-<n>` 形式 id 永远不产生（V-7/V-18） |
| `app-group` | `IRDoc.appendices`（非空才输出） | — | M-4.5.2-01 · C-S-26 | 无 |
| `app-group/app`：`@id`、`@content-type="informative"\|"normative"` | `IRAppendix.normative` | `R: labels[附录].xmlId`（`sec_A`） | M-4.5.2-02、M-4.2-07、M-E-04、M-F-10 · C-S-07 | — |
| `app/label`=“附录 A” | `labels[附录].label`（“附录A”）在“附录”后插入半角空格 | — | M-4.5.2-03 · C-S-07 | label 不以“附录”开头 → error `xml-label-missing`（Resolver 契约被破坏） |
| `app/annex-type`=“（资料性）”/“（规范性）”（全角括号） | `IRAppendix.normative` | — | M-4.5.2-04 · C-S-07 | 括号字形原文“未核实”，按 C-S-07 取全角；V-17 只查有无 |
| `app/title` | `IRAppendix.title` | — | M-4.5.2-05 · C-S-26 | `title` 为空 → `title-missing`（warning） |
| `app/sec`（附录条）：`@id=sec_A.1`、`label`=“A.1” | `IRClause`（`IRAppendix.children`） | `R: labels[条].xmlId` | M-4.5.2-06、M-E-04 · C-S-26 | 同条 |
| `title`（章/条/附录/图表题）内容模型 `inline`；`label` 内容模型 `label`（只含文本，不含 `bold`） | 各 `title`/`caption` | — | M-5.2-01、M-5.2-02 · C-S-23 | 标题内的格式 marks 如实输出（不自动加 bold） |

**写出示例（结构，不是实现）**：`<sec id="sec_5.1" ><label>5.1</label><title>…</title><p>…</p><sec id="sec_5.1.1">…</sec><non-normative-note>…</non-normative-note></sec>`。

### 2.3 文本与行内样式

#### 2.3.1 一个 run 怎样变成 XML 节点

`IRInline` 不是“一个标记一个元素”：一个 run 可同时带正文、marks，以及不受 marks 影响的**原子**（行内公式、条文脚注、表脚注上标、行内图）。HTML 渲染器的 `renderRun`（`html.ts:175-241`）与 `irToPm` 的约定是：**正文在前，随后依次是公式、条文脚注、各表脚注上标；原子不被正文的 marks 包裹**。XML 渲染器保持同一顺序：

1. **正文片段**：`run.text` 按 `'\n'` 切成段，段间用 `break`（2.3.4）；整段正文被 marks 对应的包装器包住（2.3.2）。`crossRef` 的正文改取 `labels[目标].refText`（“引用文本由 Resolver 解析，不存死文本”）；`bibRef`、`termRef`、`externalLink`、`variable`、`code`、`stdRef`、`mixedCitation` 用 run 自己的文本。
2. **`run.formula`** → `inline-formula/mml:math`（2.8）。
3. **`run.footnote`** → `xref[@ref-type="fn"]` 紧随 `fn`（同一个 `p` 内，D-M-01；2.11）。
4. **`marks` 里的每个 `tableFootnoteRef`**（按 marks 顺序）→ `xref[@ref-type="table-fn"]`（2.6）。
5. **`run.image`** → `inline-graphic`（2.7）。

输出边界已保证：带 `formula` 的 run 不带 `marks`/`footnote`，带 `image` 的 run `text` 为空且无 marks/style（`IRInlineImage` 的注释，Resolver 校验位置）。`run.style`（字体、颜色…）边界保持阻断（1.3.3）。

#### 2.3.2 marks → 元素、嵌套次序与合并

**嵌套次序（外→内）与理由**。实测 `validate.py --profile export` 对 31 个嵌套组合的接受情况（附录 A.8）：格式元素（`bold` 等六个）可包住 `named-content`、`inline-code`、`xref`、`ext-link`、`std`、`mixed-citation`；反过来 `inline-code` 与 `std-ref` 的内容只能是纯文本，`xref`/`ext-link` 只能含格式、变量、代码、行内图，`std` 内只能是 `std-ref`；两个链接类元素互相不能嵌套；`named-content` 内不能放 `std`。据此固定一个全序（rank 小者在外）：

| rank | mark | XML | 矩阵行 · 约定 | 备注 |
|---|---|---|---|---|
| 0 | `mixedCitation` | `mixed-citation`（内容 `citation` 容器） | M-10.1.7-01 · C-T-54 | 与 `stdRef` 互斥（`inlineProjectionDiagnostics` 已报） |
| 1 | `externalLink` | `ext-link[@ext-link-type="uri"][@xlink:href]` | M-10.1.9-01、M-10.1.9-02 · C-T-56 | 协议白名单 `http/https/mailto/ftp`，其他 → error `xml-link-protocol`（V-11）；`title/target/rel` 非空 → warning `link-attr-not-expressed`；`href` 为空 → error `xml-link-protocol` |
| 1 | `crossRef`、`bibRef`、`termRef` | `xref`（`custom` 型在章内术语文本里为 `tbx:entailedTerm`） | M-10.1.1-01、M-10.1.1-02、M-10.1.2-01～M-10.1.2-04、M-10.1.3-01、M-10.1.3-02、M-10.1.6-01、M-9.2.6-01～M-9.2.6-04（含 `xref` 内的 `bold`）· C-T-48/49 | 目标与 `ref-type` 映射见 2.11；链接类 mark 在一个 run 上**至多一个** |
| 2 | `variable` | `named-content[@content-type="variable"]` | M-5.5-01、M-5.5-02 · C-S-30 | `kind`、`name` 无属性 → warning `variable-attr-not-expressed`；连续的同变量 run 合并到同一个 `named-content`，其内的 `sup`/`sub` 落在内部（5.5 示例 `x<sup>2</sup>`）；不带 `variable` 的 `sub`/`sup` 留在外部 |
| 3 | `bold` | `bold` | M-5.1-01 · C-S-29 | label/title 内不自动加（2.0.2-8） |
| 4 | `italic` | `italic` | M-5.1-02 | |
| 5 | `underline` | `underline` | M-5.1-03 | |
| 6 | `strike` | `strike` | M-5.1-04 | |
| 7 | `sup` | `sup` | M-5.1-06 | |
| 8 | `sub` | `sub` | M-5.1-07 | |
| 9 | `code` | `inline-code`（只含文本，保留换行与空白） | M-5.10-02 · C-S-33 | 格式 marks 在 `inline-code` 外层 |
| 10 | `stdRef` | `std/std-ref`（`std-ref` 只含文本） | M-10.2-01、M-10.2-02 · C-T-54 | 只允许与格式 marks（rank 3～8）共现 |
| — | `tableFootnoteRef` | 原子（2.3.1-4），不参与嵌套 | M-6.2.3-10、M-6.2.3-11 · C-T-06 | |

`monospace` 不导出（M-5.1-05 的 export 为 `not-applicable`，用 `inline-code`，D-S-07）；`style` 见上。

**不可表达的组合 → error `xml-mark-combination`**（nodeId = 所在块，path 指到该 run）：①`stdRef` 与 `mixedCitation`/链接类/`variable`/`code` 任一共现；②同一 run 上两个链接类 mark（含 `externalLink` + `crossRef`）；③目标容器的内容模型（2.3.3）不允许该 mark。

**合并规则**（把相邻 run 变成嵌套结构）：对每个 run 取其 marks 按 rank 排序得到包装器序列；相邻 run 按**最长公共前缀**共享外层元素，前缀判等 = 元素名相同且属性相同（`externalLink` 比 `href`；`crossRef/bibRef/termRef` 比 `type+targetId`；`variable` 比 `kind+name`；`mixedCitation`、`stdRef`、`code` 只比类型）。`crossRef` 例外：相邻且同目标的 run 只写一次 `refText`（引用文本整体由 Resolver 产生，作者文本不是内容）。该合并是纯函数，对同一输入逐字节相同（7.3 幂等测试）。

#### 2.3.3 行内容器与内容模型

| 容器参数 | 对应 schema | 用于 | 允许的 mark/原子 |
|---|---|---|---|
| `inline` | `cm.inline` | `p`、`title`、`caption/title`、单元格行内形式、`title-wrap` 各部分、`tbx:term`、`tbx:definition/example/note`（另加 `tbx:entailedTerm`） | 全部 mark、公式、脚注、行内图、`break` |
| `term` | `cm.term` | `def-item/term`、`index-entry/term`、`see-entry`、`meta-value` | 格式、`variable`、`code`、行内图、公式、`externalLink`、`crossRef`（不含 `std`、`mixed-citation`、`break`；脚注 Resolver 已禁止） |
| `phrase` | `cm.phrase` | `copyright-statement`、`ext-link`/`xref` 内部 | 格式、`variable`、`code`、行内图 |
| `label` | `cm.label` | `label` | `phrase` 的集合 + 公式 + `crossRef`（不含 `externalLink`、`std`、`mixed-citation`、`break`） |
| `citation` | `cm.citation` | `mixed-citation` 内部 | 全部，但不含嵌套 `mixedCitation`；允许 `break`、`uri` |
| `subsup` | `cm.subsup` | `std-org-name`、`edition`、`version`、`copyright-holder` | 仅 `sup`/`sub` 与文本 |
| `text` | 纯文本 | `std-ref`、`tbx:source`、`tbx:subjectField`、`originator` 等、`uri`、`code` | 仅文本 |

**容器不允许的内容**：纯文本类容器（`subsup`、`text`）里出现 mark → 保留文字、丢弃 mark，warning `mark-dropped-in-text-only`（D-X-05）；出现公式或行内图 → error `formula-in-text-only`（文字会丢失）；其他容器（`phrase`/`label`/`term`/`citation`）里出现不允许的 mark → error `xml-mark-combination`。

#### 2.3.4 换行

`break` 只在 `inline`、`citation` 与 `tbx` 行内容器里合法。格式元素内部不含 `break`（`cm.mark`），所以 `<bold>a\nb</bold>` 写成 `<bold>a</bold><break/><bold>b</bold>`。`label`、`term`、`phrase`、`subsup`、`text` 容器里的 `'\n'` 改为一个空格，warning `newline-flattened`；`code` 与 `inline-code` 里的 `'\n'` 原样保留（M-5.10-01）。单元格内强制换行同此（C-T-11、M-6.5-01）。

#### 2.3.5 行内原子的 XML 与问题

| XML | IR 来源 | id/rid 来源 | 矩阵行 · 约定 | 错误/告警条件 |
|---|---|---|---|---|
| `inline-formula/mml:math`（无 `display`；`id=mml_m<k>`） | `run.formula`（`mathml` 优先，缺失用 `options.mathml[formula.id]`） | `S: mml_m<k>`；`inline-formula` 自身无 id | M-7.1-04、M-7.1-05、M-7.4-02 · C-T-21 | 见 2.8 |
| `xref[@ref-type="fn" @rid=fn_k]` + 紧随的 `fn[@id=fn_k]`（`label/sup`、`p`） | `run.footnote`（`content` 用 `inline`） | `R: labels[footnote.id].xmlId`（`fn_<seq>`）；`xref` 内容为 `refText`（`1)`，纯文本，C-T-55） | M-10.1.1-03、M-10.1.8-01、M-10.1.8-02、M-E-15、M-E-16、M-E-17 · C-T-55 | 脚注不在 `p` 内（标题、单元格直出形式等）→ error `xml-footnote-position`；脚注内容为空 → `invalid-footnote` 由入口断言已抛错 |
| `xref[@ref-type="table-fn"]`（内容为字母） | `marks[].tableFootnoteRef` | `R: labels[target].xmlId`（`table-fn_<表号>.<k>`，R-2） | M-6.2.3-10、M-6.2.3-11 · C-T-06 | 目标不在同一 `table-wrap` → 入口断言已抛错 |
| `inline-graphic[@xlink:href][@specific-use]` | `run.image` | `S: inl_<k>` | M-8.3-02（1.1 复核后为 `optional`）· C-T-29 | 见 2.7 |

### 2.4 列项

| XML 路径与属性 | IR 来源 | id/rid 来源 | 矩阵行 · 约定 | 错误/告警条件 |
|---|---|---|---|---|
| `list[@list-type]` | `IRList.listType`：`alpha`→`alpha-lower`、`number`→`arabic`、`roman`→`roman-lower`、`dash`→`dash`、`dot`→`bullet` | **不写 `list/@id`**（M-E-22） | M-5.7-01、M-5.7-02、M-5.7-03、M-5.7-04、M-5.7-05、M-5.7-06、M-D-03 · C-S-32 | `boxed`、`romanUpper` → error `xml-list-type-unsupported`（原文无取值；D-X-09 给出“降级并告警”的备选）；`IRList.level` 不使用（嵌套由结构表达） |
| `list` 是 `p` 的兄弟块，**不放进 `p`** | 块序列 | — | M-5.7-01 · C-S-32 | — |
| `list-item` | `IRList.items[]` | 仅被引用时写 `@id`：`R: labels[item.id].xmlId`（`li_<k>`）；写出过指向它的 `xref` 才补写（3.2；M-5.7-10 的“被引用才有 id”口径，附录 E M-E-22） | M-5.7-08、M-10.1.5-02 · C-T-52 | 被引用但 `labels` 无该项（无序列项、`romanUpper` 项）→ error `xml-xref-target-unsupported` |
| `list-item/label`（有序项必写，无序项不写） | `orderedMarkers[item.id]`（D-X-08）：取 Resolver 的 `computeOrderedListMarkers`，**全角括号转半角**（`a）`→`a)`，D-X-07；印刷页 16 的标记示例亲验为半角 `a)`/`b)`/`c)`） | — | M-5.7-09 · C-S-32 | 有序项没有标记（自定义策略返回空串；默认策略不会）→ error `list-marker-missing`（省略 `label` 会被 V-17 在 export 档判错） |
| `list-item/p`（列项正文） | `items[].content` 里的 `IRParagraph`（行内 `inline` 容器），无 id | — | M-5.7-10 · C-S-32 | 段落外的块 → 类型系统已禁止 |
| 嵌套 `list`（在同一 `list-item` 内，接在 `p` 之后） | `items[].content` 里的 `IRList` | 同上 | M-5.7-11 · C-S-32 | 嵌套层数不限；`level` 忽略 |
| 空 `items` 的列表 | — | — | — | error `xml-list-empty`（schema 要求至少一个 `list-item`）；项内无任何块 → warning `empty-content` 并输出空 `<p/>` |

### 2.5 注、示例、警告、摘录、代码

| XML 路径与属性 | IR 来源 | id/rid 来源 | 矩阵行 · 约定 | 错误/告警条件 |
|---|---|---|---|---|
| `non-normative-note`：`@id`（仅被引用）；`label`；内容块 | `IRNote`（正文、表、图、公式中的注；术语内的注走 2.9） | `R: labels[note.id].xmlId`（`note_<n>`）；公式注经 R-10 同样得到；写出过指向它的 `xref` 才补写（3.2） | M-5.6-01、M-5.6-05、M-5.6-06、M-E-09、M-E-19、M-E-20、M-E-23、M-F-14 · C-S-31、C-T-50 | 内容里出现 `paragraph`、`list` 之外的块（表、图、公式、代码、摘录…）→ error `xml-note-content`（C-S-31 “报告”；schema 另收 `code`、`disp-formula`，但那会让公式号进入注内，本阶段不放开） |
| `non-normative-note/label` | `R: labels[note.id].label`（“注：”/“注1：”，含全角冒号） | — | M-5.6-04、M-6.2.3-05、M-7.2-02 · C-S-31 | `label` 为空 → error `xml-label-missing` |
| `non-normative-example`：同上，`label` 为“示例：/示例1：” | `IRExample` | `R: labels[example.id].xmlId`（`example_<n>`） | M-5.6-02、M-5.6-04、M-E-24、M-8.4-03（图中示例，见 2.7）· C-S-31 | 同上 |
| 注/示例内的 `p`、`list` | `content: IRBlock[]`（WP8.M G7：可多块；单段且 id 为 `${id}.p0` 的“旧规范形”输出与多块形相同） | — | M-5.6-05 · C-S-31 | 同上 |
| `non-normative-note[@content-type="warning"]`，`label`=“警告：” | `IRWarning` | **不写 id**；`label` 为渲染器常量（Resolver 给警告的是 `ext_` 占位，R-5） | M-5.6-03 · C-S-31 | 对警告的 `crossRef` → error `xml-xref-target-unsupported`（无 id 方案，R-9） |
| `disp-quote/p` | `IRQuote.content`（只接受 `IRParagraph`） | 不写 id | M-5.9-01、M-5.9-02、M-D-05 · C-S-35 | 非段落块 → error `xml-quote-content`；`attrib`、`permissions` 不输出（M-5.9-03 为 gap-ir，无来源） |
| `code`（块，文本原样） | `IRCodeBlock.text` | 不写 id（`ext_` 占位不读） | M-5.10-01 · C-S-33 | `language` 非空 → warning `code-language-not-expressed` |
| `p`（段落）、`inline-code`（行内） | 见 2.2、2.3.2 | — | M-5.10-02 · C-S-33 | — |

### 2.6 表

结构（C-T-01、C-T-02）：`table-wrap[@id][@orientation]` ＞ `label`、`caption/title`、`table`（`col`*、`thead`?、`tbody`）、`table-wrap-foot`?。`table-wrap-foot` 内顺序：`p[@content-type="dimension"]`、`non-normative-note`*、`fn`*。

| XML 路径与属性 | IR 来源 | id/rid 来源 | 矩阵行 · 约定 | 错误/告警条件 |
|---|---|---|---|---|
| `table-wrap[@id][@orientation="landscape"]` | `IRTable`；`portrait` 不写 `orientation` | `R: labels[表].xmlId`（`tab_1`、`tab_A.1`） | M-6.2.1-01、M-6.2.1-02、M-6.6-01、M-D.1-01、M-E-10、M-F-15 · C-T-01、C-T-12 | 表无 label → error `xml-label-missing`；`@position` 不输出（M-C.1-01 仅导入） |
| `label` | `labels[表].label`（“表1”，无空格，C-T-15） | — | M-6.2.1-03 · C-T-15 | — |
| `caption/title` | `IRTable.caption`（`inline` 容器） | — | M-6.2.1-04、M-6.2.1-05 · C-T-15 | `caption` 为空 → warning `caption-empty`，仍输出 `<caption><title/></caption>`（V-17 要求 `caption/title` 存在；矩阵 M-6.2.1-04：SES 导出的表总带 label 与 caption） |
| 英文表题 | `IRTable.captionEn` | — | M-6.2.1-06（export `optional`，原文无写法） · D-T-03 | 非空 → warning `caption-en-not-expressed` |
| `table[@width]` | `IRTable.width`：仅 `%` 且值为 33/66/100 才写（如 `66%`） | — | M-6.1-01、M-6.1-02 · C-T-10 | 其他宽度 → warning `table-width-not-expressed`（省略）；`table.style`（`layout/borderModel/borderColor/borderWidth/…`）→ warning `table-style-not-expressed`；**不写** `border/frame/rules/cellspacing/cellpadding`（6.3.1 默认；M-6.2.3-01） |
| `table/col[@width][@align][@valign]`（`thead` 之前，C-T-01；**1.1 复核后 M-6.1-03 取 `optional`**） | `IRTable.columns[]`（`width`、`textAlign`、`verticalAlign`；长度已被 Resolver 校验等于网格列数） | — | M-6.1-03 · C-T-10 | 全部为空对象 → 不写任何 `col`；其中任一列非空 → 每列一个 `col`（含空 `col`，保持位置）；`width` 单位为 `%` 写作 `N%`（整数或小数，无多余 0），**其他单位 → warning `table-width-not-expressed` 并省略该列 `width`**（不由 px 换算）；`textAlign/verticalAlign` 不在 6.3.2 取值内（含 `baseline`）→ warning `table-style-not-expressed` 并省略；`col/@style` 不建模 |
| `thead/tr`（前 `headerRowCount` 行）、`tbody/tr` | `IRTable.rows`；`headerRowCount===0` 不写 `thead` | — | M-6.2.2-01、M-6.2.5-01 · C-T-16 | 无任何 `tbody` 行（`rows` 为空，或全部是表头行）→ error `xml-table-empty`（XHTML 表要求 `tbody`）；`headerRowCount` 与前导全表头行数不一致已被输出边界拦下（`:222`） |
| `tr[@align][@valign]` | `IRTableRow.style.textAlign/verticalAlign`（取值同 6.3.2） | — | M-6.2.2-02 · C-T-08 | `row.style` 的其余字段（背景、边框、行高…）→ warning `table-style-not-expressed` |
| `th`/`td`（`header` 决定）：`@colspan`、`@rowspan`（>1 才写）、`@align`、`@valign`、`@style` | `IRTableRow.cells[]`：`colspan/rowspan/header/style` | — | M-6.2.4-01、M-6.4-01、M-6.4-02、M-6.4-03、M-6.3.2-01、M-6.3.2-02 · C-T-07、C-T-08 | **不写** `scope`（M-6.4-04 只导入）；`align` 取 `style.textAlign`（`left/center/right/justify`），`valign` 取 `verticalAlign`（`top/middle/bottom`），**IR 有值就写，不按“默认值可省略”过滤**（保持往返）；取值不在集合内 → warning `table-style-not-expressed` 并省略 |
| `td/@style`：`border-left: <样式> <宽度>px; border-top: …; border-right: …; border-bottom: …; background-color: #RRGGBB`（顺序左、上、右、下、背景；冒号形式） | `IRCellStyle.border{Left,Top,Right,Bottom}`（宽度）、`border*Style`、`backgroundColor` | — | M-6.3.3.1-01、M-6.3.4-01 · C-T-09 | 某边仅当与表级默认不同才写：默认 = `solid` 1px（6.3.1）或 `table.style.borderWidth`（px）；样式缺省按 `solid`；样式为 `none` 写 `border-left: none`；宽度非 px 或不在 1～5 → warning `table-style-not-expressed` 并省略该宽度；`backgroundColor` 为 `#` 加 6 位十六进制（输出大写）或 `none`，其他写法（`rgb()`、命名色）→ warning 并省略；`padding*` → warning `table-style-not-expressed`；整个 `style` 为空则不写属性（D-X-17：“与表级相同者省略”的口径） |
| 单元格内容（单段、无 `unit`）：行内内容直接写在 `td`/`th` 里，**不套 `p`**（`inline` 容器） | `cells[].content` 为单个 `IRParagraph` | — | M-6.5-02 · C-T-11 | `'\n'` → `break`（M-6.5-01）；单元格内的行内格式（M-6.2.3-12 `italic`、M-6.2.3-13 `sub`）按 2.3.2 |
| 单元格内容（其他情形）：逐块写 `p`、`list`；表头单元格有 `unit` 时在最后加一个无属性的 `p`（单位文字） | `cells[].content[]`；`cells[].unit` | — | M-6.5-03、M-6.2.4-02 · C-T-04、C-T-11 | 出现 `paragraph`、`list` 之外的块（含嵌套 `table`，C-T-13）→ error `xml-cell-content`；`td`（非表头）有 `unit` → error `cell-unit-unsupported`（原文无写法，D-X-03）；`cellType`、`width` → info `cell-attr-not-expressed`；`columnWidths`（编辑器拖拽的 px 列宽）→ info `px-width-ignored`（D-X-03；同一表同一码合并成一条） |
| `table-wrap-foot/p[@content-type="dimension"]` | `IRTable.unit`（非空才写） | — | M-6.2.3-03、M-6.2.5-02 · C-T-03 | — |
| `table-wrap-foot/non-normative-note`（`label` 取 Resolver 的“注：/注n：”，内容 `p`） | `IRTable.notes[]` | `@id` 仅被引用时写：`R: labels[note].xmlId`（`note_<n>`） | M-6.2.3-04、M-6.2.3-05、M-6.2.3-06、M-E-20 · C-T-02、C-T-50 | 注内容多于一个块 → 与 2.5 同规则；内容含非段落/列项 → `xml-note-content` |
| `table-wrap-foot/fn[@id]`：`label/sup`（字母）、`p`（脚注正文，`inline` 容器） | `IRTable.footnotes[]`，**按 `orderTableFootnotes` 的字母序**输出 | `R: labels[fn].xmlId`（`table-fn_<表号>.<k>`，R-2） | M-6.2.3-07、M-6.2.3-08、M-6.2.3-09、M-E-18 · C-T-06 | 标记不是 `[a-z]+` 已被 `orderTableFootnotes` 抛错；脚注无引用 → 入口断言已抛错 |
| 单元格内 `xref[@ref-type="table-fn"]`（内容为字母 `refText`，不套 `sup`） | run 的 `tableFootnoteRef` mark | `R: labels[target].xmlId` | M-6.2.3-10、M-6.2.3-11 · C-T-06 | 见 2.3.5 |

**交叉引用到表**：`xref[@ref-type="table"]`，`rid` 取 `table-wrap` 的 id，内容为 Resolver 的 `refText`（原文示例的内容写作带空格的“表 2”，Resolver 的 `refText` 是“表2”，以 Resolver 为准，C-T-49）。

### 2.7 图与行内图

结构（C-T-26）：`fig[@id][@orientation]` ＞ `label`、`caption`（`title`、`p[@content-type="dimension"]`）、`legend`?、`graphic`、`p`*（说明段）、`non-normative-note`*（图注）、`non-normative-example`*（图中示例，D-M-09：注在前、示例在后）。

| XML 路径与属性 | IR 来源 | id/rid 来源 | 矩阵行 · 约定 | 错误/告警条件 |
|---|---|---|---|---|
| `fig[@id][@orientation="landscape"]` | `IRFigure`；`portrait` 不写 | `R: labels[图].xmlId`（`fig_1`、`fig_A.1`） | M-8.2-01、M-8.2-02、M-8.2-03、M-E-12、M-F-15 · C-T-26、C-T-34 | 图无 label → error `xml-label-missing` |
| `label` | `labels[图].label`（“图1”） | — | M-8.2-04 · C-T-35 | — |
| `caption/title`；`caption/p[@content-type="dimension"]`（无属性以外的 id） | `IRFigure.caption`；`IRFigure.unit`（非空才写） | — | M-8.2-05、M-8.2-06、M-8.6-01 · C-T-26、C-T-33 | `captionEn` 非空 → warning `caption-en-not-expressed`（M-8.2-07） |
| `graphic[@xlink:href][@content-type="image"]`（`specific-use` 不写） | `IRFigure.resourceId ?? IRFigure.src`；宽高、`alt`、`title` 无属性 | `xlink:href` = `labels[图].xmlId`（C-T-27：取所属 `fig` 的导出 id，无扩展名） | M-8.2-08、M-8.2-09、M-8.2-10、M-8.3-01 · C-T-27、C-T-28 | `ResourceManifest` 没有该图的条目 → error `resource-missing`；`alt/title/imageWidth/imageHeight` 非空 → warning `figure-attr-not-expressed`；`groups`（多资源/分图）由输出边界继续阻断（D-T-11、D-M-12） |
| `legend/title`（可选）、`legend/def-list[@list-content="figure"]/def-item`（`term`、`def/p`） | `IRFigure.legend`：`title`（`inline`）、`items[]`（`IRDefItem`：`term` 用 `term` 容器、`definition` 用 `inline` 容器，一个 `p`） | **`legend`、`def-list`、`def-item`、`p` 都不写 id**（C-T-31）；图例项不被引用 | M-8.5-01、M-8.5-02、M-8.5-03、M-8.5-04、M-8.5-05、M-8.5-06 · C-T-31 | `items` 为空 → error `xml-list-empty`；对图例项的 `crossRef` → `xml-xref-target-unsupported` |
| `p`（图和图题之间的说明段）接在 `graphic` 之后 | `IRFigure.descriptions[]`（`content` 用 `inline`），**不写 id** | — | M-8.2-12 · C-T-26 | — |
| `non-normative-note`（图注） | `IRFigure.notes[]` | `@id` 仅被引用时写 | M-8.2-11、M-E-19 · C-T-32 | 同 2.5 |
| `non-normative-example`（图中示例） | `IRFigure.examples[]` | `@id` 仅被引用时写 | M-8.4-03 · C-T-32 | 同 2.5 |
| `inline-graphic[@xlink:href=inl_<k>][@specific-use="size:S\|M\|L"]`（空元素） | `IRInline.image`：`size`；`alt` 无属性；`resourceId ?? src` | `S: inl_<k>`（k 为全文行内图的文档序，3.3） | M-8.3-02（1.1 复核：`optional`）· C-T-29、D-M-08 | 清单无条目 → error `resource-missing`；`alt` 非空 → warning `figure-attr-not-expressed`；只允许在 `p` 内（Resolver 校验）；`size:T` 不会产生（IR 类型不收） |

### 2.8 公式

结构（C-T-17）：`disp-formula[@id]` ＞ `label`?、`mml:math[@display="block"]`、`non-normative-note`*、`legend`?。

| XML 路径与属性 | IR 来源 | id/rid 来源 | 矩阵行 · 约定 | 错误/告警条件 |
|---|---|---|---|---|
| `disp-formula[@id]` | `IRFormula`（块） | 有编号：`R: labels[公式].xmlId`（`formula_1`、`formula_A.1`）；**无编号不写 id**（X-21，Resolver 对无编号公式不产生标签，实测） | M-7.1-01、M-7.1-02、M-E-13、M-F-22 · C-T-17、C-T-18 | 有编号而无 label → error `xml-label-missing` |
| `label` | `numbered===true`：`labels[公式].label`（半角 `(1)`、`(A.1)`）；**不使用显示层的 `fullWidthFormulaLabel`**（印刷页 27 的标记示例亲验为半角 `<label>(1)</label>`） | — | M-7.1-03 · C-T-25 | `numbered===false` 不写 `label` |
| `mml:math[@id=mml_m<k>][@display="block"]` | `IRFormula.mathml`（有则用，**不用 `latex` 重算**）；否则 `options.mathml[formula.id]` | `S: mml_m<k>`（3.3，行间与行内合并计数） | M-7.4-01、M-7.4-02、M-7.4-03、M-4.1-T01、M-4.3.2-T01、M-7.4-04～M-7.4-11（MathML 内部元素按字符串保真） · C-T-18、C-T-19 | 两处都没有 → error `mathml-missing`（不用图片或空公式代替）；不合规 → error `mathml-invalid`（契约见 4.5）；**不写 `tex-math`、`alternatives`，不补 `annotation`**（C-T-20）；`id` 与 `display` 由渲染器重写，不沿用输入值 |
| `non-normative-note`（公式注，`label` 取 Resolver） | `IRFormula.notes[]`（`IRFormulaNote.content` 用 `inline`，一个 `p`） | `@id` 仅被引用时写；**依赖 R-10**（公式注获得 `label` 与 `note_<n>`） | M-7.2-01、M-7.2-02 · C-T-23 | R-10 未做时 `label===''` → error `xml-label-missing`（这是 R-10 属 T2.3 的直接原因） |
| `legend/title`=“式中：”（固定常量） | `IRFormula.whereList` 非空才写 `legend` | — | M-7.3-01、M-7.3-02 · C-T-22 | 每个公式至多一个 `legend` |
| `legend/def-list[@list-content="formula"]/def-item`；`term`（符号）；`def/p`（含义） | `whereList[]`：`term`（`term` 容器）、`definition`（`inline` 容器） | **不写 id**（def-item、`p` 均无，C-T-22） | M-7.3-03、M-7.3-04、M-7.3-05、M-7.3-06、M-7.3-07 · C-T-22 | 含义里的上标等格式（M-7.3-09）按 2.3.2；`definition` 为空 → warning `empty-content`（`def` 需要至少一个 `p`） |
| `inline-formula/mml:math[@id=mml_m<k>]`（无 `display`） | `IRInline.formula`：`mathml`；否则 `options.mathml[formula.id]` | `S: mml_m<k>`；`inline-formula` 自身无 id（M-E-14，印刷页 27 亲验“使用 mml:math 中的 @id 进行行内公式 ID 的编制”） | M-7.1-04、M-7.1-05、M-E-14 · C-T-21 | 同上；**位置**：只在 `inline`/`term`/`label` 容器里合法，`text`/`subsup` 容器（`termEntry.source`、`termEntry.subjectField`、`normRef.ref`、文献字段值）→ error `formula-in-text-only` |
| 对公式的引用 `xref[@ref-type="disp-formula"]` | `crossRef(targetKind:'formula')` | `rid` = `labels[公式].xmlId`；内容 `refText`（“公式(1)”，C-T-25） | M-10.1.2-04 · C-T-25 | 对**无编号公式**的 `crossRef` → error `xml-xref-target-unsupported`（无 id） |

### 2.9 术语条目

结构（C-T-37、C-T-43）：`term-sec[@id]` ＞ `label`、`tbx:termEntry[@id]` ＞ `tbx:langSet[@xml:lang]`+ ＞（首个 `langSet`：`tbx:subjectField`?、`tbx:definition`、`tbx:example`*、`tbx:note`*、`tbx:source`?；每个 `langSet`：`tbx:tig`+ ＞ `tbx:term`、`tbx:partOfSpeech`?、`tbx:grammaticalNumber`?、`tbx:normativeAuthorization`?、`tbx:termType`?）。`term-sec` 只能位于 `sec-type="terms"` 的章之内（`validate.py` V-2）。

| XML 路径与属性 | IR 来源 | id/rid 来源 | 矩阵行 · 约定 | 错误/告警条件 |
|---|---|---|---|---|
| `term-sec[@id]`；`label` | `IRTermEntry`；`labels[条目].label`（如 `3.1.1`） | `R: labels[条目].xmlId`（`sec_3.1.1`） | M-9.2.1-01、M-9.2.1-02、M-9.2.1-03、M-E-07、M-F-13 · C-T-37 | 术语条目不在术语章内（含附录里）→ error `xml-term-outside-terms`；`nestedEntries` 由输出边界继续阻断（D-T-09） |
| `tbx:termEntry[@id]` | 同上 | `R: labels[条目].termEntryXmlId`（`term_3.1.1`，R-3） | M-9.2.1-04、M-9.2.1-05、M-E-08、M-F-12 · C-T-37 | 缺 `termEntryXmlId` → error `xml-label-missing` |
| `tbx:langSet[@xml:lang]`（至少一个） | 见下“语言集的构成” | — | M-9.2.1-06、M-9.2.1-07 · C-T-43 | `languageSets[].language` 为空 → error `term-language-missing`；词条无任何可输出的术语名（`langSet` 内没有 `tig`）→ error `xml-term-empty` |
| `tbx:tig/tbx:term` | 隐含 `tig`：`IRTermEntry.term`（zh）、`termEn`（en）；显式 `tig`：`languageSets[].groups[].terms[]`（**一个变体一个 `tig`**，`IRTermVariant.content` 用 `inline` 容器） | — | M-9.2.3-01、M-9.2.3-02 · C-T-43 | `groups` 里同一 `IRTermGroup` 的多个变体拆成多个 `tig`（M-9.2.3-01）；渲染字样（“(拒用)”“注”）不会出现在内容里（9.2.3 印刷页 38 的示例含“(拒用)”，IR 内容不含，不补） |
| `tbx:partOfSpeech[@value]`、`tbx:grammaticalNumber[@value]`、`tbx:normativeAuthorization[@value]`、`tbx:termType[@value]`（**按此次序**，空元素） | `IRTermVariant.descriptors[]`：`kind` ∈ `partOfSpeech`、`grammaticalNumber`、`normativeAuthorization`、`termType`；`value` 取纯文本（trim） | — | M-9.2.3-03、M-9.2.3-04、M-9.2.3-05、M-9.2.3-08、M-9.2.3-09 · C-T-39～C-T-42 | 取值不在 schema 枚举（`noun/verb/adj/adv`；`singular/plural`；`preferredTerm/admittedTerm/deprecatedTerm`；`fullForm/abbreviation/symbol/formula`）→ error `xml-descriptor-value`（D-X-14；WP6 夹具的 `partOfSpeech='名词'` 触发）；同一变体里同一 `kind` 出现多次 → error `xml-descriptor-duplicate`；`value` 含 marks → `mark-dropped-in-text-only`（warning） |
| 描述符的其他 `kind`（`administrativeStatus`、`usageStatus`、`source` 等） | `descriptors[]` | — | M-9.2.3-03 · C-T-40 | warning `term-descriptor-not-expressed`（同一文档内合并为一条，列出个数与前 3 个节点）；`kind==='subjectField'` 走下一行 |
| 缺词性/采用级别 | — | — | M-9.2.3-03、M-9.2.3-05 · C-T-40 | 原文清单称“必填”而示例无（C-T-40：数据驱动，不伪造）→ warning `term-descriptor-missing`（全文合并为一条） |
| `tbx:subjectField`（首个 `langSet`，纯文本） | `IRTermEntry.subjectField`（规范）；术语级 `kind==='subjectField'` 描述符（遗留） | — | M-9.2.9-01 · C-T-44、WP8.M G5 补充决定 | 规则与问题码见 1.2（`term-subjectfield-duplicate`/`-promoted`/`-conflict`）；含 `〈〉` → `term-subjectfield-brackets`；含 marks → `mark-dropped-in-text-only` |
| `tbx:definition`（首个 `langSet`，行内内容；段间 `break`） | `IRTermEntry.definition[]`：首段 + 续段，全部为 `IRParagraph` | — | M-9.2.2-01、M-9.2.2-02 · C-T-44 | 没有任何非空定义段 → error `xml-term-no-definition`（`validate.py` V-9“有且仅有一个定义”）；非段落块（列表、表…）→ error `xml-term-definition-block`（D-T-07、G-T-21） |
| `tbx:example`（首个 `langSet`，行内内容，**无 id**） | `IRTermEntry.examples[]`（单段落） | — | M-9.2.4-01 · C-T-44 | 多块或非段落 → error `xml-note-content`；对术语示例的 `crossRef` → error `xml-xref-target-unsupported`（schema 的 `tbx:example` 无 `@id`） |
| `tbx:note[@id]`（首个 `langSet`，行内内容） | `IRTermEntry.notes[]`（单段落）；“注”字样与编号不写入 | `@id` 仅被引用时写：`R: labels[note].xmlId`（`nte_<术语号>-<k>`，**依赖 R-4**） | M-9.2.5-01、M-9.2.7-01、M-E-09 · C-T-44、X-13 | 多块或非段落 → error `xml-note-content` |
| `tbx:source`（首个 `langSet`，纯文本） | `IRTermEntry.source` | — | M-9.2.8-01 · C-T-44 | marks → `mark-dropped-in-text-only`；行内公式 → error `formula-in-text-only`；来源里不加 `std`、方括号与“来源”字样（渲染阶段添加） |
| `tbx:entailedTerm[@target]`（章内术语间引用） | 在 `tbx:definition`/`tbx:example`/`tbx:note` 里：`termRef` mark，或 `crossRef(targetKind:'term')` | `target` = `R: labels[被引条目].termEntryXmlId`（`term_8.4`） | M-9.2.6-01 · C-T-45 | 目标不是术语条目 → error `xml-xref-target-unsupported`；内容取 run 自己的文本 |
| `xref[@ref-type="custom" @custom-type="term-entry"]`（术语章之外，或 `tbx:term` 等不允许 `entailedTerm` 的位置） | 同上 mark | `rid` = `termEntryXmlId` | M-9.2.6-02、M-9.2.6-03 · C-T-45 | 同上 |

**语言集的构成（D-X-13）**：
1. 隐含集：`zh` 集含一个 `tig`（`term` 的内容，`term` 为空则不建）；`termEn` 非空时再有 `en` 集含一个 `tig`。
2. 显式集（`languageSets[]`，按数组序）：取 `language` 的主语言子标签小写作为合并键（`zh-Hans`→`zh`）。键与已有集相同 → 其 `tig` 追加在该集隐含 `tig` 之后，`xml:lang` 沿用已有集的取值（隐含集恒为 `zh`/`en`），语言字符串不同时 info `term-language-merged`；键为新语言 → 新增一个 `langSet`，`xml:lang` 取 `language` 原文。
3. 条目级内容（`subjectField`、`definition`、`example`、`note`、`source`）全部写入**最终列表里的第一个 `langSet`**（C-T-43）。
4. `tailOrder`（作者尾项顺序）**不影响** XML 次序：XML 内次序固定为 `subjectField、definition、example、note、source、tig`；`tailOrder` 存在且与该次序不一致 → info `term-tail-order-normalized`。
备选：B（显式集覆盖隐含集，`term`/`termEn` 在同语言已有显式集时不输出）会丢失 `term` 文本；C（隐含集与显式集同语言时报错）会阻断 WP6 夹具。倾向 A。

**对照约定表与 schema 的两处差异**（附录 B）：C-T-40 写的描述符导出顺序是“词性、采用级别、术语类型、语法数”，而 `tbx.rng` 注释明确把次序改成“词性、语法数、采用级别、术语类型”（“原先 C-T-40 约定的导出顺序无原文依据，改为 STS 顺序”），渲染器以 schema 为准；C-T-41 写“词性取值不在列表内 warning 并原样输出”，`tbx.rng` 已收紧为枚举（“其他值保留并告警取消”），故取值非法只能 error（否则 `validate.py --profile export` 不通过）。

### 2.10 规范性引用文件与参考文献

| XML 路径与属性 | IR 来源 | id/rid 来源 | 矩阵行 · 约定 | 错误/告警条件 |
|---|---|---|---|---|
| `sec[@sec-type="norm-refs"]/ref-list[@content-type="norm-refs"]`（引导语 `p` 在 `ref-list` 之前，两者都是章的块） | `IRNormRefList`（块，只在 `norm-refs` 章） | `ref-list` 不写 id | M-4.4.2.3-02、M-4.4.2.3.2-01、M-F-09 · C-S-24、C-T-54 | 清单不在 `norm-refs` 章 → error `xml-normref-outside`（Resolver 已报，再保险）；导出恒写 `norm-refs`（不写 `norm_refs`） |
| `ref[@id]`（无 `label`） | `IRNormRef` | `R: labels[条目].xmlId`（`ref_<n>`，R-8；D-X-11 倾向“恒输出”） | M-E-06 · X-10 | — |
| `ref/std/std-ref` + `std/title` | `IRNormRef{entryType:'std'}`：`ref`（`text` 容器）、`title`（`inline` 容器）；**两者之间不写逗号文本节点**（C-T-54） | — | M-4.4.2.3-03 · C-T-54 | `ref` 或 `title` 为空 → error `xml-normref-incomplete`（V-17 要求 `ref` 内的 `std` 有 `std-ref` 与 `title`） |
| `ref/mixed-citation`（保持原有格式） | `IRNormRef{entryType:'mixed'}.content`（`citation` 容器） | — | M-4.4.2.3-04 · C-T-54 | 末尾标点 `trailing-punctuation`（Resolver 的 warning）不由渲染器转发，原样输出 |
| `back/ref-list[@content-type="bibl"][@id="sec_bibl"]` | `IRDoc.bibliography`（非空才写） | `K: sec_bibl` | M-4.5.3-01、M-4.2-09、M-10.1.6-02、M-D-02、M-E-03、M-F-11 · C-S-27 | — |
| `ref-list/title` | `IRDoc.bibliographyTitle`（`inline` 容器），缺省为常量“参考文献” | — | M-4.5.3-02 · C-S-27 | — |
| `ref[@id=biblref_<n>]`（**按 `n` 升序输出**） | `IRBibEntry`；顺序取 `labels[条目].xmlId` 的尾部数字（与 `html.ts` 的 `bibSeq` 同一规则，Resolver 已按首次引用排序），不信任 `doc.bibliography` 数组序 | `R: labels[条目].xmlId`（**依赖 R-1**） | M-4.5.3-03、M-4.5.3.1-01、M-E-05 · C-S-27、C-T-53 | 缺 `biblref_` 前缀或无尾号 → error `xml-label-missing` |
| `ref/label`（“[1]”） | `labels[条目].label` | — | M-4.5.3-04、M-4.5.3.1-02 · C-S-27 | — |
| `ref/std`＞`std-ref`＋`title` | `entryType==='standard'` 且 `fields` 有非空 `std-ref` 与 `title`（字段名取矩阵建议，值用 `text`/`inline` 容器） | — | M-4.5.3-05、M-4.5.3.1-03、M-4.5.3.1-04、M-4.5.3.1-05 · C-T-54 | `entryType==='standard'` 但缺 `std-ref` 或 `title` → warning `bib-std-incomplete` 并按 `mixed-citation` 输出（WP6 夹具只有 `title`，属此情形）；其余 `fields`（`author` 等）、`identifiers[]` → warning `bib-field-not-expressed`（合并为一条） |
| `ref/mixed-citation[@xlink:type="simple"]` | `IRBibEntry.content`（`citation` 容器） | — | M-4.5.3-06、M-4.5.3.1-06、M-4.5.3-07、M-4.5.3.3-01 · C-S-27 | `@xlink:type` 只写在**参考文献**的 `mixed-citation` 上（矩阵 M-4.5.3-06 “照示例写”）；规范性引用与正文行内的 `mixed-citation` 不写 |
| `mixed-citation/uri`（接在内容之后；不写 `xlink:type`） | `IRBibEntry.externalLink.href` | — | M-4.5.3-08、M-4.5.3.3-02 · C-T-56 | 协议白名单同 2.3.2（V-11）；`displayText` 与 `href` 不同、`title/target/rel` 非空 → warning `link-attr-not-expressed`；`std` 形式的条目没有 `uri` 位置 → warning `bib-field-not-expressed` |
| 对文献的引用 `xref[@ref-type="bibr"]` | `bibRef` mark | `rid` = `biblref_<n>`；**内容取 run 自己的文本**（D-X-10） | M-10.1.6-01 · C-T-53 | 目标不是文献条目 → `xml-xref-target-unsupported` |

### 2.11 引用、脚注与索引

**xref 目标映射**（渲染器按**目标的真实种类**决定，不信任 `mark.targetKind`；二者不一致 → error `xml-xref-target-unsupported`，与 Resolver 的 `dangling-typed-ref` 同口径）。目标种类由 P1 预扫描建立的 `targets` 表给出：

| 目标 | `ref-type`（`custom-type`） | `rid` | 内容 | 矩阵行 · 约定 |
|---|---|---|---|---|
| 章、条（含引言条、附录条） | `sec` | `labels[t].xmlId`（`sec_…`） | `refText` | M-10.1.1-01、M-10.1.1-02、M-10.1.2-01 · C-T-48 |
| 附录 | `app` | `sec_A` | `refText` | M-9.2.7-02 |
| 表 | `table` | `tab_…` | `refText` | M-10.1.2-02 |
| 图 | `fig` | `fig_…` | `refText` | M-10.1.2-03 |
| 有编号的块公式 | `disp-formula` | `formula_…` | `refText` | M-10.1.2-04 |
| 正文/表/图/公式中的注 | `custom`（`note`） | `note_<n>` | `refText` | M-10.1.3-01 · C-T-50 |
| 正文/图中的示例 | `custom`（`example`） | `example_<n>` | `refText` | M-10.1.3-02 · C-T-50 |
| 术语内的注 | `custom`（`note`） | `nte_<术语号>-<k>` | `refText` | M-10.1.3-01、M-E-09 |
| 术语条目（章外或不允许 `entailedTerm` 处） | `custom`（`term-entry`） | `termEntryXmlId` | run 文本 | M-9.2.6-02、M-9.2.6-03 |
| 参考文献条目 | `bibr` | `biblref_<n>` | run 文本（D-X-10） | M-10.1.6-01 |
| 被引用的有序列项 | `list` | `li_<k>` | `refText`（如“5.2 c）”） | M-10.1.5-01 · C-T-52（1.1 复核：`required`） |
| 缩略语项 | `abbreviation` | `abb_<k>` | `refText`（缩略语文本） | M-10.1.1-04 · C-T-51（1.1 复核：`required`） |
| 参考文献表、索引整体（`IRIndex`） | `sec` | `sec_bibl`、`sec_index` | `refText` | V-8 的 `sec` 目标含 `ref-list`、`index`；这是引用常量 id 的唯一情形 |
| 正文脚注 | `fn`（由脚注原子产生，不经 `crossRef`） | `fn_<k>` | `refText`（`1)`） | M-10.1.1-03 · C-T-55 |
| 表脚注 | `table-fn`（由 `tableFootnoteRef` 产生） | `table-fn_<表号>.<k>` | 字母 | M-6.2.3-10 · C-T-06 |
| 段落、代码块、警告、摘录、规范性引用条目、图例项、式中项、无编号公式、术语示例、索引条目 | **无 `ref-type`** | — | — | error `xml-xref-target-unsupported`（D-X-06；R-9） |

目标没有 `labels` → error `xml-xref-target-missing`。`rid` 恒为**单个**标识符（M-10.1.1-02）。`xref` 只出现在容器允许它的位置（2.3.3），不得嵌套在另一个 `xref` 或 `ext-link` 内。

**索引**

| XML 路径与属性 | IR 来源 | id/rid 来源 | 矩阵行 · 约定 | 错误/告警条件 |
|---|---|---|---|---|
| `index[@id="sec_index"]`（在 `ref-list[bibl]` 之后） | `IRDoc.index` | `K: sec_index`（R-6） | M-4.5.4-01、M-E-03 · C-S-28 | `groups` 全空 → warning `empty-content` 并整体省略（schema 要求至少一个 `index-div`/`index-entry`） |
| `index-title-group/title` | `IRIndex.title`（`inline` 容器，可选） | — | M-4.5.4-02 · C-S-28 | — |
| `index-div[index-title-group/title]` | `IRIndexGroup`；`label`（`inline`）为分组标题 | — | M-4.5.4-03 · C-S-28 | 组内没有条目 → 省略该组并 warning `empty-content` |
| `index-entry[@id=df_<k>]` | `IRIndexEntry` | `S: df_<k>`（全文索引条目的文档序，从 1 起，3.3；`df_` 取自 4.5.4 的示例 `df_1…df_4`） | M-4.5.4-04 · C-S-28 | — |
| `index-entry/term` | `IRIndexEntry.term`（`term` 容器） | — | M-4.5.4-05 · C-S-28 | — |
| `index-entry/see-entry`（每个 `targets` 一个，纯文本） | `IRIndexEntry.targets[]`：文本取 `labels[target].refText` | — **无 `rid`**（原文如此） | M-4.5.4-06 · C-S-28 | 目标没有真实编号（`label===''`，如段落）→ error `xml-xref-target-unsupported`；`seeAlso` 非空 → warning `index-seealso-not-expressed`（原文无“参见”写法） |

### 2.12 缩略语

| XML 路径与属性 | IR 来源 | id/rid 来源 | 矩阵行 · 约定 | 错误/告警条件 |
|---|---|---|---|---|
| `def-list[@list-content="abbreviation"]`（`sec` 内的块；**无 `@id`、无 `title`**） | `IRDefList`（`kind:'defList'`） | — | M-10.1.4-01 · C-T-51 | `items` 为空 → error `xml-list-empty` |
| `def-item[@id=abb_<k>]` | `IRDefList.items[]`（`IRDefItem`） | 仅被引用时写：`R: labels[item.id].xmlId`（`abb_<k>`，D-M-02、D-S-09） | M-10.1.4-03 · C-T-51 | 被引用而无 label → `xml-xref-target-missing` |
| `def-item/term` | `IRDefItem.term`（`term` 容器） | — | M-10.1.4-04 · C-T-51 | — |
| `def-item/def/p` | `IRDefItem.definition`（`inline` 容器，一个 `p`） | — | M-10.1.4-05 · C-T-51 | 定义为空 → warning `empty-content` |

缩略语与释义之间的**全角冒号**（D-M-16）是 HTML/DOCX 的排版（缩略语与释义同行），XML 里 `term` 与 `def` 是两个元素，不含冒号字符。

### 2.13 矩阵行 → 设计节对照

本节与附录 C 由脚本生成（`export≠not-applicable` 的 shall/should 行必须在上面各节出现；脚本统计除本节与附录之外的全部正文，不统计本节和附录 C 自身）。

<!--COVERAGE-2.13-BEGIN-->
统计：需覆盖的行（`obligation` 为 shall/should，且 `export` 为 required/optional，含 1.1 复核后的七行）共 **186** 行，**全部**在本文出现；`may`/示例性且 `export` 非 not-applicable 的行共 **136** 行，其中 **136** 行出现在本文。

按“首次出现的设计节”归并（需覆盖的行）：

| 设计节 | 行数 | 矩阵行 |
|---|---|---|
| 2.0 | 2 | M-5.1-08、M-5.4-01 |
| 2.1 | 12 | M-4.1-03、M-4.1-04、M-4.1-05、M-4.1-07、M-4.3.2-30、M-4.3.2-31、M-4.3.2-01、M-4.3.2-15、M-4.3.3-01、M-4.3.4-01、M-4.3.4-02、M-4.3.4-03 |
| 2.2 | 17 | M-4.4.2.1-01、M-4.4.2.1-02、M-4.4.2.1-03、M-4.4.2.1-04、M-4.4.2.2-01、M-4.4.2.3-01、M-4.4.2.4-01、M-4.4.2.5-01、M-4.5.2-01、M-4.5.2-02、M-4.5.2-03、M-4.5.2-04、M-4.5.2-05、M-4.5.2-06、M-5.2-01、M-5.2-02、M-9.1-01 |
| 2.3 | 35 | M-5.1-01、M-5.1-02、M-5.1-03、M-5.1-04、M-5.1-06、M-5.1-07、M-5.5-01、M-5.5-02、M-5.10-01、M-5.10-02、M-6.2.3-10、M-7.4-02、M-7.1-04、M-7.1-05、M-8.3-02、M-9.2.6-01、M-9.2.6-02、M-10.1.1-01、M-10.1.1-02、M-10.1.2-01、M-10.1.2-02、M-10.1.2-03、M-10.1.2-04、M-10.1.6-01、M-10.1.3-01、M-10.1.3-02、M-9.2.6-03、M-10.1.1-03、M-6.2.3-11、M-10.2-01、M-10.2-02、M-10.1.7-01、M-10.1.8-01、M-10.1.9-01、M-10.1.9-02 |
| 2.4 | 10 | M-5.7-01、M-5.7-02、M-5.7-03、M-5.7-04、M-5.7-05、M-5.7-06、M-5.7-08、M-5.7-09、M-5.7-10、M-10.1.5-02 |
| 2.5 | 11 | M-5.6-01、M-5.6-02、M-5.6-03、M-5.6-04、M-5.6-05、M-5.6-06、M-5.9-01、M-5.9-02、M-6.2.3-05、M-7.2-02、M-8.4-03 |
| 2.6 | 24 | M-6.2.1-01、M-6.6-01、M-6.2.1-03、M-6.2.1-04、M-6.2.1-05、M-6.1-01、M-6.1-03、M-6.2.2-01、M-6.2.2-02、M-6.2.4-01、M-6.4-01、M-6.4-02、M-6.4-03、M-6.3.3.1-01、M-6.3.4-01、M-6.2.3-03、M-6.2.5-02、M-6.2.3-04、M-6.2.3-06、M-6.2.3-07、M-6.2.3-08、M-6.2.3-09、M-6.2.4-02、M-D.1-01 |
| 2.7 | 15 | M-8.2-01、M-8.2-04、M-8.2-05、M-8.2-06、M-8.2-08、M-8.2-09、M-8.2-11、M-8.2-12、M-8.5-01、M-8.5-02、M-8.5-03、M-8.5-04、M-8.5-05、M-8.5-06、M-8.6-01 |
| 2.8 | 11 | M-7.1-01、M-7.1-03、M-7.4-01、M-7.2-01、M-7.3-01、M-7.3-02、M-7.3-03、M-7.3-04、M-7.3-05、M-7.3-06、M-7.3-07 |
| 2.9 | 17 | M-9.2.1-01、M-9.2.1-02、M-9.2.1-03、M-9.2.1-04、M-9.2.1-05、M-9.2.1-06、M-9.2.1-07、M-9.2.3-01、M-9.2.3-02、M-9.2.3-03、M-9.2.3-04、M-9.2.2-01、M-9.2.8-01、M-9.2.4-01、M-9.2.5-01、M-9.2.7-01、M-9.2.9-01 |
| 2.10 | 19 | M-4.4.2.3-02、M-4.4.2.3-03、M-4.4.2.3-04、M-4.5.3-01、M-4.5.3-02、M-4.5.3-03、M-4.5.3-04、M-4.5.3-05、M-4.5.3-06、M-4.5.3-08、M-10.1.6-02、M-4.4.2.3.2-01、M-4.5.3.1-01、M-4.5.3.1-02、M-4.5.3.1-03、M-4.5.3.1-04、M-4.5.3.1-05、M-4.5.3.1-06、M-4.5.3.3-02 |
| 2.11 | 9 | M-4.5.4-01、M-4.5.4-02、M-4.5.4-03、M-4.5.4-04、M-4.5.4-05、M-4.5.4-06、M-9.2.7-02、M-10.1.5-01、M-10.1.1-04 |
| 2.12 | 4 | M-10.1.4-01、M-10.1.4-03、M-10.1.4-04、M-10.1.4-05 |
<!--COVERAGE-2.13-END-->

## 3. xmlId 方案落地清单

原则（C-S-37、附录 E 印刷页 67 亲验）：**编号与 id 只由 Resolver 产生**；渲染器只在三种情形下自己产生 id——固定常量（章节以外的容器）、需要全文序号且 Resolver 无从知道的（`mml:math`、索引条目、行内图）、以及把 Resolver 已有的 id 在“被引用时才写”的规则下取舍。XML 里**绝不出现**以 `ext_` 开头的 id（R-5）。

### 3.1 全部 id 形式与归属

| id 形式 | 对象 | 谁产生 | 何时写 | 状态 |
|---|---|---|---|---|
| `sec_<n>`、`sec_<n>.<m>…` | 章、条、**术语条** `term-sec`、引言条 `sec_0.<n>` | Resolver（`labels[...].xmlId`） | 总是 | 已一致（X-01～03、R-7） |
| `sec_A`、`sec_A.<n>` | 附录 `app`、附录条 | Resolver | 总是 | 已一致（X-06/07） |
| `sec_foreword`、`sec_intro`、`sec_0` | 前言、引言（无条/有条） | **渲染器常量** | 对应部分非空时 | 新增（R-6） |
| `sec_bibl`、`sec_index` | 参考文献 `ref-list[bibl]`、`index` | **渲染器常量** | 有则写 | 新增（R-6） |
| `biblref_<n>` | 参考文献条目 `ref` | Resolver | 总是 | **T2.3 改 `bib_`（R-1）** |
| `ref_<n>` | 规范性引用条目 `ref` | Resolver | 总是（D-X-11） | 已有（R-8） |
| `term_<n>` | `tbx:termEntry`（`ResolvedLabel.termEntryXmlId`） | Resolver | 总是 | 已有（R-3） |
| `nte_<术语号>-<k>` | `tbx:note` | Resolver | **被引用时** | **T2.3 新增（R-4）** |
| `note_<n>`、`example_<n>` | 正文、表、图、公式中的注与示例 | Resolver | **被引用时** | 已有；公式注由 **T2.3（R-10）** 补齐 |
| `tab_<n>`、`tab_A.<n>`、`fig_<n>`、`fig_A.<n>` | 表、图 | Resolver | 总是（有编号） | 已一致 |
| `formula_<n>`、`formula_A.<n>` | 有编号的块公式 | Resolver | 有编号才写 | 已一致 |
| `fn_<k>` | 正文脚注 `fn` | Resolver | 总是 | 已一致 |
| `table-fn_<表号>.<k>` | 表脚注 `fn` | Resolver | 总是 | **T2.3 改 `tabfn_…`（R-2）** |
| `li_<k>` | 被引用的有序列项 | Resolver | **被引用时** | 已有；标记另见 D-X-08（R-11） |
| `abb_<k>` | 被引用的缩略语项 | Resolver | **被引用时** | 已有（D-M-02） |
| `mml_m<k>` | 每个 `mml:math` 根（行间与行内合并计数） | **渲染器后置赋值** | 总是 | 新增（C-T-18、V-14） |
| `df_<k>` | `index-entry` | **渲染器**（文档序，从 1 起） | 总是 | 新增（C-S-28） |
| `inl_<k>` | 行内图的 `xlink:href`（不是 `id`） | **渲染器**，由共享函数按 IR 文档序给出 | 总是 | 新增（D-M-08） |
| （块图 `xlink:href` = 所属 `fig` 的 `xmlId`） | `graphic` | Resolver | 总是 | C-T-27 |
| **不写 id**：`p`、`list`、`legend`、`def-list`（公式与图例）、`def-item`（公式与图例）、`inline-formula`、`code`、`disp-quote`、警告、`tbx:example`、`tbx:definition`、`norm-refs` 的 `ref-list`、`table-wrap-foot` 与其内的注（未被引用时） | | | | M-E-19～M-E-25、C-T-22、C-T-31 |

### 3.2 “仅被引用时写 id”的被引用集合怎么算

只有**渲染器真正写出的引用**才算引用。做法是“先建树、后补 id”，而不是预先扫描一遍 IR：

1. P2 构建时，对 `note`、`example`、有序列项、缩略语项、术语注这五类元素，**先不写 `id`**，只把 `(NodeId → XmlElement)` 登记进 `ctx.pendingIds`，并把应写的值取自 `labels[NodeId].xmlId`。
2. 每当写出一个 `xref` 或 `tbx:entailedTerm`，就把目标 NodeId 记入 `ctx.emittedRefs`（写出前已经通过 2.11 的目标映射校验）。
3. P3：对 `emittedRefs ∩ pendingIds` 的元素把 `id` 补成**第一个属性**；`emittedRefs` 里有而 `pendingIds` 里没有的（目标是常量 id 或总是带 id 的对象）不处理。
4. P4：任何 `rid`/`target` 在输出树里找不到对应 `id`（例如目标元素位于一个被整体丢弃的容器内）→ error `xml-rid-unresolved`。

理由：①前向引用（注在被引用的段落之前）天然成立，无需遍历顺序；②被 `mark-dropped-in-text-only` 丢弃的引用不会让目标白白带上 id，**id 与引用严格一一对应**，这正是“注、示例、列项只在被引用时带 id”（用户已定约定、附录 E M-E-22～M-E-24、C-T-50）想要的；③不需要第二套“哪些位置的行内数组会被输出”的判定。代价：P2 与 P3 之间要持有一个 `Map`，可忽略。

### 3.3 后置赋值的 id

- **`mml_m<k>`**：P3 对输出树做先序遍历，遇到不在另一个 `mml:math` 内的 `mml:math` 根就计数，写 `id="mml_m<k>"`（原有 `id` 先删除）。计数顺序即 `validate.py` 的 `root.iter()` 文档序，**必须以输出树为准而不是 IR 顺序**（表的注在行之后、图的注在说明段之后、术语的子元素按固定次序，均与 IR 数组顺序不同）。行间与行内合并计数。
- **`df_<k>`**：索引条目的文档序（`groups[].entries[]` 展开）。
- **`inl_<k>`**：不是 `id`，是 `inline-graphic/@xlink:href`。k 按**IR 文档序**（前言、引言、引言条、各章、各附录，块内按声明顺序，段落内按 run 顺序）计数，由共享纯函数 `collectXml46687ImageRefs(doc, labels)` 在 P1 给出；T2.5 准备层调用**同一个函数**命名资源文件，二者因此天然一致（不要求与输出树顺序一致，因为 `inl_<k>` 没有序号语义，只要唯一）。该函数同时返回块图的条目（`href` 取所属 `fig` 的 `xmlId`），一次得到清单。

### 3.4 全局唯一性与收尾检查放哪里

放在**渲染器 P4**，不放 Resolver：Resolver 的 `registerId` 只管 NodeId（`resolve.ts:97`），改它会改变所有出口的 problems；而 XML 特有的常量 id、后置 id 只有渲染器知道。P4 做五件事，全部在一次遍历里完成：

| 检查 | 问题码 | 依据 |
|---|---|---|
| 每个 `id` 是合法 NCName | `xml-id-invalid` | V-1 |
| 全树 `id` 唯一；报告两个持有者（NodeId 或常量名） | `xml-id-duplicate` | V-1、M-D.1-01、M-D-01 |
| 每个 `xref/@rid`（只含一个标识符）、`tbx:entailedTerm/@target` 可解析 | `xml-rid-unresolved` | V-1 |
| 没有以 `ext_` 开头的 `id`/`rid`/`target`（及 `Formula…`、`id-<uuid>`、`p-<n>` 形式） | `xml-ext-id-leak` | R-5、V-7 |
| 每个 `graphic`/`inline-graphic` 的 `xlink:href` 在 `ResourceManifest` 里有条目 | `resource-missing` | C-T-27 |

“必备 id”（`validate.py` V-13 的 `REQUIRED_ID_ELEMENTS`：有 label 的 `sec`、`app`、`term-sec`、`tbx:termEntry`、参考文献 `ref-list`/`ref`、`index`、有 label 的 `table-wrap`、`fig`、有 label 的 `disp-formula`、各类 `fn`）不在 P4 重复实现：它们的 id 来自 Resolver 或常量，缺失即 `xml-label-missing`（P2 产生）；7.4 的集成测试用 `validate.py --profile export` 作最终裁判。

### 3.5 T2.3（Resolver）与渲染器的分工

| 项 | T2.3 改 Resolver | 渲染器 |
|---|---|---|
| R-1 `biblref_` | 是（`resolve.ts:730`） | 读 `labels` |
| R-2 `table-fn_<表号>.<k>` | 是，并同步 `html.ts:232`、`footnotes.ts:17`、旧序列化器 `xmlSerializer.ts:1173` | 读 `labels` |
| R-4 `nte_<术语号>-<k>` | 是 | 读 `labels`，被引用才写 |
| R-10 公式注 `label`/`note_<n>` | 是（`resolve.ts:403-408`） | 读 `labels` |
| R-11 有序列项标记 | 是：导出纯函数 `computeOrderedListMarkers`（D-X-08） | 调同一函数 |
| R-5 `ext_` 不进 XML | 否 | P4 `xml-ext-id-leak` |
| R-6 常量 id 唯一 | 否 | P4 `xml-id-duplicate` |
| R-9 对无 id 目标的引用 | 否 | P2 `xml-xref-target-unsupported` |

## 4. 公共接口

### 4.1 文件与导出

| 位置 | 内容 |
|---|---|
| `packages/shared/src/renderers/xml46687.ts`（任务书指定） | 公共入口与管线：`renderXml46687`、`exportXml46687`、`XmlExportError`、类型 `RenderXml46687Options`、`Xml46687Problem`、`Xml46687ExportResult`；分派表 |
| `packages/shared/src/renderers/xml46687Parts/`（T2.4a 建桩） | 领域模块：`context.ts`（`ctx`、问题收集、路径栈、`pendingIds/emittedRefs`）、`inline.ts`、`meta.ts`、`structure.ts`（章条附录前后置页）、`blocks.ts`（列项、注、示例、摘录、代码）、`tables.ts`、`figures.ts`、`formulas.ts`、`terms.ts`、`refs.ts`（规范性引用、参考文献、xref、索引）、`ids.ts`（后置赋值与 P4）、`mathml.ts`（MathML 片段解析与规范化） |
| `packages/shared/src/renderers/xml46687Boundary.ts` | 各领域放行常量的汇总（1.3.2），被 `outputBoundary.ts` 引用 |
| `packages/shared/src/xml46687/resources.ts`（与 `tree.ts`、`writer.ts` 同目录） | `ResourceManifest` 类型、`collectXml46687ImageRefs` |
| `packages/shared/src/renderers/index.ts` | 追加 `export * from './xml46687'`；`src/xml46687/index.ts` 追加导出 `resources` |

渲染器**同构、无 DOM/Node API、不引入新依赖**；构建树只用 `xml46687/tree.ts` 的 `xmlElement/xmlText/qname/xmlAttr`，写出只用 `writeXml`。**无任何编号逻辑**：渲染器里不出现 `++`、序号拼接，只有 `labels[...]` 读取与 P3 的计数（`mml_m`、`df_`，它们不是 Resolver 的职责且没有“编号”语义，C-T-18、C-S-28）。

### 4.2 签名与问题类型

任务书固定签名：

`renderXml46687(doc: IRDoc, labels: Record<NodeId, ResolvedLabel>, options: { mathml: Record<NodeId, string>; resources: ResourceManifest }): string`

**建议：同时提供不抛错的 `exportXml46687`，`renderXml46687` 是它的薄封装。**

| | `renderXml46687` | `exportXml46687`（新增） |
|---|---|---|
| 返回 | `string` | `{ xml: string \| null; problems: Xml46687Problem[] }`（有任何 error 时 `xml===null`；warning/info 总是返回） |
| 失败 | 有 error 抛 `XmlExportError`（`problems` 为全部问题，不是第一个） | 不因内容问题抛错；入口断言（脚注、输出边界）与 `XmlWriteError` 仍转为问题返回 |
| 用途 | 与 `renderHtml`/DOCX 渲染器对称；测试断言 | 导出对话框：一次列出全部错误与警告；T2.5 准备层 |

**问题类型**：新增 `Xml46687Problem = { code: Xml46687ProblemCode; severity: 'error'|'warning'|'info'; nodeId?: NodeId; path: string; message: string }`，**不复用 `IRProblem`**（其 `code` 是封闭联合、没有 `path`、没有 `info`），**形状对齐 `OutputSupportProblem`**（`code/nodeId/path/message`）加 `severity`，这样 `io/src/exportGuard.ts` 的 `ExportGuardProblem` 可以一对一映射。`message` 为中文、面向最终用户；`path` 与 `getOutputSupportProblems` 同写法。理由：①内容问题常常成批出现（几十个无 id 目标的引用），“抛第一个”会让用户反复导出；②warning/info 必须有地方返回（“元数据未表达”“列项括号转换”等）；③入口断言仍沿用既有的抛错口径（`UnsupportedOutputError`、脚注 `Error`），保持三个渲染器的行为一致。

### 4.3 `ResourceManifest`（放 shared，纯数据）

```
ResourceManifest   { version: 1; entries: ResourceManifestEntry[] }
ResourceManifestEntry {
  href: string        // xlink:href 的值：块图 = 所属 fig 的 xmlId（fig_1）；行内图 = inl_<k>
  key: string         // IR 资源键：figure/image 的 resourceId，缺省时为 src
  fileName: string    // 资源包内的文件名，无目录：<href>.<扩展名>，如 fig_1.png
  mediaType: string   // image/png 等
  source: 'resource' | 'dataUrl' | 'src'   // 字节来自 IRDoc.resources、dataUrl，还是外部 src
}
```
不含字节（保持可 `JSON.stringify` 往返）；字节由准备层另行持有并写入资源包。命名规则取 C-T-27：`href` 无文件夹、无扩展名，物理文件名为 `href` 加扩展名（`png/jpg/gif/svg/webp`，由 `mediaType` 决定）。**冲突与缺失**：同一 `href` 两个条目、`fileName` 重名、`mediaType` 非 `image/*` → 准备层报错（5.2）；渲染器侧只做“有无条目、`key` 是否匹配”的检查（`resource-missing`、`resource-mismatch`），多余条目 info `resource-unused`。

`collectXml46687ImageRefs(doc, labels): { href; key; kind: 'figure' | 'inline'; ownerId: NodeId; path: string }[]`：纯函数；块图 `href=labels[图].xmlId`；行内图 `href=inl_<k>`。渲染器与 T2.5 共用。

### 4.4 问题目录

“聚合”= 同一文档内同一码合并为一条，消息里给出个数与前 3 个 nodeId，避免数据量大时刷屏；其余每处一条。

| 码 | 级别 | 条件（节） |
|---|---|---|
| `xml-label-missing` | error | 需要 Resolver 标签而缺失或形状不对（2.2、2.5、2.6～2.9、2.10） |
| `xml-body-empty` | error | 没有章（2.1） |
| `meta-required-missing` | error（D-X-02 备选 warning） | 缺题名；SES 必填的 `std-org-group`/`content-language`/`release-date`/`implementation-date` 缺失（2.1） |
| `xml-date-invalid` | error | 日期不是真实日历日 `YYYY-MM-DD`（2.1） |
| `xml-block-after-subsec` | error | 子条之后出现非注/示例/清单的块（2.1、2.2） |
| `xml-mark-combination` | error | 不可表达的 mark 组合，或容器不允许的 mark（2.3.2、2.3.3） |
| `xml-link-protocol` | error | `externalLink.href` 为空或协议不在 `http/https/mailto/ftp`（2.3.2、2.10） |
| `xml-footnote-position` | error | 脚注原子不在 `p` 内（2.3.5） |
| `formula-in-text-only` | error | 纯文本容器内出现行内公式或行内图（2.3.3、2.8、2.9） |
| `xml-list-type-unsupported` | error | `boxed`/`romanUpper`（2.4，D-X-09） |
| `list-marker-missing` | error | 有序列项没有标记（2.4） |
| `xml-list-empty` | error | `list`、`defList`、图例没有任何项（2.4、2.7、2.12） |
| `xml-note-content` | error | 注/示例内容含 `paragraph`、`list` 之外的块；术语注/示例非单段（2.5、2.9） |
| `xml-quote-content` | error | 摘录含非段落块（2.5） |
| `xml-cell-content` | error | 单元格含 `paragraph`、`list` 之外的块（含嵌套表）（2.6） |
| `cell-unit-unsupported` | error（D-X-03 备选 warning） | 非表头单元格带 `unit`（2.6） |
| `xml-table-empty` | error | 表没有 `tbody` 行（2.6） |
| `resource-missing` | error | 图的 `href` 在清单中没有条目（2.7） |
| `resource-mismatch` | error | 清单条目的 `key` 与 IR 的资源键不符（4.3） |
| `mathml-missing` | error | 公式既无 `mathml` 也无 `options.mathml` 条目（2.8） |
| `mathml-invalid` | error | MathML 不合约定（4.5） |
| `xml-term-outside-terms` | error | 术语条目不在术语章内（2.9） |
| `term-language-missing` | error | 显式语言集没有 `language`（2.9） |
| `xml-term-empty` | error | `langSet` 内没有 `tig`（2.9） |
| `xml-term-no-definition` | error | 术语条目没有定义（V-9）（2.9） |
| `xml-term-definition-block` | error | 定义含非段落块（2.9） |
| `xml-descriptor-value` | error（D-X-14 备选 warning） | 描述符取值不在 schema 枚举（2.9） |
| `xml-descriptor-duplicate` | error | 同一变体同类描述符多个（2.9） |
| `term-subjectfield-conflict` | error | 术语级领域描述符取值不一致且条目级缺失（1.2） |
| `xml-normref-outside`、`xml-normref-incomplete` | error | 规范性引用清单不在 `norm-refs` 章；`std` 条目缺编号或名称（2.10） |
| `xml-xref-target-unsupported` | error（D-X-06） | 目标种类没有 `ref-type`/id 方案，或与 `mark.targetKind` 不符（2.11） |
| `xml-xref-target-missing` | error | 目标没有 `labels`（2.11） |
| `xml-id-invalid`、`xml-id-duplicate`、`xml-rid-unresolved`、`xml-ext-id-leak` | error | 收尾检查（3.4） |
| `xml-write-failed` | error | `writeXml` 抛 `XmlWriteError`（控制字符等） |
| `mathml-empty-source`、`mathml-conversion-failed` | error | 准备层：LaTeX 为空；KaTeX 转换失败（带位置，5.2） |
| `resource-load-failed`、`resource-name-conflict`、`resource-media-type` | error | 准备层：字节读取失败；资源文件名冲突（大小写折叠）；非 `image/*`（5.2） |
| `meta-not-expressed` | warning（`standardType` 为 info） | IR 有数据而 XML 无表达：`adoptions`、`consistency`、多份版权、`languages.usage`、未知 `role`/`scheme`、多余标识符（2.1）；聚合 |
| `meta-date-order` | warning | 发布日期晚于实施日期（2.1） |
| `title-missing`、`title-ignored` | warning | 章/条/附录标题为空；无标题条带了标题（2.2） |
| `mark-dropped-in-text-only` | warning（D-X-05 备选 error） | 纯文本容器里的 mark 被丢弃（2.3.3） |
| `link-attr-not-expressed`、`variable-attr-not-expressed` | warning | `title/target/rel`、`displayText`；`kind/name`（2.3.2、2.10） |
| `newline-flattened` | warning | 不允许 `break` 的容器里的换行变空格（2.3.4） |
| `empty-content` | warning | 为满足 schema 输出空 `p` 等（2.4、2.8、2.11、2.12） |
| `code-language-not-expressed` | warning | `IRCodeBlock.language`（2.5） |
| `caption-empty`、`caption-en-not-expressed` | warning | 表/图题为空；英文题（2.6、2.7） |
| `table-width-not-expressed`、`table-style-not-expressed` | warning；聚合 | 表宽/列宽/样式无法表达（2.6） |
| `figure-attr-not-expressed` | warning；聚合 | 图/行内图的 `alt`、`title`、宽高（2.7） |
| `term-subjectfield-duplicate`、`term-subjectfield-promoted`、`term-subjectfield-brackets` | warning | G5（1.2） |
| `term-descriptor-not-expressed`、`term-descriptor-missing` | warning；聚合 | 描述符无表达 / 缺词性或采用级别（2.9） |
| `bib-std-incomplete`、`bib-field-not-expressed` | warning；后者聚合 | 参考文献 `std` 信息不全；多余字段（2.10） |
| `index-seealso-not-expressed` | warning | `seeAlso`（2.11） |
| `cell-attr-not-expressed`、`px-width-ignored` | info；聚合 | 单元格 `cellType/width`；拖拽 px 列宽（2.6） |
| `term-language-merged`、`term-tail-order-normalized` | info | 语言集合并；尾项次序规范化（2.9） |
| `mathml-annotation-removed`、`resource-unused` | info | 去掉 TeX 注释；清单多余条目（4.3、4.5） |

### 4.5 MathML 输入约定

1. `options.mathml` 以**公式的 NodeId** 为键（块公式用 `IRFormula.id`，行内公式用 `IRInlineFormula.id`），值为**一个完整的 MathML 元素字符串**。`IRFormula.mathml`/`IRInlineFormula.mathml` 有值时**以 IR 为准**，`options.mathml` 只补缺（`latex` 不被渲染器重新转换；转换在 T2.5，5.1）。
2. 值的形式：`<mml:math …>…</mml:math>`（`mml:` 前缀）；也接受等价的默认命名空间写法 `<math xmlns="http://www.w3.org/1998/Math/MathML">…</math>`（KaTeX 的输出与 IR 里保存的原始 MathML 常是这种形式），解析后统一成 `mml:` 前缀的 `XmlElement`。
3. **根上的 `id` 与 `display` 由渲染器重写**：`id=mml_m<k>`（3.3）、`display=block` 仅用于 `disp-formula`，行内公式不写 `display`（V-14、V-15、C-T-18/19）。输入里的值被丢弃，其他根属性保留。
4. 渲染器内置**严格的 MathML 片段解析器**（`xml46687Parts/mathml.ts`，纯 TS，shared 里目前没有 XML 解析器）：只接受良构 XML 元素树，元素都必须在 MathML 命名空间；拒绝 DOCTYPE、实体声明、处理指令；字符引用只收五个预定义实体与数字引用，**命名实体（如 `&InvisibleTimes;`）拒绝**；拒绝以 `on` 开头的属性（V-10）、`href`/`altimg`/`src` 的危险协议（V-11）。内容模型**不检查**（保真，C-T-19），MathML 3 的内容模型由 `sts_compat.py` 兜底。
5. **不输出 TeX**：去掉 `annotation`/`annotation-xml` 中 `encoding` 为 `application/x-tex`、`TeX`、`LaTeX` 的项（info `mathml-annotation-removed`），`semantics` 只剩一个子元素时展开；其他注释原样保留；任何输出都不含 `tex-math`（C-T-20、7.4 的断言）。
6. 不合约定 → error `mathml-invalid`，消息带公式 NodeId 与解析器给出的字符位置；没有 MathML 且没有 `options.mathml` 条目 → `mathml-missing`。

### 4.6 给上层的使用方式

- 产品代码（`packages/io`，5.2）：`prepareXml46687(doc) → { labels, mathml, resources, files, problems }`，再调 `exportXml46687(...)`，最后打包。UI 不在本阶段接入（任务书）。
- 测试：直接传手写的 `labels`（由 `resolve(doc)` 得到）与手写的 `mathml`/`resources`，不依赖 io。

## 5. T2.5 准备层（LaTeX→MathML、资源包）

### 5.1 放在 `packages/io`，不放 client

| | `packages/shared` | `packages/io` | `packages/client` |
|---|---|---|---|
| `jszip` | 不能依赖（任务书；shared 同构、无 Node/浏览器专有 API） | **有**（`^3.10.1`，`docx.ts` 已用它打 DOCX 包） | 有（`^3.10.1`） |
| `katex` | 不能依赖 | **有**（`0.16.44`，精确版本，`formulaOmml.ts` 已用） | 有（`0.16.44`） |
| 现成可复用件 | — | `formulaOmml.ts`（KaTeX→MathML→OMML）、`imageResources.ts`（data URL / fetch / resource key 解析）、`docx.ts`（固定日期、排序条目、`generateAsync` 的打包套路） | 编辑器渲染 |
| 先例 | — | `buildDocx`：PM→IR→Resolver→**准备资源与公式**→shared 渲染器→JSZip（`io/src/docx.ts`），client 与服务端共用 | — |

结论：与 DOCX 完全对称，**准备层与打包放 io**，client 只在 WP8.4 接 UI 时调用；**不新增依赖、不改 `package.json`、不改 lockfile**。任务书里的“client 准备层”在落地时应读作“client 与服务端共用的 io 准备层”。

### 5.2 模块与签名（设计，不是实现）

**(a) `packages/io/src/formulaMathMl.ts`（从 `formulaOmml.ts` 提取）**

- 从 `formulaOmml.ts` 提取：MathML 的小型解析/序列化（`parseMathMl`、`serializeMathMl`，`:74-118`）、`removeAnnotations`（`:136`）、`latexToMathMl`（`:280-292`）及其节点类型；`formulaOmml.ts` 改为从新模块导入。**行为不变**（`formulaOmml.test.ts`、`formulaOmml.retry.test.ts`、`whereSymbolFormula.test.ts` 与 DOCX 快照必须原样通过——这是提取的验收）。
- 新导出：
  - `convertLatexToMathMl(latex: string, options?: { display?: boolean }): string`：同步（KaTeX 是同步的，无需动态导入 `mathml2omml` 的 chunk）；输出 `<math xmlns="http://www.w3.org/1998/Math/MathML" …>…</math>`，已去掉 `annotation`；失败抛 `Error`，消息保留 KaTeX 的“at position N”字样。
  - `convertFormulasToMathMl(doc: IRDoc): { mathml: Record<NodeId, string>; problems: Xml46687Problem[] }`：**原生 MathML 优先**——`IRFormula.mathml`/`IRInlineFormula.mathml` 非空的公式**不转换**（渲染器直接用 IR 值，4.5-1）；只转换缺 `mathml` 而有 `latex` 的公式；`latex` 为空 → `mathml-empty-source`（error）；KaTeX 抛错 → `mathml-conversion-failed`（error），`nodeId` 为公式 id，`path` 为公式的 IR 路径，消息含 KaTeX 的位置。**失败不用图片或空公式代替**（C-T-19）。遍历用通用深度遍历（与 `collectInlineFormulas` 同法），保证列表、图注、单元格、式中等位置里的公式一个不漏。
- 键：块公式 `IRFormula.id`、行内公式 `IRInlineFormula.id`（4.5-1）。

**(b) `packages/io/src/xml46687Resources.ts`**

- `collectXml46687Resources(doc: IRDoc, labels, options?: ImageResourceOptions): Promise<{ manifest: ResourceManifest; files: Record<string, Uint8Array>; problems: Xml46687Problem[] }>`。
- 条目清单来自 shared 的 `collectXml46687ImageRefs(doc, labels)`（3.3、4.3）——**与渲染器同一个函数**，故 `href` 一致。
- 取字节：键 = `resourceId`（查 `doc.resources`：`encoding` 为 `dataUrl`/`base64`/`text`，`mediaType` 用资源自带值），缺省取 `src`（data URL / 可 fetch 的 URL / 经 `resolveResourceKey` 解析的资源键，复用 `imageResources.ts` 里已有的 `resolveSource`/`decodeBase64`，需把它们改为 `export`，**不改行为**）。与 DOCX 的差别：DOCX 只收 PNG/JPEG/GIF 并读像素尺寸；XML 只要求 `image/*`，**接受 SVG 与 WebP**，不读尺寸（`graphic` 无尺寸属性）。
- 媒体类型：优先字节签名（PNG/JPEG/GIF/WebP），SVG 与签名无法判定者取声明的 `mediaType`；非 `image/*` → `resource-media-type`（error）。
- 命名与冲突：`fileName = <href>.<扩展名>`（`png/jpg/gif/svg/webp`）；`href` 唯一，所以冲突只可能来自大小写折叠或手写清单，统一检查（小写比较）→ `resource-name-conflict`（error）。读取失败 → `resource-load-failed`（error，带 `nodeId`、`path`、原因）；失败项**不进清单**，渲染器随后会再报 `resource-missing`（两处各自成立，UI 按 `nodeId` 合并显示）。
- 同一字节被多处引用：各写各的文件，不去重（`href` 与文件一一对应，C-T-27）。

**(c) `packages/io/src/xml46687Package.ts`**

- `prepareXml46687Input(pmDoc, documentMeta?)`：与 `prepareDocxInput` 同构（PM JSON→IR→`resolve`→`labels`），返回 `{ doc, labels, warnings }`；`documentMeta` 覆盖 IR 元数据的规则沿用（`irMetaFromDocumentMeta`）。
- `buildXml46687Package(options): Promise<{ bytes: Uint8Array; xml: string | null; manifest: ResourceManifest; problems: Xml46687Problem[] }>`：并行 `convertFormulasToMathMl` 与 `collectXml46687Resources`，再调 shared 的 `exportXml46687`；**有 error 时不打包**（`bytes` 为空数组，`xml:null`，`problems` 为全部问题），无 error 才打包。
- 资源包内容（C-T-27、任务书）：

```
<包>.zip
├── standard.xml            // exportXml46687 的输出，UTF-8，无 BOM
├── manifest.json           // { format:"GB/T 46687.2—2026 XML", version:1, xml:"standard.xml", entries:[ResourceManifestEntry…] }；键序固定、无时间戳
└── resources/<fileName>    // 每个清单条目一个文件，按 fileName 排序
```
  条目固定日期（沿用 `docx.ts` 的 `ZIP_DATE = 1980-01-01T00:00:00Z`）、`createFolders:false`、`standard.xml` 第一、其余按路径字典序，`DEFLATE`——同一输入字节逐一相同（与 `packageDocxBytes` 同套路）。没有任何图片时仍按同一结构打包（`resources/` 为空目录不写入）；是否另提供“只导出 `.xml`”由 UI 决定（WP8.4），本阶段 `buildXml46687Package` 同时返回 `xml`，满足两种用法。

### 5.3 `packages/io/src/index.ts` 导出与测试

新增导出：`convertLatexToMathMl`、`convertFormulasToMathMl`、`collectXml46687Resources`、`prepareXml46687Input`、`buildXml46687Package` 及其类型。`exportGuard.ts` 在 WP8.4 之前仍把 `xml` 映射到旧 `XML` 边界（`io/src/exportGuard.ts:57`），**本阶段不动**（避免提前改变产品行为）。测试放 `packages/io/src/`：`formulaMathMl.test.ts`（块/行内、原生优先、失败带位置、不含 `annotation`/`tex-math`）、`xml46687Resources.test.ts`（data URL、SVG、重名、缺失、字节签名与声明不符）、`xml46687Package.test.ts`（目录结构、`manifest.json` 与渲染器 `xlink:href` 一一对应、同输入字节相同、有 error 不出包）。

## 6. 任务分组与依赖

### 6.1 任务总览

| 任务 | 内容 | 主要文件 | 依赖 |
|---|---|---|---|
| **T2.0** | 七行矩阵取值 + 校验脚本登记（1.1） | `docs/wp8.1/matrix-T.json`、`scripts/xml46687/export_enforcement.py`、`schemas/gbt46687.2/README.md`（脚本重新生成）；不含 TS | 无（可与任何任务并行） |
| **T2.3** | Resolver：R-1、R-2、R-4、R-10、R-11（导出 `computeOrderedListMarkers`）及波及的测试/快照（1.4） | `shared/src/ir/resolve.ts`、`renderers/html.ts`（`:232` 一行）、`renderers/footnotes.ts`（`:17`）、`client/src/serializer/xmlSerializer.ts`（`:1173`）；测试：shared 5 个文件 7 项、client 4 个文件 6 项、`html.test.ts.snap`（1.4.3） | 无 |
| **T2.4a-0** | 契约子 PR：`Xml46687Problem`/码联合、`RenderXml46687Options`、`ResourceManifest`、`collectXml46687ImageRefs`（实现+测试）、`renderXml46687`/`exportXml46687` 的类型与抛 `not implemented` 的占位 | `shared/src/xml46687/resources.ts`、`shared/src/renderers/xml46687.ts`（仅类型与占位）、两处 `index.ts` | 无 |
| **T2.4a-1** | 骨架与公共部分：管线 P0～P5、`ctx`、分派表与各领域桩、`ids.ts`（`pendingIds/emittedRefs`、P3/P4）、`structure.ts`（2.1 全部含 `std-meta`、2.2）、`inline.ts`（2.3 全部含 `xref`/`fn`/`ext-link`/标记嵌套）、`blocks.ts`（2.4、2.5）、边界汇总 `xml46687Boundary.ts` 与 `outputBoundary.ts` 的接线、三个新块 kind（`warning/quote/code`，1.3.3）及两处实现陷阱（`:156`、`:237`）、`outputBoundaryXml46687.test.ts` 改写（1.3.4） | `shared/src/renderers/xml46687.ts`、`xml46687Parts/{context,dispatch,structure,inline,blocks,ids,meta}.ts` 与各领域桩、`xml46687Boundary.ts`、`outputBoundary.ts`、`outputBoundaryXml46687.test.ts`、client `wp8mIntegration.test.ts`、`wp8mPersistence.acceptance.test.ts`、`wp8mG6.test.ts` | T2.4a-0；快照依赖 T2.3 |
| **T2.4b** | 表、图、公式与 MathML 解析器（2.6～2.8、4.5） | `xml46687Parts/{tables,figures,formulas,mathml}.ts` + 各自测试与域快照；shared `wp8mG3Boundary.test.ts`、`wp8mG8Boundary.test.ts` | T2.4a-1、T2.3 |
| **T2.4c** | 术语（含 G5）、规范性引用、参考文献、索引、缩略语（2.9～2.12、1.2） | `xml46687Parts/{terms,refs}.ts` + 各自测试与域快照；shared `wp8mG1.test.ts`、`wp8mG2Boundary.test.ts`、`wp8mG5Boundary.test.ts`；client `wp8mG1.test.ts` | T2.4a-1、T2.3 |
| **T2.5** | 准备层（5） | `io/src/{formulaMathMl,xml46687Resources,xml46687Package}.ts`、`formulaOmml.ts`（提取）、`imageResources.ts`（加 `export`）、`index.ts` | **只依赖 T2.4a-0**（类型与 `collectXml46687ImageRefs`） |
| **T2.6** | 测试与验收：三个全要素夹具的快照、`validate.py` 集成、语义检查、矩阵覆盖断言、幂等；`docs/wp8.2/validation.md` | `shared/src/renderers/__tests__/{xml46687.golden,xml46687.validate,wp82MatrixCoverage}.test.ts`、WP8.2 全要素夹具、快照文件；文档 | T2.0、T2.4b、T2.4c、T2.5 |

### 6.2 并行与合入顺序

```
T2.0 ───────────────────────────────────────────────┐
T2.3 ─────────────┐                                  │
T2.4a-0 ──┬── T2.4a-1 ──┬── T2.4b ──┐                │
          │             ├── T2.4c ──┼── T2.6 ────────┘
          └── T2.5 ─────┴───────────┘
```

合入顺序：①T2.0、T2.3、T2.4a-0 三者互不相干，任意顺序先合；②T2.4a-1 在 T2.3 之后合（其黄金快照含 `biblref_`/`table-fn_` 等新 id；也可先合 T2.4a-1 再让 T2.3 更新快照，但会让快照文件在两个 PR 里都变，故定序）；③T2.4b、T2.4c、T2.5 在各自依赖合入后**并行**；④T2.6 最后。T2.4a-1 是关键路径，故把任何不属于“所有领域共用”的内容都留给 b/c。

### 6.3 冲突热点与规避

| 文件 | 谁改 | 规避办法 |
|---|---|---|
| `shared/src/renderers/xml46687.ts` | 仅 T2.4a | 分派表放在 `xml46687Parts/dispatch.ts`，T2.4a-1 一次写完（每个领域一行 `import`，桩函数返回“未实现”问题）；b/c 只替换自己领域文件里的函数体 |
| `shared/src/renderers/outputBoundary.ts` | 仅 T2.4a-1（一次接线 + 两处陷阱） | 各领域放行常量在**各自**的 `xml46687Parts/<域>.ts`；`xml46687Boundary.ts` 汇总 |
| `outputBoundaryXml46687.test.ts` | T2.4a 持有全局断言；b/c 只在**各自的** `outputBoundaryXml46687.<域>.test.ts` 加“逐项正例” | `XML46687_DECLARED_DIFFERENCES` 由各域常量拼成（“域分段”展开），**导出自 shared**（`xml46687Boundary.ts`），使 client 测试也能用 |
| client `wp8mIntegration.test.ts:422-440,477`、`wp8mPersistence.acceptance.test.ts:334-410` | 仅 T2.4a-1 | 把“XML−XML46687=2”改为“差集恰等于 `XML46687_DECLARED_DIFFERENCES`（计算出来，不写死个数）”；b/c 之后再放行字段无需再改这两个文件（**替代 1.3.5 表里把它们归 T2.6 的写法**） |
| `shared/src/renderers/__tests__/__snapshots__/` | 各域各自的域快照文件；全要素快照只在 T2.6 | 域快照用 `toMatchFileSnapshot('…/xml46687.<域>.xml')`；b、c 不对 WP8.M/WP6 全夹具做快照（两者都会改它）。 |
| `shared/src/renderers/index.ts`、`shared/src/xml46687/index.ts` | 仅 T2.4a-0 | 一次加好 |
| `io/src/index.ts` | 仅 T2.5 | — |
| `docs/wp8.1/matrix-T.json`、`scripts/xml46687/*` | 仅 T2.0 | 与 TS 工作完全分离；T2.6 的覆盖断言只**读**矩阵 |
| `resolve.ts`、`html.ts`、`footnotes.ts`、旧序列化器 | 仅 T2.3 | b、c 不碰 Resolver：需要的 id 都由 T2.3 先给出 |

### 6.4 每个任务的验收

| 任务 | 验收（测试标题带矩阵 id；矩阵 id 清单见附录 C 按节汇总） |
|---|---|
| T2.0 | `python3 -I scripts/xml46687/matrix_coverage.py` 退出码 0；`python3 -I scripts/xml46687/test_validate.py` 全过；`git diff` 只含 `matrix-T.json` 七行、`export_enforcement.py` 登记、`README.md` 重新生成的表 |
| T2.3 | shared、io、client 全量测试与基线一致（shared 89 文件 2102 项、io 25 文件 363 项、client 114 文件 1420 项，各自增加新测试）；`html.test.ts.snap` 只在 `bib_`→`biblref_`、术语注 `note_`→`nte_` 两处变化；DOCX 快照、JSON golden 零变化（1.4.3 的实测） |
| T2.4a-0 | `collectXml46687ImageRefs` 单测（块图、行内图、重复资源、顺序）；类型检查通过 |
| T2.4a-1 | `fullRendererFixture` 的 XML 快照 + `validate.py --profile export` 零错误；2.0～2.5、2.11（xref）、3 的单元测试（含 `xml-mark-combination`、`xml-block-after-subsec`、`xml-rid-unresolved`、`xml-id-duplicate`、`xml-ext-id-leak` 的反例）；边界测试按 1.3.4 改写并通过；`:156`、`:237` 两处陷阱各有回归测试 |
| T2.4b | 表/图/公式每个映射行一条测试；表脚注、列宽（`col`）、单元格 `style`、图例、行内图、公式注（R-10）；MathML 解析器正反例（命名实体、`on*`、非 MathML 命名空间、`annotation` 去除）；`validate.py` 对域夹具零错误；`sts_compat.py` 对含公式的样例零未解释偏差 |
| T2.4c | G5 四种情形 + marks 情形（1.2）；术语语言集合并三种情形；描述符非法取值；规范性引用 `std`/`mixed`；参考文献 `std` 完整/不完整；索引；缩略语被引用与不被引用；`validate.py` 零错误 |
| T2.5 | 5.3 所列测试；`formulaOmml*.test.ts`、DOCX 快照不变（提取的验收）；`pnpm` 依赖与 lockfile 零变化 |
| T2.6 | 7 的全部内容 |

## 7. 测试策略

### 7.1 分层与文件

| 层 | 内容 | 位置 | 归属 |
|---|---|---|---|
| ① 域单元测试 | 每个映射行至少一条：手写最小 IR → 渲染 → 断言 XML 片段与问题；每个 error 码至少一条反例，标题带码 | `shared/src/renderers/__tests__/xml46687.<域>.test.ts` | T2.4a/b/c |
| ② 输出边界 | 差异集合断言、逐项正例、仍阻断清单（1.3.4） | `outputBoundaryXml46687.test.ts` 及 `…<域>.test.ts` | T2.4a/b/c |
| ③ 全要素黄金样例 | 4 份夹具的 XML 文件快照 | `__tests__/__snapshots__/xml46687.<夹具>.xml`（`toMatchFileSnapshot`，仓库里目前没有人用过它，vitest 3.2 支持；备选沿用 `.snap`，但 XML 文件快照便于直接喂给 `validate.py`） | T2.6 |
| ④ 外部校验 | `validate.py --profile export` 零错误 + `sts_compat.py` 零未解释偏差 | `xml46687.validate.test.ts`（shared）、`io/src/xml46687Package.test.ts` | T2.6 |
| ⑤ 语义检查 | 在渲染器内部的 `XmlDocument`（写出前的树）上做：id 唯一、rid 可解析、资源可定位、日期语义、无 `ext_`、无 `tex-math`、无 DOCTYPE | 同 ③，经只用于测试的 `buildXml46687Document` | T2.6 |
| ⑥ 幂等与不变 | 7.3 | 同 ③ | T2.6 |
| ⑦ 矩阵覆盖断言 | 7.5 | `wp82MatrixCoverage.test.ts` | T2.6（骨架在 T2.4a） |
| ⑧ io 与产品层 | 5.3 | `io/src/*.test.ts` | T2.5 |

### 7.2 夹具与导出前提（实测）

| 夹具 | 直接导出？ | 需要的处理 |
|---|---|---|
| `fullRendererFixture()` 经 `pmToIr`（`fullFixture` 的渲染器变体；原版 `fullFixture()` 会产生 `dangling-typed-ref` error，所以不用） | 边界 0 条，**可直接导出** | T2.4a 的第一个黄金样例 |
| WP8.M 全要素 IR `createWp8mIrDoc()` | 边界 31 条，全部是 §6.2 放行项；**但 `g1-ch3-p2` 有一个同时带 `crossRef` 与 `stdRef` 的 run**，实测 `xref` 与 `std` 互不包含 → error `xml-mark-combination` | 反例测试钉住这一条；黄金样例用**拆开该 run 的派生夹具**（`patchWp8mForXml`，在测试里写明改动）；元数据缺 SES 必填项时按 D-X-02 处理 |
| WP6 夹具 `createWp6Fixture()` 经 `pmToIr` | 边界 57 条；其中两类**保持阻断**：`figure.groups`、行内 `style`（颜色等）；块 kind `warning/quote/code` 现为四种格式都阻断，由 T2.4a 对 XML46687 放行（1.3.3）；另有 `partOfSpeech='名词'`（不在枚举内，`xml-descriptor-value`）、`bibEntry.entryType='standard'` 但无 `std-ref` 字段（`bib-std-incomplete`，退化为 `mixed-citation`） | 每个“保持阻断”项各有一条反例；黄金样例用派生夹具（`patchWp6ForXml`：去掉 `groups` 与行内 `style`，把词性改为 `noun`） |
| **WP8.2 全要素夹具**（新建，直接用 `IRDoc` 手写，不经 PM） | 目标：命中**每个** export≠not-applicable 的 shall/should 行至少一次 | 内容：引言条；全部 std-meta 字段；两种规范性引用条目；`std` 与 `mixed-citation` 两种文献；索引；被引用与未被引用的缩略语/列项/注/示例；全部标记嵌套；变量+上下标；块公式（有/无编号）、公式注、式中；行内公式；带 `col`、`thead`、表脚注、表注、单位、单元格 `style` 的表；带图例、图注、图中示例、说明段、单位的图；两种行内图；术语（`languageSets`、四类描述符、G5 四种情形、被引用的术语注）；警告、摘录、代码；外链、条文脚注 |

测试里的 MathML 与资源：shared 测试不能依赖 io，所以用**确定性桩** `stubMathMl(id)`（一个最小的 `<mml:math><mml:mi>x</mml:mi></mml:math>`）与 `stubManifest(doc, labels)`（由 `collectXml46687ImageRefs` 生成的假条目）；真实 KaTeX 转换与资源包由 io 的测试（T2.5）覆盖，并在 `xml46687Package.test.ts` 里对 WP8.2 全要素夹具做端到端：真转换 → 渲染 → `validate.py`。

### 7.3 幂等与不变

1. **确定性**：同一输入连续渲染两次，字符串逐字节相同；`exportXml46687` 同。
2. **不修改输入**：对 `doc`、`labels`、`options` 先 `JSON.stringify` 再渲染，渲染后再次 `JSON.stringify`，相等；另用递归 `Object.freeze` 的副本渲染，不抛错。
3. **键序无关**：打乱 `options.mathml`、`labels`、`resources.entries` 的键/元素序，输出不变（渲染器按 IR 文档序与 `href` 排序取值，不遍历对象键）。
4. **JSON 往返**：`XmlDocument` 可 `JSON.stringify` 往返无损（树的既有约定）。
5. **Resolver 幂等前提**：`resolve(doc)` 两次结果相同；已被 Resolver 测试覆盖，不重复。
6. **往返（导入再导出）**留给 WP8.3：本阶段没有导入器，不写假的往返测试。

### 7.4 `validate.py --profile export` 的调用与环境（实测）

| 项目 | 实测结果 |
|---|---|
| Python | `python3 3.13.17` |
| lxml | `6.1.3`（libxml2 `2.14.6`） |
| xmllint | libxml `20914`，`--version` 可用（`validate.py` 以它作第二实现） |
| 速度 | `validate.py` 单文件约 0.14 秒；`sts_compat.py` 约 0.5 秒；`test_validate.py` 259 项约 11 秒；`matrix_coverage.py` 约 2 秒 |
| 在 vitest 里调用 | node 环境（shared、io 的 vitest 都是默认 node 环境）下 `spawnSync('python3', ['-I', validate, '--json', '--profile', 'export', file])` 可用，stdout 是 JSON（`results[].valid/errors/warnings`）；实测通过 |
| CI | **仓库里没有任何 CI 配置**（根目录无 `.github`），`ENVIRONMENT.md` 把 Python 3 列为“否（日常不需要）”。所以“CI 有没有 python3 与 lxml”**无从核对，不能假设** |

**做法（D-X-18）**：测试辅助函数 `pythonValidationAvailable()` = `python3 -I -c "import lxml"` 退出码 0 且 `xmllint --version` 可执行。①可用 → 每个黄金样例与域夹具跑 `validate.py --profile export`，要求 `valid:true`、`errors:[]`（warning 允许，且逐条断言预期的 warning 集合，防止告警悄悄增多）；再对含公式的样例跑 `sts_compat.py`，要求退出码 0（**零未解释偏差**；已知偏差白名单内的不算）；②不可用 → `describe.skipIf`，并在报告里打印“外部校验被跳过”；③环境变量 `REQUIRE_XML_VALIDATION=1` 时，②改为**失败**——验收命令固定带这个变量，开发机没装 Python 的人日常不受影响。辅助函数在 shared 与 io 各放一份（各约 20 行；shared 的测试不能引用 io，反之亦然）。**需要用户确认**：验收环境须装有 python3、lxml、xmllint（本机已有）。

### 7.5 语义检查与专项断言

- **id 与 rid**：`xml-id-duplicate`、`xml-rid-unresolved` 在渲染器 P4 已检查；测试再对每个黄金样例独立复算一遍（在 `XmlDocument` 上遍历，不复用渲染器的检查函数），并与 `validate.py` 的 V-1 结论一致。
- **必备 id**：对 `validate.py` V-13 的 `REQUIRED_ID_ELEMENTS` 清单（有 label 的 `sec`、`app`、`term-sec`、`tbx:termEntry`、参考文献 `ref-list`/`ref`、`index`、有 label 的 `table-wrap`、`fig`、有 label 的 `disp-formula`、各类 `fn`），在树上逐类断言存在 id。
- **仅被引用才有 id**：对 `note`/`example`/`list-item`/`def-item`/`tbx:note` 各一对夹具（被引用/未被引用），断言 id 有无（3.2）。
- **资源可定位**：每个 `graphic`、`inline-graphic` 的 `xlink:href` 在 `manifest.entries` 里恰好一个；`fileName` 存在于 `files`。
- **日期语义**：`release-date`、`implementation-date` 是真实日历日；发布晚于实施产生 `meta-date-order` warning；非法日期 `xml-date-invalid`。
- **无 `tex-math`、无 `ext_`、无 DOCTYPE、无默认命名空间**：对每个黄金样例字符串做正则断言（`/tex-math|alternatives/`、`/\b(?:id|rid|target)="ext_/`、`<!DOCTYPE`），并断言首行为 XML 声明、`standard` 根只声明 `mml`、`tbx`、`xlink` 三个命名空间。
- **`mml_m<k>` 连续**：断言 `k` 从 1 起连续，且行间与行内合并计数。
- **差异集合**：1.3.4 的差异集合断言在测试里**用计算值**，不写死个数。

### 7.6 矩阵覆盖断言（`wp82MatrixCoverage.test.ts`）

读取 `docs/wp8.1/matrix-S.json`、`matrix-T.json`（只读），**计算**需覆盖的行：`obligation ∈ {shall, should}` 且 `export ∈ {required, optional}`（含 T2.0 复核后的七行）；静态扫描 `shared/src/renderers/__tests__/xml46687*.test.ts` 与 `outputBoundaryXml46687*.test.ts` 的源文本，收集测试标题里形如 `[M-…]` 的矩阵 id，要求：①每个需覆盖的 id 至少出现一次；②出现的 id 都存在于矩阵（防笔误）；③对 `may`/示例性的行（共 136 行 `export≠not-applicable`）只**报告**未引用个数，不失败（D-X-20）。失败信息列出缺失 id 与其所属节（本文附录 C）。该测试读矩阵、不改矩阵；矩阵行数变化会自动改变覆盖要求。

### 7.7 对既有测试的影响汇总

- 必改（随放行字段）：1.3.5 列出的 shared 6 个文件、client 4 个文件；其中 client 的两个集成/验收文件由 T2.4a 一次改成“差集等于声明集合”，之后不再动（6.3）。
- 必须保持不变（提取与 Resolver 改动的验收）：DOCX 快照、JSON golden、`formulaOmml*.test.ts`、`io` 其余测试（1.4.3、5.3）。
- 新增依赖：无；`package.json`、lockfile 零变化。

## 8. 待决事项

每项给出选项、倾向与影响。倾向只是设计建议；涉及用户已定约定的项都**不改变**既有约定，只在约定留白处取舍。

| 编号 | 问题 | 选项 | 倾向 | 影响 |
|---|---|---|---|---|
| D-X-01 | 七条矩阵行（M-10.2-01、M-10.2-02、M-10.1.7-01、M-10.1.1-04、M-10.1.5-01、M-8.3-02、M-6.1-03）的 `export` 取值（1.1） | A：前五行 `required`，后两行 `optional`；B：七行全部 `optional`（零脚本改动）；C：七行全部 `required` | A | A 需要在 `export_enforcement.py` 登记五行（1.1 给出现成写法），`matrix_coverage.py` 才不失败；B 最省事但三类正文引用不再被导出档强制；C 把 `inline-graphic`、`col` 也列为强制，与 WP8.M 其他“可有可无结构”不一致 |
| D-X-02 | SES 必填元数据（`std-org-group`、`content-language`、`release-date`、`implementation-date`）缺失时（2.1） | A：error；B：warning；C：日期与机构 error，语言 warning | A | 决定草稿能否导出：A 下 `createWp8mIrDoc()`、`createWp6Fixture()` 的元数据不全时导出被阻断，黄金样例需补元数据（T2.6 在夹具里补）；`title-wrap` 缺失（schema 硬要求）不受此项影响，恒为 error |
| D-X-03 | 表格里 IR 有而 XML 无表达的数据：拖拽列宽 `cells[].columnWidths`（px）、`cellType`、`width`，以及非表头单元格的 `unit`（1.3.3、2.6） | A：`columnWidths`、`cellType`、`width` 放行并 info，`td` 的 `unit` 为 error；B：`columnWidths` 保持阻断（现状）；C：`td` 的 `unit` 也放行，warning 并丢弃 | A | B 下编辑过一次列宽的表永远不能导出 XML；C 会静默改变内容含义（单位丢失）。矩阵 M-6.1-03 的备注已写“导出 col 时只取 columns，不由 px 反推” |
| D-X-04 | WP6 时代的字段在 46687.2 里没有表达（多语种 `adoptions`、`languages.usage`、多份版权、图/行内图的 `alt/title/宽高`、链接 `title/target/rel`、变量 `kind/name`、表/行样式、单元格 `padding`、英文题名、`code.language`……）（1.3.3） | A：放行并 warning（JSON 仍完整）；B：保持阻断；C：静默放行 | A | B 会让大部分真实文档无法导出；C 违反 D-S-05“不静默丢弃”。A 的 warning 按类合并，避免刷屏（4.4） |
| D-X-05 | 纯文本容器（`tbx:subjectField`、`tbx:source`、`std-ref`、`std-org-name` 等）里的 marks 被丢弃时（2.3.3） | A：warning；B：error | A | B 下 WP8.M 夹具 `g5-t332`（领域加粗）无法导出；marks 在这些位置本来就没有 XML 表达，文字不丢 |
| D-X-06 | 对没有 id 方案的目标（段落、警告、摘录、代码、规范性引用条目、图例项、式中项、无编号公式、术语示例）的引用（2.11；R-9） | A：error；B：降级为纯文本（保留 `refText`）并 warning | A | A 与 C-T-48 一致（“目标类型无对应 `ref-type` 时报 error”）；现状 Resolver 对段落引用静默补 `ext_` 且无问题，所以拦截只能在渲染器；B 对作者更宽容但会让引用静默失去链接 |
| D-X-07 | 有序列项 `<label>` 的括号（2.4） | A：半角 `a)`（印刷页 16 的标记示例亲验为半角，矩阵 M-5.7-09 写作 `a)、1)`）；B：全角 `a）`（与 Resolver 标记和 `refText` 一致） | A | A 需要一次“全角右括号→半角”的字符串转换（2.0.2-7 登记的两处允许转换之一）；B 无转换，但与原文示例字符不同。导入端本就不把 `label` 文本当数据 |
| D-X-08 | 未被引用的有序列项的标记从哪里来（R-11；`labels` 里只有被引用的项） | A：Resolver 模块导出纯函数 `computeOrderedListMarkers`，渲染器调用它；B：让 Resolver 给所有有序项都进 `labels`；C：渲染器自己算 | A | B 会改变 `labels` 的内容并破坏 `wp8mG4Resolve.test.ts` 钉死的“未被引用的列项没有 label”与 `li_<k>` 的编号语义；C 违反“编号只在 Resolver” |
| D-X-09 | 列项类型 `boxed`、`romanUpper`（原文无取值）（2.4） | A：error；B：降级（`boxed`→`dash`，`romanUpper`→`roman-lower`）并 warning | A | B 会改变列项含义（大写罗马变小写） |
| D-X-10 | `bibRef` 对应的 `xref` 内容（2.10） | A：run 自己的文本；B：Resolver 的 `refText`（`[n]`，C-T-49 字面）；C：`标准编号[n]` 拼接 | A | 印刷页 47 的示例 2 把标准编号写在 `xref` 内容里（亲验），示例 1 写 `[1]`；HTML 渲染器对 `bibRef` 也不替换文本。B 会把示例 2 的内容改成 `[4]` |
| D-X-11 | 规范性引用条目 `ref/@id=ref_<n>`（2.10） | A：总是输出；B：从不输出；C：仅被引用时输出（目前没有引用路径） | A | R-8 已在 Resolver 实现，附录 E 的 `ref_5` 示例为“无 label 的条目”；`validate.py` 对其无要求，A 只增加 id |
| D-X-12 | 注/示例内容可含的块（2.5） | A：仅 `paragraph`、`list`；B：另放开 `code`、行间公式（schema 已接受） | A | B 会让公式编号进入注内，与 Resolver 的编号作用域耦合；C-S-31 写“出现表、图、公式 → 报告” |
| D-X-13 | 术语隐含语言集（`term`/`termEn`）与显式 `languageSets` 的关系（2.9） | A：按主语言子标签合并（`zh-Hans`→`zh`），同语言的 `tig` 追加；B：显式集覆盖隐含集；C：同语言冲突报错 | A | B 丢失 `term` 文本；C 阻断 WP6 夹具。A 下 `xml:lang` 沿用隐含集的 `zh`/`en` |
| D-X-14 | 术语描述符取值不在 schema 枚举（如 `partOfSpeech='名词'`）（2.9） | A：error；B：warning 并省略该描述符；C：原样输出 | A | C 使 `validate.py --profile export` 失败；B 丢信息。C-T-41 写“原样输出并 warning”，但 `tbx.rng` 已收紧为枚举（附录 B 第 9 项） |
| D-X-15 | 对外接口形态（4.2） | A：`exportXml46687`（不抛）+ `renderXml46687`（抛）；B：只提供抛错版；C：只返回问题版 | A | B 一次只能看到第一个错误；C 偏离任务书给定的返回 `string` 的签名 |
| D-X-16 | 资源包里的资源目录名（5.2） | A：`resources/`（任务书）；B：`graphics/`（8.2 一个示例用 `/graphics/…png`） | A | 仅影响包布局，不影响 `xlink:href`（无目录无扩展名） |
| D-X-17 | 单元格边框样式的省略口径（2.6） | A：只写与表级默认（`solid` 1px 或 `table.style.borderWidth`）不同的边（C-T-09 字面）；B：IR 有值都写 | A | B 输出更长但往返无损；A 下显式写成默认值的边在导出后变为未设置 |
| D-X-18 | 外部校验对 python3 的依赖（7.4） | A：无 python 时跳过，`REQUIRE_XML_VALIDATION=1` 时失败，验收命令固定带它；B：总是强制；C：只放独立脚本，不进 vitest | A | 仓库无 CI 配置、`ENVIRONMENT.md` 称 Python“可选”；需要用户确认验收环境有 python3、lxml、xmllint |
| D-X-19 | 术语注的 `nte_<术语号>-<k>` 是否占用全局 `note_<n>` 计数（R-4） | A：不占用，其余 `note_<n>` 连续；B：占用，`note_<n>` 出现空洞 | A | A 使 `html.test.ts.snap` 里术语 1 之后各注的序号前移（1.4.3 已实测两项快照变化） |
| D-X-20 | 矩阵覆盖断言的范围（7.6） | A：shall/should 且 export≠not-applicable 的行必须有测试引用（186 行）；may/示例行只报告；B：全部 export≠not-applicable 的行（322 行）；C：只要求 shall（151 行） | A | B 会要求为示例性的 MathML 元素行（M-7.4-04～M-7.4-11）等逐行造测试，收益低 |

另有**不是待决、但需要用户知情**的三点：①T2.0 复核后 `M-4.3.4-02/-03`（引言条）的 `import` 仍是 `reject`，应在 WP8.3 改 `accept`；②本阶段不改 `io/src/exportGuard.ts`，`xml` 仍映射到旧 `XML` 边界，到 WP8.4 才切换；③`outputBoundary.ts` 对 `warning/quote/code` 三个块 kind 对 HTML、DOCX 同样阻断，本阶段只对 XML46687 放行，HTML/DOCX 的放行另立任务。

## 附录 A　实测记录

**A.1 工作方式**：`git archive HEAD` 导出到 scratchpad 的隔离副本（不在仓库内、不入库），在副本里 `pnpm install --frozen-lockfile`（2 秒，未改 lockfile）后运行 vitest 与 Python；所有试验用的探针测试、补丁脚本都在副本里，仓库工作树只新增本文件。

**A.2 基线测试**：shared 89 文件 2102 项、io 25 文件 363 项、client 114 文件（另 2 个跳过）1420 项，全绿。

**A.3 Resolver 改动波及面**：见 1.4.3（R-1：shared 3 个文件 5 项 + client 2 个文件 3 项 + `html.test.ts.snap`；R-2 完整改动与“只改 Resolver”的对比；R-4；R-10；四项合并：shared 5 个文件 7 项、client 4 个文件 6 项、仅 `html.test.ts.snap` 变化，DOCX 快照与 JSON golden 零变化）。

**A.4 输出边界基线**（`getOutputSupportProblems(doc,'XML46687')`）：`fullRendererFixture` 0 条；`createWp8mIrDoc()` 31 条（与 `docs/wp8.m/validation.md` 一致）；`createWp6Fixture()` 57 条，按路径归类见 1.3.3。`warning`、`quote`、`code` 三个块 kind 对 HTML、DOCX、XML、XML46687 **四种格式都报 `kind` 不支持**（WP6 夹具上各 3 条）。

**A.5 验证环境**：`python3 3.13.17`、`lxml 6.1.3`（libxml2 2.14.6）、`xmllint`（libxml 20914）；`validate.py` 单文件约 0.14 秒，`sts_compat.py` 约 0.5 秒，`test_validate.py` 259 项约 11 秒，`matrix_coverage.py` 约 2 秒；官方 DTD 在 `schemas/niso-sts-1.2/interchange-mathml3-dtd/`，不联网。

**A.6 vitest 调 python**：node 环境下 `spawnSync('python3', ['-I', 'scripts/xml46687/validate.py', '--json', '--profile', 'export', file])` 可用，stdout 为 JSON。

**A.7 页图核对**（`pdftoppm -r 110/150`，PDF 页 = 印刷页 + 4）：印刷页 16（5.7.2，`<label>a)</label>` 半角）、27（7.1，`<label>(1)</label>` 半角；“使用 mml:math 中的 @id 进行行内公式 ID 的编制”）、45（10.1.4 缩略语）、47（10.1.6 示例 2，`xref` 内容为标准编号）、48（10.1.8 脚注示例含 `label>sup`、10.1.9 外链示例）、67（附录 E ID 方案）。

**A.8 行内标记嵌套组合**：用 `validate.py --profile export` 逐个验证 31 个组合（模板：`sec_1` 内一个 `p`）。接受：`xref>bold`、`bold>xref`、`named-content>sup`、`bold>named-content`、`named-content>bold`、`bold>std>std-ref`、`ext-link>bold`、`bold>ext-link`、`mixed-citation>bold`、`bold>mixed-citation`、`mixed-citation>xref`、`mixed-citation>std>std-ref`、`bold>inline-code`、`xref>inline-code`、`named-content>inline-code`、`bold>italic>underline>strike>sup`、`inline-formula>mml:math`（含 id）、`xref>label>sup`、`fn` 紧随 `xref`、`inline-graphic`、`bold>inline-graphic`。拒绝：`std>std-ref>bold`、`std>bold`、`xref>std`、`std>xref`、`ext-link>xref`、`xref>ext-link`、`inline-code>bold`、`bold>break`、`xref>break`、`named-content>std`。2.3.2 的嵌套次序由此得出。

**A.9 夹具的不可导出点**：WP8.M 夹具 `g1-ch3-p2` 的 run 同时带 `crossRef` 与 `stdRef`（`xref` 与 `std` 互不包含，上表）；WP6 夹具的 `partOfSpeech='名词'`、`figure.groups`、行内 `style`。

**A.10 主要命令**：`git archive`、`pnpm install --frozen-lockfile`、`npx vitest run <探针>`、`python3 -I scripts/xml46687/{validate,sts_compat,matrix_coverage}.py`、`python3 -I scripts/xml46687/test_validate.py`、`pdftoppm -f N -l N`。

## 附录 B　与既有文档的不一致处

编号即“发现项”序号，正文中按序号引用。

1. **R-1、R-2 的波及面**：`conventions-S` 写 R-1 影响 5 个测试文件、R-2 影响 3 个测试文件；实测 R-1 是 4 个测试文件加 1 个快照文件，R-2 另有 3 处必须同步的**源码**（`html.ts:232`、`footnotes.ts:17`、旧序列化器 `xmlSerializer.ts:1173`）（1.4.3）。
2. **设计 §6.2 的放行清单**对“WP8.M 新增结构”完整（31 条恰为 11 类），对**整份标准**不完整：WP6 夹具的 57 条里绝大多数不在 §6.2（1.3.3）。
3. **`warning`、`quote`、`code` 三个块 kind** 在四种格式的边界里都被阻断，§6.2 与约定表都没提；XML46687 必须放行它们才能导出警告、摘录、代码（1.3.3）。
4. **`outputBoundary.ts` 两处实现陷阱**：`:156` 把 mark 对象的 `kind` 字段当成节点 kind（带 `kind` 的 `variable` mark 被误报），`:237` 对 XML 家族一律提前拦截行内公式（1.3.3）。
5. **X-21 无编号公式**：`conventions-S` 写“无编号：`ext_…`”；实测无编号公式没有任何标签，反而更符合“无编号不写 id”。
6. **R-9**：约定要求对无 id 目标的引用“报告”，实测 Resolver 对段落引用静默补 `ext_` 标签且 `problems=[]`，只能在渲染器拦（D-X-06）。
7. **M-4.1-01**：矩阵属性值写 `encoding=utf-8`，`validate.py` V-16 与写出器都取 `UTF-8`；两者等价，不改。
8. **C-T-40 的描述符导出顺序**（词性、采用级别、术语类型、语法数）与 `tbx.rng` 的顺序（词性、语法数、采用级别、术语类型；注释写明“原先 C-T-40 约定的顺序无原文依据”）不一致，渲染器取 schema。
9. **C-T-41、矩阵 M-9.2.3-04** 写“取值不在列表内保留并 warning”，`tbx.rng` 已把 `partOfSpeech` 收紧为枚举（D-X-14）。
10. **C-T-49、C-T-53** 写 `bibRef` 的 `xref` 内容取 Resolver `refText`，印刷页 47 示例 2 的内容是标准编号（D-X-10）。
11. **C-T-55 与印刷页 48 的 10.1.8 示例**：正文写“上标样式不包含在 XML 中”，示例却在 `xref` 内写 `label>sup`；约定取纯文本，`fn` 定义里的标签才用 `label>sup`（M-10.1.8-02、M-6.2.3-08）。
12. **M-5.7-09 / C-S-32 的 `a)`（半角）** 与 Resolver 列项标记及 `refText` 的 `a）`（全角，D-M-03）不同（D-X-07）。
13. **约定表中已被 WP8.M 取代的“gap”表述**：C-S-10（引言无条）、C-S-24（无规范性引用条目结构）、C-T-29（无行内图）、C-T-31（无图例）、C-T-51（无缩略语结构）、C-T-52（无列项引用目标）、C-T-32（图中注/示例）。本设计按 WP8.M 落地后的 IR 编写，约定表未改动。
14. **七条矩阵行的 `export` 列**仍是 WP8.1 时代的 `not-applicable`（1.1）。
15. **夹具不能直接导出**：WP8.M 夹具（`crossRef`+`stdRef` 同一 run）、WP6 夹具（`partOfSpeech='名词'`、`figure.groups`、行内 `style`）（A.9、7.2）。
16. **`M-4.3.4-02/-03`**：`import` 仍为 `reject`（实现类），IR 已能保存，应在 WP8.3 改 `accept`。
17. **矩阵内部**：M-4.5.3-06 写 `mixed-citation` 的 `xlink:type="simple"` “照示例写”，M-4.5.3.3-02 写 `uri`“导出不写”；按元素分别执行（2.10）。
18. **`outputBoundaryXml46687.test.ts`** 与 `outputBoundary.ts` 的注释把“XML46687 与 XML 完全一致”当作前提，一旦放行任何字段即不成立（1.3.4）。

## 附录 C　矩阵行 → 设计节对照（脚本生成）

<!--COVERAGE-C-BEGIN-->
| 矩阵行 | 条款 / 印刷页 | 义务 | export（复核后） | 约定 | 设计节（全部出现处） |
|---|---|---|---|---|---|
| M-4.1-03 | 4.1 / 2 | should | required | C-S-01 | 2.1 |
| M-4.1-04 | 4.3.1 / 5 | shall | required | C-S-01 | 2.1 |
| M-4.1-05 | 4.4.1 / 8 | shall | required | C-S-01 | 2.1 |
| M-4.1-07 | 4.3.2 / 5 | should | required | C-S-11 | 2.1 |
| M-4.3.2-30 | 4.3.2 / 6 | should | required | C-S-04 | 2.1 |
| M-4.3.2-31 | 4.3.2 / 6 | should | required | C-S-04 | 2.1 |
| M-4.3.2-01 | 4.3.2 / 5 | should | required | C-S-11 | 2.1 |
| M-4.3.2-15 | 4.3.2 / 6 | should | optional | C-S-19 | 2.1 |
| M-4.3.3-01 | 4.3.3 / 7 | shall | required | C-S-09 | 2.1 |
| M-4.3.4-01 | 4.3.4 / 7 | should | required | C-S-10 | 2.1 |
| M-4.3.4-02 | 4.3.4 / 7 | should | optional | C-S-10 | 1.1、2.1、8 |
| M-4.3.4-03 | 4.3.4 / 8 | should | optional | C-S-10 | 2.1 |
| M-4.4.2.1-01 | 4.4.2.1 / 8 | shall | required | C-S-23 | 2.2 |
| M-4.4.2.1-02 | 4.4.2.1 / 8 | shall | required | C-S-23 | 2.2 |
| M-4.4.2.1-03 | 4.4.2.1 / 8 | shall | required | C-S-23 | 2.2 |
| M-4.4.2.1-04 | 5.3 / 15 | shall | required | C-S-23 | 2.2 |
| M-4.4.2.2-01 | 4.4.2.2 / 9 | should | required | C-S-06 | 2.2 |
| M-4.4.2.3-01 | 4.4.2.3.1 / 9 | shall | required | C-S-24 | 2.2 |
| M-4.4.2.3-02 | 4.4.2.3.2 / 10 | shall | required | C-S-24 | 2.10 |
| M-4.4.2.3-03 | 4.4.2.3.2 / 10 | shall | required | C-S-24 | 2.10 |
| M-4.4.2.3-04 | 4.4.2.3.3 / 10 | shall | required | C-S-24 | 1.1、2.10 |
| M-4.4.2.4-01 | 4.4.2.4 / 10 | should | required | C-S-25 | 2.2 |
| M-4.4.2.5-01 | 4.4.2.5 / 11 | should | required | C-S-08 | 2.2 |
| M-4.5.2-01 | 4.5.2.1 / 11 | shall | required | C-S-26 | 2.2 |
| M-4.5.2-02 | 4.5.2.1 / 11 | shall | required | C-S-07 | 2.2 |
| M-4.5.2-03 | 4.5.2.1 / 11 | shall | required | C-S-07 | 2.2 |
| M-4.5.2-04 | 4.1 / 4 | shall | required | C-S-07 | 2.2 |
| M-4.5.2-05 | 4.5.2.1 / 11 | shall | required | C-S-26 | 2.2 |
| M-4.5.2-06 | 4.5.2.2 / 11 | shall | required | C-S-26 | 2.2 |
| M-4.5.3-01 | 4.5.3.1 / 12 | shall | required | C-S-27 | 2.10 |
| M-4.5.3-02 | 4.5.3.1 / 12 | shall | required | C-S-27 | 2.10 |
| M-4.5.3-03 | 4.5.3.1 / 12 | should | required | C-S-27 | 2.10 |
| M-4.5.3-04 | 4.5.3.2 / 13 | shall | required | C-S-27 | 2.10 |
| M-4.5.3-05 | 4.5.3.1 / 12 | shall | required | C-S-27 | 2.10 |
| M-4.5.3-06 | 4.5.3.2 / 13 | shall | required | C-S-27 | 2.10 |
| M-4.5.3-08 | 4.5.3.3 / 13 | shall | optional | C-S-27 | 2.10 |
| M-4.5.4-01 | 4.5.4 / 13 | shall | optional | C-S-28 | 2.11 |
| M-4.5.4-02 | 4.5.4 / 14 | shall | optional | C-S-28 | 2.11 |
| M-4.5.4-03 | 4.5.4 / 14 | shall | optional | C-S-28 | 2.11 |
| M-4.5.4-04 | 4.5.4 / 14 | shall | optional | C-S-28 | 2.11 |
| M-4.5.4-05 | 4.5.4 / 14 | shall | optional | C-S-28 | 2.11 |
| M-4.5.4-06 | 4.5.4 / 14 | shall | optional | C-S-28 | 2.11 |
| M-5.1-01 | 5.1 / 14 | shall | required | C-S-29 | 2.3 |
| M-5.1-02 | 5.1 / 14 | shall | required | C-S-29 | 2.3 |
| M-5.1-03 | 5.1 / 14 | shall | required | C-S-29 | 2.3 |
| M-5.1-04 | 5.1 / 15 | shall | required | C-S-29 | 2.3 |
| M-5.1-06 | 5.1 / 15 | shall | required | C-S-29 | 2.3 |
| M-5.1-07 | 5.1 / 15 | shall | required | C-S-29 | 2.3 |
| M-5.1-08 | 5.1 / 14 | shall | required | C-S-29 | 2.0 |
| M-5.2-01 | 5.2 / 15 | shall | required | C-S-23 | 2.2 |
| M-5.2-02 | 5.2 / 15 | shall | required | C-S-23 | 2.2 |
| M-5.4-01 | 5.4 / 15 | shall | required | C-S-34 | 2.0 |
| M-5.5-01 | 5.5 / 15 | shall | required | C-S-30 | 2.3 |
| M-5.5-02 | 5.5 / 15 | shall | required | C-S-30 | 2.3 |
| M-5.6-01 | 5.6 / 15 | shall | required | C-S-31 | 2.5 |
| M-5.6-02 | 5.6 / 15 | shall | required | C-S-31 | 2.5 |
| M-5.6-03 | 5.6 / 15 | shall | required | C-S-31 | 1.3、2.5 |
| M-5.6-04 | 5.6 / 15 | shall | required | C-S-31 | 2.5 |
| M-5.6-05 | 5.6 / 15 | should | required | C-S-31 | 2.5 |
| M-5.6-06 | 5.6 / 15 | shall | required | C-S-31 | 2.5 |
| M-5.7-01 | 5.7.1 / 16 | shall | required | C-S-32 | 2.4 |
| M-5.7-02 | 5.7.2 / 16 | shall | required | C-S-32 | 2.4 |
| M-5.7-03 | 5.7.2 / 16 | shall | required | C-S-32 | 2.4 |
| M-5.7-04 | 5.7.2 / 16 | shall | required | C-S-32 | 2.4 |
| M-5.7-05 | 5.7.3 / 17 | shall | required | C-S-32 | 2.4 |
| M-5.7-06 | 5.7.3 / 17 | shall | required | C-S-32 | 2.4 |
| M-5.7-08 | 5.7.1 / 16 | shall | required | C-S-32 | 2.4 |
| M-5.7-09 | 5.7.2 / 16 | shall | required | C-S-32 | 1.4、2.4、8 |
| M-5.7-10 | 5.7.2 / 16 | shall | required | C-S-32 | 2.4 |
| M-5.9-01 | 5.9 / 19 | should | required | C-S-35 | 1.3、2.5 |
| M-5.9-02 | 5.9 / 19 | shall | required | C-S-35 | 1.3、2.5 |
| M-5.10-01 | 5.10 / 19 | should | required | C-S-33 | 1.3、2.3、2.5 |
| M-5.10-02 | 5.10 / 19 | should | required | C-S-33 | 2.3、2.5 |
| M-6.2.1-01 | 6.2.1 / 20 | shall | required | C-T-01 | 2.6 |
| M-6.6-01 | 6.6 / 25 | shall | required | C-T-12 | 2.6 |
| M-6.2.1-03 | 6.2.1 / 20 | shall | required | C-T-15 | 2.6 |
| M-6.2.1-04 | 6.2.1 / 20 | shall | optional | C-T-15 | 2.6 |
| M-6.2.1-05 | 6.2.1 / 20 | shall | required | C-T-15 | 2.6 |
| M-6.1-01 | 6.1 / 20 | shall | required | C-T-01 | 2.6 |
| M-6.1-03 | 6.1 / 20 | shall | optional（原 not-applicable） | C-T-10 | 1.1、1.3、2.6、8 |
| M-6.2.2-01 | 6.2.2 / 20 | shall | required | C-T-16 | 2.6 |
| M-6.2.2-02 | 6.2.2 / 20 | shall | required | C-T-16 | 2.6 |
| M-6.2.4-01 | 6.2.4 / 22 | shall | required | C-T-07 | 2.6 |
| M-6.4-01 | 6.4 / 24 | shall | required | C-T-07 | 2.6 |
| M-6.4-02 | 6.4 / 24 | shall | required | C-T-07 | 2.6 |
| M-6.4-03 | 6.4 / 24 | shall | required | C-T-07 | 2.6 |
| M-6.3.3.1-01 | 6.3.3.1 / 24 | shall | optional | C-T-09 | 1.1、2.6 |
| M-6.3.4-01 | 6.3.4 / 24 | shall | optional | C-T-09 | 2.6 |
| M-6.2.3-03 | 6.2.3 / 20 | shall | required | C-T-02 | 2.6 |
| M-6.2.5-02 | 6.2.5 / 22 | shall | required | C-T-03 | 2.6 |
| M-6.2.3-04 | 6.2.3 / 20 | shall | required | C-T-02 | 2.6 |
| M-6.2.3-05 | 6.2.3 / 21 | shall | required | C-T-02 | 2.5、2.6 |
| M-6.2.3-06 | 6.2.3 / 21 | shall | required | C-T-02 | 2.6 |
| M-6.2.3-07 | 6.2.3 / 21 | shall | required | C-T-06 | 2.6 |
| M-6.2.3-08 | 6.2.3 / 21 | shall | required | C-T-06 | 2.6 |
| M-6.2.3-09 | 6.2.3 / 21 | shall | required | C-T-06 | 2.6 |
| M-6.2.3-10 | 6.2.3 / 21 | shall | required | C-T-06 | 2.3、2.6、2.11 |
| M-6.2.4-02 | 6.2.4 / 22 | shall | required | C-T-04 | 2.6 |
| M-D.1-01 | D.1 / 64 | shall | required |  | 2.6、3.4 |
| M-7.1-01 | 7.1 / 27 | should | required | C-T-17 | 2.8 |
| M-7.1-03 | 7.1 / 27 | should | required | C-T-25 | 2.8 |
| M-7.4-01 | 7.4 / 28 | should | required | C-T-19 | 2.8 |
| M-7.4-02 | 7.4 / 28 | should | required | C-T-18 | 2.3、2.8 |
| M-7.1-04 | 7.1 / 27 | should | required | C-T-21 | 2.3、2.8 |
| M-7.1-05 | 7.1 / 27 | should | required | C-T-21 | 2.3、2.8 |
| M-7.2-01 | 7.2 / 27 | should | optional | C-T-23 | 2.8 |
| M-7.2-02 | 7.2 / 27 | should | required | C-T-23 | 1.4、2.5、2.8 |
| M-7.3-01 | 7.3 / 27 | should | optional | C-T-22 | 2.8 |
| M-7.3-02 | 7.3 / 27 | should | required | C-T-22 | 2.8 |
| M-7.3-03 | 7.3 / 28 | should | required | C-T-22 | 2.8 |
| M-7.3-04 | 7.3 / 28 | should | required | C-T-22 | 2.8 |
| M-7.3-05 | 7.3 / 28 | should | required | C-T-22 | 2.8 |
| M-7.3-06 | 7.3 / 28 | should | required | C-T-22 | 2.8 |
| M-7.3-07 | 7.3 / 28 | should | required | C-T-22 | 2.8 |
| M-8.2-01 | 8.2 / 31 | should | required | C-T-26 | 2.7 |
| M-8.2-04 | 8.2 / 31 | shall | required | C-T-35 | 2.7 |
| M-8.2-05 | 8.2 / 31 | shall | required | C-T-26 | 2.7 |
| M-8.2-06 | 8.2 / 31 | shall | required | C-T-26 | 2.7 |
| M-8.2-08 | 8.2 / 31 | shall | required | C-T-27 | 2.7 |
| M-8.2-09 | 8.2 / 31 | shall | required | C-T-27 | 2.7 |
| M-8.3-02 | 8.3 / 31 | shall | optional（原 not-applicable） | C-T-29 | 1.1、2.3、2.7、8 |
| M-8.2-11 | 8.2 / 31 | shall | required | C-T-32 | 2.7 |
| M-8.2-12 | 8.2 / 31 | shall | optional | C-T-26 | 2.7 |
| M-8.5-01 | 8.5 / 32 | shall | optional | C-T-31 | 1.1、2.7 |
| M-8.5-02 | 8.5 / 32 | shall | optional | C-T-31 | 1.1、2.7 |
| M-8.5-03 | 8.5 / 32 | shall | optional | C-T-31 | 1.1、2.7 |
| M-8.5-04 | 8.5 / 32 | shall | optional | C-T-31 | 1.1、2.7 |
| M-8.5-05 | 8.5 / 32 | shall | optional | C-T-31 | 1.1、2.7 |
| M-8.5-06 | 8.5 / 32 | shall | optional | C-T-31 | 1.1、2.7 |
| M-8.6-01 | 8.6 / 33 | shall | required | C-T-33 | 2.7 |
| M-8.4-03 | 8.4 / 32 | shall | optional | C-T-32 | 2.5、2.7 |
| M-9.1-01 | 9.1 / 33 | should | required | C-T-37 | 2.2 |
| M-9.2.1-01 | 9.2.1 / 35 | shall | required | C-T-37 | 2.9 |
| M-9.2.1-02 | 9.2.1 / 35 | shall | required | C-T-37 | 2.9 |
| M-9.2.1-03 | 9.2.1 / 34 | shall | required | C-T-37 | 2.9 |
| M-9.2.1-04 | 9.2.1 / 35 | shall | required | C-T-37 | 2.9 |
| M-9.2.1-05 | 9.2.1 / 35 | shall | required | C-T-37 | 2.9 |
| M-9.2.1-06 | 9.2.1 / 35 | shall | required | C-T-43 | 2.9 |
| M-9.2.1-07 | 9.2.1 / 35 | shall | required | C-T-43 | 2.9 |
| M-9.2.3-01 | 9.2.3 / 35 | shall | required | C-T-43 | 2.9 |
| M-9.2.3-02 | 9.2.3 / 35 | shall | required | C-T-43 | 2.9 |
| M-9.2.3-03 | 9.2.3 / 36 | shall | optional | C-T-40 | 2.9 |
| M-9.2.3-04 | 9.2.3 / 36 | should | optional | C-T-41 | 2.9 |
| M-9.2.2-01 | 9.2.2 / 35 | shall | required | C-T-44 | 2.9 |
| M-9.2.8-01 | 9.2.8 / 43 | shall | required | C-T-44 | 2.9 |
| M-9.2.4-01 | 9.2.4 / 39 | shall | optional | C-T-44 | 2.9 |
| M-9.2.5-01 | 9.2.5 / 40 | shall | optional | C-T-44 | 2.9 |
| M-9.2.7-01 | 9.2.7 / 42 | shall | required | C-T-45 | 2.9 |
| M-9.2.9-01 | 9.2.9 / 43 | shall | optional | C-T-44 | 1.1、1.2、2.9 |
| M-9.2.6-01 | 9.2.6 / 41 | shall | required | C-T-45 | 2.3、2.9 |
| M-9.2.6-02 | 9.2.6 / 42 | shall | required | C-T-45 | 2.3、2.9、2.11 |
| M-10.1.4-01 | 10.1.4 / 45 | shall | optional | C-T-51 | 1.1、2.12 |
| M-10.1.1-01 | 10.1.1 / 44 | shall | required | C-T-49 | 1.1、2.3、2.11 |
| M-10.1.1-02 | 10.1.1 / 44 | shall | required | C-T-49 | 1.1、2.3、2.11 |
| M-10.1.2-01 | 10.1.2 / 44 | shall | required | C-T-48 | 1.1、2.3、2.11 |
| M-9.2.7-02 | 9.2.7 / 42 | shall | required | C-T-48 | 2.11 |
| M-10.1.2-02 | 10.1.2 / 45 | shall | required | C-T-48 | 2.3、2.11 |
| M-10.1.2-03 | 10.1.2 / 44 | shall | required | C-T-48 | 2.3、2.11 |
| M-10.1.2-04 | 10.1.2 / 44 | shall | required | C-T-25 | 2.3、2.8、2.11 |
| M-10.1.6-01 | 10.1.6 / 47 | shall | required | C-T-53 | 2.3、2.10、2.11 |
| M-10.1.3-01 | 10.1.3 / 45 | shall | required | C-T-50 | 2.3、2.11 |
| M-10.1.3-02 | 10.1.3 / 45 | shall | required | C-T-50 | 2.3、2.11 |
| M-9.2.6-03 | 9.2.6 / 42 | shall | required | C-T-45 | 2.3、2.9、2.11 |
| M-10.1.1-03 | 10.1.1 / 44 | shall | required | C-T-55 | 1.1、2.3、2.11 |
| M-10.1.5-01 | 10.1.5 / 46 | shall | required（原 not-applicable） | C-T-52 | 1.1、2.11、8 |
| M-10.1.1-04 | 10.1.1 / 44 | shall | required（原 not-applicable） | C-T-51 | 1.1、2.11、8 |
| M-6.2.3-11 | 6.2.3 / 21 | shall | required | C-T-06 | 2.3、2.6 |
| M-10.1.4-03 | 10.1.4 / 45 | shall | optional | C-T-51 | 2.12 |
| M-10.1.4-04 | 10.1.4 / 45 | shall | optional | C-T-51 | 2.12 |
| M-10.1.4-05 | 10.1.4 / 45 | shall | optional | C-T-51 | 2.12 |
| M-10.1.5-02 | 10.1.5 / 46 | shall | optional | C-T-52 | 2.4 |
| M-10.1.6-02 | 10.1.6 / 47 | shall | required | C-T-53 | 2.10 |
| M-4.4.2.3.2-01 | 4.4.2.3.2 / 10 | shall | required | C-T-54 | 2.10 |
| M-4.5.3.1-01 | 4.5.3.1 / 12 | shall | required | C-T-53 | 2.10 |
| M-4.5.3.1-02 | 4.5.3.1 / 12 | shall | required | C-T-53 | 2.10 |
| M-4.5.3.1-03 | 4.5.3.1 / 12 | shall | required | C-T-54 | 2.10 |
| M-4.5.3.1-04 | 4.5.3.1 / 12 | shall | required | C-T-54 | 2.10 |
| M-4.5.3.1-05 | 4.5.3.1 / 12 | shall | required | C-T-54 | 2.10 |
| M-4.5.3.1-06 | 4.5.3.1 / 12 | shall | required | C-T-54 | 2.10 |
| M-4.5.3.3-02 | 4.5.3.3 / 13 | shall | required | C-T-56 | 2.10 |
| M-10.2-01 | 10.2 / 49 | shall | required（原 not-applicable） | C-T-54 | 1.1、2.3、8 |
| M-10.2-02 | 10.2 / 49 | shall | required（原 not-applicable） | C-T-54 | 1.1、2.3、8 |
| M-10.1.7-01 | 10.1.7 / 48 | shall | required（原 not-applicable） | C-T-54 | 1.1、2.3、8 |
| M-10.1.8-01 | 10.1.8 / 48 | shall | required | C-T-55 | 2.3 |
| M-10.1.9-01 | 10.1.9 / 48 | shall | required | C-T-56 | 2.3 |
| M-10.1.9-02 | 10.1.9 / 48 | shall | required | C-T-56 | 2.3 |
<!--COVERAGE-C-END-->
