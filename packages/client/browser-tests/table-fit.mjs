// Browser regression: run with the client Vite server and the server's Playwright dependency.
import { createRequire } from 'node:module'
import assert from 'node:assert/strict'
const require = createRequire(new URL('../../server/package.json', import.meta.url))
const { chromium } = require('playwright-chromium')
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } })
  await page.goto(process.env.SES_TEST_URL || 'http://localhost:5173/browser-tests/')
  await page.waitForSelector('.std-table-wrapper table')
  const measure = () => page.evaluate(() => {
    const editorContent = document.querySelector('.editor-content')
    const wrapper = document.querySelector('.std-table-wrapper')
    const tableWrapper = wrapper.querySelector('.tableWrapper')
    const table = wrapper.querySelector('table')
    const tableWrapperStyle = getComputedStyle(tableWrapper)
    return {
      wrapper: wrapper.getBoundingClientRect().width,
      table: table.getBoundingClientRect().width,
      tableOffsetWidth: table.offsetWidth,
      tableRectHeight: table.getBoundingClientRect().height,
      tableWrapperClient: tableWrapper.clientWidth,
      tableWrapperScroll: tableWrapper.scrollWidth,
      tableWrapperOverflowX: tableWrapperStyle.overflowX,
      tableWrapperOverflowY: tableWrapperStyle.overflowY,
      tableWrapperHeightClient: tableWrapper.clientHeight,
      tableWrapperHeightScroll: tableWrapper.scrollHeight,
      landscapeScale: tableWrapper.dataset.landscapeScale,
      expandButtonCount: wrapper.querySelectorAll('.ses-expand-landscape-btn').length,
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

  async function assertPreviewCannotResizeColumns() {
    const cell = await page.locator('.tableWrapper[data-landscape-scale] tr:first-child td:first-child').boundingBox()
    assert.ok(cell, 'scaled table should render a cell to drag')
    const before = await page.evaluate(() => window.editor.getJSON())
    const x = cell.x + cell.width - 2
    const y = cell.y + cell.height / 2
    await page.mouse.move(x, y)
    await page.mouse.down()
    await page.mouse.move(x + 50, y, { steps: 5 })
    await page.mouse.up()
    const after = await page.evaluate(() => window.editor.getJSON())
    assert.deepEqual(after, before, 'dragging a cell border in a scaled table should not change its columns')
  }

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
  await page.waitForSelector('.std-table-wrapper[data-orientation="landscape"] > .tableWrapper[data-landscape-scale]')
  const landscapeTable = await measure()
  assert.ok(landscapeTable.tableOffsetWidth >= 950, `unscaled landscape table should expand to ~952px, got ${landscapeTable.tableOffsetWidth}`)
  assert.ok(landscapeTable.table <= landscapeTable.tableWrapperClient + 1, `scaled landscape table should fit within .tableWrapper (${landscapeTable.table} <= ${landscapeTable.tableWrapperClient})`)
  assert.equal(landscapeTable.tableWrapperOverflowX, 'hidden', 'landscape .tableWrapper should hide horizontal overflow')
  assert.equal(landscapeTable.tableWrapperOverflowY, 'hidden', 'landscape .tableWrapper should hide vertical overflow')
  assert.ok(Number(landscapeTable.landscapeScale) > 0 && Number(landscapeTable.landscapeScale) < 1, `landscape scale should be between 0 and 1, got ${landscapeTable.landscapeScale}`)
  assert.equal(landscapeTable.expandButtonCount, 1, 'landscape table should render one expand-to-edit button')
  assert.ok(landscapeTable.tableRectHeight <= landscapeTable.tableWrapperHeightClient + 1, 'landscape .tableWrapper should wrap scaled table height tightly')
  assert.ok(landscapeTable.editorScroll <= landscapeTable.editorClient + 1, 'landscape table must not widen paper')
  const badge = await page.evaluate(() => getComputedStyle(document.querySelector('.std-table-wrapper'), '::before').content)
  assert.ok(badge && badge !== 'none', 'landscape table should render ::before badge')

  await assertPreviewCannotResizeColumns()

  // Inside a landscape appendix, inner tables also scale proportionally to fit body width without horizontal scroll, and hide duplicate child landscape badges.
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
  await page.waitForSelector('.std-appendix[data-orientation="landscape"] .std-table-wrapper > .tableWrapper[data-landscape-scale]')
  const appTable = await measure()
  assert.ok(appTable.tableOffsetWidth >= 950, `table inside landscape appendix should expand to ~952px, got ${appTable.tableOffsetWidth}`)
  assert.ok(appTable.table <= appTable.tableWrapperClient + 1, `scaled table inside landscape appendix should fit within .tableWrapper (${appTable.table} <= ${appTable.tableWrapperClient})`)
  assert.equal(appTable.tableWrapperOverflowX, 'hidden', 'table inside landscape appendix should hide horizontal overflow')
  assert.equal(appTable.tableWrapperOverflowY, 'hidden', 'table inside landscape appendix should hide vertical overflow')
  assert.ok(appTable.tableRectHeight <= appTable.tableWrapperHeightClient + 1, 'appendix landscape .tableWrapper should wrap scaled table height tightly')
  assert.ok(Number(appTable.landscapeScale) > 0 && Number(appTable.landscapeScale) < 1, `appendix landscape scale should be between 0 and 1, got ${appTable.landscapeScale}`)
  assert.equal(appTable.expandButtonCount, 1, 'table inside landscape appendix should render expand-to-edit button')
  const childBadgeDisplay = await page.evaluate(() => getComputedStyle(document.querySelector('.std-table-wrapper'), '::before').display)
  assert.equal(childBadgeDisplay, 'none', 'duplicate child badge should be hidden inside landscape appendix')
  await assertPreviewCannotResizeColumns()
  console.log('landscape table and appendix checks passed', {
    tableOffsetWidth: landscapeTable.tableOffsetWidth,
    scaledWidth: landscapeTable.table,
    scale: landscapeTable.landscapeScale,
    appTableOffsetWidth: appTable.tableOffsetWidth,
    appScaledWidth: appTable.table,
    appScale: appTable.landscapeScale,
  })
} finally { await browser.close() }
