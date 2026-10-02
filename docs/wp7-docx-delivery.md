# WP7 系列：DOCX 交付稿（从零生成）实施规格书

> **使用方式**：本文件是 WP7.1–WP7.6 的实施规格，供执行开发的模型直接遵循。接口、约束与验收标准均已定稿，
> **执行时不要更改本文件定义的接口与约束**；发现矛盾或缺漏时停下来向主导人报告，不要自行决定。
> 每个工作包一个分支（`feat/wp7.<N>-<slug>`）、一个 PR，PR 描述含「验收标准逐项自查表」。
>
> **查证优先级**：GB/T 1.1-2020 原件（`rules/` 下 PDF，方正书版字体，必须以图像方式阅读；物理页 = 印刷页 + 7）
> ＞ 本文件的实测数据 ＞ `docs/dev-plan-phase-5.5.md`「GB/T 1.1-2020 版式规范（定稿）」＞ 任何模型记忆。
>
> **机制实测**：`spike/wp7-docx-word/`（Word for Mac 16.113，2026-09-24）。其中 `gen_spike.py` 的 XML 写法
> 已被 Word 接受并正确渲染，实现时可直接参照。
>
> **2026-09-30 后续决策**：废除 LibreOffice 的 DOCX → PDF 转换预览及安装引导，只保留 Vivliostyle PDF 版式预览；下文“两张 PDF 卡片”和 LibreOffice 验收记录为历史实施记录，不再是当前产品要求。
>
> **修订记录**：2026-09-25 对照代码现状细化 WP7.1（标准类型的两套取值、导出面板与首页入口、shared 骨架接口），
> 新增 §10.2 测试基建、§10.3 核对工具。
> 2026-09-25（二）对照代码与 Word 实测（spike v10）细化 WP7.2：WP7.2 扩为「结构渲染」（§5 中除图表公式本体、
> 目次域、终结线外的全部要素），WP7.3 相应收窄；§4.3 按 Word 的实际计数模型改写实例分配；条的编号级别改取嵌套深度；
> 编号段落的缩进统一写在编号级别；术语条目内容顺序按 8.7.3.1 改正；§4.7 写明模拟器模型与逐段比对方法；
> §10.2/§10.3 补大纲、`r:id` 检查、编号完整性检查与 `expect.py`。
> 2026-09-25（三）#34 审查：§4.7 新增「遍历顺序」——DOCX 输出顺序须与 Resolver 遍历顺序一致，Resolver 的图、术语条目
> 两处遍历顺序改为文档顺序（WP7.2 实施）。
> 2026-09-28 WP7.3 开工前 Word 实测与主导人取舍：原生目次域更新后改变章条编号间距和附录行格式，
> 与 GB/T 1.1-2020 10.3.2 的明确要求冲突；本包改为固定目次条目 + `PAGEREF` 自动页码。
> DOCX 测试版先开放，图、表、公式继续显示占位段；本包只在 Word 验收，WPS 核对待取得环境后再做。

---

## 0. 已定决策（2026-09-24）

| # | 决策 |
|---|---|
| D0 | **交付稿为 DOCX，PDF 仅供参考**。两张 PDF 卡片保留，停止在 PDF 版式上投入 |
| D1 | **DOCX 从零生成，不使用任何模板文件**。仓库中的 `.dotx` 来自第三方编写工具的安装包，只能作格式对照：不得随产品分发，不得整段复制其 `styles.xml`/`numbering.xml` |
| D2 | **编号原则「可编辑优先」**：能用 Word 原生编号的就用原生编号（收稿方增删章条后自动更新），实测不行的才写死 Resolver 的编号；原生编号必须通过 §4.7 一致性测试与 Resolver 逐个对齐 |
| D3 | **现有 DOCX 导出直接删除**（WP7.1 第一步），不与新生成器并行。空档期内 DOCX 卡片与「高保真 PDF」卡片禁用 |
| D4 | **公式**：client 新增依赖 `mathml2omml@0.5.0`（LGPL-3.0-or-later，锁版本）；KaTeX（已有）出 MathML，在 client 转成 OMML 后注入 shared 渲染器 |
| D5 | **验收以 Word + WPS 实际渲染为准**。主导人本机只有 Word（无 WPS），WPS 核对需另备环境（§10） |
| D6（2026-09-28） | **目次条目优先符合 10.3.2**：由渲染器生成条目文字和内部跳转书签，用 `PAGEREF` 域计算页码；收稿方在 Word 中增删章条后，须重新导出或手动调整条目。Word 原生目录更新会改变编号后的一个汉字间隙、在附录性质前插空格，故本包不用原生 `TOC` 域。D2 的章条原生编号原则不变 |

---

## 1. 架构与接口

### 1.1 数据流

```
Tiptap/PM JSON ──pmToIr──▶ IRDoc ──resolve──▶ (doc, labels)
                                                   │
             宿主（client；将来 server）准备资源：图片字节、公式 OMML
                                                   │
                         renderDocx(doc, labels, opts) ──▶ DocxPackage（纯数据）
                                                   │
                           宿主用 JSZip 打包 ──▶ Blob / Buffer
```

### 1.2 模块布局（`packages/shared/src/renderers/docx/`）

| 文件 | 职责 |
|---|---|
| `index.ts` | `renderDocx` 入口（= `renderDocxTraced(...).pkg`）与 `DocxRenderOptions`/`DocxPackage` 类型导出；WP7.2 起由 `renderers/index.ts` 导出 |
| `render.ts` | `renderDocxTraced`：组装全部部件，并返回带编号段落与 IR 节点的对应（§4.7，测试用；不经 `index.ts` 导出） |
| `units.ts` | mm→twips（×1440/25.4）、磅→半磅、mm→EMU（×36000）、汉字宽（五号 = 210 twips） |
| `xml.ts` | 转义；按 ECMA-376 固定子元素顺序拼 `pPr`/`rPr`/`sectPr`/`lvl`（附录 B），顺序错误 Word 会报「无法读取的内容」 |
| `styles.ts` | §3 样式表（数据）→ `word/styles.xml` |
| `numbering.ts` | §4 编号定义 + 实例分配器 → `word/numbering.xml` |
| `sections.ts` | §2 分节、`sectPr`、分节空段、页眉页脚部件 |
| `cover.ts` | §6 封面（6 类）；WP7.2 为占位，只有文件编号段 |
| `toc.ts` | §7 固定目次条目、目标书签及自动页码域（WP7.3） |
| `body/*.ts` | §5 各要素渲染（章条、术语、列项、注、示例、图、表、公式、附录、参考文献、行内）；按文件怎么拆由实施方定 |
| `package.ts` | `[Content_Types].xml`、`_rels/.rels`、`word/_rels/document.xml.rels`、`settings.xml`、`fontTable.xml`、`docProps/core.xml`、`docProps/app.xml` |
| `assets.ts` | 内置封面素材（base64 字符串常量，§6.4） |

### 1.3 接口（定稿）

```ts
export interface DocxRenderOptions {
  /** 公式 OMML：key = IRFormula.id，值以 <m:oMath 开头。缺失时降级为 LaTeX 源码文本并记 warning */
  formulaOmml: Record<NodeId, string>
  /** 图片：key = IRFigure.id。宿主负责把 src（dataURL 或资源 key）解析成字节 */
  images: Record<NodeId, { base64: string; contentType: 'image/png' | 'image/jpeg' | 'image/gif'; widthPx: number; heightPx: number; dpi?: number }>
  /** 文档阶段（决定封面阶段标识与专利征集说明，§6.3） */
  stage: DocumentStage
  /** 写入 docProps/core.xml 的时间（ISO），由宿主传入以保证字节级确定性 */
  createdAt: string
}

export interface DocxPackage {
  /** 包内路径 → XML 文本 */
  parts: Record<string, string>
  /** 包内路径 → base64（word/media/*） */
  binaries: Record<string, string>
  /** 降级与告警：formula-missing-omml / image-missing / cover-field-missing / list-format-fallback … */
  warnings: { code: string; nodeId?: NodeId; message: string }[]
}

export function renderDocx(doc: IRDoc, labels: Record<NodeId, ResolvedLabel>, opts: DocxRenderOptions): DocxPackage
```

`DocumentStage` 复用 `packages/shared/src/types` 中已有的类型。`renderDocx` 不接收 `ResolveResult.bibliographyOrder`，
参考文献的顺序从 `labels` 还原（§5.12）。

### 1.4 全局不变式对 DOCX 的适用（修订 dev-plan 1.1）

1. **不变式 1 保持**：shared 的 DOCX 渲染器不 fetch、不运行 KaTeX、不接触 Blob/JSZip。图片字节与公式 OMML 由宿主注入。
2. **不变式 2 修订**：编号的**计算与校验**只在 Resolver。DOCX 中章、条、无标题条、术语条目、附录、图、表、注、示例、列项、参考文献的编号以 Word 原生编号输出；**公式编号与交叉引用文字**写 Resolver 的 `label`/`refText`。原生编号必须通过 §4.7 一致性测试。
3. **不变式 3 修订**：DOCX 渲染器返回 `DocxPackage`（纯数据，可 JSON 往返），同一输入字节级同一输出；时间只取 `opts.createdAt`。
4. **不变式 4 保持**。
5. **不变式 5**：本系列唯一新增依赖是 client 的 `mathml2omml@0.5.0`；shared 零新增依赖；删除 client 的 `docx` 依赖（仅旧导出器使用）。`jszip` 已在 client，保留。

---

## 2. 页面、分节与页眉页脚（实测定稿）

### 2.1 页面参数

| 项 | OOXML | 值 | 依据 / 实测 |
|---|---|---|---|
| 纸张 | `pgSz` | w=11906 h=16838（A4） | 10.1.1 |
| 镜像页边距 | settings `<w:mirrorMargins/>` | 开 | 图 E.1/E.2 单双数页左右互换 |
| 上边距 | `pgMar top` | 1928（34 mm） | 书眉下 5 mm 起版心；实测正文首行字顶 35.1 mm，原件 35.3 mm |
| 下边距 | `pgMar bottom` | 1417（25 mm） | 原件实测版心下沿约 272 mm |
| 内侧 / 外侧 | `pgMar left` / `right` | 1417（25 mm）/ 1134（20 mm） | 图 E.1/E.2（开启镜像后 left 即内侧） |
| 页眉距 | `pgMar header` | 1417（25 mm） | 实测书眉字顶 26.0 mm，原件 25.7 mm |
| 页脚距 | `pgMar footer` | 1134（20 mm） | 实测页码距纸底 20.7 mm，原件 20.7 mm |
| 装订线 | `pgMar gutter` | 0 | — |
| 文档网格 | `docGrid` | `type="lines" linePitch="312"` | 五号行距 15.6 磅，与原件行距一致 |

版心宽 = 11906 − 1417 − 1134 = **9355 twips（165 mm）**，版心中线 4677。

### 2.2 分节

| 节 | `w:type`（本节如何起页） | `pgNumType` | 页眉页脚引用 | 内容 |
|---|---|---|---|---|
| 封面 | `nextPage`（首节，取值不影响排版，见下） | 不写 | **不写**（首节无引用即无页眉页脚） | 封面（WP7.2 为占位：只有文件编号段） |
| 目次 | `oddPage` | `fmt="upperRoman" start="1"` | 四个部件 | 目次 |
| 前言 | `nextPage` | `fmt="upperRoman"`（续编，**必须显式写 fmt**） | 四个部件 | 前言 |
| 引言（有则） | `nextPage` | `fmt="upperRoman"` | 四个部件 | 引言 |
| 正文 | `oddPage` | `fmt="decimal" start="1"` | 四个部件 | 正文首页名称 + 各章 |
| 每个附录 | `nextPage` | `fmt="decimal"` | 四个部件 | 附录 |
| 参考文献（有则） | `nextPage` | `fmt="decimal"` | 四个部件 | 参考文献 + 终结线 |

- **`sectPr` 描述的是它所结束的那一节**：`w:type` 是这一节如何起页，`pgNumType` 是这一节的页码格式与是否重起。
  非末节的 `sectPr` 写在该节末尾**单独的分节空段**里：`<w:p><w:pPr><w:sectPr>…</w:sectPr></w:pPr></w:p>`（无 pStyle、
  无文字，与 `gen_spike.py` 的 `start_section` 相同；该节最后一个要素是表格时也照此处理）；最后一节的 `sectPr` 是 `w:body`
  的最后一个子元素。实现时维护「当前节属性」，开新节时先输出上一节的分节空段。spike v10：版心排满后紧接分节空段，
  不会多出空白页。
- 各节 `sectPr` 依次含：四个页眉页脚引用（封面节没有）、`type`、`pgSz`、`pgMar`（§2.1）、`pgNumType`（封面节没有）、
  `docGrid`；不写 `cols`。封面节的 `type` 写 `nextPage`（首节的 type 不影响排版，写死是为了输出确定）。
- **为什么前言、附录、参考文献要各起一节**：Word 在分页后的页首会吞掉段前距（`pageBreakBefore` 与手动分页符都会被吞），只有节的第一段保留段前距。这些标题「书眉下空 15 mm」只能靠分节实现（spike v6–v9）。
- 无目次时省略目次节，前言节改为 `oddPage` + `upperRoman start=1`。（IR 没有「不要目次」的开关，本系列总是输出目次节，这条留给以后。）
- `oddPage` 自动插入的空白页不印书眉页码，符合 10.1.4（spike 实测）。
- 横排节见 §5.15。

### 2.3 页眉页脚部件

| 部件 | 段落 | 内容 |
|---|---|---|
| `word/header1.xml`（单数页，`type="default"`） | 样式 `SesHeader`，`jc=right` | 域 `STYLEREF "SES_封面文件编号" \* MERGEFORMAT`，缓存结果 = 封面文件编号文字 |
| `word/header2.xml`（双数页，`type="even"`） | `SesHeader`，`jc=left` | 同上 |
| `word/footer1.xml`（单数页） | `SesFooter`，`jc=right`，`ind right=227`（4 mm） | 域 `PAGE` |
| `word/footer2.xml`（双数页） | `SesFooter`，`jc=left`，`ind left=227` | 域 `PAGE` |

