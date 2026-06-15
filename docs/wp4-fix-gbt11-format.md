# WP4-fix：PDF 版式订正（对照 GB/T 1.1-2020 原件）

> **背景**：WP4 产出的 print 版式经主导人对照 GB/T 1.1-2020 原件（`rules/` 内 PDF，
> 附录 E/F、第 10 章）逐条核定，发现多处不符。本工作包是 WP4 的修订补丁。
> **WP5 的两遍构建与目次页码逻辑无需改动**（已实测页码与页脚 12/12 一致）；本包只改
> 渲染器与打印样式，外加一个横排 fixture 与一次重渲染核对。
>
> **规格来源**：`docs/dev-plan-phase-5.5.md` 的「GB/T 1.1-2020 版式规范（定稿）」表
> （已于 2026-06-15 按原件订正）。**实施时一律以该表 + 本清单为准；有疑义查原 PDF 图像**
> （方正书版字体，文本提取为乱码，必须以图像方式阅读；物理页 = 印刷页 + 7）。
>
> 涉及文件：`packages/shared/src/renderers/printCss.ts`、
> `packages/shared/src/renderers/html.ts`，及其测试与 fixture。

## 总则：print 变体专属的版式修正

多处英文译名仅应出现在「封面」（本系统 print 变体不渲染封面）。因此**正文首页文件名称、
图题/表题在 print 变体中一律不输出英文**。统一做法：在 `html.ts` 用 `ctx.variant === 'screen'`
门控这些英文行（screen 预览保留，print 省略），不要直接删字段（IR 仍承载双语数据）。

---

## 修正项清单

### F1　书眉去下划线（你的 #1）
- **依据**：表 F.1 #47 书眉文件编号 = **五号黑体**；图 E.1/E.2/E.3/E.8/E.9/E.12 及标准正文
  实页书眉**均无下划线**。注意：**字号五号是对的**，四号只用于封面/封底（#04/#46），不要改字号。
- **文件**：`printCss.ts` `pageRules()` 内 `headerBox`（约 61-70 行）。
- **当前**：含 `text-decoration: underline;` 与 `text-underline-offset: 2pt;`。
- **改为**：删除这两行（连同 `padding-bottom: 1mm` 视情况保留）；字号 `--ses-fs-wu`（五号）不变。
- **横排页同理**：`@page landscape` 的 `@top-center`（约 105-111 行）也有 `text-decoration: underline`，一并删除。
- **验收**：渲染页书眉为"GB/T …—…"五号黑体、无横线。

### F2　书眉/页码精确定位（你的 #2、#11）
- **依据**：图 E.1：书眉距纸顶 25mm；版心上沿在书眉下 5mm（≈距顶 30mm）；页码距纸底 20mm、距外侧纸边 24mm。
- **文件**：`printCss.ts` `@page :right/:left` 与 `front/body` 命名页 margin（约 90-99 行）。
- **当前**：`margin: 28mm 20mm 24mm 25mm`（上 28 / 下 24）。
- **改为**：上边距设为 **30mm**（书眉 25mm 在 margin box 内靠下对齐 → 已有 `vertical-align: bottom`）；
  下边距使页码落在距纸底 **20mm**（`pageNumBox` 配合 `vertical-align: top` 微调，必要时下边距 24mm 保持、靠 padding 调）。
  以渲染图为准微调，使页码距底 20mm。
- **验收**：对照图 E.1/E.2 量取书眉≈25mm、页码≈距底 20mm。

### F3　目次/前言/引言 标题间距（你的 #2、#4）
- **依据**：图 E.8/E.9：书眉下空 **15mm** 排标题（"目次"/"前言"/"引言"，三号黑体居中），
  标题下空 **12mm** 排首行内容。
- **文件**：`printCss.ts` `.ses-front-heading`（约 149-156 行）。
- **当前**：`margin: 0 0 12pt;`（无上距）。
- **改为**：作为「另起一面」后页面首元素，上距取使标题落在书眉下 15mm（版心上沿 30mm → 上距 ≈15mm），
  下距 **12mm**。即 `margin: 15mm 0 12mm;`（与正文首页 `.ses-doc-title-block` 一致）。
- **验收**：目次/前言/引言三页标题位置与图 E.8/E.9 一致。

### F4　目次编排：点线直抵页码 + 缩进减半（你的 #3）
- **依据**：10.3.2 + 图 E.8：标题与页码间由"……"连接、**页码右对齐紧贴版心右缘、不加括号、点线直抵页码**；
  第一层次条空 1 个汉字、第二层次条空 2 个汉字。
