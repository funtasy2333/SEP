import { createRequire } from 'node:module'
import assert from 'node:assert/strict'
const require = createRequire(new URL('../../server/package.json', import.meta.url))
const { chromium } = require('playwright-chromium')
const JSZip = require('../io/node_modules/jszip')
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } })
  await page.goto(process.env.SES_TEST_URL || 'http://localhost:5173/browser-tests/')
  await page.waitForFunction(() => !!window.editor)
  const result = await page.evaluate(async () => {
    const { buildDocxBlob } = await import('/src/serializer/docxExporter.ts')
    const cell = (text, attrs = {}) => ({ type: 'tableCell', attrs, content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] })
    window.editor.commands.setContent({ type: 'doc', content: [{ type: 'chapter', content: [
      { type: 'chapterTitle', content: [{ type: 'text', text: '列宽回归' }] },
      { type: 'stdTable', attrs: { nodeId: 'width-table' }, content: [{ type: 'tableCaption' }, { type: 'table', content: [
        { type: 'tableRow', content: [cell('序号', { colwidth: [41] }), cell('名称'), cell('主要内容与详细说明')] },
        { type: 'tableRow', content: [cell('1', { colwidth: [41] }), cell('资料收集'), cell('收集区域水文、水质、污染源、生产使用、排放和既有监测资料，形成污染源清单。')] },
        { type: 'tableRow', content: [cell('合并', { colspan: 2 }), cell('合并单元格说明')] },
      ] }] },
    ] }] })
    await new Promise(resolve => requestAnimationFrame(resolve))
    const before = JSON.stringify(window.editor.getJSON())
    const widths = [...document.querySelectorAll('table col')].map(col => col.getBoundingClientRect().width)
    const { blob } = await buildDocxBlob({ pmDoc: window.editor.state.doc, editorView: window.editor.view })
    return { widths, bytes: [...new Uint8Array(await blob.arrayBuffer())], unchanged: before === JSON.stringify(window.editor.getJSON()) }
  })
  const zip = await JSZip.loadAsync(Uint8Array.from(result.bytes))
  const xml = await zip.file('word/document.xml').async('string')
  const grid = [...xml.match(/<w:tblGrid>(.*?)<\/w:tblGrid>/)[1].matchAll(/w:w="(\d+)"/g)].map(match => Number(match[1]))
  console.log({ editor: result.widths, docx: grid })
  const screenTotal = result.widths.reduce((a, b) => a + b, 0)
  const docxTotal = grid.reduce((a, b) => a + b, 0)
  grid.forEach((width, i) => assert.ok(Math.abs(width / docxTotal - result.widths[i] / screenTotal) < 0.002, `column ${i + 1} proportion differs`))
  assert.ok(result.unchanged, 'export must not mutate the editor document')
  assert.ok(xml.includes(`<w:tcW w:w="${grid[0] + grid[1]}" w:type="dxa"/>`), 'merged cell uses the sum of its columns')
} finally { await browser.close() }
