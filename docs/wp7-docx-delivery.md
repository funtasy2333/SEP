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
> **修订记录**：2026-09-25 对照代码现状细化 WP7.1（标准类型的两套取值、导出面板与首页入口、shared 骨架接口），
> 新增 §10.2 测试基建、§10.3 核对工具。

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
| `index.ts` | `renderDocx` 入口与类型导出 |
| `units.ts` | mm→twips（×1440/25.4）、磅→半磅、mm→EMU（×36000）、汉字宽（五号 = 210 twips） |
| `xml.ts` | 转义；按 ECMA-376 固定子元素顺序拼 `pPr`/`rPr`/`sectPr`/`lvl`（附录 B），顺序错误 Word 会报「无法读取的内容」 |
| `styles.ts` | §3 样式表（数据）→ `word/styles.xml` |
| `numbering.ts` | §4 编号定义 + 实例分配器 → `word/numbering.xml` |
| `sections.ts` | §2 分节、`sectPr`、页眉页脚部件 |
| `cover.ts` | §6 封面（6 类） |
| `toc.ts` | §7 目次域及缓存结果 |
| `body/*.ts` | §5 各要素渲染（章条、术语、列项、注、示例、图、表、公式、附录、参考文献、行内） |
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

`DocumentStage` 复用 `packages/shared/src/types` 中已有的类型。

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
| 封面 | （首节，任意） | 不写 | **不写**（首节无引用即无页眉页脚） | 封面 |
| 目次 | `oddPage` | `fmt="upperRoman" start="1"` | 四个部件 | 目次 |
| 前言 | `nextPage` | `fmt="upperRoman"`（续编，**必须显式写 fmt**） | 四个部件 | 前言 |
| 引言（有则） | `nextPage` | `fmt="upperRoman"` | 四个部件 | 引言 |
| 正文 | `oddPage` | `fmt="decimal" start="1"` | 四个部件 | 正文首页名称 + 各章 |
| 每个附录 | `nextPage` | `fmt="decimal"` | 四个部件 | 附录 |
| 参考文献（有则） | `nextPage` | `fmt="decimal"` | 四个部件 | 参考文献 + 终结线 |

- **`sectPr` 写在一节的最后一段的 `pPr` 里（最后一节写在 `w:body` 末尾），描述的是它所结束的那一节**：`w:type` 是这一节如何起页，`pgNumType` 是这一节的页码格式与是否重起。实现时维护「当前节属性」，开新节时把上一节属性写进上一节末段（参照 `gen_spike.py` 的 `start_section`）。
- **为什么前言、附录、参考文献要各起一节**：Word 在分页后的页首会吞掉段前距（`pageBreakBefore` 与手动分页符都会被吞），只有节的第一段保留段前距。这些标题「书眉下空 15 mm」只能靠分节实现（spike v6–v9）。
- 无目次时省略目次节，前言节改为 `oddPage` + `upperRoman start=1`。
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
  - 黑体类：`rFonts` 四个属性都为 `"黑体"`（章条编号数字也用黑体，表 F.1 #33）
- 字号（半磅 `w:sz`，同时写 `w:szCs`）：一号 52、小一 48、二号 44、小二 36、三号 32、四号 28、五号 21、小五 18、六号 15。
- 「空 N 个汉字」按五号计：1 字 = 210 twips；字符单位属性（`firstLineChars` 等）同时写 twips 回退值。
- 「上下各空一行 / 半行」用 `beforeLines/afterLines = 100/50`，并同时写 `before/after = 312/156`。
- 正文段落对齐文档网格（缺省）。**三号标题关闭网格**（`<w:snapToGrid w:val="0"/>`）并用固定 20 磅行距，否则三号字在网格上占两行、整体下移约 3 mm（spike v6）。
- 格式只写在样式里。段落上只允许写 `pStyle`、段落级 `numPr`、`tabs`（式中条目）、`keepNext`（§5.13）、`framePr`（封面）、`sectPr`；行内只允许写 `b/i/u/vertAlign`（来自 IR marks）与标题字距 `w:spacing`（§3.3）。

### 3.2 样式清单

