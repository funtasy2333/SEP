/**
 * PDF 导出器（基于浏览器打印 HTML）
 * 打开新窗口并调用 window.print() 实现打印/PDF导出
 */

import { exportSemanticHtml } from './htmlExporter'
import type { Node as PMNode } from '@tiptap/pm/model'
import type { DocMeta } from './docxExporter'

const PRINT_CSS = `
/* ===================== 打印样式 ===================== */
@import url('https://fonts.googleapis.com/css2?family=Noto+Serif+SC&display=swap');

* { box-sizing: border-box; }

@page {
  size: A4;
  margin: 37mm 28mm 35mm 28mm;
}

@page :first {
  margin: 0;
}

body {
  font-family: 'SimSun', 'Songti SC', 'Noto Serif SC', serif;
  font-size: 12pt;
  line-height: 1.5;
  color: #000;
  background: #fff;
  margin: 0;
  padding: 0;
}

/* ——— 封面页 ——— */
.cover-page {
  width: 210mm;
  min-height: 297mm;
  padding: 30mm 28mm;
  page-break-after: always;
  break-after: page;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
}

.cover-meta {
  width: 100%;
  text-align: right;
  font-size: 10.5pt;
  margin-bottom: 20mm;
}

.cover-type {
  font-family: 'SimHei', 'Heiti SC', sans-serif;
  font-size: 18pt;
  font-weight: bold;
  margin-bottom: 5mm;
}

.cover-std-code {
  font-family: 'SimHei', 'Heiti SC', sans-serif;
  font-size: 16pt;
  font-weight: bold;
  margin-bottom: 15mm;
}

.cover-title {
  font-family: 'SimHei', 'Heiti SC', sans-serif;
  font-size: 22pt;
  font-weight: bold;
  line-height: 1.4;
  margin-bottom: 10mm;
}

.cover-title-en {
  font-family: 'Times New Roman', Times, serif;
  font-size: 14pt;
  font-style: italic;
  margin-bottom: 20mm;
}

.cover-dates {
  font-size: 12pt;
  margin-top: 15mm;
  margin-bottom: 5mm;
}

.cover-issuer {
  font-family: 'SimHei', 'Heiti SC', sans-serif;
  font-size: 14pt;
  font-weight: bold;
  margin-top: 10mm;
}

/* ——— 页眉 / 页脚 ——— */
@page :not(:first) {
  @top-center {
    content: element(running-header);
    font-size: 9pt;
    font-family: 'SimSun', serif;
  }
  @bottom-center {
    content: counter(page);
    font-size: 9pt;
  }
}

.page-header-running {
  position: running(running-header);
  font-size: 9pt;
  text-align: center;
  font-family: 'SimSun', serif;
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

.std-foreword:first-child,
.std-chapter:first-child {
  page-break-before: auto;
  break-before: auto;
}

/* ——— 章标题 ——— */
.std-chapter-title {
  font-family: 'SimHei', 'Heiti SC', sans-serif;
  font-size: 15pt;
  font-weight: bold;
  margin: 0 0 6pt;
  line-height: 1.5;
  page-break-after: avoid;
  break-after: avoid;
}

/* ——— 条标题 ——— */
.std-clause-title {
  font-family: 'SimHei', 'Heiti SC', sans-serif;
  font-weight: bold;
  page-break-after: avoid;
  break-after: avoid;
  line-height: 1.5;
  margin: 3pt 0;
}

.std-clause-title-1 { font-size: 14pt; }
.std-clause-title-2 { font-size: 13pt; }
.std-clause-title-3,
.std-clause-title-4,
.std-clause-title-5 { font-size: 12pt; }

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

/* ——— 正文段落 ——— */
.std-paragraph {
  text-indent: 2em;
  font-size: 12pt;
  line-height: 1.5;
  margin: 0;
}

/* ——— 表格 ——— */
.std-table-wrap { margin: 6pt 0; }

table {
  border-collapse: collapse;
  width: 100%;
  font-size: 10.5pt;
  page-break-inside: avoid;
  break-inside: avoid;
}

th, td {
  border: 1px solid #000;
  padding: 3pt 6pt;
  vertical-align: middle;
}

th {
  background: #f0f0f0;
  font-family: 'SimHei', 'Heiti SC', sans-serif;
  font-weight: bold;
}

/* ——— 表题/图题 ——— */
.std-table-caption,
.std-figure-caption {
  font-family: 'SimHei', 'Heiti SC', sans-serif;
  font-size: 10.5pt;
  text-align: center;
  margin: 3pt 0;
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
  font-size: 12pt;
}

/* ——— 注/示例 ——— */
.std-note,
.std-example {
  font-size: 10.5pt;
  margin: 3pt 0;
  text-indent: 2em;
  line-height: 1.4;
}

/* ——— 列项 ——— */
.std-list {
  margin: 3pt 0;
}

.std-list-item {
  font-size: 12pt;
  line-height: 1.5;
  padding-left: 2em;
  text-indent: -2em;
  margin: 1pt 0;
}

/* ——— 前言/引言 ——— */
.std-foreword,
.std-introduction {
  font-size: 12pt;
}

.std-foreword::before {
  display: block;
  content: "前　言";
  font-family: 'SimHei', 'Heiti SC', sans-serif;
  font-size: 15pt;
  font-weight: bold;
  text-align: center;
  margin-bottom: 6pt;
}

.std-introduction::before {
  display: block;
  content: "引　言";
  font-family: 'SimHei', 'Heiti SC', sans-serif;
  font-size: 15pt;
  font-weight: bold;
  text-align: center;
  margin-bottom: 6pt;
}

/* ——— 附录 ——— */
.std-appendix-label {
  font-family: 'SimHei', 'Heiti SC', sans-serif;
  font-size: 12pt;
  font-weight: bold;
  text-align: center;
  margin-bottom: 2pt;
}

.std-appendix-title {
  font-family: 'SimHei', 'Heiti SC', sans-serif;
  font-size: 14pt;
  font-weight: bold;
  text-align: center;
  margin-bottom: 6pt;
}

/* ——— 参考文献 ——— */
.std-bibliography-title {
  font-family: 'SimHei', 'Heiti SC', sans-serif;
  font-size: 15pt;
  font-weight: bold;
  text-align: center;
  margin-bottom: 6pt;
}

.std-bib-entry {
  font-size: 12pt;
  line-height: 1.5;
  text-indent: -4em;
  padding-left: 4em;
  margin: 2pt 0;
}

/* ——— 术语定义 ——— */
.std-term-name {
  font-family: 'SimHei', 'Heiti SC', sans-serif;
  font-weight: bold;
  font-size: 12pt;
  margin-top: 6pt;
}

.std-term-name-en {
  font-style: italic;
  font-size: 12pt;
}

.std-term-definition {
  font-size: 12pt;
  text-indent: 2em;
  line-height: 1.5;
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

  // 生成封面 HTML
  const coverHtml = `
