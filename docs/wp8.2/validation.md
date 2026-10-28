# WP8.2 验收记录

本文件由 T2.6 汇总最终验收；以下按任务追加各自的记录。

## T2.4a-1：骨架、公共部分与输出边界（基线 `5e25430`）

### 输出边界基线的变化（设计 §1.3.5、§6.3）

`outputBoundary.ts` 对 XML46687 不再与旧 XML 完全相同：各领域的放行项登记在 `renderers/xml46687Parts/<域>.ts` 的 `XML46687_*_BOUNDARY` 常量里，
`renderers/xml46687Boundary.ts` 汇总成 `XML46687_DECLARED_DIFFERENCES`（导出自 `@ses/shared`）。所有“XML46687 与 XML 的差别”改为**计算值**：

- 差集（XML 阻断而 XML46687 放行的问题）里每一条必须落在某个已声明差异内，XML46687 不得比 XML 多阻断；
- 已声明的差异必须被真正触发（新增放行而不登记、或登记了却没有真正放行，都会使测试失败）。

受影响且已改写的测试：shared `outputBoundaryXml46687.test.ts`（差异集合断言、逐项正例、仍阻断清单、两处陷阱回归）、`wp8mG1.test.ts`、`wp8mG6.test.ts`、
`xml46687.contract.test.ts`（占位用例改为真实管线断言）；client `wp8mIntegration.test.ts`、`wp8mG1.test.ts`、`wp8mG6.test.ts`、
`wp8mPersistence.acceptance.test.ts`（opt-in 验收，基线“XML−XML46687=2”改为“等于被声明差异覆盖的问题数”）。
T2.4b/T2.4c 之后再放行字段，这几处无需再改。

### 实测数字（WP8.M 全要素 IR，`createWp8mIrDoc()`）

| 格式 | 问题数 | 说明 |
|---|---|---|
| HTML | 15 | 与 WP8.M 验收一致（图例、图中示例、行内图、列宽、单元格样式、资源） |
| DOCX | 15 | 同上 |
| XML（旧） | 33 | 含 2 个罗马列项（旧序列化器降为阿拉伯数字，故阻断） |
| XML46687 | 24 | T2.4a-1 之后；T2.4b/T2.4c 放行后继续减少 |
| 差集 | 9 | = 引言条 `front.introductionClauses` 1 + `stdRef`/`mixedCitation` 的 mark 类型 6 + 罗马列项 2；全部在 `XML46687_DECLARED_DIFFERENCES` 内 |

opt-in 的真实 API/SQLite 保存重开验收（`wp8mPersistence.acceptance.test.ts`，需要 `WP8M_API_URL`/`WP8M_EVIDENCE_FILE`）**本任务没有运行**：
只改了它的边界断言（上述计算值），断言逻辑与 `wp8mIntegration.test.ts` 同构且已在后者中运行；真实验收留给 T2.6/WP8.4 一并执行。

### 黄金样例与外部校验

- 骨架夹具（`renderers/__tests__/xml46687SkeletonFixture.ts`，元数据、前言/引言/引言条、章/条/无标题条/附录、行内标记与引用、脚注、外链、
  列项、注/示例/警告/摘录/代码）的 XML 文件快照：`renderers/__tests__/__snapshots__/xml46687.skeleton.xml`；
  `python3 -I scripts/xml46687/validate.py --json --profile export` 对它 `valid:true`、`errors:[]`，warning 恰为引言条“导入暂拒”的三条
  （`W-IMPL-REJECT`，M-4.3.4-02/03 的 import 仍为 reject，WP8.3 改 accept）；`sts_compat.py` 零未解释偏差。
- `fullRendererFixture()` 含表、图、公式、术语与参考文献，T2.4a-1 的领域桩无法导出，它的 XML 黄金样例留给 T2.6（`xml46687.stubs.test.ts` 钉住“当前不能导出”）。
- 外部校验辅助 `pythonValidationAvailable()` / `shouldSkipValidation()`（`xml46687PythonValidation.ts`）：缺 python3/lxml/xmllint 时跳过并打印提示；
  `REQUIRE_XML_VALIDATION=1` 时缺环境即失败（验收命令固定带该变量）。