| 样式 ID | 中文名 | 字体字号 | 段落属性 | 大纲 | 编号 | 依据 |
|---|---|---|---|---|---|---|
| SesNormal | SES_正文基础 | 宋 五 | `jc=both` widowControl autoSpaceDE autoSpaceDN；默认段落样式 | — | — | 表 F.1 #34 |
| SesPara | SES_段 | 继承 | 首行缩进 2 字（420） | — | — | 10.2.1 |
| SesTocTitle | SES_目次标题 | 黑 三 | `jc=center`；无网格；段前 500 段后 600 固定 20 磅 | — | — | 图 E.8、#14；实测字顶 43.9 mm、到下文 12.6 mm |
| SesFrontTitle | SES_前言引言标题 | 黑 三 | 同 SesTocTitle | 0 | — | 图 E.9、#16/#18 |
| SesBodyTitle | SES_正文首页名称 | 黑 三 | 同 SesTocTitle | — | — | 图 E.3、#20 |
| SesChapter | SES_章标题 | 黑 五 | keepNext；段前段后各 1 行；缩进 0 | 0 | 属主：章条 L0 | 10.2.1、#33 |
| SesClause1…5 | SES_一级条标题…五级条标题 | 黑 五 | keepNext；段前段后各半行；缩进 0 | 1…5 | 属主：章条 L1…L5 | 10.2.1 |
| SesNoTitle1…5 | SES_一级无标题条…五级无标题条 | 宋 五 | 缩进 0 | — | 段落级：章条 L1…L5 | 10.2.1（编号顶格，空一字接条文） |
| SesTermNum | SES_术语条目编号 | 黑 五 | keepNext；缩进 0；段前段后 0 | — | 段落级：章条 Ln | 10.3.5、#22 |
| SesTermHead | SES_术语 | 黑 五 | keepNext；缩进 0 | — | — | #23 |
| SesAppendix | SES_附录标识 | 黑 五 | keepNext；`jc=center`；段前 520 段后 150（起始值，按 §10 实测调整） | 0 | 属主：附录 L0 | 图 E.12、#25–27 |
| SesAppClause1…5 | SES_附录一级条标题… | 黑 五 | 同 SesClause | 1…5 | 属主：附录 L1…L5 | 9.6.3.1 |
| SesAppNoTitle1…5 | SES_附录一级无标题条… | 宋 五 | 缩进 0 | — | 段落级：附录 L1…L5 | 9.6.3.1 |
| SesListDash | SES_破折号列项 | 宋 五 | 由编号级别定缩进 | — | 属主：破折号 L0 | 10.2.2 |
| SesListDot | SES_间隔号列项 | 宋 五 | 同上 | — | 属主：破折号 L1 | 10.2.2 |
| SesListItem | SES_编号列项 | 宋 五 | 同上 | — | 段落级：按列表实例 | 10.2.2 |
| SesListCont | SES_列项续段 | 宋 五 | 左缩进 = 所在层次文字位置（840 / 1260），首行 0 | — | — | 10.2.2 回行对齐 |
| SesNote | SES_注 | 宋 小五 | 左 780 悬挂 360（首行起于 420 = 2 字） | — | 属主：注 L0（「注：」） | 10.4.4.1、#43/#44 |
| SesNoteN | SES_注X | 宋 小五 | 左 870 悬挂 450 | — | 段落级：每组一个实例 | 同上 |
| SesNoteCont | SES_注续段 | 宋 小五 | 左 780（单条）/ 870（多条），首行 0 | — | — | 10.4.4.1 |
| SesExLabel | SES_示例标识 | 宋 小五 | keepNext；首行 420 | — | 属主：示例 L0（「示例：」） | 10.4.5、#41 |
| SesExLabelN | SES_示例X标识 | 宋 小五 | 同上 | — | 段落级：每组一个实例 | 同上 |
| SesExText | SES_示例内容 | 宋 小五 | 首行 420，回行顶格 | — | — | 10.4.5、#42 |
| SesFigure | SES_图 | — | `jc=center`；keepNext；缩进 0 | — | — | 10.4.2 |
| SesFigCap | SES_图题 | 黑 五 | `jc=center`；段前段后各半行 | — | 属主：正文图 L0 | 10.4.2、#36 |
| SesAppFigCap | SES_附录图题 | 黑 五 | 同上 | — | 段落级：每附录一个实例 | 9.6.3.1 |
| SesTblCap | SES_表题 | 黑 五 | `jc=center`；keepNext；段前段后各半行 | — | 属主：正文表 L0 | 10.4.2、#36 |
| SesAppTblCap | SES_附录表题 | 黑 五 | 同上 | — | 段落级：每附录一个实例 | 9.6.3.1 |
| SesTableText | SES_表格文字 | 宋 小五 | 首行 1 字（210），回行顶格 | — | — | 10.4.2.2、#40 注 a |
| SesTableCenter | SES_表格居中 | 宋 小五 | `jc=center`，缩进 0 | — | — | 10.4.2.2（表头、数字） |
| SesTableNote | SES_表注 | 宋 小五 | 同 SesNote / SesNoteN | — | 段落级：每表一组实例 | 10.4.4.1 |
| SesFormula | SES_公式 | 宋 五 | 制表位：居中 4677、右对齐 9355 点线；缩进 0；段前段后各半行 | — | 编号为 Resolver 文字 | 10.4.3 |
| SesWhereLabel | SES_式中 | 宋 五 | 首行 420 | — | — | 10.4.3 |
| SesWhereItem | SES_式中条目 | 宋 五 | 按 §5.10 计算制表位与悬挂 | — | — | 10.4.3 |
| SesBibTitle | SES_参考文献标题 | 黑 五 | keepNext；`jc=center`；段前 520 段后 150（起始值） | 0 | — | 图 E.10、#29 |
| SesBibEntry | SES_参考文献条目 | 宋 五 | 首行 420，回行顶格 | — | 属主：参考文献 L0 | 10.3.6、#30 |
| SesEndMark | SES_终结线 | 宋 4 磅 | keepLines；左右缩进各 3508；下边框 single sz=6 | — | — | 10.1.5（原件实测 40.3 × 0.25 mm） |
| SesHeader | SES_书眉 | 黑 五 | — | — | — | #47 |
| SesFooter | SES_页码 | 宋 小五 | — | — | — | #48 |
| TOC1 / TOC2 / TOC3 | toc 1 / toc 2 / toc 3 | 宋 五 | 右对齐点线制表位 9355；TOC1 段前段后各 1/4 行（25）；TOC2 左缩进 210；TOC3 左缩进 420 | — | — | 10.3.2、图 E.8、#15 |
| SesCover* | SES_封面… | 见 §6 | 图文框定位 | — | — | 10.3.1、图 E.5–E.7、#01–13 |

