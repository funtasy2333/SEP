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
  // 书眉 margin box（外侧顶部）：五号黑体，短下划线（线长同文字、非通栏）
  const headerBox = (corner: 'top-left' | 'top-right') => `
    @${corner} {
      content: ${header};
      font-family: var(--ses-hei);
      font-size: var(--ses-fs-wu);
      vertical-align: bottom;
      padding-bottom: 1mm;
      text-decoration: underline;
      text-underline-offset: 2pt;
    }`
  // 页码 margin box（外侧底部）：小五宋体
  const pageNumBox = (corner: 'bottom-left' | 'bottom-right', counter: string) => `
    @${corner} {
      content: ${counter};
      font-family: var(--ses-song);
      font-size: var(--ses-fs-xiaowu);
      vertical-align: top;
      padding-top: 1mm;
    }`
  // 空白页：清空全部 margin box（自动插入的空白页归属前一命名上下文，须用 <name>:blank）
  const blankClear = `
    @top-left{content:""} @top-center{content:""} @top-right{content:""}
    @bottom-left{content:""} @bottom-center{content:""} @bottom-right{content:""}`

  const roman = 'counter(page, upper-roman)'
  const arabic = 'counter(page)'

  return `
/* 镜像版心：top right bottom left（单数=右页 左25右20，双数=左页 左20右25） */
@page :right { size: A4; margin: 28mm 20mm 24mm 25mm; }
@page :left  { size: A4; margin: 28mm 25mm 24mm 20mm; }

/* 前置部分（目次/前言/引言）：罗马大写页码，书眉自目次页起 */
@page front:right { margin: 28mm 20mm 24mm 25mm;${headerBox('top-right')}${pageNumBox('bottom-right', roman)} }
@page front:left  { margin: 28mm 25mm 24mm 20mm;${headerBox('top-left')}${pageNumBox('bottom-left', roman)} }

/* 正文/附录/参考文献：阿拉伯页码（counter-reset 在 .ses-body-content 上从 1 起编） */
@page body:right { margin: 28mm 20mm 24mm 25mm;${headerBox('top-right')}${pageNumBox('bottom-right', arabic)} }
@page body:left  { margin: 28mm 25mm 24mm 20mm;${headerBox('top-left')}${pageNumBox('bottom-left', arabic)} }

/* 横排宽表（WP0 方案A 命名页）：页码居中、书眉居中 */
@page landscape {
  size: A4 landscape;
  margin: 25mm 28mm 20mm 28mm;
  @top-center {
    content: ${header};
    font-family: var(--ses-hei);
    font-size: var(--ses-fs-wu);
    text-decoration: underline;
    text-underline-offset: 2pt;
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
/* 正文（含附录、参考文献）：阿拉伯页码，从 1 起编；正文首页须从单数页起排 */
.ses-body-content { page: body; counter-reset: page 1; break-before: right; }
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

/* —— 前置标题（目次/前言/引言）：三号黑体居中 —— */
.ses-front-heading {
  font-family: var(--ses-hei);
  font-size: var(--ses-fs-san);
  font-weight: bold;
  text-align: center;
  margin: 0 0 12pt;
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
.ses-toc-l1 > .ses-toc-text { font-family: var(--ses-hei); font-weight: bold; }
.ses-toc-l2 { padding-left: 2em; }
.ses-toc-l3 { padding-left: 4em; }
/* 页码占位：定宽，保证两遍构建分页不漂移（WP5 注入纯文本数字） */
.ses-toc-page { min-width: 3em; text-align: right; white-space: nowrap; }

/* —— 正文首页文件名称：三号黑体居中，书眉下空 15mm、名称下空 12mm —— */
.ses-doc-title-block { margin: 15mm 0 12mm; text-align: center; }
.ses-doc-title {
  font-family: var(--ses-hei);
  font-size: var(--ses-fs-san);
  font-weight: bold;
  margin: 0;
  line-height: 1.6;
}

/* —— 章标题：五号黑体（与正文同字号）—— */
.ses-chapter-title {
  font-family: var(--ses-hei);
  font-size: var(--ses-fs-wu);
  font-weight: bold;
  margin: 12pt 0 6pt;
  break-after: avoid;
}
.ses-chapter-title .ses-num { margin-right: 1em; }

/* —— 条标题：五号黑体 —— */
.ses-clause-title {
  font-family: var(--ses-hei);
  font-size: var(--ses-fs-wu);
  font-weight: bold;
  margin: 8pt 0 4pt;
  break-after: avoid;
}
.ses-clause-title .ses-num { margin-right: 1em; }
/* 无标题条：仅有编号标签 */
.ses-clause-num-only { font-family: var(--ses-hei); font-weight: bold; margin-right: 1em; }

/* —— 术语条目：编号/术语/英文对应词 黑体五号 —— */
.ses-term-entry { margin: 6pt 0; }
.ses-term-head { font-family: var(--ses-hei); font-weight: bold; margin: 4pt 0 0; }
.ses-term-num { margin-right: 1em; }
.ses-term-name-en { font-family: var(--ses-hei); font-weight: bold; margin: 0; }
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

/* —— 列项：标记由 CSS 计数器生成（保持渲染器无编号逻辑）—— */
.ses-list { margin: 4pt 0 4pt 2em; counter-reset: ses-li; }
.ses-list-item { position: relative; padding-left: 1.8em; }
.ses-list-item::before {
  position: absolute;
  left: 0;
  counter-increment: ses-li;
}
.ses-list-dash > .ses-list-item::before { content: "— "; counter-increment: none; }
.ses-list-number > .ses-list-item::before { content: counter(ses-li) ") "; }
.ses-list-alpha > .ses-list-item::before { content: counter(ses-li, lower-alpha) ") "; }
.ses-list-roman > .ses-list-item::before { content: counter(ses-li, lower-roman) ") "; }
.ses-list-romanUpper > .ses-list-item::before { content: counter(ses-li, upper-roman) ") "; }
.ses-list-boxed > .ses-list-item::before { content: counter(ses-li) " "; }

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
.ses-table-caption-en { text-align: center; font-style: italic; margin: 0 0 3pt; }
.ses-table-block table { border-collapse: collapse; width: 100%; font-size: var(--ses-fs-wu); }
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
.ses-figure-caption-en { font-style: italic; margin: 0; }
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
.ses-xref { color: inherit; text-decoration: none; }`

/**
 * 返回 GB/T 1.1-2020 打印 CSS 字符串。
 * @param opts.standardNo 书眉文件编号（建议从 IRDocMeta.stdCode 传入）
 */
export function printCss(opts: PrintCssOptions = {}): string {
  const standardNo = opts.standardNo ?? ''
  return [TOKENS, pageRules(standardNo), PAGE_CONTEXT, CONTENT].join('\n')
}