- 书眉用 `STYLEREF` 而不是写死：收稿方改了封面文件编号，书眉自动跟着变（可编辑优先）。缓存结果必须写成正确的编号文字，不重算域的阅读器也能显示正确。
- 页码距外侧纸边 24 mm = 外侧边距 20 mm + 缩进 4 mm（图 E.1/E.2；实测 24.2 mm）。
- 缓存结果：STYLEREF 写 `meta.stdCode`（缺失写空串），PAGE 写「1」。Word 渲染（含导出 PDF）时重算这两个域，缓存值不影响
  Word 的显示（spike v10）。
- **封面必须有一个 `SesCoverStdNo` 段**，`meta.stdCode` 缺失时也要输出（空段）：文档里没有该样式的段落时，Word 书眉显示
  「错误!文档中没有指定样式的文字。」；空段则书眉空白（spike v10）。
- 页眉页脚部件中的段落直接写上表的 `jc`、`ind`（§3.1 的例外）。根元素 `w:hdr`/`w:ftr` 声明 `w`、`r` 两个前缀。
- 关系 ID：四个部件按 header1、header2、footer1、footer2 的顺序向 `createRelationshipIdAllocator()` 申请（即 rId1–rId4），
  styles、settings、fontTable、numbering 由 `buildPackage` 接着登记。作为 `relatedParts` 传入时，内容类型为
  `application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml` / `…footer+xml`，关系类型为
  `http://schemas.openxmlformats.org/officeDocument/2006/relationships/header` / `…/footer`。

### 2.4 settings.xml（按附录 B 顺序）

`<w:mirrorMargins/>`、`<w:defaultTabStop w:val="420"/>`、`<w:evenAndOddHeaders/>`、
`<w:characterSpacingControl w:val="compressPunctuation"/>`、`<w:updateFields w:val="true"/>`（§7）、
`<w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat>`、
`<m:mathPr><m:mathFont m:val="Cambria Math"/><m:dispDef/><m:smallFrac m:val="0"/><m:naryLim m:val="undOvr"/><m:intLim m:val="subSup"/></m:mathPr>`。

---

## 3. 样式表（格式的唯一数据源）

### 3.1 通用约定

- 样式 ID 用 ASCII（`Ses*`），中文名用 `SES_*`；全部 `w:customStyle="1"`、`w:qFormat`。**Word 另存时会按中文名重写样式 ID**，测试与后续逻辑不得依赖另存后的 ID。
- `SesNormal` 设为默认段落样式（`w:default="1"`），收稿方新写的段落自动带正文格式。
- 字体：
  - 宋体类：`rFonts ascii/hAnsi/cs="Times New Roman" eastAsia="宋体"`
  - 段和正文/附录无标题条正文：`rFonts ascii/hAnsi/cs/eastAsia` 均为 `"宋体"`；编号本身仍由编号级别指定字体。
  - 黑体类：`rFonts` 四个属性都为 `"黑体"`（章条编号数字也用黑体，表 F.1 #33）
- 字号（半磅 `w:sz`，同时写 `w:szCs`）：一号 52、小一 48、二号 44、小二 36、三号 32、四号 28、五号 21、小五 18、六号 15。
- 「空 N 个汉字」按五号计：1 字 = 210 twips（小五的注、示例、表格文字也按此计）。缩进一律写 twips，不写 `firstLineChars` 等字符单位属性（同 `gen_spike.py`）。
- 「上下各空一行 / 半行」用 `beforeLines/afterLines = 100/50`，并同时写 `before/after = 312/156`。
- 正文段落对齐文档网格（缺省）。**三号标题关闭网格**（`<w:snapToGrid w:val="0"/>`）并用固定 20 磅行距，否则三号字在网格上占两行、整体下移约 3 mm（spike v6）。
- 格式只写在样式里。段落上只允许写 `pStyle`、段落级 `numPr`、`tabs`（式中条目）、`keepNext`（§5.13）、`framePr`（封面）、`sectPr`；行内只允许写 `b/i/u/vertAlign`（来自 IR marks）与标题字距 `w:spacing`（§3.3）。公式编号 run 另显式写宋体，以覆盖 SesFormula 对 ASCII 的默认字体。例外：页眉页脚部件的段落按 §2.3 写 `jc`/`ind`；分节空段只有 `sectPr`（§2.2）。
- **带编号段落的缩进只写在编号级别的 `pPr/ind` 里**（§4.2），它们使用的样式不写 `ind`（§3.2 标「缩进见 Ax」的行）。样式与编号定义都写缩进时谁优先，ECMA-376 的规定与各软件的实现不尽一致（WPS 未验证），只写一处就没有歧义。
- 除 SesNormal 外，全部样式 `basedOn` SesNormal；SesNormal 不写 `ind`。标题类样式（SesChapter、SesClause*、SesAppendix、SesAppClause*、SesFrontTitle、SesBibTitle）写 `w:next="SesPara"`。
- `styles.xml` 的 `docDefaults`：`rPrDefault` 为宋体类 `rFonts` + `<w:lang w:val="en-US" w:eastAsia="zh-CN"/>`，`pPrDefault` 为空 `pPr`（同 `gen_spike.py`）。不写 `latentStyles`。

### 3.2 样式清单

| 样式 ID | 中文名 | 字体字号 | 段落属性 | 大纲 | 编号 | 依据 |
|---|---|---|---|---|---|---|
| SesNormal | SES_正文基础 | 宋 五 | `jc=both` widowControl autoSpaceDE autoSpaceDN；默认段落样式 | — | — | 表 F.1 #34 |
| SesPara | SES_段 | 宋 五（含 ASCII） | 首行缩进 2 字（420） | — | — | 10.2.1 |
| SesTocTitle | SES_目次标题 | 黑 三 | `jc=center`；无网格；段前 500 段后 600 固定 20 磅 | — | — | 图 E.8、#14；实测字顶 43.9 mm、到下文 12.6 mm |
| SesFrontTitle | SES_前言引言标题 | 黑 三 | 同 SesTocTitle | 0 | — | 图 E.9、#16/#18 |
| SesBodyTitle | SES_正文首页名称 | 黑 三 | 同 SesTocTitle | — | — | 图 E.3、#20 |
| SesChapter | SES_章标题 | 黑 五 | keepNext；段前段后各 1 行；缩进见 A1 | 0 | 属主：章条 L0 | 10.2.1、#33 |
| SesClause1…5 | SES_一级条标题…五级条标题 | 黑 五 | keepNext；段前段后各半行；缩进见 A1 | 1…5 | 属主：章条 L1…L5 | 10.2.1 |
| SesNoTitle1…5 | SES_一级无标题条…五级无标题条 | 宋 五（含 ASCII） | 缩进见 A1 | — | 段落级：章条 L1…L5 | 10.2.1（编号顶格，空一字接条文；编号黑体见 A1） |
| SesTermNum | SES_术语条目编号 | 黑 五 | keepNext；段前段后 0；缩进见 A1/A2 | — | 段落级：章条 Ln（附录中为附录 Ln，§4.4） | 10.3.5、#22 |
| SesTermHead | SES_术语 | 黑 五 | keepNext；首行缩进 2 字（420） | — | — | 10.3.5、#23 |
| SesTermSource | SES_术语来源 | 宋 五（含 ASCII） | 首行缩进 2 字（420） | — | — | 10.3.5、#24 |
| SesAppendix | SES_附录标识 | 黑 五 | keepNext；`jc=center`；段前 520 段后 0；缩进见 A2 | 0 | 属主：附录 L0 | 图 E.12、#25 |
| SesAppendixKind | SES_附录性质 | 黑 五 | keepNext；`jc=center`；段前段后 0 | — | — | 图 E.12、#26 |
| SesAppendixTitle | SES_附录标题 | 黑 五 | keepNext；`jc=center`；段前 0 段后 150 | — | — | 图 E.12、#27 |
| SesAppClause1…5 | SES_附录一级条标题… | 黑 五 | 同 SesClause；缩进见 A2 | 1…5 | 属主：附录 L1…L5 | 9.6.3.1 |
| SesAppNoTitle1…5 | SES_附录一级无标题条… | 宋 五（含 ASCII） | 缩进见 A2 | — | 段落级：附录 L1…L5 | 9.6.3.1 |
| SesListDash | SES_破折号列项 | 宋 五 | 缩进见 A11 | — | 属主：破折号 L0 | 10.2.2 |
| SesListDot | SES_间隔号列项 | 宋 五 | 缩进见 A11 | — | 属主：破折号 L1 | 10.2.2 |
| SesListItem | SES_编号列项 | 宋 五 | 缩进见 A12–A15 | — | 段落级：按列表实例 | 10.2.2 |
| SesListCont | SES_列项续段 | 宋 五 | 左 840，首行 0（第一层列项的续段） | — | — | 10.2.2 回行对齐 |
| SesListCont2 | SES_列项续段2 | 宋 五 | 左 1260，首行 0（第二层及更深） | — | — | 同上 |
| SesNote | SES_注 | 宋 小五 | 缩进见 A7（左 780 悬挂 360，首行起于 420 = 2 字） | — | 属主：注 L0（「注：」） | 10.4.4.1、#43/#44 |
| SesNoteN | SES_注X | 宋 小五 | 缩进见 A8（左 870 悬挂 450） | — | 段落级：按组分配实例（§4.3） | 同上 |
| SesNoteCont | SES_注续段 | 宋 小五 | 左 780，首行 0（单条注的续段） | — | — | 10.4.4.1 |
| SesNoteNCont | SES_注X续段 | 宋 小五 | 左 870，首行 0（多条注的续段） | — | — | 10.4.4.1 |
| SesExLabel | SES_示例标识 | 宋 小五 | keepNext；缩进见 A9（首行 420） | — | 属主：示例 L0（「示例：」） | 10.4.5、#41 |
| SesExLabelN | SES_示例X标识 | 宋 小五 | keepNext；缩进见 A10 | — | 段落级：按组分配实例（§4.3） | 同上 |
| SesExText | SES_示例内容 | 宋 小五 | 首行 420，回行顶格 | — | — | 10.4.5、#42 |
| SesFigure | SES_图 | — | `jc=center`；keepNext；缩进 0 | — | — | 10.4.2 |
| SesFigCap | SES_图题 | 黑 五 | `jc=center`；段前段后各半行；缩进见 A3 | — | 属主：正文图 L0 | 10.4.2、#36 |
| SesAppFigCap | SES_附录图题 | 黑 五 | `jc=center`；段前段后各半行；缩进见 A5 | — | 段落级：每附录一个实例 | 9.6.3.1 |
| SesTblCap | SES_表题 | 黑 五 | `jc=center`；keepNext；段前段后各半行；缩进见 A4 | — | 属主：正文表 L0 | 10.4.2、#36 |
| SesAppTblCap | SES_附录表题 | 黑 五 | `jc=center`；keepNext；段前段后各半行；缩进见 A6 | — | 段落级：每附录一个实例 | 9.6.3.1 |
| SesTblCapCont | SES_续表题 | 黑 五 | `jc=center`；keepNext；段前段后各半行 | — | 续表字面量表号，不另计数 | 9.8.3、WP7.4 后续修订 |
| SesAppTblCapCont | SES_附录续表题 | 黑 五 | `jc=center`；keepNext；段前段后各半行 | — | 续表字面量附录表号，不另计数 | 9.8.3、WP7.4 后续修订 |
| SesTableText | SES_表格文字 | 宋 小五 | 首行 1 字（210），回行顶格 | — | — | 10.4.2.2、#40 注 a |
| SesTableCenter | SES_表格居中 | 宋 小五 | `jc=center`，缩进 0 | — | — | 10.4.2.2（表头、数字） |
| SesTableNote | SES_表注 | 宋 小五 | 缩进见 A7 / A8 | — | 段落级：单条指向 A7 固定实例（spike v10 T6），多条按 §4.3 分配 A8 实例（WP7.4） | 10.4.4.1 |
| SesFormula | SES_公式 | 宋 五；编号 run 全字符宋体 | 制表位：居中 4677、右对齐 9355 点线；缩进 0；段前段后各半行 | — | Resolver 编号用中文圆括号 | 10.4.3 |
| SesWhereLabel | SES_式中 | 宋 五 | 首行 420 | — | — | 10.4.3 |
| SesWhereItem | SES_式中条目 | 宋 五 | 按 §5.10 计算制表位与悬挂 | — | — | 10.4.3 |
| SesBibTitle | SES_参考文献标题 | 黑 五 | keepNext；`jc=center`；段前 520 段后 150（起始值） | 0 | — | 图 E.10、#29 |
| SesBibEntry | SES_参考文献条目 | 宋 五 | 缩进见 A16（首行 420，回行顶格） | — | 属主：参考文献 L0 | 10.3.6、#30 |
| SesEndMark | SES_终结线 | 宋 4 磅 | keepLines；左右缩进各 3532（Word 实测校准）；下边框 single sz=8（1 磅） | — | — | 10.1.5（本版心目标约 41.25 mm） |
| SesHeader | SES_书眉 | 黑 五 | — | — | — | #47 |
| SesFooter | SES_页码 | 宋 小五 | — | — | — | #48 |
| TOC1 / TOC2 / TOC3 | toc 1 / toc 2 / toc 3 | 宋 五（含 ASCII 编号） | 右对齐点线制表位 9355；TOC1 段前段后各 1/4 行（25）；TOC2 左缩进 210；TOC3 左缩进 420 | — | — | 10.3.2、图 E.8、#15 |
| SesCoverStdNo | SES_封面文件编号 | 黑 四 | `jc=right`（WP7.5 在段落上加 `framePr`） | — | — | #04；书眉 STYLEREF 的取值来源（§2.3），WP7.2 起就要有 |
| SesCover*（其余） | SES_封面… | 见 §6 | 图文框定位 | — | — | 10.3.1、图 E.5–E.7、#01–13（WP7.5） |