### 矩阵覆盖断言骨架

`wp82MatrixCoverage.test.ts`：强制开关 `ENFORCE_COVERAGE` 为 `false`，只报告缺口（T2.4a-1 结束时需覆盖 186 行、已引用 84 行；缺的 102 行全属 T2.4b/T2.4c 的域，
以及少数跨域行）；恒强制“标题里出现的矩阵 id 都存在于矩阵”。T2.6 把开关改为 `true`。

## T2.4b：表、图、公式与 MathML 解析器（`4f3f901`…`569bc55`）

- 实现：`xml46687Parts/{tables,figures,formulas,mathml}.ts`（设计 §2.6～§2.8、§4.5）及各自 `XML46687_<域>_BOUNDARY`（含 `declared`）。放行的字段：表（`table.columns/unit/width/style`、`row.style`、`cell.style/cellType/width/unit/columnWidths`）、图（`figure.resourceId/descriptions/unit/alt/title/imageWidth/imageHeight/legend/examples`、行内图 `image`、`doc.resources`）、公式（`formula.mathml/notes`、行内公式 `mathml/source`）；`figure.groups` 与行内 `style` 保持阻断。
- 域测试：`xml46687.{tables,figures,formulas,mathml}.test.ts`（57 + 33 + 35 + 40 项），每个映射行至少一条、每个 error 码至少一条反例；边界测试 `outputBoundaryXml46687.{tables,figures,formulas}.test.ts`（23 + 25 + 15 项：逐项正例、域内富文档差集恰等于声明集合、shape 登记探针、仍阻断项）。已改的既有测试：shared `wp8mG3Boundary.test.ts`、`wp8mG8Boundary.test.ts`、`wp8mResolverBoundary.test.ts`（XML46687 放行、旧 XML/HTML/DOCX 仍阻断，旧断言保留）。
- 域黄金样例：`__snapshots__/xml46687.{tables,figures,formulas}.xml`；三份均 `validate.py --profile export` `valid:true`、`errors:[]`、`warnings:[]`；含公式的样例 `sts_compat.py` 退出码 0（零未解释偏差）。
- 检查点 4 补充：空行（`rows` 为空或全是表头行）报 error `xml-table-empty`；MathML 解析器加鲁棒性回归（命名实体、`on*`、非 MathML 命名空间、`annotation` 去除）。

## T2.4c：术语、规范性引用文件、参考文献、索引、缩略语（`7ef3c5f`…`f494b07`）

- 实现：`xml46687Parts/{terms,refs}.ts`（设计 §1.2、§2.9～§2.12）及边界放行。G5 `subjectField` 四种情形 + marks 情形的问题码：`term-subjectfield-duplicate`/`-promoted`/`-conflict`（error）、`mark-dropped-in-text-only`；`nestedEntries` 保持阻断。
- 域测试：`xml46687.terms.test.ts`（60 项）、`xml46687.refs.test.ts`（53 项，含 T2.4c-2 新增）；边界测试 `outputBoundaryXml46687.{terms,refs}.test.ts`（15 + 18 项）。已改的既有测试：shared `wp8mG1.test.ts`（`normRefList`/`bibliographyTitle` 现对 XML46687 放行、旧 XML 仍阻断）、`wp8mG2Boundary.test.ts`、`wp8mG5Boundary.test.ts`，client `wp8mG1.test.ts`。
- 域黄金样例：`__snapshots__/xml46687.{terms,refs}.xml`；`validate.py --profile export` 零错误，`sts_compat.py` 零未解释偏差。

## T2.4c-2：`normref-unstructured` 与 `citation` 容器内的条文脚注（`0ca4eac`、`374b821`）