「属主」= 该样式带样式级 `numPr`，是这个编号级别唯一绑定的样式；「段落级」= 样式不带 `numPr`，由段落自己写 `numPr`（原因见 §4.1）。

### 3.3 偏差登记（以原件为准，已改正）

| 项 | 原口径 | 本规格 | 依据 |
|---|---|---|---|
| 书眉字号 | 参考模板为小五、未设黑体 | 五号黑体 | 表 F.1 #47 |
| 标题字距 | WP4-fix D3 定为插一个全角空格（PDF 已如此实现） | **用字符间距（`rPr/w:spacing` 加宽）实现，文字本身不插空格**：目次/前言/引言两字间 2 个字宽（三号，`w:spacing w:val="640"`，只加在前一个字上）；参考文献逐字 1 个字宽（五号，210，最后一个字不加）；附录标识「附录A」由编号生成，在 A2 L0 的标识 rPr 上加 210（末字后多出的约 1.8 mm 居中偏移可接受）。这样正文标题显示为「前　　言」「参　考　文　献」「附　录　A」，而目次条目仍是「前言」「参考文献」「附录A（规范性）…」，两处都与原件一致 | 原件出版物实测（字间约 2 em / 1 em）；图 E.8 目次条目不带空格。PDF 已冻结，不回改 |
| 终结线 | dev-plan 定稿表要求用 `docs/素材/终结线.jpg` | 段落下边框（0.75 磅） | 原图 117×25 px，印刷仅 72 dpi；原件实测是 40.3 × 0.25 mm 的实线，边框可精确复现 |
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

所有级别 `lvlJc=left`。「缩进」写在级别的 `pPr/ind`，单位 twips。

| ID | 用途 | 类型 | 级别定义 | 属主样式 |
|---|---|---|---|---|
| A1 | 章条 | multilevel | L0 decimal `%1　`；L1 `%1.%2　`；L2 `%1.%2.%3　`；L3、L4、L5 依此类推；suff=nothing；缩进 0 | SesChapter、SesClause1…5 |
| A2 | 附录 | multilevel | L0 upperLetter `附录%1`，标识 rPr 黑体 + 字符间距 210（§3.3）；L1 `%1.%2　`…L5；suff=nothing；缩进 0 | SesAppendix、SesAppClause1…5 |
| A3 | 正文图 | singleLevel | L0 decimal `图%1　` | SesFigCap |
| A4 | 正文表 | singleLevel | L0 decimal `表%1　` | SesTblCap |
| A5 | 附录图 | singleLevel | L0 decimal `图%1　`（占位，实例覆盖整个 L0） | — |
| A6 | 附录表 | singleLevel | 同上，`表%1　` | — |
| A7 | 注 | singleLevel | L0 **none** `注：`；标识 rPr 黑体 | SesNote |
| A8 | 注X | singleLevel | L0 decimal `注%1：`；标识 rPr 黑体 | —（按组实例） |
| A9 | 示例 | singleLevel | L0 none `示例：`；标识 rPr 黑体 | SesExLabel |
| A10 | 示例X | singleLevel | L0 decimal `示例%1：`；标识 rPr 黑体 | —（按组实例） |
| A11 | 破折号列项 | multilevel | L0 bullet `——` suff=nothing，左 840 悬挂 420；L1 bullet `·` suff=tab，左 1260 悬挂 420 | SesListDash、SesListDot |
| A12 | 字母列项 | multilevel | L0 lowerLetter `%1)` suff=tab，左 840 悬挂 420；L1 decimal `%2)` suff=tab，左 1260 悬挂 420 | —（按列表实例） |
| A13 | 数字列项 | multilevel | L0 decimal `%1)`；L1 lowerLetter `%2)`（缩进同 A12） | — |
| A14 | 罗马列项 | multilevel | L0 lowerRoman `%1)`；L1 decimal `%2)` | — |
| A15 | 大写罗马列项 | multilevel | L0 upperRoman `%1)`；L1 decimal `%2)` | — |
| A16 | 参考文献 | singleLevel | L0 decimal `[%1]　` suff=nothing；首行 420 | SesBibEntry |

- 标识后的「空一个汉字」用 lvlText 里的全角空格 U+3000，不用 `suff=space`（半角）。
- 列表 `boxed`（方框编号）V1 退化为 A13 并记 `list-format-fallback` warning。
- 注/示例的悬挂量等于标识的实际宽度（黑体小五：汉字与全角冒号各 1 em = 180 twips，阿拉伯数字 0.5 em = 90 twips），所以 `suff=nothing` 时回行正好与注内容左对齐：「注：」360、「注1：」450。

### 4.3 编号实例（w:num）分配

- **固定实例**（每个文档一个，属主样式引用）：A1、A2、A3、A4、A7、A9、A11、A16。
- **按需实例**（段落级 `numPr` 引用；每个都写 `<w:lvlOverride w:ilvl="0"><w:startOverride w:val="1"/>…</w:lvlOverride>`）：
  - 每个多条注的组（作用域与 Resolver 相同：最近的条或章；表内注按表独立）→ A8 新实例；
  - 每个多条示例的组 → A10 新实例；
  - 每个编号列表（整棵列表，嵌套项用同一实例的 L1）→ A12–A15 中对应的新实例；
  - 每个附录 → A5、A6 各一个新实例，`lvlOverride` 内再写一个完整 `w:lvl` 覆盖 L0，lvlText 为 `图{字母}.%1　` / `表{字母}.%1　`（v2 验证：图A.1、图A.2、图B.1、表B.1 均正确）。