「属主」= 该样式带样式级 `numPr`，是这个编号级别唯一绑定的样式；「段落级」= 样式不带 `numPr`，由段落自己写 `numPr`（原因见 §4.1）。
「缩进见 Ax」= 该样式自身不写 `ind`，缩进由编号级别给出（§3.1、§4.2）。WP7.2 输出本表全部样式（含后续工作包才用到的），
只有 SesCover* 中除 SesCoverStdNo 以外的样式留给 WP7.5。

### 3.3 偏差登记（以原件为准，已改正）

| 项 | 原口径 | 本规格 | 依据 |
|---|---|---|---|
| 书眉字号 | 参考模板为小五、未设黑体 | 五号黑体 | 表 F.1 #47 |
| 标题字距 | WP4-fix D3 定为插一个全角空格（PDF 已如此实现） | **用字符间距（`rPr/w:spacing` 加宽）实现，文字本身不插空格**：目次/前言/引言两字间 2 个字宽（三号，`w:spacing w:val="640"`，只加在前一个字上）；参考文献逐字 1 个字宽（五号，210，最后一个字不加）；附录标识「附录A」由编号生成，在 A2 L0 的标识 rPr 上加 210。目次条目由渲染器单独生成纯文字，不继承标题 run 的字距 | 原件出版物实测（字间约 2 em / 1 em）；图 E.8 目次条目不带字距。PDF 已冻结，不回改 |
| 终结线 | dev-plan 定稿表要求用 `docs/素材/终结线.jpg` | 段落下边框（1 磅），Word 16.113 实测把左右缩进设为 3532 twips 时线长约 41.3 mm（当前版心 165 mm 的四分之一）；原件版心较窄，实测线长 40.3 mm | 原图 117×25 px、72 dpi，黑线仅底部 1 像素，约 1 磅；改粗边框以复现，并避免图片白边 |
| GB 标志 | `docs/素材/GB标志.png`（152×77 px，印刷约 96 dpi） | 原件封面内嵌的 948×474 px、1 位、600 dpi 位图 | `pdfimages -f 1 -l 1` 提取 |
| 表格线 | — | 粗 sz=6（0.75 磅）、细 sz=2（0.25 磅） | 原件实测：外框/表头 0.25 mm，内线约 0.1 mm |

---

## 4. 编号方案（可编辑优先）

### 4.1 Word 的两条硬约束（spike 实测）

1. **一个编号级别只能绑定一个段落样式**。两个样式的 `numPr` 指向同一 abstractNum 的同一级别时（即使 numId 不同），Word 加载时把级别绑给**第一个**样式，其余样式上的 `numPr` 被删除（v1–v3，另存后可见）。
   → 每个级别只有一个「属主样式」带样式级 `numPr`；无标题条、术语条目编号、附录无标题条等共用级别的段落，一律写**段落级** `numPr`，指向同一编号实例，因而共享计数（v4：4.1→4.2（无题）→4.3、5.1、A.2 均正确）。
2. **多级列表跳级会隐式计数**。更深的级别出现时，被跳过的中间级别被当作已用 1，之后该级别从 2 开始（v1：附录图放在附录列表第 7 级，A.1.1 变成 A.1.2）。
   → 图、表、公式**不得**作为章条列表或附录列表的深层级别。

### 4.2 编号定义（abstractNum）

所有级别 `start=1`、`lvlJc=left`；未写 `suff` 的为 `nothing`。**缩进只写在级别的 `pPr/ind`**（§3.1），单位 twips；
表中未写缩进的级别为 `left=0 firstLine=0`。

| ID | 用途 | 类型 | 级别定义 | 属主样式 |
|---|---|---|---|---|
| A1 | 章条 | multilevel | L0 decimal `%1　`；L1 `%1.%2　`；L2 `%1.%2.%3　`；L3、L4、L5 依此类推；各级标识 rPr 黑体 | SesChapter、SesClause1…5 |
| A2 | 附录 | multilevel | L0 upperLetter `附录%1`，标识 rPr 黑体 + 字符间距 210（§3.3）；L1 `%1.%2　`…L5，标识 rPr 黑体 | SesAppendix、SesAppClause1…5 |
| A3 | 正文图 | singleLevel | L0 decimal `图%1　` | SesFigCap |
| A4 | 正文表 | singleLevel | L0 decimal `表%1　` | SesTblCap |
| A5 | 附录图 | singleLevel | L0 decimal `图%1　`（占位，实例覆盖整个 L0） | — |
| A6 | 附录表 | singleLevel | 同上，`表%1　` | — |
| A7 | 注 | singleLevel | L0 **none** `注：`；左 780 悬挂 360；标识 rPr 黑体 | SesNote |
| A8 | 注X | singleLevel | L0 decimal `注%1：`；左 870 悬挂 450；标识 rPr 黑体 | —（按组实例） |
| A9 | 示例 | singleLevel | L0 none `示例：`；首行 420；标识 rPr 黑体 | SesExLabel |
| A10 | 示例X | singleLevel | L0 decimal `示例%1：`；首行 420；标识 rPr 黑体 | —（按组实例） |
| A11 | 破折号列项 | multilevel | L0 bullet `——`，左 840 悬挂 420；L1 bullet `·` suff=tab，左 1260 悬挂 420；两级标识 rPr 全字符宋体 | SesListDash、SesListDot |
| A12 | 字母列项 | multilevel | L0 lowerLetter `%1）` suff=tab，左 840 悬挂 420；L1 bullet `·` suff=tab，左 1260 悬挂 420；两级标识 rPr 全字符宋体 | —（按列表实例） |
| A13 | 数字列项 | multilevel | L0 decimal `%1）`；L1 bullet `·`（suff、缩进和字体同 A12） | — |
| A14 / A15 | 旧罗马类型兼容槽 | multilevel | L0 decimal `%1）`；L1 bullet `·`（字体同 A12）；旧文档的罗马列表降级为数字列项，不再输出罗马编号 | — |
| A16 | 参考文献 | singleLevel | L0 decimal `[%1]　`，编号 rPr 指定宋体；首行 420 | SesBibEntry |

- 标识后的「空一个汉字」用 lvlText 里的全角空格 U+3000，不用 `suff=space`（半角）。
- A1、A2 各级标识都用黑体：无标题条与术语条目的编号也是「条编号」（表 F.1 #33），原件中无标题条的编号即为黑体（如 7.5.1），
  而它们的段落样式是宋体，编号字体必须由级别的 rPr 给出。
- 列表 `boxed`（方框编号）V1 退化为 A13 并记 `list-format-fallback` warning。
- 注/示例的悬挂量等于标识的实际宽度（黑体小五：汉字与全角冒号各 1 em = 180 twips，阿拉伯数字 0.5 em = 90 twips），所以 `suff=nothing` 时回行正好与注内容左对齐：「注：」360、「注1：」450。
- abstractNumId 即表中序号（A1 → 1 … A16 → 16）。A1、A2、A11–A15 的 `multiLevelType` 为 `multilevel`，其余为
  `singleLevel`；每个 abstractNum 只写表中列出的级别（spike 验证 Word 接受少于 9 级），不写 `nsid`、`tmpl`。
- 固定实例（§4.3）的 numId 等于其 abstractNumId；按需实例的 numId 从 101 起，按渲染时第一次需要它的顺序递增。
  `numbering.xml` 先按 abstractNumId 升序写全部 abstractNum，再按 numId 升序写全部 num（附录 B）。16 个 abstractNum 与
  8 个固定实例总是全部输出（属主样式引用它们，不论文档里有没有对应要素）。
- 已知限制（不处理）：Word 的 upperLetter 过了 Z 依次是 AA、BB、CC…，Resolver 的附录字母是 AA、AB…，第 28 个附录起两者
  不同；「注10：」起标识宽 540，悬挂仍是 450。

### 4.3 编号实例（w:num）分配

**Word 的计数模型**（spike v10 实测；本节的分配规则与 §4.7 模拟器都以它为准）：

1. 计数器属于 abstractNum 的各个级别。引用同一个 abstractNum 的所有 `w:num` 实例**共用**这套计数器；
2. 实例 `lvlOverride` 里的 `startOverride` 只在该实例**第一次被段落使用**时生效一次：把该级别置为「下一个显示起始值」。
   之后再用这个实例，就和别的实例一样沿用共享计数；
3. 某级别出现一次，比它深的级别全部重置；比它浅的级别若还没计过数，按 1 计（跳级隐式计数，§4.1）。

因此：同一 abstractNum 的两组编号**交错**出现时，回到前一组会接着后一组往下数（spike v10 T1：X Y Y X Y 显示
注1 注1 注2 **注3 注4**）；只在 L1 使用的新实例，若 override 只写了 ilvl 0，L1 会接着上一个实例往下数（T4）。

**分配规则**

- **固定实例**（每个文档一个，属主样式引用；段落级 numPr 也可以指向它们）：A1、A2、A3、A4、A7、A9、A11、A16。
  这些 abstractNum 只有这一个实例，不受上述模型影响。
- **按需实例**对该 abstractNum 的**每个级别**都写 `<w:lvlOverride w:ilvl="k"><w:startOverride w:val="…"/></w:lvlOverride>`
  （A12–A15 写 ilvl 0 与 1；singleLevel 写 ilvl 0）。
- **同一 abstractNum 的组交错时，回到前一组要新建实例**：A8、A10 各记「上一个用到它的段落属于哪个作用域」（作用域键见
  §5.7）；第一次使用，或本条的作用域键与上次不同，就新建实例，ilvl 0 的 `startOverride` = 本条在本组中的序号 N（取自 Resolver 的
  label「注N：」「示例N：」）；相同则沿用当前实例。不交错时每组正好一个实例、起始值为 1；交错时（例：条 4.1 的两条注之间
  夹着一个带两条注的图）第二段 4.1 的注由新实例从 2 接上（spike v10 resume：注1 注1 注2 **注2 注3**）。

按需实例的用途：

- 多条注（A8）、多条示例（A10）：按上一条规则；
- 编号列表（A12–A15）：每个第一层编号列表一个实例。第一层列表是块级要素，彼此不会交错；嵌套列表只有「dash 下的第二层
  编号列表」新建实例（它外面没有别的编号列表），其余嵌套复用上层实例或不用编号定义（§4.4），所以列表实例也不会交错。
  注意不能在一个编号列表里面为嵌套列表新建同一 abstractNum 的实例：新实例首次使用时的 startOverride 会把外层列表的计数
  一起重置；
- 附录图、附录表（A5、A6）：每个附录各一个（在该附录第一次用到时创建），`lvlOverride` 内 `startOverride` 之后再写一个完整
  `w:lvl` 覆盖 L0，lvlText 为 `图{字母}.%1　` / `表{字母}.%1　`（v2 验证：图A.1、图A.2、图B.1、表B.1 均正确）。附录依次
  出现，不会交错。
- **单条注、单个示例**：用属主样式 SesNote / SesExLabel（none 格式，标识为「注：」「示例：」），不需要实例。单条还是多条
  由 Resolver 的 label 判定（§5.7），与 Resolver「单条不编号、多条编号」规则一致。

### 4.4 级别选择

- 章：A1 L0。
- 条：A1 L = **嵌套深度**（章的直属条为 1，其子条为 2……），**不用 `IRClause.level`**。Resolver 按路径长度编号，`level` 只用来
  报 heading-skip；两者不一致时只有按深度才与 Resolver 一致。深度超过 5 时按 5 输出并记 `clause-too-deep` warning
  （这类文档 Resolver 已报 heading-skip，Word 编号与 Resolver 不同，不要求一致）。
- 术语条目编号：**正文用 A1、附录用 A2** 的固定实例（段落级 numPr），L = 父节点深度 + 1（章、附录本身深度为 0：章直属 →
  「3.1」，条 3.1 之下 → 「3.1.1」，附录直属 → 「A.1」）；超过 5 同上处理。
- 附录条、附录无标题条：A2，L = 深度。
- 列项（2026-09-30 用户验收修订：一级为破折号、字母列项；二级为数字、间隔号列项；数字列项保留 `1）` 标识）：

  | 所在层 | 本层列表类型 | 渲染 |
  |---|---|---|
  | 第一层 | dash | P(SesListDash)，样式自带 A11 L0 |
  | 第一层 | alpha | P(SesListItem) + 新建 A12 实例的 ilvl 0，显示 `a）` |
  | 第二层 | number | P(SesListItem) + 新建 A13 实例的 ilvl 0，段落直接缩进 left=1260 / hanging=420，显示 `1）` |
  | 第二层 | dot | P(SesListDot)，样式自带 A11 L1，显示 `·` |
  | 旧数据 | roman / romanUpper | 降级为 number，不输出罗马数字 |
  | 旧数据 | boxed | 按数字编号渲染，记 `list-format-fallback` |
  | 历史嵌套第二层 | dash / alpha / boxed 等 | 保留间隔号降级；嵌套 number 保留数字编号 |
  | 第三层及更深 | 任意类型 | P(SesListDot)，显示间隔号 `·`，并记 `list-too-deep` |

  第三层及更深的列表（不论类型）每个记一条 `list-too-deep`（GB/T 1.1 7.5.2：细分不宜超过两个层次）。
  编辑器中列项可以作为同级块存储，数字和间隔号仍按二级字位显示；旧文档里 `numeric` 节点虽标记 `level=1`，导出时也按二级处理。

  列表的一项有多个块时：第一块是段落，则它带编号；第一块不是段落（例如直接是嵌套列表），先输出一个只有编号的段
  （样式与 numPr 同上、无文字）。其后的段落用 SesListCont（第一层）或 SesListCont2（第二层及更深）；嵌套列表按上表。

### 4.5 公式编号

不使用 Word 原生编号：列表标识只能出现在段首，而公式编号在行尾。写 Resolver 的 `labels[id].label`（「(3)」「(A.1)」）为文字。`numbered=false` 时不写编号和点线，公式只居中。

### 4.6 交叉引用

V1 写 `labels[targetId].refText` 纯文字，**不加颜色、不加下划线**（旧导出器的蓝色直接格式属于缺陷，不得沿用）。V2（本系列不做）改为 REF 域 + 书签。

### 4.7 一致性测试（必须实现）

