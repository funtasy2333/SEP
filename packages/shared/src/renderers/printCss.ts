/**
 * GB/T 1.1-2020 打印样式（Phase 5.5 / WP4）。
 *
 * 全部尺寸、字号、版式参数严格按 docs/dev-plan-phase-5.5.md 节末
 * 「GB/T 1.1-2020 版式规范（定稿）」表执行（依据附录 E/F、第 10 章及 GB/T 37967 实物核定）。
 * 不得参考 spike/vivliostyle-gbt11 的 CSS 参数值（那是机制验证用的占位参数）。
 *
 * 与 html.ts 的 print 变体配套使用：
 * - 目次页码不用 target-counter（命名页计数 bug，WP0 结论 1/3）；由 WP5 两遍构建注入纯文本；
 * - 自动插入的空白页必须按命名上下文 `@page <name>:blank` 清空 margin box（WP4 微验证结论）；
 * - 横排宽表采用命名页 `size: A4 landscape`（WP0 方案A）。
 *
 * 同构纯 TypeScript：不引用任何浏览器/Node API，仅返回字符串。
 */

export interface PrintCssOptions {
  /** 书眉文件编号（如 "GB/T 12345—2026"）；缺省则书眉为空。 */
  standardNo?: string
}

/**
 * 把任意字符串转为 CSS `content` 可用的带引号字面量。
 * 转义 `\` 与 `"`，并把 `<`/`>` 转为 CSS 字符转义（`\3c `/`\3e `），
 * 防止 stdCode 等用户输入拼出 `</style>` 突破 <style> 元素注入 HTML/脚本
 * （print 变体由 vivliostyle 在真实浏览器引擎中渲染）。
 */
function cssString(value: string): string {
  return (
    '"' +
    value
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/</g, '\\3c ')
      .replace(/>/g, '\\3e ')
      // 控制字符（含换行）：CSS 字符串字面量不能含裸换行，否则截断样式表；统一转 CSS 码位转义
      .replace(/[\x00-\x1f]/g, (c) => '\\' + c.charCodeAt(0).toString(16) + ' ') +
    '"'
  )
}

/** 字体栈与字号（表 F.1）。Latin/数字优先 Times New Roman，CJK 回退宋体/黑体。 */
const TOKENS = `
:root {
  --ses-song: "Times New Roman", "SimSun", "宋体", "Songti SC", "STSong", serif;
  --ses-hei: "SimHei", "黑体", "Heiti SC", "STHeiti", sans-serif;
  --ses-fs-san: 16pt;     /* 三号：目次/前言/引言标题、正文首页文件名称 */
  --ses-fs-wu: 10.5pt;    /* 五号：章条标题、正文、图表编号题、术语、附录、参考文献标题、书眉 */
  --ses-fs-xiaowu: 9pt;   /* 小五：注/示例标识与内容、单位陈述、页码 */
  --ses-fs-liu: 7.5pt;    /* 六号：图中数字与文字 */
}`

/**
 * 生成 @page 规则：镜像版心、外侧短线书眉（五号黑体）、外侧下角页码（小五宋体）。
 * 版心（图 E.1/E.2）：单数页左 25/右 20mm，双数页左 20/右 25mm；
 * 书眉距纸顶 25mm（置于上边距），版心于书眉下空 5mm 起（上边距取 28mm 近似）；
 * 页码距纸底 20mm（置于下边距，取 24mm 近似），位于版心外侧下角。
 */