- **单条注、单个示例**：用属主样式 SesNote / SesExLabel（none 格式，标识为「注：」「示例：」），与 Resolver「单条不编号、多条编号」规则一致。

### 4.4 级别选择

- 章：A1 L0；条：A1 L = `IRClause.level`（1–5）。
- 术语条目编号：A1 L = 父节点层级 + 1（章直属 → L1，即「3.1」；条 3.1 之下 → L2，即「3.1.1」）。
- 附录条、附录无标题条：A2，规则同上。
- 列项：顶层 L0，嵌套一层 L1；更深的嵌套 GB/T 1.1 不建议，渲染为 L1 并记 warning。

### 4.5 公式编号

不使用 Word 原生编号：列表标识只能出现在段首，而公式编号在行尾。写 Resolver 的 `labels[id].label`（「(3)」「(A.1)」）为文字。`numbered=false` 时不写编号和点线，公式只居中。

### 4.6 交叉引用

V1 写 `labels[targetId].refText` 纯文字，**不加颜色、不加下划线**（旧导出器的蓝色直接格式属于缺陷，不得沿用）。V2（本系列不做）改为 REF 域 + 书签。

### 4.7 一致性测试（必须实现）

在 shared 测试中实现一个「Word 编号模拟器」，只需覆盖本规格用到的特性：decimal / upperLetter / lowerLetter / lowerRoman / upperRoman / bullet / none；多级拼接；`startOverride`；实例覆盖 `lvl`；上级出现时下级重置；跳级隐式计 1。
模拟器读取生成的 `numbering.xml` 与 `document.xml`（含样式级 `numPr` 的继承），为每个带编号段落算出标识字符串，与 Resolver `labels` 逐个比对：章、条、无标题条、术语条目、附录及附录条、图、表、注X、示例X、参考文献。全要素 fixture 与各专项 fixture 全部一致才算通过。

---

## 5. 要素渲染（IR → OOXML）

下文「P(样式, 内容)」表示 `<w:p><w:pPr><w:pStyle w:val="样式"/>…</w:pPr>…</w:p>`。

### 5.1 正文首页

P(SesBodyTitle, `meta.title`)。只输出中文名称，不输出英文。名称由多个元素组成时，元素之间用一个全角空格（10.1.4）：渲染器把名称中元素间的半角空格替换为 U+3000。GB/T 1.1 的「重要提示」（#21）IR 暂无字段，本期不做。

### 5.2 章

P(SesChapter, 标题)。`secType` 只影响内容，不影响版式。悬置段由 Resolver 报 problem，渲染照常输出。

### 5.3 条与无标题条

- 有标题条：P(SesClause{level}, 标题)，随后渲染 children。
- 无标题条：第一个子段落写成 P(SesNoTitle{level}) + 段落级 `numPr`（A1 固定实例，ilvl = level），其余子块照常（段落用 SesPara）。GB/T 7.3.3 要求同一层次有无标题一致、7.3.4 规定无标题条不再分条；违反时 Resolver 报 problem，渲染不拦截。

### 5.4 术语条目（三段式，10.3.5）

1. P(SesTermNum) + 段落级 `numPr`，段落无文字，只显示编号；
2. P(SesTermHead, term + U+3000 + termEn)，termEn 缺省时只写 term；
3. 定义各块用 SesPara；来源一段 SesPara，**原样输出** `source`（pmToIr 已把「[来源：……]」整段作为 source，渲染器不得再加前缀）；注、示例按 §5.7。

### 5.5 段落与行内

- 段落：P(SesPara, runs)。
- marks：bold→`<w:b/><w:bCs/>`；italic→`<w:i/><w:iCs/>`；underline→`<w:u w:val="single"/>`；sub/sup→`<w:vertAlign w:val="subscript|superscript"/>`；crossRef→按 §4.6 输出文字。
- 文本中的 `\n` 输出为 `<w:br/>`；XML 特殊字符必须转义。

### 5.6 列项

- dash：顶层项 P(SesListDash)，嵌套项 P(SesListDot)（属主样式自带编号）。
- 其他类型：P(SesListItem) + 段落级 `numPr`（该列表的实例，ilvl 0/1）。
- 一项有多个段落时，第一段带编号，后续段落用 SesListCont（左缩进取所在层次的文字位置）。

### 5.7 注与示例

- 同一作用域只有一条注：第一段 P(SesNote)；后续段落 SesNoteCont（左 780）。
- 多条注：每条第一段 P(SesNoteN) + 本组实例的段落级 `numPr`；后续段落 SesNoteCont（左 870）。
- 示例：标识单独一段（单个示例用 P(SesExLabel)，多个用 P(SesExLabelN) + 本组实例），段落内无文字；内容各段 SesExText。
- 术语条目内的注、示例规则相同（作用域为该术语条目）。

### 5.8 图

顺序（9.7.5）：图片段 → 图中的注 → 图题。