主导决定 2026-10-27：①未结构化的规范性引用文件章（`norm-refs` 章没有 `normRefList` 且除子条外块数 ≥ 2）按 `p` 输出并报 warning `normref-unstructured`，单个引导段不报；
②`citation` 容器（`mixed-citation` 内，含规范性引用与参考文献条目）允许条文脚注（`xref[fn]` 紧随 `fn`，与 `p` 同规则），`std` 条目的 `std-ref`/`title` 里仍无合法位置，报 `xml-footnote-position`。
错误/警告码联合 73 → 74（契约测试同步）。`validate.py` export/import 档零错误，`sts_compat.py` 零偏差。T2.6 顺带把 `context.ts` 里 `InlineContainer` 的过期注释（“脚注只写在 `p` 内”）改为 `p` 与 `citation`（仅注释）。

## T2.4a-2：嵌套有序列项按显示形态导出（`f1418ae`）

二层 alpha/roman 与三层及以下的有序列项在 HTML/DOCX 中显示为间隔号“·”（D-M-17），没有标记；XML 与显示一致：整个列表的列项都没有标记时导出为 `list[@list-type="bullet"]`、列项不写 `label`，并报 warning `list-type-normalized`（按类聚合）。Resolver 不改。WP8.2 全要素夹具的 `w82-list-inner-alpha` 钉住这一行为。

## T2.5：准备层与资源包（`71cce04`…`20d0e92`）

- `packages/io`：`formulaMathMl.ts`（LaTeX → MathML，KaTeX `0.16.44`；`formulaOmml.ts` 提取后行为不变）、`xml46687Resources.ts`（`collectXml46687Resources`，与渲染器共用 `collectXml46687ImageRefs`）、`xml46687Package.ts`（`buildXml46687Package`、`packageXml46687`）。测试：`formulaMathMl.test.ts` 16 项、`xml46687Resources.test.ts` 31 项、`xml46687Package.test.ts` 23 项、`xml46687Package.wiring.test.ts` 9 项；`manifest.json` 里 `dataUrl` 条目的 `key` 为固定占位 `data:<mediaType>;base64,…`（不带数据）。
- 依赖与 lockfile 零变化；`io/src/exportGuard.ts` 未动（`xml` 仍映射旧 `XML` 边界，WP8.4 切换）；UI 未接入。
- 真实渲染器的端到端（`validate.py`、`xlink:href` 与清单一一对应）由 T2.6 的 `xml46687Package.e2e.test.ts` 完成，见下节。

## T2.6：全要素黄金样例、外部校验、语义检查与验收

### 夹具

- **WP8.2 全要素夹具**（`xml46687Wp82Fixture.ts`，手写 `IRDoc`，不经 PM）：命中每个 `shall`/`should` 且 `export≠not-applicable` 的矩阵行（186 行，见“矩阵覆盖”）；元数据完整（两个发布机构、语言、发布/实施日期等）；公式只给真实 LaTeX（两处同时带 IR 自己的 `mathml`，验证“IR 优先”），图片是真实 PNG/SVG data URL，块图与行内图都含“资源键”与“内联 data URL”两种来源。shared 测试用确定性桩：`stubMathMlFor`（每个公式一个最小 MathML）+ `stubManifest`（`collectXml46687ImageRefs` 生成的假清单）。
- **派生夹具**（`xml46687GoldenFixtures.ts`，纯函数、返回深拷贝；字节锁定的 `fixtures.ts`、`wp6.ts` 未动；主导已定处置，渲染器规则未改）：