在 shared 测试中实现一个「Word 编号模拟器」，只需覆盖本规格用到的特性；它先用手写片段复现 spike v10 的 Word 实测结果，
再拿来检查渲染器的输出与 Resolver 的 `labels` 逐段一致。

**遍历顺序**：Word 按段落在文档中的先后计数，Resolver 按遍历顺序赋号，所以凡用 Word 原生编号的要素，DOCX 的输出顺序
必须与 Resolver 的遍历顺序完全一致。本规格按 GB/T 1.1 定的输出顺序有两处与 Resolver 原先的遍历顺序不同，由 Resolver 改为
按文档顺序遍历（WP7.2 实施）：

1. 图：图中的注在图题之上（9.11.1、§5.8）。Resolver 改为先遍历 `notes`，再给图编号、遍历图题（`caption`、`captionEn`）；
2. 术语条目：示例在注之前、来源在最后（8.7.3.1、§5.4）。Resolver 改为 术语 → 定义 → 示例 → 注 → 来源。

这两处只在注、示例里再嵌图、表时影响编号（IR 允许，pmToIr 目前产生不了）；另外参考文献按首次引用排序，取的是 Resolver
收集交叉引用的顺序，同一术语条目的注与示例中各有引用时，排序随之改为文档顺序。HTML 渲染器（PDF，已冻结）把图注排在
图题之下、把术语的来源与注排在示例之前，上述罕见情形下 PDF 的编号先后与版面先后会不一致，不回改。其余要素（章、条、
附录、表、公式、列项、注与示例的内容、参考文献条目）两边顺序本来一致。

**模拟器**（`__tests__/helpers/numberingSim.ts`，测试代码）

- 输入 `DocxPackage`，读 `word/styles.xml`、`word/numbering.xml`、`word/document.xml`；没有 styles 或 numbering 部件时视为全文
  无编号。
- 段落顺序：`document.xml` 中全部 `w:p`，按文档顺序深度优先（含表格单元格内的段落）。
- 有效编号：段落 `pPr/numPr` 优先（`numId` 为 0 表示无编号）；否则沿 `basedOn` 链找第一个带 `pPr/numPr` 的样式；`ilvl` 缺省为 0。
- 级别定义：实例 `lvlOverride` 内的 `w:lvl` 优先，否则取 abstractNum 的同级 `w:lvl`。
- 计数：按 §4.3 的模型。每个 abstractNum 有一组按级别存放的计数器，初值 0（表示未计数）；实例第一次被段落使用时，把它的
  每个 `startOverride` v 写成对应级别的 v−1；然后本段级别为 0 时取该级 `start`、否则加 1；比本段深的级别置 0；比本段浅且
  为 0 的级别置为其 `start`（跳级隐式计数）。
- 格式：decimal、upperLetter / lowerLetter（过了 z 按 Word 规则：aa、bb……）、upperRoman / lowerRoman、bullet 与 none
  （lvlText 原样输出）。lvlText 中的 `%n` 替换为第 n−1 级的计数按该级 numFmt 格式化的结果。
- 输出每段：`index`（段落序号，从 0 起）、`styleId`、`numId`、`ilvl`、`label`（模拟出的标识全文，含 lvlText 里的全角
  空格；无编号为 undefined）、`text`（提取规则同 §10.2 的大纲）。

**模拟器自测**（历史 Word spike，手写 styles、numbering、document 片段；原始 XML 见 `spike/wp7-docx-word/probe_v10.py`）。下表用于复现 Word 编号计数行为，其中旧 `a)`/`1)` 仅为当时的实验标识，不代表当前列项输出格式：

| 用例 | 构造 | Word 实测（期望输出） |
|---|---|---|
| T1 | A8 的两个实例 X、Y（都写 startOverride=1）：X Y Y X Y | 注1： 注1： 注2： 注3： 注4： |
| T2 | 同一 abstractNum 的两个实例，都不写 override：a b a | 甲1： 甲2： 甲3： |
| T3 | 一个 A12 实例：L0 L1 L1 L0 L1 | a) 1) 2) b) 1) |
| T4 | 紧接 T3，同一 abstractNum 的两个新实例（override 只写 ilvl 0），各在 L1 用两次 | 2) 3) 4) 5) |
| T4b | 另一个 abstractNum 的两个新实例（override 写 ilvl 0 与 1），各在 L1 用两次 | 1) 2) 1) 2) |
| T5 | 同一 abstractNum 的两个实例 P、Q（都写 override）：P P Q P Q | a) b) a) b) c) |
| resume | A8：X（起始 1）Y（起始 1）Y Z（起始 2）W（起始 3） | 注1： 注1： 注2： 注2： 注3： |
| T6 | 段落级 numPr 指向由 SesNote 属主的 A7 固定实例 | 注： |
| T8 | 字母列表 L0、SesListDot（A11 L1）、字母列表 L0 | a) · b) |
| v4 | A1 固定实例，样式级与段落级 numPr 混用：章、条、无标题条、条、二级条、二级无标题条、章、无标题条 | 4　 4.1　 4.2　 4.3　 4.3.1　 4.3.2　 5　 5.1　（前三章略） |
| 跳级 | A1：L0 后直接 L2 | 1　 1.1.1　 |
| 格式 | upperLetter 第 1、26、27、28 个；lowerRoman 第 4、9 个；upperRoman 第 14 个 | A、Z、AA、BB；iv、ix；XIV |

**追踪**：`render.ts` 导出（不经 `index.ts`）

```ts
export interface NumberedParagraphTrace {
  nodeId: NodeId
  kind: 'chapter' | 'clause' | 'termEntry' | 'appendix' | 'figure' | 'table' | 'note' | 'example' | 'bibEntry' | 'listItem'
}
export function renderDocxTraced(
  doc: IRDoc, labels: Record<NodeId, ResolvedLabel>, opts: DocxRenderOptions,
): { pkg: DocxPackage; numbered: NumberedParagraphTrace[] }
```

`numbered` 按 `document.xml` 中的顺序，每个**有效编号段落**恰好一项：章标题段、条（有标题条的标题段 / 无标题条带编号的
首段）、术语条目编号段、附录标识段、图题段、表题段、注的第一段、示例标识段、参考文献条目段、列表每一项的第一段（第三层及
更深的非 dash 列项用文字标识，不是编号段落，不记）。
实现上所有段落经同一个函数输出，它在「段落写了 numPr，或样式是属主样式」时要求传入 nodeId 与 kind 并记一项，漏传即抛错。

**比对**（每个一致性 fixture）

1. 模拟器中 `label` 不为空的段落数等于 `numbered.length`，二者按顺序一一对应；
2. 对应段落的 `label` 去掉末尾一个 U+3000 后：kind 为 `listItem` 的等于测试手写的期望（Resolver 不给列项编号）；其余等于
   `labels[nodeId].label`；
3. 覆盖：IR 中每个章、条、术语条目、附录、图、表、注、示例、参考文献条目在 `numbered` 中恰好出现一次。WP7.2 不含表格内部
   的节点（表注，以及单元格内容里的注、示例等），WP7.4 起包含。

## 5. 要素渲染（IR → OOXML）

下文「P(样式, 内容)」表示 `<w:p><w:pPr><w:pStyle w:val="样式"/>…</w:pPr>…</w:p>`。

### 5.1 正文首页

P(SesBodyTitle, `meta.title`)。只输出中文名称，不输出英文。名称由多个元素组成时，元素之间用一个全角空格（10.1.4）：渲染器去掉首尾空白，把连续的半角空格（U+0020）替换为一个 U+3000。`meta.title` 缺失时输出空的 SesBodyTitle 段（保持版面位置）并记 `cover-field-missing`。GB/T 1.1 的「重要提示」（#21）IR 暂无字段，本期不做。

### 5.2 章

P(SesChapter, 标题)。`secType` 只影响内容，不影响版式。悬置段由 Resolver 报 problem，渲染照常输出。

### 5.3 条与无标题条

下文 {L} 是 §4.4 的编号级别（嵌套深度）。附录中的条把 SesClause/SesNoTitle 换成 SesAppClause/SesAppNoTitle、A1 换成 A2。

- 有标题条：P(SesClause{L}, 标题)，随后渲染 children。
- 无标题条：第一个子块是段落时，写成 P(SesNoTitle{L}) + 段落级 `numPr`（A1 固定实例，ilvl = L），其余子块照常（段落用 SesPara）；
  第一个子块不是段落或没有子块时，先输出一个只有编号的 P(SesNoTitle{L}) + 同样的 `numPr`（无文字），其后照常输出全部子块。
  GB/T 7.3.3 要求同一层次有无标题一致、7.3.4 规定无标题条不再分条；违反时 Resolver 报 problem，渲染不拦截。

### 5.4 术语条目（10.3.5）

1. “术语和定义”章内：P(SesTermNum) + 段落级 `numPr`（正文 A1，级别见 §4.4），编号独占一行；下一段 P(SesTermHead, term + U+3000 + termEn)，首行空两个汉字，termEn 缺省或为空时只写 term（10.3.5）。
2. 其他章节和附录中出现的测试用 `termEntry`：编号与术语写在同一 P(SesTermNum) 中，分别使用正文 A1 或附录 A2。这是按人工验收反馈处理非“术语和定义”章内的异常结构，不套用上一项的分行格式。
3. 定义各块：段落用 SesPara，其他块照常；
4. 示例（`examples`），然后注（`notes`），按 §5.7，作用域为该术语条目；
5. 来源：P(SesTermSource, `source`)，**原样输出**（pmToIr 已把「[来源：……]」整段作为 source，渲染器不得再加前缀）；段内中英文、数字均指定宋体。

顺序依据 8.7.3.1（术语条目中「依次」给出……定义、其他表述形式、示例、注、来源）与 9.11.1「术语条目的注应置于示例（如有）
之后」。Resolver 按同一顺序遍历（§4.7「遍历顺序」）。HTML/PDF 渲染器目前把来源放在注、示例之前；PDF 已冻结，不回改。

### 5.5 段落与行内

- 段落：P(SesPara, runs)。
- marks：bold→`<w:b/><w:bCs/>`；italic→`<w:i/><w:iCs/>`；underline→`<w:u w:val="single"/>`；sub/sup→`<w:vertAlign w:val="subscript|superscript"/>`；crossRef→按 §4.6 输出文字。
- crossRef：输出 `labels[targetId].refText`；目标没有 label 时输出该 run 的原文（与 HTML 渲染器相同）。同一 run 上的其余 marks 照常作用于这段文字。
- 文本中的 `\n`（出现在任意位置）拆开输出，每个 `\n` 一个 `<w:r><w:br/></w:r>`（带同样的 rPr）；`w:t` 一律写 `xml:space="preserve"`；XML 特殊字符必须转义（`xml.ts`）。
- inline 数组为空时输出不含 run 的段落。

### 5.6 列项

按 §4.4 的列项表渲染：dash 第一层 P(SesListDash)、第二层 P(SesListDot)（属主样式自带编号）；其他类型 P(SesListItem) + 段落级
`numPr`；第三层及更深见该表。一项有多个块时的处理（只有编号的段、SesListCont / SesListCont2）见 §4.4 表后一段。

### 5.7 注与示例

- **单条还是多条由 Resolver 的 label 判定**：`labels[note.id].label` 为「注：」是单条，为「注N：」是多条中的第 N 条；示例同理
  （「示例：」/「示例N：」）。缺 label 时按单条处理并记 `label-missing`。
- 单条注：第一段 P(SesNote)（样式自带 A7）；后续段落 SesNoteCont。
- 多条注：每条第一段 P(SesNoteN) + 段落级 `numPr`（A8 实例，按 §4.3 分配）；后续段落 SesNoteNCont。
- 注的第一块不是段落时，先输出一个只有标识的段（样式与 numPr 同上、无文字），其后输出各块。注内的其他块（列项等）照常渲染。
- 示例：标识单独一段（单个示例 P(SesExLabel)；多个 P(SesExLabelN) + A10 实例，按 §4.3 分配），段落内无文字；内容中的段落用
  SesExText，其他块照常。
- **作用域键**（与 Resolver 的分组完全相同）：前言 `front.foreword`、引言 `front.introduction`；章、条、附录的直属块 = 该章、条、
  附录的 id；术语条目的定义块及其 `notes`、`examples` = 该术语条目的 id；图的 `notes` = 该图的 id；表的单元格内容与 `notes` =
  该表的 id（WP7.4）；注、示例内容中的块 = 该注、示例的 id；列项内容沿用列表所在的作用域。

### 5.8 图

顺序（9.7.5）：图片段 → 图中的注 → 图题。Resolver 相应地先遍历图中的注、再给图编号（§4.7「遍历顺序」）。

- 图片段：P(SesFigure)，内含 `w:drawing/wp:inline`。尺寸取 `widthPx/heightPx` 与 `dpi`（缺省 96）换算为 EMU（1 mm = 36000 EMU）；宽度超过版心宽（竖排 165 mm，横排 252 mm）时等比缩到版心宽。媒体写入 `word/media/imageN.{ext}`，在 `document.xml.rels` 里登记。
- `orientation='landscape'` 的图按 §5.15 放进横排节（图片、图中的注、图题都在该节内）。
- 图题：正文 P(SesFigCap, caption)；附录 P(SesAppFigCap, caption) + 本附录图实例。**不输出** `captionEn`。
- `images` 中缺该图：输出一段文字「〔图片缺失〕」并记 `image-missing` warning。

### 5.9 表

- 表题位于表格首个无边框、跨满全宽的标题行：P(SesTblCap / SesAppTblCap, caption)，不输出 `captionEn`。该行与列标题行均为重复标题行。
- `w:tbl`：
  - `tblPr`：`tblW` 5000 pct；`jc=center`；`tblLayout fixed`；边框外框 sz=6，`insideH/insideV` sz=2；
  - `tblGrid`：按最大列数平均分配版心宽（必须写，否则不符合 schema）；
  - 表题行及前 `headerRowCount` 个数据行 `trPr` 写 `<w:tblHeader/>`；表头最后一行的单元格下边框 sz=6，所有表格行写 `cantSplit`，在行边界分页；
  - 合并：`colspan` → `tcPr/gridSpan`；`rowspan` → 起始格 `vMerge val="restart"`，**被覆盖的后续行在同一网格位置补占位格** `<w:tc><w:tcPr><w:gridSpan w:val="N"/><w:vMerge/></w:tcPr><w:p/></w:tc>`，其中 N = 起始格的 `colspan`（为 1 时省略 `gridSpan`）。占位格缺 `gridSpan` 会只占一列，同行后面的格整体左移，网格错位（旧导出器连占位格都没有）；
  - 单元格段落：表头格与纯数字格（`/^[\d\s.,±%~—-]+$/`）用 SesTableCenter，其余用 SesTableText；空单元格写一字线「—」（10.4.2.2）。