- 图片段：P(SesFigure)，内含 `w:drawing/wp:inline`。尺寸取 `widthPx/heightPx` 与 `dpi`（缺省 96）换算为 EMU（1 mm = 36000 EMU）；宽度超过版心宽（竖排 165 mm，横排 252 mm）时等比缩到版心宽。媒体写入 `word/media/imageN.{ext}`，在 `document.xml.rels` 里登记。
- `orientation='landscape'` 的图按 §5.15 放进横排节（图片、图中的注、图题都在该节内）。
- 图题：正文 P(SesFigCap, caption)；附录 P(SesAppFigCap, caption) + 本附录图实例。**不输出** `captionEn`。
- `images` 中缺该图：输出一段文字「〔图片缺失〕」并记 `image-missing` warning。

### 5.9 表

- 表题在表上方：P(SesTblCap / SesAppTblCap, caption)，不输出 `captionEn`。
- `w:tbl`：
  - `tblPr`：`tblW` 5000 pct；`jc=center`；`tblLayout fixed`；边框外框 sz=6，`insideH/insideV` sz=2；
  - `tblGrid`：按最大列数平均分配版心宽（必须写，否则不符合 schema）；
  - 前 `headerRowCount` 行 `trPr` 写 `<w:tblHeader/>`（跨页重复表头，9.8.3），表头最后一行的单元格下边框 sz=6；
  - 合并：`colspan` → `tcPr/gridSpan`；`rowspan` → 起始格 `vMerge val="restart"`，**被覆盖的后续行在同一网格位置补占位格** `<w:tc><w:tcPr><w:gridSpan w:val="N"/><w:vMerge/></w:tcPr><w:p/></w:tc>`，其中 N = 起始格的 `colspan`（为 1 时省略 `gridSpan`）。占位格缺 `gridSpan` 会只占一列，同行后面的格整体左移，网格错位（旧导出器连占位格都没有）；
  - 单元格段落：表头格与纯数字格（`/^[\d\s.,±%~—-]+$/`）用 SesTableCenter，其余用 SesTableText；空单元格写一字线「—」（10.4.2.2）。
- 表注：表内最后加一行，单元格 `gridSpan` 跨满全宽，上边框 sz=6，内容按 §5.7 规则，用 SesTableNote。
- `orientation='landscape'` 的表按 §5.15 放进横排节（表题、表、表注都在该节内）。
- 「表X（续）」、单位陈述：V2，不在本系列。

### 5.10 公式（10.4.3）

- 公式段：P(SesFormula, `<w:r><w:tab/></w:r>` + OMML + `<w:r><w:tab/></w:r>` + 编号文字)。`numbered=false` 时只有第一个制表符和 OMML。
- `formulaOmml` 缺该公式：写 LaTeX 源码文字，记 `formula-missing-omml` warning。
- 式中：`whereList` 非空时，先 P(SesWhereLabel, 「式中：」)，再每项一段 SesWhereItem：首行起于 420；符号后接一个制表位跳到破折号位置 `d`；「——」后接释义；回行对齐释义起点。`d` = 420 + 本组最长符号宽度 + 210（符号宽按汉字 1 字、ASCII 0.5 字估算）；段落 `tabs` 写 `d`，左缩进 = d + 420（「——」宽 2 字），悬挂 = 左缩进 − 420。

### 5.11 附录

P(SesAppendix, `<w:br/>` + 「（规范性）」或「（资料性）」+ `<w:br/>` + title)。编号「附录A」由 A2 L0 生成，字距按 §3.3。三行在同一段落，目次里会合成一行「附录A （规范性） 标题」（spike 已验证）。

### 5.12 参考文献

按 `bibliographyOrder` 输出：P(SesBibTitle, 「参考文献」，字距按 §3.3)，每条 P(SesBibEntry, content)（编号由 A16 生成；content 中若已含「[n]」前缀，先剥离再输出）。

### 5.13 终结线（10.1.5）

文件最后一个要素之后写 P(SesEndMark)。为保证与最后内容同页、不另起一面：**最后一个内容段落加 `keepNext`**。

### 5.14 前言、引言

P(SesFrontTitle, 「前言」/「引言」，字距按 §3.3) + 内容块。引言中的图、表、公式参与全文连续编号（9.7.2.1「图编号从引言开始」），实例同正文。

### 5.15 横排（图、表共用）

适用于 `orientation='landscape'` 的 `IRFigure` 与 `IRTable`：

- 在该要素之前结束当前节（按 §2.2 的规则把当前节属性写进上一段），开一个横排节：`w:type=nextPage`，`pgSz w=16838 h=11906 orient="landscape"`，页码续编（显式写当前的 `pgNumType fmt`），页眉页脚引用同一组四个部件。
- 横排节的页边距按横向换算：左右（内/外侧）25 / 20 mm 不变，上下 34 / 25 mm 不变；横排版心宽 = 297 − 25 − 20 = **252 mm**，图片按此上限缩放，表格 `tblW` 5000 pct 即占满横排版心。
- 该要素（连同图题/表题、图中的注/表注）之后再开一个竖排节（`nextPage`，页码续编），恢复竖排页面。**连续的横排要素共用一个横排节**，中间不插竖排节。
- 若文件最后一个要素是横排的，终结线（§5.13）放在该横排节内、与该要素同页，不再切回竖排另起一面。
- 横排节里的书眉、页码会随纸张方向一起转到横向的顶部和底部；这是否符合要求须在 WP7.4 开工前的 spike 中用 Word 与 WPS 确认，结论写进 PR。