| 夹具 | 改写步骤（`skip` 可复现原始不可导出点） | 原样导出的结果 |
|---|---|---|
| `fullRendererFixture()` 经 `pmToIr` | `meta`：补内容语言 | 缺内容语言为 warning `meta-required-missing`，其余可直接导出 |
| WP8.M `createWp8mIrDoc()` | `split-crossref-stdref`：拆开 `g1-ch3-p2` 的 crossRef+stdRef run | error `xml-mark-combination` |
| | `move-cell-note`：`g7-t1-note` 单元格注改为表注 | error `xml-cell-content`（schema `cm.cell-content` 只允许 p/list） |
| | `move-appendix-term`：`g5-t-app` 附录术语移入术语章 | error `xml-term-outside-terms`（WP8.1 V-2、C-S-25、C-T-37；依据 9.1） |
| | `meta`：补题名与 SES 四项 | 缺题名 error `meta-required-missing`，缺四项为同码 warning |
| WP6 `createWp6Fixture()` 经 `pmToIr` | `figure-groups`、`inline-style`：去掉 `figure.groups` 与行内 `style` | `unsupported-output`（输出边界永久阻断） |
| | `part-of-speech`：`名词` → `noun` | error `xml-descriptor-value`（D-X-14） |
| | `mathml-namespace`：行内/行间公式 `<math>` 补 MathML 命名空间 | error `mathml-invalid`（设计 §4.5） |
| | `move-term`：普通章里的 `term-main` 移入新增术语章 | error `xml-term-outside-terms`，连带 `xml-block-after-subsec`、`xml-rid-unresolved` |
| | `cell-unit`：去掉非表头单元格的 `unit` | error `cell-unit-unsupported`（D-X-03） |
| | `meta`：补发布/实施日期 | 缺日期为 warning |

  每一步在 `xml46687.goldenSamples.test.ts` 的“原始夹具的不可导出点”一节各有一条反例，钉住上表右列的错误码与节点。

### 黄金样例（`xml46687.goldenSamples.test.ts`，37 项）

文件快照 `__snapshots__/xml46687.{wp82,fullRenderer,wp8m,wp6}.xml`（715 / 272 / 582 / 194 行）。四份均：`validate.py --json --profile export` `valid:true`、`errors:[]`；import 档零错误；`sts_compat.py` 退出码 0、未解释偏差 0 个（已知偏差均在白名单内：wp82 4 个〔3 条白名单〕、fullRenderer 3 个〔2〕、wp8m 2 个〔1〕、wp6 2 个〔1〕）；Resolver 无 error。
`validate.py` 的 warning：wp82、wp8m 各 5 条 `W-IMPL-REJECT`（引言中的条“格式上合法，但导入暂拒”，M-4.3.4-02/03 的 import 仍为 reject，WP8.3 改 accept）；fullRenderer、wp6 为空。
渲染器问题集合（逐条断言，防止告警悄悄增多；均无 error）：

| 样例 | 渲染器问题（严重度 码 节点） |
|---|---|
| wp82 | info `meta-not-expressed`；warning `term-subjectfield-promoted` w82-term-2；info `term-language-merged` w82-ls-3a；warning `term-subjectfield-duplicate` w82-ls-3a.v0.d0；warning `mark-dropped-in-text-only` w82-term-4；warning `term-descriptor-missing` w82-term-1；warning `list-type-normalized` w82-list-inner-alpha |
| fullRenderer | info `meta-not-expressed`；warning `caption-en-not-expressed` ×2（tbl-1、fig-1）；warning `term-descriptor-missing` term-1 |
| wp8m | info `meta-not-expressed`；warning `mark-dropped-in-text-only` g5-t332；warning `figure-attr-not-expressed` g3-scope-p；warning `term-descriptor-missing` g5-t1 |
| wp6 | 23 条：`meta-not-expressed`（标准类型 info、标识符组成部分 warning）、`variable-attr-not-expressed`、`link-attr-not-expressed` ×7（正文外链 3 + 文献外链 4）、`code-language-not-expressed`、`term-language-merged`（info）、`term-subjectfield-promoted`、`bib-std-incomplete`、`index-seealso-not-expressed`、`table-width-not-expressed`、`table-style-not-expressed`、`cell-attr-not-expressed`（info）、`px-width-ignored`（info）、`figure-attr-not-expressed`、`term-descriptor-missing`、`term-descriptor-not-expressed`、`bib-field-not-expressed` |

### 幂等与不变（`xml46687.invariance.test.ts`，21 项，设计 §7.3）

对四份样例：①连续两次渲染逐字节相同，`exportXml46687` 与 `renderXml46687` 一致；②`doc`/`labels`/`options` 渲染前后 `JSON.stringify` 相等，递归 `Object.freeze` 的副本渲染不抛错且输出相同；③打乱 `options.mathml`、`labels` 的键序和 `resources.entries` 的元素序（及条目键序，固定种子的 Fisher-Yates，并断言确实改变了顺序）后输出不变；④`XmlDocument` 经 JSON 往返无损，往返后写出的文本与原输出逐字节相同。