function pageRules(standardNo: string): string {
  const header = cssString(standardNo)
  // 书眉 margin box（外侧顶部）：五号黑体，无下划线（图 E.1/E.2 实页书眉无横线，2026-06-15 订正）。
  // 上边距 30mm（版心上沿），书眉靠下对齐并以 padding-bottom 上抬，使书眉落在距纸顶 ≈25mm（版心上空 5mm）。
  const headerBox = (corner: 'top-left' | 'top-right') => `
    @${corner} {
      content: ${header};
      font-family: var(--ses-hei);
      font-size: var(--ses-fs-wu);
      vertical-align: bottom;
      padding-bottom: 5mm;
    }`
  // 页码 margin box（外侧底部）：小五宋体；下边距 20mm + 顶对齐 → 页码距纸底 ≈20mm（表 F.1 #48）
  const pageNumBox = (corner: 'bottom-left' | 'bottom-right', counter: string) => `
    @${corner} {
      content: ${counter};
      font-family: var(--ses-song);
      font-size: var(--ses-fs-xiaowu);
      vertical-align: top;
    }`
  // 空白页：清空全部 margin box（自动插入的空白页归属前一命名上下文，须用 <name>:blank）
  const blankClear = `
    @top-left{content:""} @top-center{content:""} @top-right{content:""}
    @bottom-left{content:""} @bottom-center{content:""} @bottom-right{content:""}`

  const roman = 'counter(page, upper-roman)'
  const arabic = 'counter(page)'

  return `
/* 镜像版心：top right bottom left（上 30mm=书眉下 5mm 起版心；下 20mm=页码距纸底；单数=右页 左25右20，双数=左页 左20右25） */
@page :right { size: A4; margin: 30mm 20mm 20mm 25mm; }
@page :left  { size: A4; margin: 30mm 25mm 20mm 20mm; }

/* 前置部分（目次/前言/引言）：罗马大写页码，书眉自目次页起 */
@page front:right { margin: 30mm 20mm 20mm 25mm;${headerBox('top-right')}${pageNumBox('bottom-right', roman)} }
@page front:left  { margin: 30mm 25mm 20mm 20mm;${headerBox('top-left')}${pageNumBox('bottom-left', roman)} }

/* 正文/附录/参考文献：阿拉伯页码（counter-reset 在 .ses-body-content 上从 1 起编） */
@page body:right { margin: 30mm 20mm 20mm 25mm;${headerBox('top-right')}${pageNumBox('bottom-right', arabic)} }
@page body:left  { margin: 30mm 25mm 20mm 20mm;${headerBox('top-left')}${pageNumBox('bottom-left', arabic)} }

/* 横排宽表（WP0 方案A 命名页）：页码居中、书眉居中 */
@page landscape {
  size: A4 landscape;
  margin: 25mm 28mm 20mm 28mm;
  @top-center {
    content: ${header};
    font-family: var(--ses-hei);
    font-size: var(--ses-fs-wu);
  }
  @bottom-center {
    content: ${arabic};
    font-family: var(--ses-song);
    font-size: var(--ses-fs-xiaowu);
  }
}

/* 自动插入的空白页：计数但不印内容（WP4 微验证：必须按命名上下文 :blank 抑制） */
@page front:blank {${blankClear} }
@page body:blank {${blankClear} }
@page landscape:blank {${blankClear} }`
}

/** 正文/前置/横排内容容器与分区页码绑定。 */
const PAGE_CONTEXT = `
/* 前置部分（目次→前言→引言）：罗马页码命名页 */
.ses-front-matter { page: front; }
/* 正文（含附录、参考文献）：阿拉伯页码，从 1 起编。
 * 电子出版 PDF 只要求正文页码从阿拉伯 1 起编，不要求正文落在物理单数页/右页，
 * 故用 break-before: page（普通另起页）而非 right，避免在前置部分后插入空白物理页。 */
.ses-body-content { page: body; counter-reset: page 1; break-before: page; }
/* 横排宽表容器：命名横排页 */
.ses-landscape { page: landscape; }`