---

## 6. 封面（10.3.1、图 E.5–E.7、表 F.1 #01–13）

### 6.1 几何（国家标准，页面坐标，单位 mm，以原件封面实测墨迹为准）

| 元素 | 目标位置（墨迹） | 字体 | 实现 |
|---|---|---|---|
| ICS / CCS（行业标准加第三行「备案号：」） | 左 25，首行字顶 10.6 | 五号黑体（#01/#02） | 图文框 x=25 y=10 w=90 |
| 文件代号标志 | x 143–183、y 13–33（40 × 20，中心距右纸边约 46） | 图片（#03） | 图文框 x=143 y=13 w=40，内嵌 40 × 20 mm 图片 |
| 称谓 | y 41.5–50.2，x 25–195 分散对齐 | 国标：宋体一号加粗；其他：黑体小一（#06/#07，定稿表） | 图文框 x=25 y=41 w=170，`jc=distribute` |
| 文件编号 | 字顶 58.3，右端 190 | 四号黑体（#04） | 图文框 x=100 y=57.5 w=90，`jc=right` |
| 代替文件编号 | 字顶 65.4，右端 190 | 五号黑体（#05） | 图文框 x=100 y=64.8 w=90，`jc=right`；无则省略 |
| 横线 | y 75，x 25–195，约 0.2 mm | — | 图文框 x=25 y=74 w=170 的空段落，下边框 sz=4 |
| 文件名称 | 首行字顶 115.4，居中，多行行距约 12.9 | 一号黑体（#08） | 与下面三项共用一个图文框：x=25 y=114.5 w=170 |
| 英文译名 | 名称之下 10.5 | 四号黑体（#09） | 同一图文框内，段前约 10 mm |
| 一致性程度标识 | 英文之下 14.5 | 四号黑体（#10） | 同上，段前约 15 mm |
| 阶段标识、专利说明 | 见 §6.3 | 四号黑体 / 五号宋体 | 同上 |
| 发布 / 实施日期 | 字顶 251.5；「发布」左 25，「实施」右端 195 | 四号黑体（#11） | 图文框 x=25 y=250.5 w=170，右对齐制表位 9638（170 mm）；段落下边框 sz=4（y≈257） |
| 发布机构 + 「发　布」 | 块 x 68.6–151.4、y 264–276（下沿距纸底约 21） | 机构：专用字（#12）；「发　布」四号黑体（#13） | 图文框 x=25 y=263 w=170 `jc=center`：机构图片（国标）或文字，其后空 5 mm 接「发　布」 |

- 连续段落的 `framePr` 完全相同时，Word 把它们合成一个图文框。名称、英文、一致性、阶段标识放在同一个图文框里自然流动，名称行数变化时不会互相覆盖。
- 图文框统一写 `w:hAnchor="page" w:vAnchor="page" w:wrap="around" w:hSpace="0" w:vSpace="0"`，`w:x`/`w:y`/`w:w` 为 twips。封面节 `pgMar` 可沿用正文值，图文框按页面定位不受影响。
- 表中「图文框」列为起始值，最终以 §10 的墨迹测量对照「目标位置」，允差 ±1 mm。

### 6.2 类型差异

| 类型 | 称谓 | 标志 | 文件编号示例 | 英文译名 | 其他 |
|---|---|---|---|---|---|
| gb | 中华人民共和国国家标准 | GB 标志 | GB/T 12345—2026、GB 12345—2026 | 有 | 发布机构为国标发布机构图片 |
| guide | 中华人民共和国国家标准化指导性技术文件 | GB 标志 | GB/Z 12345—2026 | 有 | 同上（E.1 注：T 改 Z） |
| industry | 中华人民共和国××行业标准 | 行业代号文字「XX」（专用美术体字，V1 用黑体加粗、字符缩放到 40 × 20 mm，待确认） | XX/T 1234—2026 | 有 | ICS/CCS 下加「备案号：」；发布机构为文字 |
| local | ××××（地方名称）地方标准 | DB 标志 + 地区代码文字 | DBXX/T 123—2026 | 无（图 E.7） | 发布机构为文字 |
| group | 团体标准（GB/T 1.1 无封面图，比照 E.5，**待主导人确认**） | T 标志 | T/XXX 123—2026 | 有 | 发布机构 = 团体名称 |
| enterprise | 企业标准（比照 E.5，**待主导人确认**） | Q 标志 | Q/XXX 123—2026 | 无 | 发布机构 = 企业名称 |

- 文件编号中「代号与顺序号之间空半个汉字，顺序号与年份之间用一字线」（定稿表）：渲染器把 `stdCode` 中代号后的空格规范为一个半角空格、年份连接符规范为「—」（U+2014）。
- 非国标的发布机构文字（「专用字」）V1 用宋体加粗小二近似，待确认。

### 6.3 草案信息（8.1、附录 D.1）

- 阶段标识（`opts.stage`）：工作组讨论稿 / 征求意见稿 / 送审稿 / 报批稿 时，在一致性程度标识之下一行居中写「（征求意见稿）」等（四号黑体）；发布稿不写。
- **征求意见稿、送审稿**：封面显著位置**必须**写专利征集说明「在提交反馈意见时，请将您知道的相关专利连同支持性文件一并附上。」（D.1，五号宋体），放在阶段标识之下。
- 位置细节原件未给图，按上述顺序排在名称图文框内；若主导人另有样式要求再调整。

