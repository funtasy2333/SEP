// Browser regression: run with the client Vite server and the server's Playwright dependency.
import { createRequire } from 'node:module'
import assert from 'node:assert/strict'
const require = createRequire(new URL('../../server/package.json', import.meta.url))
const { chromium } = require('playwright-chromium')
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } })
  await page.goto(process.env.SES_TEST_URL || 'http://127.0.0.1:5175/browser-tests/')
  await page.waitForSelector('.std-table-wrapper table')
  const measure = () => page.evaluate(() => {
    const editorContent = document.querySelector('.editor-content')
    const wrapper = document.querySelector('.std-table-wrapper')
    const tableWrapper = wrapper.querySelector('.tableWrapper')
    const table = wrapper.querySelector('table')
    return {
      wrapper: wrapper.getBoundingClientRect().width,
      table: table.getBoundingClientRect().width,
      tableWrapperClient: tableWrapper.clientWidth,
      tableWrapperScroll: tableWrapper.scrollWidth,
      tableWrapperHeightClient: tableWrapper.clientHeight,
      tableWrapperHeightScroll: tableWrapper.scrollHeight,
      editorClient: editorContent.clientWidth,
      editorScroll: editorContent.scrollWidth,
      cells: Array.from(table.rows[0].cells, cell => cell.getBoundingClientRect().width),
      spans: Array.from(table.rows[0].cells, cell => cell.colSpan), rows: table.rows.length,
    }
  })
  for (const width of [664, 441, 800]) {
    await page.evaluate(width => { const el = document.querySelector('.editor-content'); el.style.width = `${width}px`; el.style.padding = '0' }, width)
    const result = await measure()
    console.log(width, result)
    assert.ok(result.table <= result.wrapper + 1, `table exceeds ${width}px container by ${result.table-result.wrapper}px`)
    assert.deepEqual(result.spans, [3,1,1,10])
    assert.equal(result.rows, 21)
    if (width === 664) assert.ok(result.cells[1] > 60, 'date cell should have room to display its content')
  }
  if (process.env.SES_SCREENSHOT) {
    await page.evaluate(() => { document.querySelector('.editor-content').style.width = '666px' })
    await page.screenshot({ path: process.env.SES_SCREENSHOT, fullPage: true })
  }
  // A regular table with nominal widths keeps those widths, and resizing changes
  // the editor's colwidth without changing the nominal column model.
  await page.evaluate(() => {
    const cell = text => ({ type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] })
    window.editor.commands.setContent({ type: 'doc', content: [{ type: 'stdTable', attrs: { columns: [
      { width: 40, widthUnit: '%' }, { width: 60, widthUnit: '%' },
    ] }, content: [{ type: 'tableCaption' }, { type: 'table', content: [
      { type: 'tableRow', content: [cell('第一列'), cell('第二列')] },
      { type: 'tableRow', content: [cell('内容'), cell('内容')] },
    ] }] }] })
  })
  await page.waitForSelector('.std-table-wrapper[data-columns]')
  const original = await page.locator('tr:first-child td:first-child').boundingBox()
  const second = await page.locator('tr:first-child td:nth-child(2)').boundingBox()
  assert.ok(Math.abs(original.width / (original.width + second.width) - 0.4) < 0.05, 'nominal 40/60 widths should render')
  await page.mouse.move(original.x + original.width - 2, original.y + original.height / 2)
  await page.mouse.down()
  await page.mouse.move(original.x + original.width + 48, original.y + original.height / 2, { steps: 5 })
  await page.mouse.up()
  const after = await page.evaluate(() => ({ json: window.editor.getJSON(), width: document.querySelector('tr:first-child td:first-child').getBoundingClientRect().width }))
  assert.ok(after.width > original.width + 20, 'drag should increase the first column')
  assert.deepEqual(after.json.content[0].attrs.columns, [{ width: 40, widthUnit: '%' }, { width: 60, widthUnit: '%' }])
  assert.ok(after.json.content[0].content[1].content[0].content[0].attrs.colwidth[0] > 0, 'drag stores a pixel width')
  console.log('nominal and dragged widths', original.width, after.width)
  await page.evaluate(() => {
    const json = window.editor.getJSON()
    for (const row of json.content[0].content[1].content) {
      row.content[0].attrs.colwidth = [900]
      row.content[1].attrs.colwidth = [200]
    }
    window.editor.commands.setContent(json)
  })
  const wide = await measure()
  assert.ok(wide.table > wide.wrapper, 'explicit oversized pixel widths should retain their semantics')
  assert.ok(wide.tableWrapperScroll > wide.tableWrapperClient, 'oversized table should scroll inside .tableWrapper')
  assert.ok(wide.editorScroll <= wide.editorClient + 1, 'paper .editor-content must not overflow horizontally')
  console.log('explicit oversized width', wide.table, 'in', wide.wrapper, 'scroll', wide.tableWrapperScroll)

  // Restore default 810px paper (666px inner content width) for landscape checks.
  await page.evaluate(() => {
    const el = document.querySelector('.editor-content')
    el.style.width = ''
    el.style.padding = ''
    const cell = text => ({ type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] })
    window.editor.commands.setContent({ type: 'doc', content: [{ type: 'stdTable', attrs: { orientation: 'landscape' }, content: [
      { type: 'tableCaption', content: [{ type: 'text', text: '横表' }] },
      { type: 'table', content: [
        { type: 'tableRow', content: Array.from({ length: 6 }, (_, i) => cell(`列${i + 1}`)) },
      ] },
    ] }] })
  })
  await page.waitForSelector('.std-table-wrapper[data-orientation="landscape"]')
  const landscapeTable = await measure()
  assert.ok(landscapeTable.table >= 950, `landscape table should expand to ~952px, got ${landscapeTable.table}`)
  assert.ok(landscapeTable.tableWrapperScroll > landscapeTable.tableWrapperClient, 'landscape table should scroll inside .tableWrapper')
  assert.ok(landscapeTable.tableWrapperHeightScroll <= landscapeTable.tableWrapperHeightClient + 1, 'landscape .tableWrapper should not trigger a vertical scrollbar')
  assert.ok(landscapeTable.editorScroll <= landscapeTable.editorClient + 1, 'landscape table must not widen paper')
  const badge = await page.evaluate(() => getComputedStyle(document.querySelector('.std-table-wrapper'), '::before').content)
  assert.ok(badge && badge !== 'none', 'landscape table should render ::before badge')

  // Inside a landscape appendix, inner tables also expand & scroll, and hide duplicate child landscape badges.
  await page.evaluate(() => {
    const cell = text => ({ type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] })
    window.editor.commands.setContent({ type: 'doc', content: [{ type: 'appendix', attrs: { orientation: 'landscape', normative: false }, content: [
      { type: 'appendixLabel', content: [{ type: 'text', text: '（资料性）' }] },
      { type: 'appendixTitle', content: [{ type: 'text', text: '横向附录' }] },
      { type: 'stdTable', attrs: { orientation: 'landscape' }, content: [
        { type: 'tableCaption', content: [{ type: 'text', text: '附录横表' }] },
        { type: 'table', content: [{ type: 'tableRow', content: Array.from({ length: 5 }, (_, i) => cell(`列${i + 1}`)) }] },
      ] },
    ] }] })
  })
  await page.waitForSelector('.std-appendix[data-orientation="landscape"] .std-table-wrapper')
  const appTable = await measure()
  assert.ok(appTable.table >= 950, `table inside landscape appendix should expand to ~952px, got ${appTable.table}`)
  assert.ok(appTable.tableWrapperScroll > appTable.tableWrapperClient, 'table inside landscape appendix should scroll inside .tableWrapper')
  const childBadgeDisplay = await page.evaluate(() => getComputedStyle(document.querySelector('.std-table-wrapper'), '::before').display)
  assert.equal(childBadgeDisplay, 'none', 'duplicate child badge should be hidden inside landscape appendix')
  console.log('landscape table and appendix checks passed', landscapeTable.table, appTable.table)
} finally { await browser.close() }
