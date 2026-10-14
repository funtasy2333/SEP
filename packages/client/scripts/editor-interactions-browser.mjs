/** Local UI regression; uses an in-memory document API, never a user's document store.
 * node packages/client/scripts/editor-interactions-browser.mjs http://127.0.0.1:5188 <output-dir>
 */
import { chromium } from '../../server/node_modules/playwright-chromium/index.mjs'
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'

const origin = process.argv[2] || 'http://127.0.0.1:5188'
const url = new URL(origin)
if (!['127.0.0.1', 'localhost'].includes(url.hostname) || url.protocol !== 'http:' || url.origin !== origin) throw new Error('Only a local HTTP origin is allowed')
const output = resolve(process.argv[3] || 'output/editor-interactions')
await mkdir(output, { recursive: true })
const text = value => ({ type: 'text', text: value })
const p = value => ({ type: 'stdParagraph', content: [text(value)] })
let fixture = {
  id: 9001, title: '编辑交互验收样稿', stage: 'working_draft',
  meta: { titleCn: '编辑交互验收样稿', standardType: 'group', standardNo: 'T/TEST 1—2026', issuer: '测试协会' },
  content: { type: 'doc', content: [
    { type: 'chapter', content: [
      { type: 'chapterTitle', content: [text('交互测试')] }, p('表格前正文'),
      { type: 'stdTable', content: [
        { type: 'tableCaption', content: [text('测试表')] },
        { type: 'table', content: Array.from({ length: 3 }, (_, r) => ({ type: 'tableRow', content: Array.from({ length: 3 }, (_, c) => ({ type: r === 0 ? 'tableHeader' : 'tableCell', content: [{ type: 'paragraph', content: [text(`格${r + 1}${c + 1}`)] }] })) })) },
      ] }, p('表格后正文'),
      { type: 'stdList', attrs: { listType: 'dash' }, content: ['列项一', '列项二', '列项三'].map(value => ({ type: 'stdListItem', content: [text(value)] })) },
    ] },
    { type: 'chapter', content: [{ type: 'chapterTitle', content: [text('下一章')] }, p('末段正文')] },
  ] },
}
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, acceptDownloads: true })
const evidence = { origin, status: 'in-progress', steps: [], errors: [] }
page.on('pageerror', error => evidence.errors.push(error.message))
await page.route(`${origin}/api/**`, async route => {
  if (new URL(route.request().url()).pathname === '/api/convert/capabilities') return route.fulfill({ json: { htmlToPdf: false } })
  if (route.request().method() === 'PUT') fixture = { ...fixture, ...route.request().postDataJSON() }
  return route.fulfill({ json: fixture })
})
const editor = () => page.locator('.tiptap')
async function selectText(value, start = 0, length = 0) {
  await editor().evaluate((element, { value, start, length }) => {
    const e = element.editor
    let position = -1
    e.state.doc.descendants((node, pos) => { if (node.isText && node.text === value) position = pos })
    if (position < 0) throw new Error(`Missing text ${value}`)
    e.commands.setTextSelection({ from: position + start, to: position + start + length })
    e.view.focus()
  }, { value, start, length })
}
async function dragCells(first, last) {
  const cells = page.locator('.tiptap th,.tiptap td')
  await page.locator('.std-table-caption').click()
  await cells.nth(first).scrollIntoViewIfNeeded()
  const a = await cells.nth(first).boundingBox(), b = await cells.nth(last).boundingBox()
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2)
  await page.mouse.down()
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 12 })
  await page.mouse.up()
  await page.waitForTimeout(150)
  return editor().evaluate(element => {
    const selected = element.querySelector('.selectedCell')
    return { type: element.editor.state.selection.constructor.name, count: element.querySelectorAll('.selectedCell').length,
      color: selected && getComputedStyle(selected, '::after').backgroundColor, overlay: selected && getComputedStyle(selected, '::after').content }
  })
}
try {
  await page.goto(`${origin}/editor/9001`)
  await editor().locator('table').waitFor()
  const gapExtension = await editor().evaluate(element => element.editor.extensionManager.extensions.some(extension => extension.name === 'gapCursor'))
  assert.equal(gapExtension, false)
  await selectText('表格后正文', 5)
  await page.keyboard.press('ArrowDown')
  assert.equal(await page.locator('.ProseMirror-gapcursor').count(), 0)
  evidence.steps.push('横向 gap cursor 关闭，正文保留普通文字光标')

  for (const [a, b, count] of [[0, 1, 2], [0, 3, 2], [0, 4, 4]]) {
    const result = await dragCells(a, b)
    assert.equal(result.type, 'CellSelection')
    assert.equal(result.count, count)
    assert.equal(result.overlay, '""')
    assert.notEqual(result.color, 'rgba(0, 0, 0, 0)')
  }
  await page.screenshot({ caret: 'initial', path: join(output, 'cell-selection.png') })
  evidence.steps.push('真实鼠标横向、纵向、矩形拖选分别选中2、2、4格并显示高亮')

  await page.getByRole('button', { name: '表格', exact: true }).click()
  assert.equal(await page.getByRole('menuitem', { name: '上方插入行', exact: true }).isVisible(), false)
  await page.getByText('单元格', { exact: true }).hover()
  await page.getByRole('menuitem', { name: '合并单元格', exact: true }).click()
  assert.equal(await editor().locator('th[colspan="2"][rowspan="2"]').count(), 1)
  await page.getByRole('button', { name: '表格', exact: true }).click()
  await page.getByText('单元格', { exact: true }).hover()
  await page.getByRole('menuitem', { name: '拆分单元格', exact: true }).click()
  assert.equal(await editor().locator('td,th').count(), 9)
  evidence.steps.push('二级单元格菜单保持拖选范围，合并及拆分生效')

  await selectText('格33')
  await page.getByRole('button', { name: '表格', exact: true }).click()
  await page.getByText('行与列', { exact: true }).hover()
  await page.getByRole('menuitem', { name: '下方插入行', exact: true }).waitFor({ state: 'visible' })
  await page.screenshot({ caret: 'initial', path: join(output, 'table-menu.png') })
  await page.getByRole('menuitem', { name: '下方插入行', exact: true }).click()
  assert.equal(await editor().locator('tr').count(), 4)
  await page.getByRole('button', { name: '表格', exact: true }).click()
  await page.getByText('行与列', { exact: true }).hover()
  await page.getByRole('menuitem', { name: '删除行', exact: true }).click()
  assert.equal(await editor().locator('tr').count(), 3)
  await selectText('测试表')
  await page.getByRole('button', { name: '表格', exact: true }).click()
  await page.getByRole('menuitem', { name: '删除表格', exact: true }).click()
  assert.equal(await editor().locator('.std-table-wrapper').count(), 0)
  assert.ok((await editor().innerText()).includes('表格前正文'))
  assert.ok((await editor().innerText()).includes('表格后正文'))
  await editor().evaluate(element => element.editor.commands.undo())
  assert.equal(await editor().locator('table').count(), 1)
  await editor().evaluate(element => element.editor.commands.redo())
  assert.equal(await editor().locator('table').count(), 0)
  evidence.steps.push('行列二级菜单可操作；从表题完整删除整表，撤销重做保留前后文')

  await selectText('列项三', 3)
  await page.keyboard.press('Enter')
  await page.keyboard.insertText('回车后的列项')
  assert.equal(await editor().locator('.std-list-item').count(), 4)
  await selectText('回车后的列项', 2, 3)
  await page.getByRole('button', { name: '段落', exact: true }).click()
  assert.equal(await editor().locator('p[data-type="std-paragraph"]').filter({ hasText: '回车后的列项' }).count(), 1)
  assert.equal(await editor().locator('.std-list-item').count(), 3)
  await selectText('列项二', 1, 1)
  await page.getByRole('button', { name: '注', exact: true }).click()
  await page.getByRole('menuitem', { name: '注', exact: true }).click()
  assert.equal(await editor().locator('.std-note-content').filter({ hasText: '列项二' }).count(), 1)
  assert.equal(await editor().locator('.std-list-item').count(), 2)
  await page.screenshot({ caret: 'initial', path: join(output, 'list-conversion.png') })
  evidence.steps.push('回车续列项可改为段落；部分选中文本改注保留整项正文和相邻列项')

  await page.getByRole('button', { name: '添加章节结构', exact: true }).click()
  await page.getByRole('menuitem', { name: '前言', exact: true }).click()
  assert.ok((await editor().locator('.std-foreword').innerText()).includes('不承担识别这些专利的责任。'))
  assert.ok((await editor().locator('.std-foreword').innerText()).includes('本文件主要起草人：'))
  assert.equal(await editor().evaluate(element => element.editor.state.doc.firstChild.type.name), 'coverPage')
  const saving = page.waitForResponse(response => response.request().method() === 'PUT' && response.url() === `${origin}/api/documents/9001`)
  await page.keyboard.press('Control+s')
  await saving
  await page.locator('.ses-save-pill').getByText(/已保存/).waitFor()
  await page.waitForFunction(() => !document.body.innerText.includes('保存中'))
  const saved = await editor().evaluate(element => element.editor.getJSON())
  await page.reload()
  await editor().locator('.std-foreword').waitFor()
  const reopened = await editor().evaluate(element => element.editor.getJSON())
  assert.deepEqual(reopened, saved)
  evidence.steps.push('手动添加前言默认包含专利识别和主要起草人行；保存重开保留修改且不重套模板')

  await page.getByRole('button', { name: '导出', exact: true }).click()
  const download = page.waitForEvent('download')
  await page.locator('.export-card').filter({ has: page.getByText('DOCX', { exact: true }) }).click()
  await (await download).saveAs(join(output, 'group-cover.docx'))
  evidence.steps.push('团体标准从真实UI导出DOCX，交给OOXML及渲染核验')
  assert.deepEqual(evidence.errors, [])
  evidence.status = 'passed'
} catch (error) {
  evidence.status = 'failed'; evidence.failure = error.message
  await page.screenshot({ caret: 'initial', path: join(output, 'failure.png') }).catch(() => {})
  throw error
} finally {
  await writeFile(join(output, 'browser-evidence.json'), JSON.stringify(evidence, null, 2) + '\n')
  await browser.close()
}
console.log(JSON.stringify(evidence, null, 2))