### 语义检查（`xml46687.semantic.test.ts`，55 项，设计 §7.5）

由 `xml46687SemanticKit.ts` 的最小 XML 解析器从**写出的文本**重新解析后**独立复算**，不复用渲染器的检查函数；对四份样例逐项断言：id 唯一；`xref/@rid` 与 `tbx:entailedTerm/@target` 全部可解析且为单个标识符；无 `ext_` 占位、无 `tex-math`/`alternatives`/`annotation`、无 DOCTYPE；XML 声明在首行，根只声明 `mml`/`tbx`/`xlink` 且无默认命名空间；根的子元素次序与 `std-meta` 子元素次序（V-12）；必备 id（V-13 清单：有 label 的 `sec`、`app`、`term-sec`、`tbx:termEntry`、参考文献 `ref-list` 与 `ref`、`index`、有 label 的 `table-wrap`、`fig`、有 label 的 `disp-formula`、各类 `fn`）；仅被引用才有 id（`non-normative-note`/`non-normative-example`/`list-item`/`def-item`/`tbx:note` 有 id 必被引用，WP8.2 夹具对每类各有被引用/未被引用一对）；资源可定位（每个 `graphic`/`inline-graphic` 的 `href` 在清单中恰好一条、清单条目都被使用、`fileName` 唯一）；日期是真实日历日且发布不晚于实施；`mml:math` 根 id 为 `mml_m1…mml_mN` 连续（行间行内合并计数），行间带 `display="block"`、行内不带；`label` 内无 `bold`；列项 `label` 只在有序列表中。另有：WP8.2 夹具每种 `xref` 类型至少一次；故意破坏 id/rid（悬空 rid、重复 id）时 TS 复算与 `validate.py` 的 V-1 都报错；日期语义的正反例（真实日历日含闰日通过；`2026-02-30` 等非法日期 error `xml-date-invalid`；发布晚于实施 warning `meta-date-order`）。

### io 端到端（`packages/io/src/xml46687Package.e2e.test.ts`，6 项）

WP8.2 全要素夹具（经 `irToPm` 变成生产 PM JSON，再走 `buildXml46687Package`）：真实 KaTeX 转换（`msup`/`mfrac`/`msqrt`，无 `annotation`/`tex-math`）→ 真实渲染 → 无 error → 打包 → 解包：`standard.xml`、`manifest.json`、`resources/<fileName>` 三类条目；`validate.py --profile export` `valid:true`、`errors:[]`（warning 仅引言条 `W-IMPL-REJECT`），`sts_compat.py` 零未解释偏差；`manifest.json` 的条目与 XML 里每个 `xlink:href` 一一对应（共 8 个：fig_1、fig_2、fig_3、fig_A.1 与 inl_1…inl_4；`resource` 与 `dataUrl` 两种来源，`dataUrl` 条目的 `key` 为占位 `data:<mediaType>;base64,…`），`resources/` 下恰好这些文件；同输入两次打包字节逐一相同。外部校验辅助 `packages/io/src/xml46687PythonValidation.ts`（与 shared 同口径各放一份）。
生产 PM 不能表示夹具里的两处（`bold`+`code` 同一 run、列项内嵌套列表，`irToPm` 报 `IRToPmError`），端到端用去掉这两处的变体 `createWp82PmRepresentableDoc()`（其余内容原样）。

### 矩阵覆盖

`wp82MatrixCoverage.test.ts` 的 `ENFORCE_COVERAGE` 改为 `true`：**需覆盖 186 行，已引用 186 行，缺 0 行**；补了最后一行 M-5.6-06（表注、图注、公式注：`xml46687.blocks.test.ts`）。`may`/示例性行（`export≠not-applicable`）136 行，未引用 48 行，仅报告（D-X-20）。

### 输出边界基线（`getOutputSupportProblems`，T2.6 实测）