/** 全局字体、段落、标题、各语义块样式。 */
const CONTENT = `
.ses-standard {
  font-family: var(--ses-song);
  font-size: var(--ses-fs-wu);
  line-height: 1.5;
  color: #000;
  text-align: justify;
}
.ses-standard p { margin: 0 0 4pt; orphans: 2; widows: 2; }

/* 条文段落首行缩进两个汉字 */
.ses-paragraph { text-indent: 2em; }

/* —— 前置标题（目次/前言/引言）：三号黑体居中；书眉下空 15mm、标题下空 12mm（图 E.8/E.9）—— */
.ses-front-heading {
  font-family: var(--ses-hei);
  font-size: var(--ses-fs-san);
  font-weight: bold;
  text-align: center;
  margin: 15mm 0 12mm;
  break-after: avoid;
}
.ses-foreword, .ses-introduction { break-before: page; }

/* —— 目次 —— */
.ses-toc-list { list-style: none; padding: 0; margin: 0; }
.ses-toc-item {
  display: flex;
  align-items: baseline;
  margin: 2pt 0;
}
.ses-toc-text::after {
  content: leader(dotted);
  flex: 1;
}
/* 目次内容一律五号宋体、不加粗（表 F.1 #15）；仅「目　次」标题为三号黑体（.ses-front-heading） */
/* 一级条空 1 字、二级条空 2 字起排（10.3.2、图 E.8） */
.ses-toc-l2 { padding-left: 1em; }
.ses-toc-l3 { padding-left: 2em; }
/* 页码占位：定宽（≈刚够两位数页码 2em）右对齐，缩小点线与页码间隙；
 * 占位 U+3000 与 WP5 注入的纯文本数字同处此定宽框、整框宽恒定 → 两遍分页不漂移（codex #28 评审采纳：保留预留宽度）。 */
.ses-toc-page { min-width: 2em; text-align: right; white-space: nowrap; }

/* —— 正文首页文件名称：三号黑体居中，书眉下空 15mm、名称下空 12mm —— */
.ses-doc-title-block { margin: 15mm 0 12mm; text-align: center; }
.ses-doc-title {
  font-family: var(--ses-hei);
  font-size: var(--ses-fs-san);
  font-weight: bold;
  margin: 0;
  line-height: 1.6;
}

/* 正文首页隐藏哨兵锚点：透明 + 零高度，仅供 pdftotext 提取以定位正文起始页，不占版式空间 */
.ses-body-anchor { display: block; height: 0; line-height: 0; color: transparent; font-size: 5pt; }

/* —— 章标题：五号黑体（与正文同字号）；上下各空一行（10.2.1）—— */
.ses-chapter-title {
  font-family: var(--ses-hei);
  font-size: var(--ses-fs-wu);
  font-weight: bold;
  margin: 1em 0;
  break-after: avoid;
}
.ses-chapter-title .ses-num { margin-right: 1em; }

/* —— 条标题：五号黑体；上下各空半行（10.2.1）—— */
.ses-clause-title {
  font-family: var(--ses-hei);
  font-size: var(--ses-fs-wu);
  font-weight: bold;
  margin: 0.5em 0;
  break-after: avoid;
}
.ses-clause-title .ses-num { margin-right: 1em; }
/* 无标题条（10.2.1）：编号顶格、后空一字接条文 —— */
.ses-clause-num-only { font-family: var(--ses-hei); font-weight: bold; margin-right: 1em; }
/* 无标题条首段：顶格起排（编号顶格），不缩进（区别于一般 .ses-paragraph 的首行缩进 2 字） */
.ses-clause-numbered-para { text-indent: 0; }

/* —— 术语条目（10.3.5、表 F.1 #22-24）三段式：
 *   ①编号独占一行、顶格、上下无空行（黑体五号）；
 *   ②术语 + 空一字 + 英文对应词 同一行、顶格（均黑体五号，英文行内、不斜体不灰）；
 *   ③定义/来源等各项另行、空两字起排（五号宋体，回行顶格＝首行缩进 2em）。—— */
.ses-term-entry { margin: 6pt 0; }
.ses-term-num-line { font-family: var(--ses-hei); font-weight: bold; margin: 0; }
.ses-term-head { font-family: var(--ses-hei); font-weight: bold; margin: 0; }
.ses-term-name-en { font-family: var(--ses-hei); font-weight: bold; }
.ses-term-def { text-indent: 2em; margin: 2pt 0; }
.ses-term-source { text-indent: 2em; margin: 2pt 0; }

/* —— 附录：编号/（规范性|资料性）/标题 三行，黑体五号居中，另起一页 —— */
.ses-appendix { break-before: page; }
.ses-appendix-label, .ses-appendix-kind, .ses-appendix-title {
  font-family: var(--ses-hei);
  font-size: var(--ses-fs-wu);
  font-weight: bold;
  text-align: center;
  margin: 0;
}
.ses-appendix-label { margin-top: 6pt; }
.ses-appendix-title { margin-bottom: 8pt; break-after: avoid; }

/* —— 参考文献：标题行黑体五号（非三号），另起一页 —— */
.ses-bibliography { break-before: page; }
.ses-bib-title {
  font-family: var(--ses-hei);
  font-size: var(--ses-fs-wu);
  font-weight: bold;
  text-align: center;
  margin: 0 0 8pt;
}
.ses-bib-entry { padding-left: 2em; text-indent: -2em; margin: 2pt 0; }

/* —— 列项（10.2.2）：标记由 CSS 计数器生成（保持渲染器无编号逻辑）；
 *   一级标记空 2 字起排（margin-left 2em）、文字/回行第 5 字位（padding-left 2em → 4em）；
 *   二级由嵌套再缩进 2 字（marker 4em / 文字 6em，容差从宽）。 —— */
.ses-list { margin: 4pt 0 4pt 2em; counter-reset: ses-li; }
.ses-list[data-level="2"], .ses-list-number, .ses-list-dot { margin-left: 4em; }
.ses-list-item { position: relative; padding-left: 2em; }
.ses-list-item::before {
  position: absolute;
  left: 0;
  counter-increment: ses-li;
}
.ses-list-dash > .ses-list-item::before { content: "— "; counter-increment: none; }
.ses-list-dot > .ses-list-item::before { content: "·"; counter-increment: none; }
.ses-list-number > .ses-list-item::before { content: counter(ses-li) "） "; }
.ses-list-alpha > .ses-list-item::before { content: counter(ses-li, lower-alpha) "） "; }
/* 旧罗马列表类按数字列项显示，确保旧文档不再产生罗马编号。 */
.ses-list-roman > .ses-list-item::before,
.ses-list-romanUpper > .ses-list-item::before { content: counter(ses-li) "） "; }
.ses-list-boxed > .ses-list-item::before { content: counter(ses-li) " "; }
/* 二级数字列项保留编号；其他历史嵌套类型用间隔号，更深层由 DOCX 渲染器另行发出超层警告。 */
.ses-list .ses-list:not(.ses-list-number) > .ses-list-item::before { content: "·"; counter-increment: none; }

/* —— 表格：图表编号题 黑体五号居中；thead 跨页重复（含单位陈述行）—— */
.ses-table-block { margin: 8pt 0; break-inside: auto; }
.ses-table-caption {
  font-family: var(--ses-hei);
  font-size: var(--ses-fs-wu);
  font-weight: bold;
  text-align: center;
  margin: 8pt 0 3pt;
  break-after: avoid;
}
/* 表题英文（.ses-table-caption-en）print 不输出（仅 screen），故 print CSS 不含其样式（F8） */
/* 表中数字和文字：小五号宋体（表 F.1 #40 注 a；「以表形式编写的术语标准」用五号的例外本期未实现，列为范围差距） */
.ses-table-block table { border-collapse: collapse; width: 100%; font-size: var(--ses-fs-xiaowu); }
.ses-table-block thead { display: table-header-group; }
.ses-table-block th, .ses-table-block td {
  border: 0.5pt solid #000;
  padding: 1.5mm 3mm;
  vertical-align: top;
}
.ses-table-block th { font-family: var(--ses-hei); font-weight: bold; text-align: center; }
.ses-table-block td { text-align: left; }
.ses-table-block tr { break-inside: avoid; }
/* 「关于单位的陈述」：IR 暂无独立字段（已知差距，出处 GB/T 1.1 9.8.3，与「表X（续）」一并进 V2），
 * 当前若作为表头行存在则随 thead 跨页重复（结构满足），其宋体小五/表右上方的字体定位待补字段后实现。 */

/* —— 图：图编号题 黑体五号居中 —— */
.ses-figure-block { margin: 8pt 0; text-align: center; break-inside: avoid; }
.ses-figure-image { max-width: 100%; }
.ses-figure-caption {
  font-family: var(--ses-hei);
  font-size: var(--ses-fs-wu);
  font-weight: bold;
  margin: 3pt 0 0;
  break-before: avoid;
}
/* 图题英文（.ses-figure-caption-en）print 不输出（仅 screen），故 print CSS 不含其样式（F8） */
/* 图中数字和文字：宋体六号（占位说明，实际作用于 SVG/位图内文本时由资源自带）*/
.ses-figure-image text { font-size: var(--ses-fs-liu); }

/* —— 公式：编号右端对齐 + 点线引导；式中键值列表 —— */
.ses-formula-block { display: flex; align-items: center; margin: 10pt 0 4pt; }
.ses-formula { flex: 1; text-align: center; }
.ses-formula-num {
  width: 6em;
  text-align: right;
  font-family: var(--ses-song);
  white-space: nowrap;
  flex-shrink: 0;
}
.ses-formula-num::before { content: leader(dotted); }
.ses-where { margin: 0 0 10pt 3em; }
.ses-where-intro { margin: 0 0 2pt; }
.ses-where-list { display: grid; grid-template-columns: min-content 1fr; column-gap: 0.8em; row-gap: 1pt; margin: 0; }
.ses-where-list dt { font-style: italic; white-space: nowrap; margin: 0; }
.ses-where-list dd { margin: 0; }

/* —— 注 / 示例：标识黑体小五，内容宋体小五 —— */
.ses-note, .ses-example { font-size: var(--ses-fs-xiaowu); margin: 4pt 0 4pt 2em; }
.ses-note-marker, .ses-example-marker { font-family: var(--ses-hei); }

/* —— 交叉引用：print 变体为纯文本（无内部链接），此处仅保证字体一致 —— */
.ses-xref { color: inherit; text-decoration: none; }

/* —— 终结线（10.1.5）：文件最后一个要素之下，居中粗实线，长度为版心宽 1/4（版心 165mm → ≈41mm）；
 *   break-before: avoid 保证与末要素同页、不另起一面。 —— */
.ses-end-mark {
  width: 41mm;
  margin: 12pt auto 0;
  border-top: 1.5pt solid #000;
  break-before: avoid;
}`

/**
 * 返回 GB/T 1.1-2020 打印 CSS 字符串。
 * @param opts.standardNo 书眉文件编号（建议从 IRDocMeta.stdCode 传入）
 */
export function printCss(opts: PrintCssOptions = {}): string {
  const standardNo = opts.standardNo ?? ''
  return [TOKENS, pageRules(standardNo), PAGE_CONTEXT, CONTENT].join('\n')
}
