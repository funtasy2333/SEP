/**
 * WP8.M M-Z-b 目视走查：真实 Chromium + 真实编辑器 + 隔离 API/SQLite。
 *   node packages/client/scripts/wp8m-browser-walkthrough.mjs <origin> <output-dir>
 *
 * 只允许本机 HTTP origin，且 /api 背后必须是一次性的空文档库（先把 Vite 的 /api 代理指向隔离实例，见 docs/wp8.m/validation.md）。
 * 脚本做三件事：
 *   1. 把 M-Z-a 全要素 fixture（`src/extensions/__fixtures__/wp8m.ts`）经生产 Schema 规范化后存入空库，载入真实编辑器，
 *      对设计 §4.9 第 6 项的每个清单项截图，并给出可机检的 DOM/样式断言；
 *   2. 编辑器内实际按键：规范性引用条目的编号 / 名称里按 Enter（不拆分），图例标题里按 Enter（进入第一项）；
 *   3. 导出：全要素文档走 UI 导出 → 暂不排版的结构应被阻断；去掉这些结构的第二份文档走 UI 导出“版式预览”(HTML 打印 → PDF)，
 *      并把相关页面渲染成 PNG（需要 poppler 的 pdftotext/pdftoppm）。
 * 浏览器：默认用 server 包里的 playwright-chromium；环境里的 Chromium 版本不同时，用 WP8M_PLAYWRIGHT 指向匹配版本的 playwright 入口，
 * 例如 /opt/node-tools/node_modules/playwright/index.mjs；Chromium 本体由 PLAYWRIGHT_BROWSERS_PATH 定位，不执行 playwright install。
 * 不新增依赖，不进入 CI。
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const origin = process.argv[2] || 'http://127.0.0.1:5198'
const output = resolve(process.argv[3] || 'output/wp8m-walkthrough')
const url = new URL(origin)
if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(url.hostname) || url.origin !== origin) throw new Error('只允许本机 HTTP origin')
if (url.port === '3000' || url.port === '5173') throw new Error('不得使用默认端口 3000/5173（它们可能指向用户的业务数据库）')
const playwrightEntry = process.env.WP8M_PLAYWRIGHT ? pathToFileURL(process.env.WP8M_PLAYWRIGHT).href : new URL('../../server/node_modules/playwright-chromium/index.mjs', import.meta.url).href
const { chromium } = await import(playwrightEntry)
await mkdir(output, { recursive: true })

const evidence = { origin, status: 'in-progress', screenshots: [], checks: [], interactions: [], exports: [], consoleErrors: [], pageErrors: [] }
const note = (kind, text, extra = {}) => { evidence[kind].push({ text, ...extra }); console.log(`[${kind}] ${text}`) }

const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, acceptDownloads: true })
const page = await context.newPage()
page.on('pageerror', error => evidence.pageErrors.push(error.message))
page.on('console', message => { if (message.type() === 'error') evidence.consoleErrors.push(message.text()) })

const editorJson = () => page.locator('.tiptap').evaluate(element => element.editor.getJSON())

/**
 * 元素截图：把元素滚到工具栏下方，按元素外框加边距裁剪，宽度取编辑器页面栏（含大纲时另用 viewportShot）。
 * `through` 给出时，裁剪范围取 locator 到 through 两个元素外框的并集（用来截取“一段连续内容”）。
 * 注意：所有截图都用 caret:'initial'；Playwright 默认的 caret:'hide' 会让 ProseMirror 把一次 DOM 变化误读成回车而劈开段落。
 */
async function shot(name, locator, { pad = 28, maxHeight = 820, through = null } = {}) {
  // 工具栏占视口顶部约 104px：把元素滚到距滚动容器顶部 150px 处（立即滚动，不用 smooth），避免遮住被截取的内容
  await locator.first().evaluate(element => {
    const container = document.querySelector('.editor-content-wrapper')
    const offset = element.getBoundingClientRect().top - container.getBoundingClientRect().top
    container.scrollTo({ top: Math.max(0, container.scrollTop + offset - 150), behavior: 'instant' })
  })
  await page.waitForTimeout(300)
  const first = await locator.first().boundingBox()
  const last = through ? await through.first().boundingBox() : first
  assert.ok(first && last, `${name}：元素没有外框`)
  const editorBox = await page.locator('.tiptap').boundingBox()
  const top = first.y
  const bottom = Math.max(first.y + first.height, last.y + last.height)
  const x = Math.max(0, editorBox.x - 20)
  const y = Math.max(0, top - pad)
  const height = Math.min(maxHeight, 1100 - y, bottom - top + pad * 2)
  await page.screenshot({ caret: 'initial', path: join(output, `${name}.png`), clip: { x, y, width: Math.min(editorBox.width + 40, 1440 - x), height } })
  evidence.screenshots.push(`${name}.png`)
}
async function viewportShot(name, clip) {
  await page.screenshot({ caret: 'initial', path: join(output, `${name}.png`), clip })
  evidence.screenshots.push(`${name}.png`)
}

