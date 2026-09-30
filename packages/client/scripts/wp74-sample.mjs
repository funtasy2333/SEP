/**
 * 手工验收样稿：使用真实 buildDocxBlob 链生成 WP7.4 覆盖文档。
 * 用法：node packages/client/scripts/wp74-sample.mjs <输出 DOCX 绝对路径>
 */
import { writeFile, mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

const clientRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const output = process.argv[2]
if (!output || !output.startsWith('/')) throw new Error('请提供 DOCX 输出绝对路径')

const text = (value) => ({ type: 'text', text: value })
const paragraph = (id, value) => ({ type: 'stdParagraph', attrs: { nodeId: id }, content: [text(value)] })
const formula = (id, latex) => ({
  type: 'formula', attrs: { nodeId: id }, content: [{ type: 'formulaContent', content: [text(latex)] }],
})
const cell = (value, attrs = {}) => ({
  type: attrs.header ? 'tableHeader' : 'tableCell', attrs,
  content: [paragraph(`sample-cell-${++cellId}`, value)],
})
let cellId = 0
const tableRow = (...cells) => ({ type: 'tableRow', content: cells })
const table = (id, caption, rows, orientation = 'portrait', note = '') => ({
  type: 'stdTable', attrs: { nodeId: id, orientation }, content: [
    { type: 'tableCaption', content: [text(caption)] },
    { type: 'table', content: rows },
    ...(note ? [{ type: 'tableFootnote', content: [text(note)] }] : []),
  ],
})
const figure = (id, orientation, src) => ({
  type: 'figure', attrs: { nodeId: id, orientation }, content: [
    { type: 'figureImage', attrs: { src } },
    { type: 'figureCaption', content: [text('横排图片样例')] },
  ],
})

const formulas = [
  String.raw`w = \frac{m_1-m_2}{m_1}\times 100\%`,
  String.raw`\bar{x}=\frac{1}{n}\sum_{i=1}^{n}x_i`,
  String.raw`a < b \leq c \quad \text{且} \quad A \& B`,
  String.raw`s=\sqrt{\frac{\sum_{i=1}^{n}(x_i-\bar{x})^2}{n-1}}`,
  String.raw`\int_{0}^{\infty}e^{-x^2}\,\mathrm{d}x=\frac{\sqrt{\pi}}{2}`,
  String.raw`\begin{bmatrix}a&b\\c&d\end{bmatrix}`,
  String.raw`f(x)=\begin{cases}x^2,&x\geq 0\\-x,&x<0\end{cases}`,
  String.raw`\prod_{i=1}^{n}p_i`,
  String.raw`\sqrt[3]{a+b}`,
  String.raw`\sum_{i=1}^{n}i^2`,
  String.raw`\iint_D f(x,y)\,\mathrm{d}A`,
  String.raw`(\sum_{i=1}^{n}x_i)+y`,
  String.raw`(\sum_{i=1}^{n}x_i)^2-z`,
  String.raw`A\cap B\cup C\neq\varnothing`,
]

const bluePng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAHgAAAA8CAIAAAAiz+n/AAAAa0lEQVR42u3QQQ0AAAgEoOsfzwRmMIEtnA82EpDq4UAUiBaNaNGiLYgWjWjRoi2IFo1o0aIRLRrRokUjWjSiRYtGtGhEixaNaNGIFi0a0aIRLRrRokUjWjSiRYtGtGhEixaNaNGiES0a0b8s0ipI1zvfEP8AAAAASUVORK5CYII='
const longRows = [
  tableRow(cell('项目', { header: true, colspan: 2 }), cell('数值', { header: true }), cell('说明', { header: true })),
  tableRow(cell('跨行且跨列', { colspan: 2, rowspan: 2 }), cell('1'), cell('合并首行')),
  tableRow(cell('2'), cell('合并续行')),
  ...Array.from({ length: 64 }, (_, i) => tableRow(
    cell(`测试项目 ${i + 1}`), cell('—'), cell(String(i + 3)), cell('用于验证表头在跨页时重复。'),
  )),
]
const shortRows = [
  tableRow(cell('项目', { header: true }), cell('数值', { header: true })),
  tableRow(cell('横排内容'), cell('123')),
]

const pmDoc = {
  type: 'standardDoc',
  attrs: { standardType: 'national', titleCn: 'WP7.4 图表公式与横排验收样稿', standardNo: 'GB/T 12345—2026' },
  content: [
    { type: 'foreword', content: [paragraph('foreword-p', '本文件用于 DOCX 图、表、公式和横排核验。')] },
    { type: 'chapter', attrs: { nodeId: 'sample-ch1' }, content: [
      { type: 'chapterTitle', content: [text('范围')] },
      paragraph('sample-intro', '下列 14 个编号公式覆盖比较符、逻辑符、求和、积分、根号、矩阵与分段函数。'),
      ...formulas.map((source, index) => formula(`formula-${index + 1}`, source)),
      table('long-table', '跨页合并单元格表', longRows, 'portrait', '续表题与表头应在后续页重复。'),
      figure('wide-figure', 'landscape', bluePng),
      table('wide-table', '连续横排表', shortRows, 'landscape', '此表与前图应共用横排节。'),
      paragraph('portrait-restored', '此段应恢复竖排，页码继续。'),
    ] },
    { type: 'appendix', attrs: { nodeId: 'app-a', normative: true }, content: [
      { type: 'appendixLabel', content: [text('（规范性）')] },
      { type: 'appendixTitle', content: [text('末尾横排检验')] },
      paragraph('appendix-p', '下一表是文件最后一个内容要素，终结线应在同一横排页。'),
      table('end-table', '末尾横排表', shortRows, 'landscape'),
    ] },
  ],
}

const server = await createServer({
  root: clientRoot,
  configFile: false,
  resolve: { alias: { '@': resolve(clientRoot, 'src') } },
  optimizeDeps: { noDiscovery: true },
  server: { middlewareMode: true },
})
try {
  const { buildDocxBlob } = await server.ssrLoadModule('/src/serializer/docxExporter.ts')
  const { blob, warnings } = await buildDocxBlob({ pmDoc, stage: 'approval_draft', createdAt: '2026-09-29T08:00:00Z' })
  await mkdir(dirname(output), { recursive: true })
  await writeFile(output, new Uint8Array(await blob.arrayBuffer()))
  console.log(JSON.stringify({ output, bytes: blob.size, warnings, formulaCount: formulas.length }, null, 2))
} finally {
  await server.close()
}
