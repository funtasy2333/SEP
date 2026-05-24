/**
 * PDF 导出器（基于浏览器打印 HTML）
 * 打开新窗口并调用 window.print() 实现打印/PDF导出
 */

import { exportSemanticHtml } from './htmlExporter'
import type { Node as PMNode } from '@tiptap/pm/model'
import type { DocMeta } from './docxExporter'

const PRINT_CSS = `
/* ===================== GB/T 1.1-2020 打印样式 ===================== */

* { box-sizing: border-box; }

@page {
  size: A4;
  margin: 25.4mm 20mm 20mm 20mm;
}

@page :first {
  margin: 0;
}

body {
  font-family: 'SimSun', 'Songti SC', serif;
  font-size: 10.5pt;
  line-height: 1.56;
  color: #000;
  background: #fff;
  margin: 0;
  padding: 0;
}

/* ——— 封面页（GB/T 1.1-2020 §9.2 封面）——— */
.cover-page {
  width: 210mm;
  height: 297mm;
  padding: 25mm 28mm 20mm 26mm;
  page-break-after: always;
  break-after: page;
  display: flex;
  flex-direction: column;
  position: relative;
}

/* ICS / CCS 左上角 */
.cover-meta {
  width: 100%;
  text-align: left;
  font-family: 'SimSun', serif;
  font-size: 10.5pt;
  line-height: 1.8;
}

/* 标准类型标记 + 编号区域 */
.cover-header-area {
  text-align: right;
  margin-top: -2em;
}

.cover-type {
  font-family: 'SimHei', 'Heiti SC', sans-serif;
  font-size: 26pt;
  font-weight: bold;
  letter-spacing: 2pt;
  text-align: center;
  margin-top: 20mm;
}

.cover-std-code {
  font-family: 'SimHei', 'Heiti SC', sans-serif;
  font-size: 16pt;
  font-weight: bold;
  text-align: right;
  margin-top: 2mm;
}

.cover-replace-info {
  font-family: 'SimSun', serif;
  font-size: 10.5pt;
  text-align: right;
  margin-top: 1mm;
}

/* 标准名称 —— 居中、大号黑体 */
.cover-title {
  font-family: 'SimHei', 'Heiti SC', sans-serif;
  font-size: 22pt;
  font-weight: bold;
  line-height: 1.4;
  text-align: center;
  flex-grow: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}

.cover-title-en {
  font-family: 'Times New Roman', Times, serif;
  font-size: 12pt;
  text-align: center;
  margin-top: -15mm;
  margin-bottom: 10mm;
}

/* 封面底部：发布/实施日期 + 发布机构 */
.cover-bottom {
  width: 100%;
  border-top: 1.5pt solid #000;
  padding-top: 4mm;
  margin-top: auto;
}

.cover-dates {
  display: flex;
  justify-content: center;
  font-family: 'SimSun', serif;
  font-size: 10.5pt;
  gap: 10mm;
}

.cover-dates .date-publish,
.cover-dates .date-implement {
  white-space: nowrap;
}

.cover-issuer {
  font-family: 'SimHei', 'Heiti SC', sans-serif;
  font-size: 13pt;
  font-weight: bold;
  text-align: center;
  margin-top: 4mm;
  letter-spacing: 1pt;
}

/* ——— 页眉 / 页脚 ——— */
/* 浏览器 print 不支持 CSS Paged Media running()，
   改用固定定位 + 每章首页手动插入页眉 div 的方式模拟 */

.page-header {
  text-align: center;
  font-family: 'SimSun', serif;
  font-size: 9pt;
  color: #000;
  border-bottom: 0.75pt solid #000;
  padding-bottom: 2pt;
  margin-bottom: 12pt;
}

/* ——— 章节分页 ——— */
.std-chapter,
.std-appendix,
.std-foreword,
.std-introduction,
.std-bibliography {
  page-break-before: always;
  break-before: page;
}

/* 封面后的第一个元素不需要额外分页 */
.main-content > :first-child {
  page-break-before: auto;
  break-before: auto;
}

/* ——— 章标题（GB/T 1.1: 黑体）——— */
.std-chapter-title {
  font-family: 'SimHei', 'Heiti SC', sans-serif;
  font-size: 10.5pt;
  font-weight: bold;
  margin: 0 0 6pt;
  line-height: 1.56;
  page-break-after: avoid;
  break-after: avoid;
}

/* ——— 条标题（GB/T 1.1: 黑体，与正文同字号）——— */
.std-clause-title {
  font-family: 'SimHei', 'Heiti SC', sans-serif;
  font-size: 10.5pt;
  font-weight: bold;
  page-break-after: avoid;
  break-after: avoid;
  line-height: 1.56;
  margin: 6pt 0 3pt;
}

.std-clause-title-1,
.std-clause-title-2,
.std-clause-title-3,
.std-clause-title-4,
.std-clause-title-5 { font-size: 10.5pt; }

/* ——— 无题条 ——— */
.std-clause[data-has-title="false"] > .std-clause-title {
  font-family: 'SimSun', 'Songti SC', serif;
  font-size: 12pt;
  font-weight: normal;
  text-indent: 2em;
}

.std-clause[data-has-title="false"] > .std-clause-title::before {
  font-family: 'SimHei', 'Heiti SC', sans-serif;
  font-weight: bold;
}

/* ——— 正文段落（GB/T 1.1: 宋体五号 10.5pt，首行缩进 2 字）——— */
.std-paragraph {
  text-indent: 2em;
  font-size: 10.5pt;
  line-height: 1.56;
  margin: 0;
}

/* ——— 表格（GB/T 1.1: 表格文字小于正文，一般用小五号 9pt）——— */
.std-table-wrap { margin: 6pt 0; }

table {
  border-collapse: collapse;
  width: 100%;
  font-size: 9pt;
  page-break-inside: avoid;
  break-inside: avoid;
}

th, td {
  border: 0.5pt solid #000;
  padding: 2pt 4pt;
  vertical-align: middle;
}

th {
  font-family: 'SimHei', 'Heiti SC', sans-serif;
  font-weight: bold;
  text-align: center;
}

/* ——— 表题/图题（GB/T 1.1: 黑体，居中）——— */
.std-table-caption,
.std-figure-caption {
  font-family: 'SimHei', 'Heiti SC', sans-serif;
  font-size: 10.5pt;
  font-weight: bold;
  text-align: center;
  margin: 6pt 0 3pt;
}

/* ——— 图片 ——— */
.std-figure {
  text-align: center;
  margin: 6pt 0;
  page-break-inside: avoid;
  break-inside: avoid;
}

.std-figure img {
  max-width: 100%;
  max-height: 180mm;
}

/* ——— 公式 ——— */
.std-formula {
  text-align: center;
  margin: 6pt 0;
  font-size: 10.5pt;
}

/* ——— 注/示例（GB/T 1.1: 小五号 9pt，缩进 2 字）——— */
.std-note,
.std-example {
  font-size: 9pt;
  margin: 3pt 0;
  text-indent: 2em;
  line-height: 1.56;
}

/* ——— 列项 ——— */
.std-list {
  margin: 3pt 0;
}

.std-list-item {
  font-size: 10.5pt;
  line-height: 1.56;
  padding-left: 2em;
  text-indent: -2em;
  margin: 1pt 0;
}

/* ——— 前言/引言 ——— */
.std-foreword,
.std-introduction {
  font-size: 10.5pt;
}

/* 前言/引言标题由 HTML <h2> 提供，不再用 ::before 避免重复 */
.std-foreword > h2,
.std-introduction > h2 {
  font-family: 'SimHei', 'Heiti SC', sans-serif;
  font-size: 16pt;
  font-weight: bold;
  text-align: center;
  margin: 0 0 12pt;
  letter-spacing: 1em;
}

/* ——— 附录（GB/T 1.1: 黑体，居中）——— */
.std-appendix-label {
  font-family: 'SimHei', 'Heiti SC', sans-serif;
  font-size: 10.5pt;
  font-weight: bold;
  text-align: center;
  margin-bottom: 2pt;
}

.std-appendix-title {
  font-family: 'SimHei', 'Heiti SC', sans-serif;
  font-size: 10.5pt;
  font-weight: bold;
  text-align: center;
  margin-bottom: 6pt;
}

/* ——— 参考文献 ——— */
.std-bibliography-title {
  font-family: 'SimHei', 'Heiti SC', sans-serif;
  font-size: 10.5pt;
  font-weight: bold;
  text-align: center;
  margin-bottom: 6pt;
}

.std-bib-entry {
  font-size: 10.5pt;
  line-height: 1.56;
  text-indent: -4em;
  padding-left: 4em;
  margin: 2pt 0;
}

/* ——— 术语定义（GB/T 1.1: 术语名黑体）——— */
.std-term-name {
  font-family: 'SimHei', 'Heiti SC', sans-serif;
  font-weight: bold;
  font-size: 10.5pt;
  margin-top: 6pt;
}

.std-term-name-en {
  font-family: 'Times New Roman', Times, serif;
  font-size: 10.5pt;
}

.std-term-definition {
  font-size: 10.5pt;
  text-indent: 2em;
  line-height: 1.56;
}

/* ——— 隐藏屏幕专属元素 ——— */
@media print {
  .no-print { display: none !important; }
}
`