/** 在浏览器里取全要素 fixture（经生产 Schema 规范化）及“去掉暂不排版结构”的版本。 */
async function loadFixtures() {
  await page.goto(origin)
  return page.evaluate(async () => {
    const { createWp8mFixture } = await import('/src/extensions/__fixtures__/wp8m.ts')
    const { createEditorSchema } = await import('/src/extensions/editorSchema.ts')
    const schema = createEditorSchema()
    const node = schema.nodeFromJSON(createWp8mFixture())
    node.check()
    const full = node.toJSON()
    // 设计 §7.1：图例、图中示例、行内图（及其文档级资源）、名义列宽、单元格边框样式暂报 unsupported-output
    const strip = value => {
      if (Array.isArray(value)) return value.filter(entry => !(entry && ['figureLegend', 'inlineImage', 'figureResource'].includes(entry.type))).map(strip)
      if (!value || typeof value !== 'object') return value
      const row = { ...value }
      if (row.type === 'figure' && Array.isArray(row.content)) row.content = row.content.filter(child => child.type !== 'example')
      if (row.type === 'stdTable' && row.attrs) row.attrs = { ...row.attrs, columns: null }
      if (['tableCell', 'tableHeader'].includes(row.type) && row.attrs) {
        // 任何单元格 style（边框宽度、单位、样式）都会让 HTML/DOCX 的 cell 字段表报 unsupported-output，四边的三个属性一并清掉
        const attrs = { ...row.attrs }
        for (const side of ['Top', 'Right', 'Bottom', 'Left']) for (const suffix of ['', 'Unit', 'Style']) attrs[`border${side}${suffix}`] = null
        row.attrs = attrs
      }
      if (Array.isArray(row.content)) row.content = strip(row.content)
      return row
    }
    const stripped = strip(full)
    schema.nodeFromJSON(stripped).check()
    return { full, stripped }
  })
}

async function createDocument(title, content) {
  const meta = { titleCn: title, titleEn: 'WP8.M visual walkthrough', standardType: 'national' }
  const response = await page.request.post(`${origin}/api/documents`, { data: { title, meta, stage: 'working_draft', content } })
  assert.equal(response.ok(), true, `创建文档失败：${response.status()}`)
  return (await response.json()).id
}

async function openEditor(id) {
  await page.goto(`${origin}/editor/${id}`)
  await page.locator('.tiptap').waitFor()
  await page.waitForTimeout(1200)
}

/** 把光标放到 nodeId 对应节点（或其某类型子节点）内，offset 为节点内文本偏移。 */
async function placeCaret(nodeId, childType, offset) {
  await page.locator('.tiptap').evaluate((element, { nodeId, childType, offset }) => {
    const editor = element.editor
    let target = null
    editor.state.doc.descendants((node, pos) => {
      if (target || node.attrs.nodeId !== nodeId) return true
      if (!childType) { target = { node, pos }; return false }
      node.forEach((child, childOffset) => { if (!target && child.type.name === childType) target = { node: child, pos: pos + 1 + childOffset } })
      return false
    })
    if (!target) throw new Error(`找不到 ${nodeId}${childType ? ` / ${childType}` : ''}`)
    const at = offset === 'end' ? target.pos + target.node.nodeSize - 1 : target.pos + 1 + offset
    editor.commands.setTextSelection(at)
    editor.view.focus()
  }, { nodeId, childType, offset })
}