### 6.4 素材

| 素材 | 来源 | 状态 |
|---|---|---|
| GB 标志 | 原件第 1 页内嵌 948×474 px、1 位、600 dpi 位图（`pdfimages -f 1 -l 1 -png`） | 可用；替换 `docs/素材/GB标志.png` |
| 国家标准发布机构（两行） | 原件封面按 600 dpi 渲染并裁切，二值化 PNG（原件中是专用字体文字，不是图片） | 可用 |
| DB 标志 | `docs/素材/DB标志.tiff`（196×98 px，印刷约 225 dpi） | 可用；有正式地方标准 PDF 时换源 |
| T 标志 | 参考模板内的两张 PNG（约 220–280 dpi） | 待换源（来自第三方模板，需正式团体标准 PDF） |
| Q 标志 | `docs/素材/Q标志.tif`（34×35 px，印刷仅 72 dpi） | **不合格**，需正式企业标准 PDF 换源 |
| 终结线 | 不用图片（§5.13） | — |

素材以 base64 常量放在 `assets.ts`，TIFF 统一转 PNG（Word/WPS 对 TIFF 支持不一）。

### 6.5 IRDocMeta 需补充的字段（只增不改，均可选）

`replaces`（代替文件编号）、`consistency`（一致性程度标识，如「（ISO 1234:2020，MOD）」）、`filingNo`（备案号）、`industryName`（××行业）、`regionName`（地方名称）。`pmToIr` 从封面节点属性取值；编辑器封面表单缺这些字段时，本系列只做 IR 与渲染侧，表单字段另开任务（在 PR「发现的问题」中列出）。

---

## 7. 目次（10.3.2、图 E.8）

- 目次节：P(SesTocTitle, 「目次」，字距按 §3.3)，随后是目次域：`TOC \o "1-2" \h \z \u`。`\u` 必需：自定义样式靠段落大纲级别进入目次。收录前言、引言、章、附录、参考文献（大纲 0）与一级条（大纲 1）；无标题条没有大纲级别，自动不收。
- **缓存结果由渲染器生成**：按 Resolver 的编号与标题逐条写 TOC1/TOC2 段落，页码处留空。settings 写 `<w:updateFields w:val="true"/>`，Word 打开时提示「是否更新域」，选「是」后生成页码。WPS 的行为在 WP7.3 验收时确认。
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

### WP7.2 样式、编号、分节（2.5 天）

- 按 §3.2 实现 `styles.ts`；按 §4 实现 `numbering.ts`（定义 + 实例分配器）；按 §2 实现 `sections.ts` 与页眉页脚部件（settings 已在 WP7.1 按 §2.4 输出）。
- 实现 §4.7 编号模拟器，先用手写段落序列验证模拟器自身。
- **验收**：用手写 IR（每类编号至少两例，含无标题条、术语、跨章、多附录、多组注、多列表）生成 DOCX：模拟器结果与期望全部一致；Word 渲染后分节、页码、书眉与 §2.1 的实测值一致（±0.5 mm）。

### WP7.3 正文渲染 + 目次 + 重新开放 DOCX 按钮（3 天）

- 实现 §5.1–5.7、5.11–5.14 与 §7；client 薄壳：`pmToIr` → `resolve` → `renderDocx` → JSZip → 下载。
  `pmToIr` 之后用 `irMetaFromDocumentMeta(store.currentDocument?.meta)` 覆盖 IR meta 中所有非 undefined 的字段（封面、书眉
  要用标准类型、文件编号、发布机构、日期；与 PDF 只覆盖五项不同，是有意的）；`opts.stage` 取 `store.currentDocument.stage`，
  `createdAt` 取导出时刻。
- DOCX 卡片重新启用，副标题「测试版」；「高保真 PDF」卡片随之恢复（它转换的就是新生成的 DOCX）。两张 PDF 卡片改名：「版式预览（GB/T 1.1 排版）」「交付稿预览（与 DOCX 一致）」。
- **验收**：全要素 fixture 的 §4.7 一致性测试全过；Word 渲染逐项对照 §5（附截图）；更新目次后标题、编号与 Resolver 一致。

### WP7.4 表格、图片、公式、横排（3 天）

- **开工前半天 spike**（Word，另备 WPS）：表头跨页重复、横排节书眉页码、`spike/wp7-docx-word/omml2.js` 的公式样例在两端的渲染。结论写进 PR。
- 实现 §5.8–5.10、§8（公式转换放 client，动态 import `mathml2omml`）、横排节。
- **验收**：14 个样例公式（含 `<`、`&`、∑、∫、根号、矩阵、分段函数，以及括号包住 ∑ 的写法）全部可打开、主体正确；含 rowspan 与 colspan 组合合并的表格网格正确（续格带相同 `gridSpan`）；横排图、横排表各至少一例，连续横排共用一节，末要素为横排时终结线同页；横排页书眉页码位置经人工确认。

### WP7.5 封面（2 天）

- 实现 §6；按 §6.4 替换素材；补 §6.5 的 IRDocMeta 字段与 `pmToIr` 映射。
- **验收**：6 类封面在 Word 渲染后，用墨迹测量对照 §6.1 目标位置（±1 mm）；征求意见稿、送审稿封面有专利征集说明。

### WP7.6 交付验收（1 天，主导人 + 用户）