- 表注：表内最后加一行，单元格 `gridSpan` 跨满全宽，上边框 sz=6，内容按 §5.7 规则，用 SesTableNote。
- `orientation='landscape'` 的表按 §5.15 放进横排节（表题、表、表注都在该节内）。
- WP7.4 后续修订：按用户要求将长表拆成独立的 Word 表段，续段另起页并写「表X　表题（续）」；每段重放列标题，切分点避开跨行合并区域，表注只在末段。Word 原生重复标题行不能只在续页改变文字，因此按 Word 样稿行高估算最少页数并均衡各段；长表首段另起页，无法根据前文在 Word 中的实际排版位置精确利用上一页余量。编辑后若行高变化，需重新导出并复核分页。单位陈述仍留给 V2。

### 5.10 公式（10.4.3）

- 公式段：P(SesFormula, `<w:r><w:tab/></w:r>` + OMML + `<w:r><w:tab/></w:r>` + 编号文字)。编号沿用 Resolver 的数字/字母内容，把外层半角圆括号统一写为中文圆括号「（…）」，整段编号 run 的四类 `rFonts` 均指定宋体，避免英文字母和数字回退为 Times New Roman。`numbered=false` 时只有第一个制表符和 OMML。
- `formulaOmml` 缺该公式：写 LaTeX 源码文字，记 `formula-missing-omml` warning。
- 式中：`whereList` 非空时，先 P(SesWhereLabel, 「式中：」)，再每项一段 SesWhereItem：首行起于 420；符号后接一个制表位跳到破折号位置 `d`；「——」后接释义；回行对齐释义起点。`d` = 420 + 本组最长符号宽度 + 210（符号宽按汉字 1 字、ASCII 0.5 字估算）；段落 `tabs` 写 `d`，左缩进 = d + 420（「——」宽 2 字），悬挂 = 左缩进 − 420。

### 5.11 附录

附录编号、性质、标题分为三个居中段：P(SesAppendix) 的编号「附录A」由 A2 L0 生成，字距按 §3.3；P(SesAppendixKind,「（规范性）」或「（资料性）」)；P(SesAppendixTitle, title)。三段均 keepNext，只有第一段参与 A2 编号。分段可避免 Word 把同段内第二、三行相对编号悬挂区向右偏移。WP7.3 固定目次条目按 §7 单独生成「附录A（规范性）　标题」。

### 5.12 参考文献

按 Resolver 赋的序号输出：`renderDocx` 拿不到 `bibliographyOrder`，按 `labels[id].xmlId`（`bib_<n>`）中的 n 升序排列
`doc.bibliography`（与 HTML 渲染器相同；Resolver 按 bibliographyOrder 赋号），没有 label 的排在最后并保持原顺序。
P(SesBibTitle, 「参考文献」：「参」「考」「文」三个 run 各带 `w:spacing w:val="210"`，「献」不带，§3.3)，每条
P(SesBibEntry, content)，编号由 A16 生成。

content 里若已写了编号（如「[9] 」），先剥掉，否则会排成「[1]　[9] ……」。这个前缀可能拆在几个 run 里：bibEntry 的内容是
富文本，把其中的数字加粗就成了 `[`、加粗的 `9`、`] ……` 三个 run，XML 导入也按标记拆 run。剥离方法：

1. 把 content 各 run 的 `text` 依次拼成一串，用 `/^\s*[\[［]\d+[\]］]\s*/` 匹配；不匹配就原样输出；
2. 匹配长度为 L 时，从 run 序列开头删掉共 L 个字符：完全落在前缀内的 run 整个去掉；跨过前缀末尾的那个 run 只保留前缀之后
   的部分，marks 不变；其后的 run 原样保留；
3. 前缀范围内有带 crossRef mark 的 run 时不剥离，原样输出（这种 run 显示的是 refText，不是 text）。

### 5.13 终结线（10.1.5）

文件最后一个要素之后写 P(SesEndMark)。为保证与最后内容同页、不另起一面：**最后一个内容段落加 `keepNext`**。

### 5.14 前言、引言

P(SesFrontTitle, 「前言」/「引言」：「前」「引」的 run 带 `w:spacing w:val="640"`，§3.3) + 内容块，作用域键见 §5.7。
引言中的图、表、公式参与全文连续编号（9.7.2.1「图编号从引言开始」），实例同正文（A3、A4 固定实例）。

### 5.15 横排（图、表共用）

适用于 `orientation='landscape'` 的 `IRFigure` 与 `IRTable`：

- 在该要素之前结束当前节（按 §2.2 输出当前节的分节空段），开一个横排节：`w:type=nextPage`，`pgSz w=16838 h=11906 orient="landscape"`，页码续编（显式写当前的 `pgNumType fmt`），页眉页脚引用同一组四个部件。
- 横排节的页边距按横向换算：左右（内/外侧）25 / 20 mm 不变，上下 34 / 25 mm 不变；横排版心宽 = 297 − 25 − 20 = **252 mm**，图片按此上限缩放，表格 `tblW` 5000 pct 即占满横排版心。
- 该要素（连同图题/表题、图中的注/表注）之后再开一个竖排节（`nextPage`，页码续编），恢复竖排页面。**连续的横排要素共用一个横排节**，中间不插竖排节。
- 若文件最后一个要素是横排的，终结线（§5.13）放在该横排节内、与该要素同页，不再切回竖排另起一面。
- 横排节里的书眉、页码会随纸张方向一起转到横向的顶部和底部；这是否符合要求须在 WP7.4 开工前的 spike 中用 Word 与 WPS 确认，结论写进 PR。

---

## 6. 封面（10.3.1、图 E.5–E.7、表 F.1 #01–13）

### 6.1 几何（页面坐标，单位 mm，以实测墨迹为准）

2026-09-30 用户补充六类 DOCX 模板并要求修正封面。标志、代号和发布机构以这些模板的实际 Word 渲染为参照；其余名称、编号、横线及日期目标保留原方案。模板中的说明、表单占位值及链接只作输入数据，不是执行指令；不导入整套模板样式、编号或宏。

| 元素 | 目标位置（墨迹） | 字体 | 实现 |
|---|---|---|---|
| ICS / CCS（行业标准加第三行「备案号：」） | 左 25，首行字顶 10.6 | 五号黑体（#01/#02） | 图文框 x=25 y=10 w=90 |
| 文件代号标志 | 国标/指导性文件 x 138.94–178.99、y 12.95–33.10；其他类型见下表 | 图片或图文同行 | 国标仍用600dpi嵌图、40×20 mm；其他类型按模板原图片尺寸和可编辑代号排版 |
| 称谓 | y 41.5–50.2，x 25–195 分散对齐 | 国标：宋体一号加粗；其他：黑体小一（#06/#07，定稿表） | 图文框 x=25 y=41 w=170，`jc=distribute` |
| 文件编号 | 字顶 58.3，右端 190 | 四号黑体（#04） | 图文框 x=100 y=57.5 w=90，`jc=right` |
| 代替文件编号 | 字顶 65.4，右端 190 | 五号黑体（#05） | 图文框 x=100 y=64.8 w=90，`jc=right`；无则省略 |
| 横线 | y 75，x 25–195，0.75 pt（约 0.265 mm） | — | 图文框 x=25 y=74 w=170 的空段落，下边框 sz=6（0.75 pt） |
| 文件名称 | 首行字顶 115.4，居中，多行行距约 12.9 | 一号黑体（#08） | 与下面三项共用一个图文框：x=25 y=114.5 w=170 |
| 英文译名 | 名称之下 10.5 | 四号黑体（#09） | 同一图文框内，段前约 10 mm |
| 一致性程度标识 | 英文之下 14.5 | 四号黑体（#10） | 同上，段前约 15 mm |
| 阶段标识、专利说明 | 见 §6.3 | 四号黑体 / 五号宋体 | 同上 |
| 发布 / 实施日期 | 字顶 251.5；「发布」左 25，「实施」右端 195 | 四号黑体（#11） | 图文框 x=25 y=250.5 w=170，右对齐制表位 9638（170 mm）；段落下边框 sz=6（0.75 pt）（y≈257） |
| 发布机构 + 「发　布」 | 国标 x 72.39–147.07、y 264.08–275.25；指导性文件 y 265.85–276.94；非国标字顶271.95、版心居中 | 国标为模板整幅图片；非国标黑体四号常规字 | 国标图片已包含两行机构与垂直居中的「发布」，禁止再拼同名文字；非国标机构和「发　布」同段居中 |

- 2026-10-02 用户要求：六类 DOCX 封面（国家、指导性技术文件、行业、地方、团体、企业）的编号下横线和日期下横线统一为 **0.75 pt**，OOXML 边框 `w:sz=6`；该项覆盖先前的 0.5 pt 设置。此前 Word 几何测量属于旧线宽记录，本次仅调整粗细。

- 发布/实施日期为空（含纯空白）时各自显示`XXXX-XX-XX`占位；日期段及其下横线始终输出。占位只用于DOCX封面展示，不写回真实日期元数据。明确填写的日期优先。

- 连续段落的 `framePr` 完全相同时，Word 把它们合成一个图文框。名称、英文、一致性、阶段标识放在同一个图文框里自然流动，名称行数变化时不会互相覆盖。
- 图文框统一写 `w:hAnchor="page" w:vAnchor="page" w:wrap="around" w:hSpace="0" w:vSpace="0"`，`w:x`/`w:y`/`w:w` 为 twips。封面节 `pgMar` 可沿用正文值，图文框按页面定位不受影响。
- 表中「图文框」列为起始值，最终以 §10 的墨迹测量对照「目标位置」，允差 ±1 mm。

### 6.2 类型差异

模板标志墨迹目标（固定样稿），来源指纹和参照填值方法见 `wp7.5-template-reference.json`。以下目标在校准生成器前从模板 Word PDF 冻结；允差±1 mm，不把 OOXML 图文框坐标当作墨迹结果。

| 固定代号 | 左 / 顶 / 右 / 底（mm） | 字形与尺寸 |
|---|---|---|
| HG | 147.24 / 23.54 / 180.76 / 35.31 | Times New Roman 48pt、粗体、水平130% |
| DB33 | 134.70 / 19.81 / 180.09 / 31.50 | DB图22.131×11.049 mm；数字同上述字形，地区码由规范化标准号提取2或4位 |
| T/TEST | 108.03 / 23.71 / 182.37 / 36.15 | T图11.520×11.960 mm及斜杠图4.748×12.128 mm；机构码可编辑 |
| Q/TEST | 107.36 / 18.88 / 182.29 / 31.50 | Q图11.994×12.347 mm；斜杠和机构码可编辑 |

| 类型 | 称谓 | 标志 | 文件编号示例 | 英文译名 | 其他 |
|---|---|---|---|---|---|
| gb | 中华人民共和国国家标准 | GB 标志 | GB/T 12345—2026、GB 12345—2026 | 有 | 发布机构为国标发布机构图片 |
| guide | 中华人民共和国国家标准化指导性技术文件 | GB 标志 | GB/Z 12345—2026 | 有 | 同上（E.1 注：T 改 Z） |
| industry | 中华人民共和国××行业标准 | 从完整编号提取行业代号，按模板48pt Times New Roman粗体、水平130%；无法提取时显示XX并告警 | XX/T 1234—2026 | 有 | ICS/CCS 下加「备案号：」；发布机构为文字 |
| local | ××××（地方名称）地方标准 | DB 标志 + 地区代码文字 | DBXX/T 123—2026 | 无（图 E.7） | 发布机构为文字 |
| group | 团体标准（用户提供模板） | T图片 + 斜杠图片 + 机构代码 | T/XXX 123—2026 | 有 | 发布机构 = 团体名称 |
| enterprise | 企业标准（用户提供模板） | Q图片 + 可编辑斜杠和机构代码 | Q/XXX 123—2026 | 无 | 发布机构 = 企业名称 |

- 文件编号中「代号与顺序号之间空半个汉字，顺序号与年份之间用一字线」（定稿表）：渲染器把 `stdCode` 中代号后的空格规范为一个半角空格、年份连接符规范为「—」（U+2014）。
- 非国标发布机构按本次用户模板采用黑体四号常规字，不称正式专用字；团体/企业机构代码保留输入大小写，行业家族代码规范为大写。

### 6.3 草案信息（8.1、附录 D.1）

- 阶段标识（`opts.stage`）：按下表穷尽映射，在一致性程度标识之下一行居中写对应文字（四号黑体）；阶段名称与 `DocumentStage` 定义一致，不把工作草案改称工作组讨论稿。

| DocumentStage | 封面阶段标识 | 专利征集说明 |
|---|---|---|
| `working_draft` | （工作草案） | 无 |
| `comment_draft` | （征求意见稿） | 有 |
| `review_discussion_draft` | （送审讨论稿） | 无 |
| `review_draft` | （送审稿） | 有 |
| `approval_draft` | （报批稿） | 无 |
| `public_draft` | （公示稿） | 无 |
| `published` | 不显示 | 无 |

该映射于 2026-09-30 WP7.5 开工时补全；专利说明仍按附录 D.1 限于征求意见稿和送审稿。
- **征求意见稿、送审稿**：封面显著位置**必须**写专利征集说明「在提交反馈意见时，请将您知道的相关专利连同支持性文件一并附上。」（D.1，五号宋体），放在阶段标识之下。
- 位置细节原件未给图，按上述顺序排在名称图文框内；若主导人另有样式要求再调整。

### 6.4 素材