try {
  const initial = await (await page.request.get(`${origin}/api/documents`)).json()
  assert.equal(initial.length, 0, '拒绝向非空文档库写入；必须使用隔离的空数据库及正确的 /api 代理')
  const { full, stripped } = await loadFixtures()
  const fullId = await createDocument('WP8.M 目视走查稿（全要素）', full)
  const strippedId = await createDocument('WP8.M 目视走查稿（去掉暂不排版结构）', stripped)
  note('checks', `隔离库已创建两份文档：全要素 id=${fullId}，去掉暂不排版结构 id=${strippedId}`)

  // ================= 一、全要素文档载入真实编辑器，逐项截图 =================
  await openEditor(fullId)
  const staged = await editorJson()
  assert.equal(staged.attrs.extensionVersion, 1)
  const loadedContent = JSON.stringify(staged.content)
  note('checks', '全要素文档载入真实编辑器，无页面错误；根属性 extensionVersion=1')

  // 1 规范性引用章
  const normChapter = page.locator('.std-chapter').filter({ has: page.locator('.std-norm-ref-list') })
  await shot('01-norm-ref-chapter', normChapter)
  const normRefs = await page.locator('.std-norm-ref').evaluateAll(nodes => nodes.map(node => ({
    cls: node.className, text: node.textContent, textIndent: getComputedStyle(node).textIndent,
    gap: node.querySelector('.std-norm-ref-title') ? getComputedStyle(node.querySelector('.std-norm-ref-title'), '::before').content : null,
  })))
  assert.equal(normRefs.length, 4)
  assert.deepEqual(normRefs.slice(0, 3).map(row => row.text), ['GB/T 321优先数和优先数系', 'GB/T 3102（所有部分）量和单位', 'ISO 80000（所有部分）量和单位（Quantities and units）'])
  assert.ok(normRefs.slice(0, 3).every(row => row.gap === '"　"'), '编号与名称之间为一个全角空格（::before）')
  note('checks', `规范性引用清单：${normRefs.length} 条（3 条标准化 + 1 条非标准化），编号与名称之间由 ::before 加一个全角空格`, { normRefs })

  // 2 正文 std / mixed-citation 标记
  const stdParagraph = page.locator('[data-node-id="g1-ch3-p1"]')
  await shot('02-std-ref-marks', stdParagraph, { pad: 40 })
  const marks = await page.locator('.std-std-ref, .std-mixed-citation').evaluateAll(nodes => nodes.map(node => ({ cls: node.className, text: node.textContent, deco: getComputedStyle(node).textDecorationLine + ' ' + getComputedStyle(node).textDecorationStyle })))
  assert.ok(marks.some(mark => mark.cls.includes('std-std-ref') && mark.text === 'GB/T 3102.1' && mark.deco === 'underline dotted'))
  assert.ok(marks.some(mark => mark.cls.includes('std-mixed-citation') && mark.text === '《中华人民共和国计量法》' && mark.deco === 'underline dotted'))
  note('checks', '正文 std / mixed-citation 标记：点状下划线，文本与 fixture 一致', { marks })

  // 3 缩略语表
  const abbreviations = page.locator('.std-chapter').filter({ has: page.locator('.std-def-list') }).first()
  await shot('03-abbreviation-list', abbreviations)
  const defRows = await page.locator('.std-def-list').first().locator('.std-where-item').evaluateAll(nodes => nodes.map(node => node.textContent))
  note('checks', `缩略语表（第 4 章）${defRows.length} 项`, { defRows })
  assert.equal(defRows.length, 3)
  // F-3（M-Z-c）：缩略语后由 dt::after 显示全角冒号（生成内容，不入模型），释义紧随冒号
  const defTerms = await page.locator('.std-def-list').first().locator('.std-where-item > dt').evaluateAll(nodes => nodes.map(node => ({
    term: node.textContent, after: getComputedStyle(node, '::after').content,
    gap: Math.round(node.nextElementSibling.getBoundingClientRect().left - node.getBoundingClientRect().right),
  })))
  assert.ok(defTerms.every(row => row.after === '"："' && row.gap === 0 && !row.term.includes('：')), `缩略语后应显示全角冒号：${JSON.stringify(defTerms)}`)
  note('checks', '缩略语后显示全角冒号（::after），DOM 文本里没有冒号，释义紧随冒号', { defTerms })

  // 4 图例、图注、图中示例、行内图
  const figureChapter = page.locator('.std-chapter').filter({ has: page.locator('.std-figure-legend') })
  await shot('04a-figure-legend-notes-example', page.locator('.std-figure').first(), { pad: 40 })
  await shot('04b-inline-images', page.locator('[data-node-id="g3-ch-p"]'), { pad: 50 })
  const legendRows = await page.locator('.std-figure-legend').first().locator('.std-where-item').evaluateAll(nodes => nodes.map(node => node.textContent))
  assert.equal(await page.locator('.std-figure-legend-title').first().textContent(), '图例')
  assert.equal(legendRows.length, 3)
  const images = await page.locator('.std-inline-image').evaluateAll(nodes => nodes.map(node => ({ size: node.getAttribute('data-size'), w: Math.round(node.getBoundingClientRect().width), h: Math.round(node.getBoundingClientRect().height) })))
  assert.equal(images.length, 6)
  note('checks', `图例标题“图例” + ${legendRows.length} 项；行内图 ${images.length} 个`, { legendRows, images })
  void figureChapter

  // 5 术语领域〈〉
  const terms = page.locator('.std-chapter').filter({ has: page.locator('.std-term-subject-field') }).first()
  await shot('05-term-subject-field', terms, { pad: 20 })
  const subjects = await page.locator('.std-term-subject-field').evaluateAll(nodes => nodes.map(node => ({ text: node.textContent, before: getComputedStyle(node, '::before').content, after: getComputedStyle(node, '::after').content })))
  assert.ok(subjects.every(row => row.before === '"〈"' && row.after === '"〉"'), '领域由 ::before / ::after 显示〈〉')
  note('checks', `术语领域 ${subjects.length} 处，〈〉由伪元素显示（不入内容）`, { subjects })

  // 6 引言 0.1 / 0.2 与大纲
  await page.locator('.std-introduction').evaluate(element => {
    const container = document.querySelector('.editor-content-wrapper')
    container.scrollTo({ top: Math.max(0, container.scrollTop + element.getBoundingClientRect().top - container.getBoundingClientRect().top - 20), behavior: 'instant' })
  })
  await page.waitForTimeout(300)
  await viewportShot('06-introduction-clauses-outline', { x: 0, y: 104, width: 1244, height: 780 })
  const clauseNumbers = await page.locator('.std-introduction .std-clause-title').evaluateAll(nodes => nodes.map(node => node.textContent.trim()))
  const outline = await page.locator('.outline-item, [class*="outline"] li, [class*="outline"] .item').allTextContents().catch(() => [])
  note('checks', '引言条编号与大纲', { clauseNumbers, outline: outline.map(text => text.trim()).filter(Boolean).slice(0, 12) })

  // 7 罗马列项
  await shot('07-roman-list', page.locator('[data-node-id="g7-intro"]'), { pad: 30, through: page.locator('.std-list-roman').first() })
  const roman = await page.locator('.std-list-roman').first().locator('.std-list-item').evaluateAll(nodes => nodes.map(node => ({ text: node.textContent, marker: getComputedStyle(node, '::before').content, counter: getComputedStyle(node).listStyleType })))
  note('checks', '罗马列项（i）～iv））', { roman })
  // F-5（M-Z-c）：标识为固定最小宽度的行内块，各项文字起排位置一致。编辑器内的 4 项之外，另在编辑器之外复制 9 项（i）～ix））量取
  const romanStarts = await page.locator('.std-list-roman').first().locator('.std-list-item').evaluateAll(nodes => nodes.map(node => {
    const range = document.createRange()
    range.selectNodeContents(node.firstChild)
    return Math.round(range.getClientRects()[0].left * 10) / 10
  }))
  assert.equal(new Set(romanStarts).size, 1, `罗马列项各项文字起排位置应一致：${romanStarts}`)
  const romanNineStarts = await page.evaluate(() => {
    const source = document.querySelector('.std-list-roman')
    const host = document.createElement('div')
    host.className = document.querySelector('.tiptap').className
    host.style.cssText = 'position:absolute;left:300px;top:200px;width:700px;background:#fff'
    const list = source.cloneNode(false)
    const template = source.querySelector(':scope > .std-list-item')
    for (let index = 0; index < 9; index += 1) {
      const item = template.cloneNode(false)
      item.textContent = ['准备', '实施', '检查', '处置', '复核', '归档', '验收', '发布', '回访'][index]
      list.appendChild(item)
    }
    host.appendChild(list)
    document.body.appendChild(host)
    const starts = [...list.children].map(item => {
      const range = document.createRange()
      range.selectNodeContents(item.firstChild)
      return Math.round(range.getClientRects()[0].left * 10) / 10
    })
    host.remove()
    return starts
  })
  assert.equal(new Set(romanNineStarts).size, 1, `i）～ix）的文字起排位置应一致：${romanNineStarts}`)
  note('checks', `罗马列项文字起排位置一致（编辑器内 4 项：${romanStarts[0]}px；复制 9 项 i）～ix））：${romanNineStarts[0]}px）`, { romanStarts, romanNineStarts })

  // 8 多段注 / 示例
  await shot('08-multi-block-notes-examples', page.locator('[data-node-id="g7-n1"]'), { pad: 20, through: page.locator('[data-node-id="g7-e2"]') })
  await shot('08b-foreword-multi-block-note', page.locator('.std-foreword'), { pad: 20 })

  // 9 列宽 4:6 与边框样式
  await shot('09-table-columns-borders', page.locator('.std-chapter').filter({ has: page.locator('[data-node-id="g8-tbl-2col"]') }), { pad: 20 })
  const tableMetrics = await page.locator('[data-node-id="g8-tbl-2col"]').evaluate(element => {
    const cells = [...element.querySelectorAll('tr:first-child th')]
    const widths = cells.map(cell => cell.getBoundingClientRect().width)
    const body = [...element.querySelectorAll('tr:nth-child(2) td')].map(cell => {
      const style = getComputedStyle(cell)
      return { top: style.borderTopStyle, right: style.borderRightStyle, bottom: style.borderBottomStyle, left: style.borderLeftStyle }
    })
    return { widths, ratio: widths[0] / (widths[0] + widths[1]), colWidths: [...element.querySelectorAll('col')].map(col => col.style.width || col.getAttribute('style')), body }
  })
  note('checks', '两列表：列宽比与边框样式', { tableMetrics })

  // 10 自定义参考文献标题
  await shot('10-bibliography-title', page.locator('.std-bibliography'), { pad: 20 })
  assert.equal((await page.locator('.std-bibliography-title').textContent()).trim(), '参考书目')
  note('checks', '自定义参考文献标题“参考书目”')

  // ================= 二、编辑器内实际按键 =================
  const before = JSON.stringify((await editorJson()).content)
  // 截图与 DOM 读取不得改动文档（Playwright 默认的 caret:'hide' 会让 ProseMirror 把一次 DOM 变化误读成回车而劈开段落，所以所有截图都用 caret:'initial'）
  assert.equal(before, loadedContent, '逐项截图之后文档内容应与载入时完全相同')
  for (const [childType, offset, label] of [['normRefStdRef', 3, '编号'], ['normRefStdTitle', 2, '名称']]) {
    await placeCaret('g1-nr-1', childType, offset)
    await page.keyboard.press('Enter')
    await page.waitForTimeout(150)
    const after = JSON.stringify((await editorJson()).content)
    const stdCount = await page.locator('.std-norm-ref-std').count()
    assert.equal(after, before, `规范性引用条目的${label}中按 Enter 后文档内容应完全不变`)
    assert.equal(stdCount, 3)
    note('interactions', `规范性引用 std 条目的${label}内按 Enter：不拆分，文档内容逐字不变，std 条目仍为 3 条`)
  }
  await shot('11-norm-ref-enter-no-split', normChapter)

  // 补充：非标准化条目（mixed）按 Enter 拆出新条目，然后撤销（G1 报告的既有行为）
  await placeCaret('g1-nr-4', null, 3)
  await page.keyboard.press('Enter')
  await page.waitForTimeout(150)
  const mixedAfter = await page.locator('.std-norm-ref-mixed').count()
  note('interactions', `（补充）mixed 条目内按 Enter：mixed 条目 1 → ${mixedAfter}（拆出新条目，与 G1 报告一致）`)
  assert.equal(mixedAfter, 2)
  await page.keyboard.press('Control+z')
  await page.waitForTimeout(150)
  assert.equal(await page.locator('.std-norm-ref-mixed').count(), 1)
  assert.equal(JSON.stringify((await editorJson()).content), before, '撤销后文档回到按键前')

  await placeCaret('g3-legend-1', 'figureLegendTitle', 1)
  const legendTitles = await page.locator('.std-figure-legend-title').count()
  await page.keyboard.press('Enter')
  await page.waitForTimeout(150)
  const caret = await page.locator('.tiptap').evaluate(element => {
    const { $from } = element.editor.state.selection
    return { parent: $from.parent.type.name, itemId: $from.node($from.depth - 1).attrs.nodeId, titleCount: element.querySelectorAll('.std-figure-legend-title').length }
  })
  assert.deepEqual(caret, { parent: 'whereTerm', itemId: 'g3-lg-1', titleCount: legendTitles })
  note('interactions', `图例标题内按 Enter：光标进入第一项（${caret.itemId}）的符号格，标题仍为 ${caret.titleCount} 个（没有被劈开）`)
  await shot('12-legend-title-enter', page.locator('.std-figure').first(), { pad: 40 })

  // ================= 三、导出 =================
  // 全要素文档：HTML/DOCX/PDF 导出被输出边界阻断（图例、图中示例、行内图、列宽、边框样式），JSON 保留
  await page.reload()
  await page.locator('.tiptap').waitFor()
  await page.waitForTimeout(800)
  // F-1（M-Z-c）：对话框与格式卡片须在 1440×900 视口内可见，所以这一步用 900 高的视口
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.getByRole('button', { name: '导出', exact: true }).click()
  await page.locator('.export-card').filter({ has: page.getByText('DOCX', { exact: true }) }).click()
  const summary = page.locator('.el-dialog .export-error-text').first()
  await summary.waitFor()
  const blockedText = (await summary.textContent()).trim()
  // 阻断项恰为 §7.1 暂不排版的 15 处：行内图 6 + 图例 2 + 图中示例 2 + 文档级资源 1 + 单元格边框样式 2 + 列宽 2
  assert.equal(blockedText, '导出被阻止：DOCX 有 15 处内容暂不能导出', `全要素文档导出 DOCX 应被阻断，实际提示：${blockedText}`)
  const blockedItems = (await page.locator('.el-dialog .export-error-items > li').allTextContents()).map(text => text.trim())
  assert.equal(blockedItems.length, 15)
  assert.ok(blockedItems.every(text => text.startsWith('DOCX ')), '每条明细单独一行')
  const layout = await page.evaluate(() => {
    const list = document.querySelector('.export-error-items')
    const dialog = document.querySelector('.el-dialog')
    const cards = [...document.querySelectorAll('.export-card')].map(card => card.getBoundingClientRect())
    const dialogBox = dialog.getBoundingClientRect()
    return {
      viewportHeight: window.innerHeight,
      dialogTop: Math.round(dialogBox.top), dialogBottom: Math.round(dialogBox.bottom),
      cardsBottom: Math.round(Math.max(...cards.map(card => card.bottom))),
      listClientHeight: list.clientHeight, listScrollHeight: list.scrollHeight,
      listHorizontalOverflow: list.scrollWidth > list.clientWidth,
      itemsHorizontalOverflow: [...list.children].some(item => item.scrollWidth > item.clientWidth),
    }
  })
  assert.ok(layout.listScrollHeight > layout.listClientHeight, '明细区在内部滚动（限高）')
  assert.equal(layout.listHorizontalOverflow, false, '明细不得横向裁切')
  assert.equal(layout.itemsHorizontalOverflow, false, '每条明细自行折行')
  assert.ok(layout.cardsBottom <= layout.viewportHeight, `格式卡片应在 ${layout.viewportHeight}px 高的视口内可见，实际底边 ${layout.cardsBottom}`)
  assert.ok(layout.dialogBottom <= layout.viewportHeight, '对话框整体在视口内')
  await page.screenshot({ caret: 'initial', path: join(output, '13-export-blocked-full-doc.png') })
  evidence.screenshots.push('13-export-blocked-full-doc.png')
  note('exports', `全要素文档导出 DOCX 被阻断：${blockedText}；${blockedItems.length} 条明细逐条一行；1440×900 下对话框与格式卡片可见`, { layout, firstItem: blockedItems[0] })
  await page.setViewportSize({ width: 1440, height: 1100 })
  const jsonDownload = page.waitForEvent('download')
  await page.locator('.export-card').filter({ has: page.getByText('JSON', { exact: true }) }).click()
  const jsonPath = join(output, 'full-doc.json')
  await (await jsonDownload).saveAs(jsonPath)
  const exportedJson = JSON.parse(await readFile(jsonPath, 'utf8'))
  assert.equal(exportedJson.attrs.extensionVersion, 1)
  note('exports', '全要素文档 JSON 导出仍可用，extensionVersion=1')

  // 去掉暂不排版结构的文档：UI 导出版式预览（HTML 打印 → vivliostyle → PDF）
  await openEditor(strippedId)
  await page.getByRole('button', { name: '导出', exact: true }).click()
  const pdfDownload = page.waitForEvent('download', { timeout: 180000 })
  await page.locator('.export-card').filter({ has: page.getByText('版式预览（GB/T 1.1 排版）', { exact: true }) }).click()
  const pdfPath = join(output, 'stripped-print-preview.pdf')
  await (await pdfDownload).saveAs(pdfPath)
  note('exports', '去掉暂不排版结构的文档：UI 导出“版式预览”成功，已保存 PDF')
  if (await page.getByRole('dialog', { name: '导出文档' }).isVisible()) await page.keyboard.press('Escape')
  const docxDownload = page.waitForEvent('download')
  await page.getByRole('button', { name: '导出', exact: true }).click()
  await page.locator('.export-card').filter({ has: page.getByText('DOCX', { exact: true }) }).click()
  const docxPath = join(output, 'stripped.docx')
  await (await docxDownload).saveAs(docxPath)
  note('exports', '去掉暂不排版结构的文档：UI 导出 DOCX 成功')

  const pages = Number(/Pages:\s+(\d+)/.exec(execFileSync('pdfinfo', [pdfPath], { encoding: 'utf8' }))[1])
  const pageText = Array.from({ length: pages }, (_, index) => execFileSync('pdftotext', ['-f', String(index + 1), '-l', String(index + 1), '-layout', pdfPath, '-'], { encoding: 'utf8' }))
  await writeFile(join(output, 'stripped-print-preview.pages.json'), JSON.stringify(pageText, null, 1))
  // 打印预览里各清单项的版式文字（pdftotext -layout）与所在页；每项必须找到，找到的页渲染成 PNG
  const find = pattern => pageText.map((text, index) => (pattern.test(text) ? index + 1 : 0)).filter(Boolean)
  const roles = {
    'toc-introduction-custom-bibliography-title': [/引言\.{3,}\s*III/, /参考书目\.{3,}/],
    'introduction-clauses': [/0\.1\s+背景/, /0\.1\.1\s+起因/, /0\.2\s+目的/, /0\.3\s+无标题条的条文。/],
    'norm-refs-and-subject-field': [/GB\/T 321\s+优先数和优先数系/, /ISO 80000（所有部分）\s+量和单位（Quantities and units）/, /〈顾客满意〉由成员组织或个人组成的组织。/],
    'abbreviations-figure-notes': [/ADC：模数转换器（Analog-to-Digital Converter）/, /CT：计算机断层扫描，参见\s*ADC\s*与电流互感器/],
    'roman-list-multi-block-notes': [/iii）\s*检查/, /注 ?2：多块注的第一段。/, /第二段带脚注/, /示例 ?2：/],
    'appendix-subject-field': [/〈附录领域〉附录中的术语。/],
    'bibliography-custom-title': [/参考书目\s*\n\s*\[1\]/],
  }
  const printPages = {}
  for (const [role, patterns] of Object.entries(roles)) {
    const hits = patterns.map(pattern => find(pattern))
    const common = hits.reduce((left, right) => left.filter(pageNo => right.includes(pageNo)))
    assert.ok(common.length > 0, `打印预览没有同时含有 ${role} 的全部文字：${patterns.join(' | ')}（各自所在页：${JSON.stringify(hits)}）`)
    printPages[role] = common[0]
    const prefix = join(output, `print-preview-${role}`)
    execFileSync('pdftoppm', ['-r', '90', '-png', '-f', String(common[0]), '-l', String(common[0]), '-singlefile', pdfPath, prefix])
    evidence.screenshots.push(`print-preview-${role}.png`)
  }
  note('exports', `打印预览 PDF ${pages} 页；各清单项所在页：${JSON.stringify(printPages)}`, { printPages })
  evidence.pdf = { pages, printPages }
  await writeFile(join(output, 'walkthrough-evidence.json'), JSON.stringify(evidence, null, 2) + '\n')

  assert.deepEqual(evidence.pageErrors, [])
  evidence.status = 'passed'
} catch (error) {
  evidence.status = 'failed'
  evidence.failure = error.message
  await page.screenshot({ caret: 'initial', path: join(output, 'failure.png') }).catch(() => {})
  throw error
} finally {
  await writeFile(join(output, 'walkthrough-evidence.json'), JSON.stringify(evidence, null, 2) + '\n')
  await browser.close()
}
console.log(JSON.stringify({ status: evidence.status, screenshots: evidence.screenshots, consoleErrors: evidence.consoleErrors, pageErrors: evidence.pageErrors }, null, 2))