- **文件**：`printCss.ts` `.ses-toc-page`（约 174 行）、`.ses-toc-l2/.ses-toc-l3`（约 171-172 行）。
- **当前**：`.ses-toc-page { min-width: 3em; text-align: right; }`（致点线与页码间空太大）；`l2=2em / l3=4em`。
- **改为**：去掉固定 `min-width: 3em`，让页码为内容宽、右对齐贴版心右缘，由 `.ses-toc-text::after`
  的 `leader(dotted) flex:1` 充满至页码紧邻（页码恒在右缘，点线吸收 1–3 位数字宽差）；`l2=1em / l3=2em`。
- **两遍构建安全性**：占位 U+3000 与注入数字均处于行尾右缘、由弹性点线吸收宽差，**整行行数不变 → 分页不漂移**；
  故固定宽度并非必要（上一轮已验证页码正确，本改动不影响该结论，但**改后须重跑 F12 复核**）。
- **验收**：目次每行点线一直延伸到页码前一字，无大段空白；一/二级条缩进为 1/2 字。

### F5　正文首页不排英文名称（你的 #5）
- **依据**：图 E.3 + 表 F.1 #20/#21：正文首页只排中文文件名称（三号黑体），其下为重要提示；英文译名仅在封面（#09）。
- **文件**：`html.ts` `renderBody()` 文件名称块（约 538-543 行）。
- **当前**：渲染 `.ses-doc-title` 后又渲染 `.ses-doc-title-en`（540-542 行）。
- **改为**：英文行用 `ctx.variant === 'screen'` 门控（print 不输出）。
- **验收**：print 正文首页只有中文名称；screen 预览仍含英文。

### F6　术语条目结构（你的 #6）
- **依据**：10.3.5 + 表 F.1 #22-24：①条目编号**单独占一行、顶格**（五号黑体）；
  ②术语 + 英文对应词**同一行**（术语后空一个汉字接英文，均五号黑体）；③其余各项另行、空两个汉字起排（五号宋体）。
- **文件**：`html.ts` `renderTermEntry()`（343-364 行）；`printCss.ts` `.ses-term-*`（约 209-214 行）。
- **当前**：`html.ts:346` 把「编号 + 术语」放同一行（`.ses-term-head`），`:349` 英文又单独成行。
- **改为**：
  - 第一行：`<p class="ses-term-num-line">编号</p>`（顶格、黑体五号、上下无空行，10.3.5）；
  - 第二行：`<p class="ses-term-head">术语<空一汉字>英文对应词</p>`（英文 `.ses-term-name-en` 改为**行内**、黑体五号，不再 italic/灰，不另起行）；
  - 定义/来源等：`.ses-term-def`/`.ses-term-source` 空两个汉字起排（`text-indent: 2em`，回行顶格——注意是首行缩进而非整体缩进）。
- **验收**：术语呈「3.1 / 标准 standard / 通过……」三段式，编号独占一行，术语与英文同行。

### F7　无标题条顶格（你的 #7）
- **依据**：10.2.1："章、条编号应顶格起排""无标题条的条编号之后，空一个汉字的间隙接排条文"。
- **文件**：`html.ts` `renderClause()` 无标题分支（384-394 行，**389 行**）。
- **当前**：`389` 行用 `class="ses-paragraph"`（`text-indent: 2em`）→ 编号被缩进。
- **改为**：该首段不用 `.ses-paragraph`，改用顶格样式（如 `.ses-clause-numbered-para { text-indent: 0; }`），
  编号 `.ses-clause-num-only`（已 `margin-right: 1em` = 空一汉字）后接条文；该条**后续**的真正段落仍用 `.ses-paragraph`。
- **验收**：`4.2.1` 顶格起排，编号后空一字接正文，不再缩进 2 字。

### F8　图题/表题不附英文（你的 #8）
- **依据**：10.4.2 + 表 F.1 #36：图题/表题 = 编号 + 空一汉字 + 标题（五号黑体），无英文。
- **文件**：`html.ts` 表 `230-232` 行、图 `267-269` 行；`printCss.ts` `.ses-table-caption-en`（约 264 行）、`.ses-figure-caption-en`（约 288 行）。
- **当前**：只要 `captionEn` 非空即渲染英文题。
- **改为**：英文题行用 `ctx.variant === 'screen'` 门控（print 不输出）。
- **验收**：print 表题/图题仅中文；表题在表上方居中、图题在图下方居中（现已满足，勿动）。