| 素材 | 来源 | 状态 |
|---|---|---|
| GB 标志 | 原件第 1 页内嵌 948×474 px、1 位、600 dpi 位图（`pdfimages -f 1 -l 1 -png`） | 可用；替换 `docs/素材/GB标志.png` |
| 国家标准发布机构（两行及发布） | 用户提供的国家/指导性文件模板同一幅690×131 px、220dpi TIFF，转换PNG不重采样 | 按用户要求采用；文字固定为模板内容，来源未作正式核验 |
| DB 标志 | 用户提供地方标准模板196×98 px、220dpi TIFF转换PNG | 按模板采用，原始来源未核实 |
| T 与斜杠 | 用户提供团体标准模板100×103及53×135 px PNG | 按模板原像素采用，原始来源未核实 |
| Q 标志 | 用户提供企业标准模板34×35 px、72dpi TIFF转换PNG | 本次用户明确要求用图片，按模板采用；低清限制保留，正式交付需更高清源 |
| 终结线 | 不用图片（§5.13） | — |

素材以 base64 常量放在 `assets.ts`，TIFF 统一转 PNG（Word/WPS 对 TIFF 支持不一）。

### 6.5 IRDocMeta 需补充的字段（只增不改，均可选）

`replaces`（代替文件编号）、`consistency`（一致性程度标识，如「（ISO 1234:2020，MOD）」）、`filingNo`（备案号）、`industryName`（××行业）、`regionName`（地方名称）。`pmToIr` 从封面节点属性取值；2026-09-30按用户补充要求，`replaces`（标准替代情况）和`consistency`（标准采标情况）已接入新建表单及持久化内容；`filingNo`、`industryName`、`regionName`的表单输入仍另开任务。新建编号未填时保存明确占位编号（如`GB/T XXXXX—XXXX`），不推定年份或未填写的行业/地区/机构代号。提出/归口/起草单位用于一次性生成前言，并加入用户指定的专利提示；已有正文不重新套用，详见`wp7.5-new-document-validation.md`。

---

## 7. 目次（10.3.2、图 E.8）

- 目次节：P(SesTocTitle, 「目次」，字距按 §3.3)，随后按 IR 文档顺序生成前言、引言、章、附录、参考文献
  的一级目次段（TOC1）；普通章直属的有标题一级条，以及附录直属的有标题一级条和术语条目生成二级目次段（TOC2）。
  术语和定义章只收录章标题，不收录其下的术语条目或补充条（如 3.3）。判断条的层级以实际嵌套深度为准，
  不信任 `IRClause.level`；其余术语条目、无标题条、图表不收录。
- 条目文字从 Resolver 的 `labels[id].label` 和可见标题生成：章/条 =「编号」+ 一个汉字间隙（U+3000）+「完整标题」；
  附录 =「附录编号」+「（规范性）/（资料性）」+ U+3000 +「完整标题」，编号与性质之间**无空格**；
  前言、引言、参考文献只写其名称。标题里的交叉引用显示为 `labels[targetId].refText`，不复制正文标题 run 的直接字距。
- 每个目录目标标题段加确定性的 `bookmarkStart`/`bookmarkEnd`；相应目次段含指向该书签的内部跳转，
  文字后写右对齐点线制表位和 `PAGEREF <书签名> \h` 域（页码缓存可为空）。`word/settings.xml` 保留
  `<w:updateFields w:val="true"/>`；Word 打开或打印时计算页码，核对不同分节的罗马/阿拉伯页码。
  目次条目本身是可编辑文字，但不会随 Word 中增删章条自动增删；此类结构性修改后应重新从 SES 导出，或手动修目次。
- 导出稿的页码域标记为待更新，Word 首次及再次打开时可能提示「域可能引用其他文件」。这份生成稿没有外部文件关系；
  提示源于自动更新标记，选「是」可在打开时计算页码。只删自动更新标记会继续提示；连同待更新标记一起删则不提示，
  但首次打开时目录页码为空。需要无提示且已填页码的**核验副本**时，必须先用 Word 计算并保存域结果；
  这种副本只对应定稿时的分页，之后修改内容或分页须重新计算。
- **取舍依据（Word for Mac 16.113，2026-09-26）**：原生 `TOC \o "1-2" \h \z \u` 更新后把章条编号后的
  一个汉字间隙变成半角空格，把附录行变成「附录A （规范性） 标题」；试过九种编号后缀/空格写法仍无法保持
  10.3.2 所要求的格式。固定条目 + `PAGEREF` 的 Word spike 已能显示正确文字、点线与页码。
  WPS 的域更新行为待取得环境后确认（§10.1）。
- 图、表目次（图 E.8 下半部分，「需要时列出」）：V1 不做。

---

## 8. 公式转换（client 宿主）

原型：`spike/wp7-docx-word/omml2.js`（已验证）。

### 8.1 管线

1. `katex.renderToString(latex, { output: 'mathml', displayMode: true, throwOnError: true })`，取 `<math>…</math>`；
2. 删除 `<annotation>…</annotation>`（否则库会逐个打印「Type not supported」）；
3. **n-ary 吸收**（§8.2）；
4. 实体占位：`&lt;`→U+E001、`&gt;`→U+E002、`&amp;`→U+E003；
5. `mml2omml(mathml)`；
6. 占位还原：U+E001→`&lt;`、U+E002→`&gt;`、U+E003→`&amp;`。

第 4、6 步的原因：`mathml2omml@0.5.0` 输出时不转义 `<`、`&`，公式含「x < 0」「A & B」时会产生非法 XML，**整个 DOCX 打不开**（实测 14 个常见公式中 3 个中招）。库本身不修改。

### 8.2 n-ary 吸收

`mathml2omml` 只把「紧跟在 n-ary 元素之后的 `<mrow>`」放进 ∑/∫ 的主体（`m:e`），而 KaTeX 输出的被加项不带 `<mrow>`，结果 `m:e` 为空、渲染出一大块空隙。预处理规则：

- 只在顺序容器（`mrow`、`math`、`semantics`、`mstyle`、`mtd`、`msqrt`、`menclose` 等）里处理；上下标、分式等按位置取子节点的元素（`msub`/`msup`/`msubsup`/`munder`/`mover`/`munderover`/`mfrac`/`mroot`/`mmultiscripts`）**不改动其子节点**；
- n-ary 元素：底为大型运算符（∑∏∐∫∬∭∮∯∰⋀⋁⋂⋃⨀⨁⨂）的 `munderover`/`munder`/`mover`/`msubsup`/`msub`/`msup`，或裸 `mo`；
- 从 n-ary 之后收集兄弟节点，维护括号深度（`(`/`[`/`{`/`⟨` 加一，右括号及挂着上下标的右括号减一）。深度为 0 时遇到 `= + − - ± ∓ < > ≤ ≥ ≈ ≠ ≡ ∼ , ;` 停止；**深度为 0 时遇到右括号也停止，且不吸收它**——它属于 n-ary 外层的分组（如 `(\sum_i x_i)+y` 中的「)」）。收集到的节点包进一个新 `<mrow>`，紧跟在 n-ary 之后。

实测：`∑xᵢ`、`∑(xᵢ−x̄)²+1`、`∫e^{−x²}dx`、`(∑ᵢxᵢ)+y`、`(∑xᵢ)²−z` 的主体全部正确。

### 8.3 失败降级

KaTeX 报错或转换异常时不传该公式的 OMML，由渲染器按 §5.10 降级，并把错误信息放进 warning。

### 8.4 已知限制（记录在案，不在本系列解决）

与点线编号同一行的公式，Word 一律按**行内样式**排版：分式缩小，∑ 的上下限排在右侧；同段落改用 `m:oMathPara` 也会被降为行内（spike v5）。这是满足 10.4.3「公式与编号之间由『……』连接」的代价。V2 可评估用 `m:limLow`/`m:limUpp` 强制上下限。

### 8.5 LGPL 合规

`mathml2omml` 以独立 chunk 动态 `import()`，不与主包合并压缩；在「关于 / 开源许可」处列出 LGPL-3.0 声明与源码地址；不修改库源码。

---

## 9. 工作包

### WP7.1 删除旧导出 + 基建（1 天）

> 2026-09-25 对照代码细化。原「迁移」一项假设 shared 已有的 `StandardType` 可以直接复用，实际它与旧导出器的
> `StandardType` 取值不同（见「元数据口径」），改为下述做法。

**删除**

- `packages/client/src/serializer/docxTemplateExporter.ts`、`docxExporter.ts`，以及 `serializer/index.ts` 中对应的导出；
- `packages/client/public/templates/` 整个目录（5 个 `.dotx`）；
- client 的 `docx` 依赖（`pnpm -F @ses/client remove docx`，同步 `pnpm-lock.yaml`）；`jszip` 保留，WP7.3 用；
- `EditorView.vue`：`docx`、`pdf-hifi` 两个分支里的模板导出与回退调用；导出面板的「标准类型模板」单选组、`selectedStandardType`。
  这组单选只用来挑 `.dotx`，模板删除后不再控制任何输出；导出时的标准类型一律取文档自身的元数据；
- 首页「导出 DOCX」入口：`DocCard.vue` 的下拉项和 `export` 事件，`HomeView.vue` 的 `@export` 与 `handleExport`，
  以及 `EditorView.vue` 中读取 `route.query.autoExport` 的代码（入口删除后没有调用方）。WP7.3 不恢复此入口；
- `README.md`：功能列表中「DOCX 导出……模板」一条改为「DOCX 交付稿：生成器重建中（见 docs/wp7-docx-delivery.md）」，技术栈表删除 `docx` 一行。

**UI（空档期）**：DOCX 卡片与「高保真 PDF」卡片保留、置为 `disabled`，副标题「重建中」，点击无反应。其余卡片不变。

**元数据口径（替代原「迁移」）**

仓库里的标准类型有两套取值：文档库口径 `StandardType`（shared `types/document.ts`：`national`/`guidance`…，存于数据库
与编辑器根节点属性）；IR 口径 `IRDocMeta.standardType`（`gb`/`guide`…，定稿接口，不改）。旧导出器的 `StandardType`
与 IR 口径相同。处理如下：

- shared 新增 `ir/meta.ts`，由 `ir/index.ts` 导出：

  ```ts
  export type IRStandardType = IRDocMeta['standardType']
  /** 文档库口径 → IR 口径：national→gb、guidance→guide；industry/local/group/enterprise 同名；也接受 gb、guide；其余返回 undefined */
  export function toIrStandardType(t: string | undefined): IRStandardType | undefined
  /**
   * 数据库文档元数据 → IR 元数据覆盖项：titleCn→title、standardNo→stdCode，titleEn/icsCode/ccsCode/issuer/applicant/
   * publishDate/implementDate 同名复制，standardType 经 toIrStandardType。只跳过 undefined，空字符串照常复制（与现行
   * EditorView 的 buildDocMeta 一致）。proposer、technicalCommittee 不进 IR
   */
  export function irMetaFromDocumentMeta(meta: DocumentMeta | undefined): Partial<IRDocMeta>
  ```

- `pmToIr` 的 `STANDARD_TYPE_MAP` 改为调用 `toIrStandardType`，顺带修正一个现存问题：改前 `guidance` 被当作无法识别的类型、按国标处理；
- client 的 `DocMeta`、`StandardType`、`STANDARD_TYPE_LABELS` 随旧导出器删除，不迁移（文档库口径的标签已在
  `constants/standards.ts` 的 `TYPE_LABELS`）；
- `EditorView` 的 `buildDocMeta()` 改为返回 `irMetaFromDocumentMeta(store.currentDocument?.meta)`；
  `buildPdfExportRequest` 的参数类型改为 `Partial<IRDocMeta>`，**函数体不变**（仍只覆盖 title/titleEn/stdCode/icsCode/ccsCode），
  PDF 输出因此与改前逐字节相同。

**shared 骨架**（`packages/shared/src/renderers/docx/`；本包不改 `renderers/index.ts`，`renderDocx` 在 WP7.2 加入）

- `units.ts`：§1.2 所列换算，结果取整；
- `xml.ts`：文本、属性转义；附录 B 所列容器（`pPr`、`rPr`、`sectPr`、`lvl`、`num`、`style`、`tcPr`、`tbl`、`tr`）的构造函数：
  调用方按元素名传入子元素 XML，构造函数按附录 B 的顺序拼接，遇到清单外的元素名直接抛错。此后各模块拼这些容器
  一律经过这里，不手写字符串；
- `package.ts`：`buildPackage(input) → DocxPackage`。输入为 `word/document.xml` 全文与可选部件（styles、numbering、
  页眉页脚、media…）、`createdAt`、标题。要求：
  - 关系 ID 由本模块的分配器按调用顺序发放（`rId1`、`rId2`…）：渲染器生成 `document.xml` 时先为页眉页脚、图片申请 ID；
    styles、settings、fontTable、numbering 的关系由 `buildPackage` 最后自动登记；
  - `[Content_Types].xml`、`_rels/.rels`、`word/_rels/document.xml.rels` 按包内实际存在的部件生成；
  - `word/settings.xml` 按 §2.4 全文输出；`word/fontTable.xml` 登记宋体、黑体、Times New Roman、Cambria Math；
  - `docProps/core.xml` 的创建、修改时间都取 `createdAt`，不读系统时间；`docProps/app.xml` 的 Application 写 `SES`；
- 最小 DOCX（测试 fixture `minimal`）：一个段落，外加 `w:body` 末尾的 `sectPr`（§2.1 的纸张、页边距与文档网格，不引用页眉页脚）。

**测试基建**：见 §10.2（shared 零新增依赖）。**核对工具**：见 §10.3。

**验收**

1. `pack.py` 打包 `minimal` 的 golden 目录，Word 打开无修复提示；`word_pdf.py` 能把它导出为 PDF；
2. `measure.py` 对 `spike/wp7-docx-word/spike-word.pdf` 的输出与 §10.3 的基准表一致；
3. `pnpm -F @ses/shared test`、`pnpm -F @ses/client test` 全绿；`pnpm -F @ses/shared exec tsc --noEmit` 与 `pnpm -F @ses/client build`（含 `vue-tsc -b`）通过；
4. 在 `packages/`（不含 `node_modules`）与 `README.md` 中搜索
   `docxExporter|docxTemplateExporter|exportDocx|STANDARD_TYPE_LABELS|selectedStandardType|autoExport|\.dotx|from 'docx'` 无结果；