<div class="cover-page">
  <div class="cover-meta">
    ${meta.icsCode ? `<div>ICS ${meta.icsCode}</div>` : ''}
    ${meta.ccsCode ? `<div>CCS ${meta.ccsCode}</div>` : ''}
  </div>
  <div class="cover-type">${stdType}</div>
  ${meta.stdCode ? `<div class="cover-std-code">${meta.stdCode}</div>` : ''}
  <div class="cover-title">${meta.title || '（标准名称）'}</div>
  ${meta.titleEn ? `<div class="cover-title-en">${meta.titleEn}</div>` : ''}
  ${meta.publishDate || meta.implementDate ? `
    <div class="cover-dates">
      ${meta.publishDate ? `${meta.publishDate} 发布` : ''}
      &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;
      ${meta.implementDate ? `${meta.implementDate} 实施` : ''}
    </div>` : ''}
  <div class="cover-issuer">${meta.issuer || '发布机构'}</div>
</div>
`

  // 页眉（运行元素，使用 CSS running element）
  const headerHtml = `<div class="page-header-running">${meta.stdCode || ''}</div>`

  const fullHtml = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width">
  <title>${meta.title || '标准文件'}</title>
  <style>${PRINT_CSS}</style>
</head>
<body>
  ${headerHtml}
  ${coverHtml}
  <div class="main-content">
    ${html}
  </div>
  <script>
    window.addEventListener('load', function() {
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