### F9　终结线（你的 #9）
- **依据**：10.1.5：末页中、文件最后一个要素内容之下应有终结线——**居中粗实线、长度为版心宽度 1/4**
  （版心宽 = 210−25−20 = 165mm → ≈41mm）；须与最后一个要素同页，不准许另起一面。
- **文件**：`html.ts`（在 `renderBody()` 末尾、所有内容渲染完后追加）；`printCss.ts` 新增样式。
- **改为**：
  - HTML：正文内容（章/附录/参考文献）全部渲染完后输出 `<div class="ses-end-mark" role="presentation"></div>`；
  - CSS：`.ses-end-mark { width: 41mm; margin: 12pt auto 0; border-top: 1.5pt solid #000; break-before: avoid; }`
    （`break-before: avoid` 确保与末要素同页）。
- **验收**：末页最后内容下方有居中粗短横线，约为版心宽 1/4，且与内容同页。

### F10　表格正文字号（你的 #11）
- **依据**：表 F.1 #40：表中的数字和文字 = **小五号宋体**（9pt）。
- **文件**：`printCss.ts` `.ses-table-block table`（约 265 行）。
- **当前**：`font-size: var(--ses-fs-wu)`（五号 10.5pt）。
- **改为**：`font-size: var(--ses-fs-xiaowu)`（小五 9pt）。
- **验收**：表内文字明显小于正文。

### F11　章/条间距、列项缩进（你的 #11，次要，可同批做）
- **依据**：10.2.1 章"上下各空一行"、条"各空半行"；10.2.2 一级列项标记空 2 字、文字置第 5 字位，二级空 4 字、文字第 7 字。
- **文件**：`printCss.ts` `.ses-chapter-title`/`.ses-clause-title`（约 187-204 行）、`.ses-list*`（约 240-252 行）。
- **改为**：章标题上下≈1 行（如 `margin: 1em 0;`），条标题上下≈半行；列项按字位校（一级 marker 2em/文字 4em，二级 marker 4em/文字 6em）。
- **验收**：与图 E.3 正文段落疏密、列项缩进观感一致（容差从宽，优先级低于 F1-F9）。

---

## 横排核对与回归

### F12　横排 fixture + 重渲染核对（你的 #10）
- **新增 fixture**：在 `packages/shared/src/ir/__tests__/fixtures.ts` 的 `fullFixture()` 增补一个
  `orientation: 'landscape'` 的宽表（列数足够触发横排），或新增 `landscapeFixture()`。
- **重渲染核对**（改完 F1-F11 后必做）：复用上一轮 e2e 办法——
  1. 用 fixture 经 `pmToIr → resolve → renderHtml(variant:'print')` 出 print HTML；
  2. 走服务端两遍 vivliostyle 管线出 PDF；
  3. **逐图对照 GB/T 1.1 附录 E**：书眉（无线）、目次（点线抵页码、缩进、间距）、前言/引言间距、
     正文首页（仅中文名）、术语三段式、无标题条顶格、图表题无英文、末页终结线、横排页（书眉/页码居中、A4 横向）。
- **验收**：上述各项与附录 E 图一致；且**目次注入页码仍与页脚一致**（F4 改动后的回归，沿用上一轮核对表）。

---

## 单元测试更新

- `packages/shared/src/renderers/__tests__/html.test.ts`：
  - print 变体断言**不含** `ses-doc-title-en`、`ses-table-caption-en`、`ses-figure-caption-en`；screen 变体仍含；
  - 术语断言新结构（编号行 / 术语+英文行）；
  - 无标题条断言首段不带 `text-indent` 语义（或类名变更）；
  - 末尾含 `ses-end-mark`。
- `printCss` 断言：不含 `text-decoration: underline`；`.ses-toc-page` 无 `min-width: 3em`；表格字号为小五。

## 不改动项（避免误伤）
- WP5 管线（`packages/server/src/convert/pdf/*`）、两遍构建、目次页码注入逻辑——**不动**。
- 镜像版心左右值（25/20 镜像）、页码分区（前置罗马/正文阿拉伯 + `counter-reset: page 1`）、
  `break-before: right` 正文单数页起排——**均正确，不动**。
- 表题在上、图题在下、居中——**正确，不动**。