5. `pdfExporter.ts` 的 diff 只有 import 行与参数类型两处；在应用里实际导出一次 PDF（vivliostyle）确认可用；
6. 新增测试覆盖：`toIrStandardType` 全部 6 个文档库取值与 `gb`/`guide`/未知值；`irMetaFromDocumentMeta` 的字段映射与
   undefined/空字符串规则；`pmToIr` 对 `guidance` 不再报警告。

### WP7.2 结构渲染：样式、编号、分节（3.5 天）

> 2026-09-25 对照代码与 Word 实测（spike v10）细化。原规格要求 WP7.2「用手写 IR 生成 DOCX 并与 Resolver 一致」，而章条、
> 术语、注、列项等要素的渲染排在 WP7.3——缺了它们，WP7.2 无法从 IR 生成带编号的 DOCX。现把 §5 中决定编号与版式结构的
> 部分移入 WP7.2，WP7.3 收窄为目次、终结线与 client 接入。

**范围**

- `styles.ts`：§3.2 全部样式，按 §3.1 的约定；
- `numbering.ts`：§4.2 的 A1–A16 定义与 §4.3 的实例分配器；
- `sections.ts`：§2.2 的节序、sectPr、分节空段，§2.3 的四个页眉页脚部件；
- `body/*.ts`：§5.1–5.7、§5.11、§5.12、§5.14；图、表、公式只输出与编号有关的部分和占位段（见下表）；
- `cover.ts`：封面占位（见「文档结构」第 1 项）；
- `index.ts`（`renderDocx`）与 `render.ts`（`renderDocxTraced`，§4.7）；`renderers/index.ts` 加 `export * from './docx'`，
  `docx/index.ts` 只导出 `renderDocx`、`DocxRenderOptions`、`DocxPackage`；
- `xml.ts`：按附录 B 补 `numPr`、`abstractNum`、`numbering`、`styles`、`docDefaults`、`pBdr` 六个容器的子元素顺序
  （`assertChildOrder` 随之覆盖它们）；
- 测试：§4.7 模拟器与比对、§10.2 的增补；核对工具：§10.3 的 `expect.py`。

**不在本包**：目次条目与页码域（WP7.3；本包目次节只有标题）、终结线与末段 keepNext（WP7.3）、图片、表格本体与表注、公式 OMML 与式中、
横排（WP7.4）、封面正文（WP7.5）、client 接入与按钮（WP7.3）。不改 IR 类型、HTML 渲染器与 client；Resolver 只做 §4.7
「遍历顺序」的两处调整。

**文档结构**（节序与 sectPr 见 §2.2）

1. 封面节（占位）：一个 P(SesCoverStdNo, `meta.stdCode`)；stdCode 缺失时输出空段并记 `cover-field-missing`。WP7.5 替换封面节
   的内容，但必须保留这个段落（书眉 STYLEREF 的取值来源，§2.3）；
2. 目次节：P(SesTocTitle, 「目」+「次」)，「目」的 run 带 `w:spacing w:val="640"`（WP7.3 在其后加目次条目与页码域）；
3. 前言节、引言节（各自非空才有）：§5.14；
4. 正文节：§5.1 的正文首页名称，随后各章（§5.2–5.7）；
5. 每个附录一节：§5.11，随后是附录的子节点；
6. 参考文献节（非空才有）：§5.12。

docProps 的标题取 `meta.title`（缺失为空串），时间取 `opts.createdAt`。`opts.images`、`opts.formulaOmml`、`opts.stage` 本包不用。

**图、表、公式在本包的输出**（WP7.4 替换占位段）

| 要素 | 输出 |
|---|---|
| 图 | P(SesFigure, 「〔图片占位〕」) → 图的 `notes`（§5.7，作用域为该图）→ 图题：正文 P(SesFigCap, caption)；附录 P(SesAppFigCap, caption) + 本附录的 A5 实例 |
| 表 | 表题：正文 P(SesTblCap, caption)；附录 P(SesAppTblCap, caption) + 本附录的 A6 实例 → P(SesTableCenter, 「〔表格占位〕」)；单元格内容与表注本包不输出 |
| 公式 | P(SesFormula, 首个制表位 + 「〔公式占位〕」；`numbered` 时再接第二个制表位和中文圆括号编号，编号 run 显式宋体)；编号公式缺 label 时不写编号并记 `label-missing`；式中本包不输出 |

`orientation` 本包忽略；`captionEn` 不输出（§5.8、§5.9）。

**warning**（本包产生的全部 code；`message` 用中文写明节点与原因）

| code | 何时 | nodeId |
|---|---|---|
| `cover-field-missing` | `meta.stdCode`、`meta.title` 缺失，各记一条（WP7.5 沿用这两条，不重复记） | 无 |
| `clause-too-deep` | 条或术语条目的编号级别超过 5（§4.4） | 该条或术语条目 |
| `list-format-fallback` | boxed 列表；嵌套列表的类型与实际显示的格式不符（§4.4） | 该列表 |
| `list-too-deep` | 第三层及更深的列表（§4.4） | 该列表 |
| `label-missing` | 注、示例、编号公式在 `labels` 中没有 label | 该节点 |

**测试**（放在 `__tests__/`；每个渲染测试都做 §10.2 的四项断言，外加 `assertNumberingIntegrity`）

- 单元测试：
  - styles：§3.2 每个样式都在（ID、中文名、`basedOn`、`w:next`）；属主样式的 numPr 与 §3.2「编号」列一致；标「缩进见 Ax」
    的样式不含 `ind`；SesNormal 为默认段落样式；
  - numbering：A1–A16 逐级与 §4.2 一致（numFmt、lvlText、suff、ind、rPr）；固定实例的 numId；按需实例从 101 递增、每级都有
    startOverride；交错时新建实例、起始值为 N；附录实例的 L0 覆盖；
  - sections：有无前言、引言、附录、参考文献的各种组合下的节序、type、pgNumType、页眉页脚引用个数（用大纲的 § 行断言）；
    页眉页脚部件的内容；
  - runs：各 mark、crossRef（有 label / 无 label）、文字中间的 `\n`、XML 特殊字符、正文首页名称的空格规则；
  - 参考文献前缀剥离（§5.12）：前缀在一个 run 里；前缀拆在多个 run 里，剩余部分的 marks 保留；全角方括号；前缀范围内有
    crossRef run 时不剥离；没有前缀时原样输出；
  - 参考文献顺序：按 `labels[id].xmlId` 的序号排列，没有 label 的排在最后；
  - warning：每个 code 至少一例；
  - 空文档（无章、无附录、无参考文献、无前言引言）能生成并通过全部检查。
- 模拟器自测：§4.7 表全部用例。
- 一致性 fixture（都有 golden 目录与大纲快照，都跑 §4.7 比对）：
  - `numbering`：手写 IRDoc（`__tests__/fixtures/numbering.ts`，直接构造 IR、不经 pmToIr，以便覆盖 pmToIr 产生不了的结构），
    `meta.stdCode` 用「GB/T 99999—2026」。至少包含：
    - 前言：两条注、一个示例；引言：一张图（验证图号从引言起算）、一条注；
    - 条：两层以上的有标题条；无标题条（首块为段落；首块为列表 → 只有编号的段）；新章首条从 N.1 起；深度 5 的条链；
      一个 `level` 与深度不一致的条（按深度编号）；
    - 术语：章直属两条（其中一条带 termEn、定义、两个示例、两条注、来源）、条内术语（如 3.3.1）、附录直属术语（A.n）；
    - 注：条内两条注之间夹一张带两条注的图（交错，§4.3）；有两段的单条注；多条注中有一条有两段；第一块不是段落的注；
    - 示例：同一作用域两个示例、另一作用域一个示例；
    - 列项：alpha（项下嵌 number 列表、项下嵌 dash 列表）、number、boxed；dash 下嵌 number 列表（按间隔号输出）；
      三层嵌套（第三层 dash 与非 dash 各一，均按间隔号输出）；一项两段（续段）；
      第一块是嵌套列表的项；
    - 图、表：正文至少两图两表且跨章；附录 A、B 各有图和表（每个附录从 1 起），附录 A 至少两张图；
    - 公式：编号、不编号各一；
    - 参考文献：三条，正文按与 IR 不同的顺序引用其中两条；一条 content 以拆在三个 run 里的「[9] 」开头（`[`、加粗的 `9`、
      `] ` 接正文），验证 §5.12 的跨 run 剥离；
    - 交叉引用：条、图、表、公式、参考文献各一处；
    - 遍历顺序（§4.7）：一张图的注里再嵌一张图；一个术语条目的示例与注里各嵌一张图；
    - **期望标记**（供 §10.3 `expect.py` 在 Word 的 PDF 上核对）：每个带编号的段落都用下列标记之一写明期望的标识（列项写
      手写的期望，其余写 Resolver 的 label）：
      - 「〔期望 X〕」：写在带编号段落自己的文字末尾；
      - 「〔前段期望 X〕」：写在只有编号、没有文字的段落（术语和定义章内的术语条目编号段、示例标识段、只有编号的无标题条 / 注 / 列项）的
        **下一段**；
      - 「〔附录期望 X〕」：写在第三个附录标题段末尾；其前两段依次是附录编号、附录性质。

      带标记的段落文字要短，保证在 Word 中排成一行，且不以
      数字或「.」开头。测试断言每个标记与模拟器一致：「期望」「附录期望」
      对本段、「前段期望」对上一段的 label（去掉末尾一个 U+3000）；列项的手写期望即取自这些标记。
  - `full`：`pmToIr(fullFixture()).doc` 经 `resolve` 的结果（不改 fixture）；列项手写期望 li-1 → a）、li-2 → b）。
- `numbering` fixture 的 warnings 与期望列表完全一致（boxed、三层嵌套等）。
- Resolver（`ir/__tests__/resolve.test.ts`）：图的注中嵌图时，注里的图先编号；术语条目的示例与注中各嵌一张图时，示例里的
  图先编号；术语条目的示例与注中各引用一条参考文献时，示例里引用的排在前面。

**验收**

1. `pnpm -F @ses/shared test`、`pnpm -F @ses/client test` 全绿；`pnpm -F @ses/shared exec tsc --noEmit` 与
   `pnpm -F @ses/client build` 通过（`renderers/index.ts` 导出 docx 后，client 构建会编译这部分代码）；
2. 模拟器自测复现 §4.7 表的全部用例；
3. `numbering`、`full` 两个 fixture 的 §4.7 比对全部一致（逐段标识与覆盖检查），期望标记断言通过；
4. `pack.py` + `word_pdf.py`：两个 golden 在 Word 中打开无修复提示；`expect.py` 对 `numbering` 的 PDF 全部通过（这一步核对的是
   Word 实际排出的编号，不只是模拟器）；
5. `measure.py` 对 `full` 的 PDF：页序依次为封面、空白、目次（I）、前言（II）、引言（III）、正文（从 1 起）……、附录 A、
   附录 B、参考文献（`oddPage` 自动插入的空白页照实列出）；各页数值与 §10.3 基准表相差不超过 ±0.5 mm；封面与空白页之外，
   每页书眉为「GB/T 12345—2026」，页码前置部分为罗马数字、正文起为阿拉伯数字；
6. 输出中除上表三种占位文字外，没有其他占位或 TODO 文字；IR 类型、HTML 渲染器与 client 没有改动，Resolver 只有 §4.7
   「遍历顺序」的两处调整。

PR 描述附「验收标准逐项自查表」、两个 fixture 的大纲（节选）与 `expect.py`、`measure.py` 的完整输出。

### WP7.3 目次、终结线 + 重新开放 DOCX 按钮（2 天）

> 2026-09-25：§5 的结构渲染已移入 WP7.2，本包只剩目次、终结线与 client 接入；开工前按惯例对照代码细化。

- 实现 §7（固定目次条目、目标书签、`PAGEREF` 页码域，接在 WP7.2 的目次标题之后）与 §5.13（终结线、末个内容段 keepNext）。
- client 薄壳：`pmToIr` → `resolve` → `renderDocx` → JSZip → 下载。
  `pmToIr` 之后用 `irMetaFromDocumentMeta(store.currentDocument?.meta)` 覆盖 IR meta 中所有非 undefined 的字段（封面、书眉
  要用标准类型、文件编号、发布机构、日期；与 PDF 只覆盖五项不同，是有意的）；`opts.stage` 取 `store.currentDocument.stage`，
  `createdAt` 取导出时刻。
- DOCX 卡片重新启用，副标题「测试版 · 图表公式暂为占位」；DOCX 转换预览卡片在服务端具备 LibreOffice 转换能力时恢复
  （它转换的就是新生成的 DOCX）。两张 PDF 卡片命名为「版式预览（GB/T 1.1 排版）」「DOCX 转换预览」。
  本机 LibreOfficeDev 26.8 转换样稿虽能显示条目与页码，但前言/引言的 PAGEREF 返回阿拉伯页码，且分页与 Word 不同；
  因此转换稿仅供预览，最终 DOCX 版式以 Word 验收结果为准。
  用户已决定 WP7.4 合并前先开放 DOCX 测试版；图、表、公式在本包仍是 WP7.2 占位段，WP7.4 合并时去掉副标题后半句。
- **验收**：全要素 fixture 在 Word 中计算页码域后，目次条目的标题、编号与 Resolver 一致，章条后一个汉字间隙和附录行格式符合 10.3.2；
  终结线与末个内容同页；Word 渲染逐项对照本包覆盖的 §5 内容（附截图或测量记录）。
  用户当前只要求 Word 验收，WPS 待有环境时再核对，不作为本包完成的前置条件。

### WP7.4 表格、图片、公式、横排（3 天）