export interface PrintOptions {
  meta?: DocMeta
}

/**
 * 生成打印预览窗口，用户可直接打印为 PDF
 */
export function printAsPdf(doc: PMNode, options: PrintOptions = {}): void {
  const { meta = {} } = options
  const html = exportSemanticHtml(doc)

  const stdTypeMap: Record<string, string> = {
    gb: '国家标准', industry: '行业标准', local: '地方标准',
    group: '团体标准', enterprise: '企业标准', guide: '标准化指导性技术文件',
  }
  const stdType = meta.standardType ? stdTypeMap[meta.standardType] || '国家标准' : '国家标准'

  // 格式化日期为 "XXXX-XX-XX"
  const fmtDate = (raw?: string) => {
    if (!raw) return ''
    const d = new Date(raw)
    if (Number.isNaN(d.getTime())) return raw
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    return `${y}-${m}-${day}`
  }

  // 生成封面 HTML（符合 GB/T 1.1-2020 §9.2）
  const coverHtml = `
<div class="cover-page">
  <div class="cover-meta">
    ${meta.icsCode ? `<div>ICS&ensp;${meta.icsCode}</div>` : '<div>ICS&ensp;&ensp;</div>'}
    ${meta.ccsCode ? `<div>CCS&ensp;${meta.ccsCode}</div>` : '<div>CCS&ensp;&ensp;</div>'}
  </div>
  <div class="cover-header-area">
    ${meta.stdCode ? `<div class="cover-std-code">${meta.stdCode}</div>` : '<div class="cover-std-code">GB/T XXXXX—XXXX</div>'}
  </div>
  <div class="cover-type">${stdType}</div>
  <div class="cover-title">${meta.title || '（标准名称）'}</div>
  ${meta.titleEn ? `<div class="cover-title-en">${meta.titleEn}</div>` : ''}
  <div class="cover-bottom">
    <div class="cover-dates">
      <span class="date-publish">${fmtDate(meta.publishDate) || 'XXXX-XX-XX'}&ensp;发布</span>
      <span class="date-implement">${fmtDate(meta.implementDate) || 'XXXX-XX-XX'}&ensp;实施</span>
    </div>
    <div class="cover-issuer">${meta.issuer || '发布机构'}</div>
  </div>
</div>
`

  // 页眉：在每个章节/前言顶部插入带标准编号的页眉 div
  const stdCodeHeader = meta.stdCode || 'GB/T XXXXX—XXXX'

  const fullHtml = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width">
  <title>${meta.title || '标准文件'}</title>
  <style>${PRINT_CSS}</style>
</head>
<body>
  ${coverHtml}
  <div class="main-content">
    ${html}
  </div>
  <script>
    // 在每个分页章节顶部插入页眉
    window.addEventListener('load', function() {
      var stdCode = ${JSON.stringify(stdCodeHeader)};
      var sections = document.querySelectorAll(
        '.std-foreword, .std-introduction, .std-chapter, .std-appendix, .std-bibliography'
      );
      sections.forEach(function(sec) {
        var header = document.createElement('div');
        header.className = 'page-header';
        header.textContent = stdCode;
        sec.insertBefore(header, sec.firstChild);
      });
      setTimeout(function() { window.print(); }, 300);
    });
  </script>
</body>
</html>`

  const printWindow = window.open('', '_blank')
  if (!printWindow) {
    alert('请允许弹出窗口以打印 PDF')
    return
  }
  printWindow.document.open()
  printWindow.document.write(fullHtml)
  printWindow.document.close()
}