| 夹具 | HTML | DOCX | XML（旧） | XML46687 |
|---|---|---|---|---|
| `createWp8mIrDoc()` | 15 | 15 | 33 | 0（T2.4a-1 时为 24） |
| `createWp6Fixture()` 经 `pmToIr` | 58 | 54 | 59 | 2（`figure.groups`、行内 `style`，永久阻断） |
| `fullRendererFixture()` 经 `pmToIr` | 0 | 0 | 0 | 0 |
| WP8.2 全要素夹具 | 50 | 50 | 66 | 0 |

### 全部必跑命令（`REQUIRE_XML_VALIDATION=1` 用于 shared、io）

| 命令 | 结果 |
|---|---|
| `REQUIRE_XML_VALIDATION=1 pnpm --filter @ses/shared test` | 115 个文件、2896 项全部通过（设计基线 89 个文件、2102 项） |
| `pnpm --filter @ses/shared exec tsc --noEmit` | 无输出（通过） |
| `REQUIRE_XML_VALIDATION=1 pnpm --filter @ses/io test` | 30 个文件、448 项全部通过（设计基线 25 个文件、363 项）；`pnpm --filter @ses/io exec tsc --noEmit` 通过 |
| `pnpm --filter @ses/client exec vitest run --maxWorkers=2` | 114 个文件通过、2 个跳过（opt-in 的保存重开验收），1421 项通过、2 项跳过 |
| `pnpm --filter @ses/client build` | 通过 |
| `cd packages/server && NODE_OPTIONS=--experimental-vm-modules npx jest --runInBand` | 21 个套件、762 项全部通过 |
| `python3 scripts/xml46687/test_validate.py` | 259 项 OK |
| `python3 -I scripts/xml46687/matrix_coverage.py` | 退出码 0（导出档强制核对：289 个单元，105 个探针全部真实运行） |

`package.json` 与 lockfile 零变化；JSON golden、DOCX 快照零变化；没有修改渲染器规则（本任务未发现渲染器缺陷）。

### 已知限制

1. **附录中的术语条目**保持 error `xml-term-outside-terms`（WP8.1 V-2、C-S-25、C-T-37；依据 9.1）；WP8.M 夹具的 `g5-t-app` 只能在派生夹具里移入术语章。
2. **表格单元格内的注**保持 error `xml-cell-content`（schema `cm.cell-content` 只允许 `p`/`list`）；派生夹具改为表注。
3. **同一 run 同时带 `crossRef` 与 `stdRef`** 保持 error `xml-mark-combination`（`xref` 与 `std` 在 schema 中互不包含）。
4. **嵌套有序列项按显示形态导出**：二层 alpha/roman 与三层及以下的有序列项导出为 `bullet`（warning `list-type-normalized`），与 HTML/DOCX 的显示一致，往返后不再是有序列表；Resolver 不改。
5. **D-X-02**：发布机构、内容语言、发布日期、实施日期缺失只是 warning（题名缺失仍是 error），导出继续并省略对应元素。实测（T2.6）`validate.py --profile export` 目前并不要求这四项，缺失时仍判 `valid:true`；设计预期的“输出可能通不过 `validate.py`”取决于校验脚本以后是否收紧。黄金样例与验收夹具必须补齐这四项。
6. **未接 UI**：`io/src/exportGuard.ts` 仍把 `xml` 映射到旧 `XML` 边界，导出对话框与服务端未接入 `buildXml46687Package`；旧 XML 实现（`client/src/serializer/xmlSerializer.ts`）在 WP8.4 删除。
7. **WP8.3 导入未做**：本阶段没有导入器，往返（导入再导出）测试留给 WP8.3；`M-4.3.4-02/-03`（引言条）的 `import` 仍为 `reject`（`W-IMPL-REJECT`），WP8.3 改 `accept`。
8. **生产 PM 的表示限制**（与渲染器无关）：`code` 标记排斥其他行内标记、`stdList` 不支持嵌套列表，所以这两类 IR 只能手写（WP8.2 全要素夹具有，io 端到端用去掉它们的变体）。
9. **opt-in 的真实 API/SQLite 保存重开验收**（`wp8mPersistence.acceptance.test.ts`，需 `WP8M_API_URL`/`WP8M_EVIDENCE_FILE` 与服务端重启）本任务没有运行，留给 WP8.4 一并执行。