- **开工前半天 spike**（Word，另备 WPS）：表头跨页重复、横排节书眉页码、`spike/wp7-docx-word/omml2.js` 的公式样例在两端的渲染。结论写进 PR。
- 实现 §5.8–5.10、§8（公式转换放 client，动态 import `mathml2omml`）、横排节；替换 WP7.2 的三种占位段。
- 表注：按 §5.9 放在表内最后一行，内容按 §5.7——单条用 SesTableNote + 段落级 numPr 指向 A7 固定实例（spike v10 T6），多条用
  SesTableNote + 按 §4.3 分配的 A8 实例，作用域键为该表的 id；§4.7 比对的覆盖检查加入表格内部的节点。
- **验收**：14 个样例公式（含 `<`、`&`、∑、∫、根号、矩阵、分段函数，以及括号包住 ∑ 的写法）全部可打开、主体正确；含 rowspan 与 colspan 组合合并的表格网格正确（续格带相同 `gridSpan`）；横排图、横排表各至少一例，连续横排共用一节，末要素为横排时终结线同页；横排页书眉页码位置经人工确认。

### WP7.5 封面（2 天）

- 实现 §6；按 §6.4 替换素材；补 §6.5 的 IRDocMeta 字段与 `pmToIr` 映射。封面节替换 WP7.2 的占位，保留 SesCoverStdNo 段（§2.3）。
- 开工前补全 §6.3 的阶段映射：`DocumentStage` 有 7 个取值（工作草案、征求意见稿、送审讨论稿、送审稿、报批稿、公示稿、
  发布稿），§6.3 只写了其中几种。
- **验收**：6 类封面在 Word 渲染后，用墨迹测量对照 §6.1/§6.2 目标位置（±1 mm）；征求意见稿、送审稿封面有专利征集说明。

### WP7.6 交付验收（1 天，主导人 + 用户）

用一份真实标准文稿走完整流程，在 Word 与 WPS 中对照附录 E 逐项核对，问题清单作为修订依据。

合计约 12.5 个工作日。WP7.2 完成后，WP7.3–7.5 改动的是不同模块，可以并行。

---

## 10. 验收环境、测试基建与核对工具

### 10.1 环境

- **Word（macOS）**：AppleScript 导出 PDF 已验证（Word 16.113）。输入输出文件必须放在 `~/Library/Containers/com.microsoft.Word/Data/` 下，否则 Word 沙盒会弹授权窗口；首次运行需在系统设置中允许「控制 Microsoft Word」。
- **WPS**：主导人本机未安装。用户决定 WP7.3 当前只在 Word 验收；取得 WPS Office for Mac 或 Windows 环境后再按同一清单核对，
  其结果目前是未验证项，不得以 Word 结果代替。
- **测量**：用 `scripts/docx-check/measure.py`（§10.3），与 §2.1、§6.1 的毫米值比对。

### 10.2 shared 测试基建（WP7.1 建立，WP7.2 增补，后续各包沿用）

shared 不新增任何依赖（包括 devDependencies）。下列文件都是测试代码，放在 `packages/shared/src/renderers/docx/__tests__/`，
不从任何 `index.ts` 导出。辅助文件不以 `.test.ts` 结尾，会被 shared 的 `tsc` 检查，同样不得使用 Node 或浏览器 API。

| 文件 | 内容 |
|---|---|
| `helpers/xmlTree.ts` | 最小 XML 解析器，产出 `{ name, attrs, children }` 树（文本为独立节点）。支持 XML 声明、带前缀的元素名与属性名、单双引号、5 个预定义实体与数字字符引用、自闭合标签。以下情况抛错并给出位置：标签不配对或未闭合；文本或属性值中出现未转义的 `<` 或 `&`；同一元素属性重复；多个根元素；根元素之后还有内容。生成器不输出注释、CDATA、DTD 和处理指令（XML 声明除外），解析器遇到也抛错 |
| `helpers/checks.ts` | `assertWellFormed(pkg)`：每个部件都能解析；`[Content_Types].xml` 为每个部件、每种二进制扩展名给出类型；每个 `.rels` 的 Target 都存在于包内（悬空关系会触发 Word 的修复提示）。`assertChildOrder(pkg)`：遍历所有部件，附录 B 所列容器的子元素必须是清单的子序列（`sectPr` 开头的 headerReference/footerReference 之间不限顺序），出现清单外的子元素也算失败。**WP7.2 增补**：`assertWellFormed` 另查每个 XML 部件中 `r:id`、`r:embed`、`r:link` 属性的值，在该部件自己的关系文件（`<目录>/_rels/<文件名>.rels`）里有同 Id 的 Relationship，且每个 `.rels` 内 Id 不重复；新增 `assertNumberingIntegrity(pkg)`：段落与样式引用的 numId 都在 `numbering.xml` 中、每个 num 的 abstractNumId 都存在，且每个 (abstractNumId, ilvl) 至多被一个样式的 numPr 引用（§4.1 约束 1） |
| `helpers/outline.ts` | `docxOutline(pkg)`：按 `document.xml` 顺序每段一行，格式 `样式ID │ 编号 │ 文本`。编号一栏在 WP7.1 写 `numId:ilvl`（无 `numPr` 写 `—`），**WP7.2 起改为 §4.7 模拟器的 label 去掉末尾一个 U+3000**（无编号写 `—`）。文本中 `w:br` 记为 `⏎`、`w:tab` 记为 `⇥`，公式记为 `〔公式〕`，图片记为 `〔图〕`；表格内段落的行首加 `┆`；每个 `sectPr` 单独一行，写在它所结束那一节的末段之后，**WP7.2 起格式为** `§ type=… pgNumType=… start=… orient=… refs=…`：`start` 为 `pgNumType` 的 `w:start`，`refs` 为 headerReference 与 footerReference 的个数，缺失的属性写 `—`（`minimal` 的快照随之更新）。用 `toMatchSnapshot()` 固化 |
| `helpers/numberingSim.ts` | §4.7 的 Word 编号模拟器（WP7.2） |
| `__golden__/<fixture>/` | 需要在 Word 中核对的 fixture：每个部件用 `await expect(…).toMatchFileSnapshot(路径)` 写成一个文件（二进制部件写 base64，文件名加 `.b64`），即解包后的 DOCX 目录，PR 里可以直接看 XML diff。WP7.1 只有 `minimal`，WP7.2 增加 `numbering`、`full` |

每个渲染测试都断言四项：`assertWellFormed`；`assertChildOrder`；同一输入两次输出深度相等；`JSON.parse(JSON.stringify(pkg))` 与原值深度相等。
有 `word/numbering.xml` 的包另断言 `assertNumberingIntegrity`。每个新增检查都要有「篡改合法包后必须抛错」的反例测试（同 WP7.1 的 `checks.test.ts`）。

### 10.3 核对工具 `scripts/docx-check/`

Python 3 + PyMuPDF，本地核对用，不是项目依赖，不进 CI。

| 脚本 | 用法 | 要求 |
|---|---|---|
| `pack.py` | `pack.py <golden 目录> <out.docx>` | 把目录打成 zip：`[Content_Types].xml` 放第一个，其余按路径排序；`.b64` 文件解码后去掉该后缀；条目时间固定为 1980-01-01 |
| `word_pdf.py` | `word_pdf.py <in.docx> <out.pdf>` | 复制到 `~/Library/Containers/com.microsoft.Word/Data/ses-check/`（沙盒内，免授权弹窗）；把**副本**的 `settings.xml` 中 `w:updateFields` 和 `document.xml` 中 `w:dirty="true"` 都删去，避免 Word 的「更新域」提示卡住自动化；AppleScript：打开并核对副本路径 → 兼容旧 spike 的原生目次更新 → 更新这份文档的所有域（含 WP7.3 的 `PAGEREF`）→ 另存为 PDF → 不保存关闭这份文档；把 PDF 复制到 `out.pdf`；120 秒无结果则报错退出 |
| `measure.py` | `measure.py <pdf> [--pages 3-9] [--json]` | 300 dpi 灰度渲染，灰度 < 128 为墨迹，连续的墨迹行归为一个「行块」。每页输出：首个行块的字顶与左右范围（有书眉的页即书眉）；第二个行块的字顶（书眉之后的首行或标题）；末个行块底边距纸底（页码）；末个行块距外侧纸边（单数页量右侧，双数页量左侧，页序从 1 起算）。整页无墨迹时输出「空白页」。单位 mm，保留一位小数 |
| `expect.py`（WP7.2） | `expect.py <pdf>` | PyMuPDF 按 span 取文字：同一页上基线（span `origin` 的 y）相差不到 1 pt 的 span 归为一个「视觉行」，行内按 x 排序拼接。在视觉行中找三种期望标记（§9 WP7.2）：「〔期望 X〕」——本行去掉全部空白后以 X（同样去掉空白）开头，且紧接 X 的字符不是数字或「.」；「〔前段期望 X〕」——同一页的上一个视觉行去掉空白后等于 X；「〔附录期望 X〕」——同一页往上第二个视觉行去掉空白后等于 X。逐条输出通过或失败及实际文字；有失败、或一个标记也没找到时退出码为 1 |
| `README.md` | — | 各脚本的用法、Word 首次运行的授权步骤、下表基准值 |

WP7.3 的固定目次会复制标题中的期望标记；`expect.py` 跳过带连续点线的目次行，避免把目录文字误判为正文编号。

`measure.py` 的验收基准：对 `spike/wp7-docx-word/spike-word.pdf` 运行，第 2–9 页应得到下表（±0.3 mm；字顶随首行字形
不同有 0.2 mm 左右的出入）。第 1 页是 spike 的简化封面，不比对。下表由主导人用同一算法实测。

| 页 | 内容 | 首个行块字顶 | 第二个行块字顶 | 末个行块底边距纸底 | 距外侧纸边 |
|---|---|---|---|---|---|
| 2 | `oddPage` 插入的空白页 | 空白页 | | | |
| 3 | 目次 | 26.0 | 43.9 | 20.7 | 24.1 |
| 4 | 前言 | 26.0 | 43.9 | 20.7 | 24.1 |
| 5 | 正文首页 | 26.0 | 43.9 | 20.7 | 24.4 |
| 6 | 正文续页 | 26.0 | 35.3 | 20.7 | 24.0 |
| 7 | 附录 A | 26.0 | 44.3 | 20.7 | 24.2 |
| 8 | 附录 B | 26.0 | 44.3 | 20.7 | 24.0 |
| 9 | 参考文献 | 26.0 | 44.2 | 20.7 | 24.2 |

---

## 附录 A：spike 结论摘要

见 `spike/wp7-docx-word/README.md`。要点：从零生成的 DOCX 能被 Word 正常打开；分节、奇偶书眉、`STYLEREF`、罗马/阿拉伯页码分区、空白页、目次域均可行；「一级别一样式」「跳级隐式计数」「分页吞段前距」「sectPr 描述所结束的节」四条是实现时最容易踩的坑，本规格已给出对应做法。
v10（2026-09-25，`probe_v10.py`）补第五条：**编号计数按 abstractNum 共享，`startOverride` 只在实例第一次被使用时生效**
（§4.3 的分配规则由此而来）；另测得 STYLEREF 缺值时的表现（§2.3）、标题字距的写法（§3.3）、分节空段不会挤出空白页（§2.2）、
字母与罗马编号的格式（§4.7 模拟器自测）。

## 附录 B：OOXML 子元素顺序（易错清单）

- `w:pPr`：pStyle, keepNext, keepLines, pageBreakBefore, framePr, widowControl, numPr, suppressLineNumbers, pBdr, shd, tabs, suppressAutoHyphens, kinsoku, wordWrap, overflowPunct, topLinePunct, autoSpaceDE, autoSpaceDN, bidi, adjustRightInd, snapToGrid, spacing, ind, contextualSpacing, mirrorIndents, suppressOverlap, jc, textDirection, textAlignment, textboxTightWrap, outlineLvl, divId, cnfStyle, rPr, sectPr, pPrChange
- `w:rPr`：rStyle, rFonts, b, bCs, i, iCs, caps, smallCaps, strike, dstrike, outline, shadow, emboss, imprint, noProof, snapToGrid, vanish, webHidden, color, spacing, w, kern, position, sz, szCs, highlight, u, effect, bdr, shd, fitText, vertAlign, rtl, cs, em, lang, eastAsianLayout, specVanish, oMath
- `w:sectPr`：headerReference/footerReference（任意顺序，最多 6 个）, footnotePr, endnotePr, type, pgSz, pgMar, paperSrc, pgBorders, lnNumType, pgNumType, cols, formProt, vAlign, noEndnote, titlePg, textDirection, bidi, rtlGutter, docGrid, printerSettings
- `w:lvl`：start, numFmt, lvlRestart, pStyle, isLgl, suff, lvlText, lvlPicBulletId, legacy, lvlJc, pPr, rPr
- `w:num`：abstractNumId, lvlOverride*（`lvlOverride` 内：startOverride, lvl）
- `w:style`：name, aliases, basedOn, next, link, autoRedefine, hidden, uiPriority, semiHidden, unhideWhenUsed, qFormat, locked, personal…, rsid, pPr, rPr, tblPr, trPr, tcPr, tblStylePr
- `w:settings`（本规格用到的）：mirrorMargins, defaultTabStop, evenAndOddHeaders, characterSpacingControl, updateFields, compat, m:mathPr
- `w:tbl`：tblPr, tblGrid, tr+；`w:tr`：trPr, tc+；`w:tc`：tcPr, 块内容（至少一个 `w:p`）
- `w:tcPr`：cnfStyle, tcW, gridSpan, hMerge, vMerge, tcBorders, shd, noWrap, tcMar, textDirection, tcFitText, vAlign, hideMark
- `w:numPr`：ilvl, numId（WP7.2 补；`ilvl` 在前）
- `w:abstractNum`：nsid, multiLevelType, tmpl, name, styleLink, numStyleLink, lvl*（WP7.2 补）
- `w:numbering`：numPicBullet*, abstractNum*, num*, numIdMacAtCleanup（WP7.2 补）
- `w:styles`：docDefaults, latentStyles, style*；`w:docDefaults`：rPrDefault, pPrDefault（WP7.2 补）
- `w:pBdr`：top, left, bottom, right, between, bar（WP7.2 补）