用一份真实标准文稿走完整流程，在 Word 与 WPS 中对照附录 E 逐项核对，问题清单作为修订依据。

合计约 12.5 个工作日。WP7.2 完成后，WP7.3–7.5 改动的是不同模块，可以并行。

---

## 10. 验收环境、测试基建与核对工具

### 10.1 环境

- **Word（macOS）**：AppleScript 导出 PDF 已验证（Word 16.113）。输入输出文件必须放在 `~/Library/Containers/com.microsoft.Word/Data/` 下，否则 Word 沙盒会弹授权窗口；首次运行需在系统设置中允许「控制 Microsoft Word」。
- **WPS**：主导人本机未安装。WP7.3 起的验收需在装有 WPS 的机器（WPS Office for Mac 或 Windows 版）上人工打开，按与 Word 相同的清单核对，并截图附在 PR 中。
- **测量**：用 `scripts/docx-check/measure.py`（§10.3），与 §2.1、§6.1 的毫米值比对。

### 10.2 shared 测试基建（WP7.1 建立，后续各包沿用）

shared 不新增任何依赖（包括 devDependencies）。下列文件都是测试代码，放在 `packages/shared/src/renderers/docx/__tests__/`，
不从任何 `index.ts` 导出。辅助文件不以 `.test.ts` 结尾，会被 shared 的 `tsc` 检查，同样不得使用 Node 或浏览器 API。

| 文件 | 内容 |
|---|---|
| `helpers/xmlTree.ts` | 最小 XML 解析器，产出 `{ name, attrs, children }` 树（文本为独立节点）。支持 XML 声明、带前缀的元素名与属性名、单双引号、5 个预定义实体与数字字符引用、自闭合标签。以下情况抛错并给出位置：标签不配对或未闭合；文本或属性值中出现未转义的 `<` 或 `&`；同一元素属性重复；多个根元素；根元素之后还有内容。生成器不输出注释、CDATA、DTD 和处理指令（XML 声明除外），解析器遇到也抛错 |
| `helpers/checks.ts` | `assertWellFormed(pkg)`：每个部件都能解析；`[Content_Types].xml` 为每个部件、每种二进制扩展名给出类型；每个 `.rels` 的 Target 都存在于包内（悬空关系会触发 Word 的修复提示）。`assertChildOrder(pkg)`：遍历所有部件，附录 B 所列容器的子元素必须是清单的子序列（`sectPr` 开头的 headerReference/footerReference 之间不限顺序），出现清单外的子元素也算失败 |
| `helpers/outline.ts` | `docxOutline(pkg)`：按 `document.xml` 顺序每段一行，格式 `样式ID │ 编号 │ 文本`。编号一栏在 WP7.1 写 `numId:ilvl`（无 `numPr` 写 `—`），WP7.2 起改为 §4.7 模拟器算出的标识。文本中 `w:br` 记为 `⏎`、`w:tab` 记为 `⇥`，公式记为 `〔公式〕`，图片记为 `〔图〕`；表格内段落的行首加 `┆`；每个 `sectPr` 单独一行，写在它所结束那一节的末段之后：`§ type=… pgNumType=… orient=…`。用 `toMatchSnapshot()` 固化 |
| `__golden__/<fixture>/` | 需要在 Word 中核对的 fixture：每个部件用 `await expect(…).toMatchFileSnapshot(路径)` 写成一个文件（二进制部件写 base64，文件名加 `.b64`），即解包后的 DOCX 目录，PR 里可以直接看 XML diff。WP7.1 只有 `minimal` |

每个渲染测试都断言四项：`assertWellFormed`；`assertChildOrder`；同一输入两次输出深度相等；`JSON.parse(JSON.stringify(pkg))` 与原值深度相等。

### 10.3 核对工具 `scripts/docx-check/`

Python 3 + PyMuPDF，本地核对用，不是项目依赖，不进 CI。

| 脚本 | 用法 | 要求 |
|---|---|---|
| `pack.py` | `pack.py <golden 目录> <out.docx>` | 把目录打成 zip：`[Content_Types].xml` 放第一个，其余按路径排序；`.b64` 文件解码后去掉该后缀；条目时间固定为 1980-01-01 |
| `word_pdf.py` | `word_pdf.py <in.docx> <out.pdf>` | 复制到 `~/Library/Containers/com.microsoft.Word/Data/ses-check/`（沙盒内，免授权弹窗）；把**副本**的 `settings.xml` 中的 `w:updateFields` 删去，否则 Word 打开时的「更新域」提示会卡住自动化；AppleScript：打开 → 有目次则更新（写在 `try` 里）→ 另存为 PDF → 不保存关闭；把 PDF 复制到 `out.pdf`；120 秒无结果则报错退出 |
| `measure.py` | `measure.py <pdf> [--pages 3-9] [--json]` | 300 dpi 灰度渲染，灰度 < 128 为墨迹，连续的墨迹行归为一个「行块」。每页输出：首个行块的字顶与左右范围（有书眉的页即书眉）；第二个行块的字顶（书眉之后的首行或标题）；末个行块底边距纸底（页码）；末个行块距外侧纸边（单数页量右侧，双数页量左侧，页序从 1 起算）。整页无墨迹时输出「空白页」。单位 mm，保留一位小数 |
| `README.md` | — | 三个脚本的用法、Word 首次运行的授权步骤、下表基准值 |

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
