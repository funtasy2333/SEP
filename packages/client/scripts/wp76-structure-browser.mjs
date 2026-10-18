/**
 * WP76 结构编辑浏览器验收：无题条编号与首段同行、大纲式改级、失败原因提示、列项格式命令。
 * 真实 UI → 隔离 SQLite API。只允许本机空文档库：
 *   1. 在独立工作树启动服务端（packages/server/dist/main.js，PORT=3000）与 Vite（默认 5173，/api 代理到 3000）；
 *   2. PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node packages/client/scripts/wp76-structure-browser.mjs <output-dir>
 * 使用 server 已有 playwright-chromium，不新增依赖，不进入 CI。
 */
import { chromium } from '../../server/node_modules/playwright-chromium/index.mjs'
import { mkdir } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import assert from 'node:assert/strict'

const output = resolve(process.argv[2] || 'tmp-e2e/wp76-structure')
await mkdir(output, { recursive: true })
const origin = process.env.WP76_BROWSER_ORIGIN || 'http://127.0.0.1:5173'
const originUrl = new URL(origin)
if (originUrl.protocol !== 'http:' || !['localhost', '127.0.0.1'].includes(originUrl.hostname) || originUrl.origin !== origin) throw new Error('验收只允许本机HTTP origin')

const text = (value, marks) => ({ type: 'text', text: value, ...(marks ? { marks } : {}) })
const para = (id, value) => ({ type: 'stdParagraph', attrs: { nodeId: id }, content: value ? [text(value)] : [] })
const untitled = (id, pid, value, level = 2, extra = []) => ({
  type: 'clause', attrs: { nodeId: id, level, hasTitle: false },
  content: [{ type: 'clauseTitle', attrs: { level } }, ...(pid ? [para(pid, value)] : []), ...extra],
})
const clause = (id, title, body, level = 1) => ({
  type: 'clause', attrs: { nodeId: id, level }, content: [{ type: 'clauseTitle', attrs: { level }, content: [text(title)] }, ...body],
})
const longText = '无题条的长条文用于验证换行：编号与首段第一行排在同一行，之后各行回到版心左侧继续排版，不应出现编号独占一行、正文另起一行的情况。'.repeat(2)
const content = {
  type: 'doc',
  content: [
    {
      type: 'chapter', attrs: { nodeId: 'ch1' }, content: [
        { type: 'chapterTitle', content: [text('总体要求')] },
        clause('c1', '基本规定', [
          untitled('u1', 'u1p', '短条文：编号与首段同行。'),
          untitled('u2', 'u2p', longText),
          untitled('u3', 'u3p', ''),
          untitled('u4', null, '', 2, [{ type: 'stdList', attrs: { nodeId: 'u4l', listType: 'dash', level: 1 }, content: [
            { type: 'stdListItem', attrs: { nodeId: 'u4i' }, content: [text('首块是列项的无题条')] },
          ] }]),
        ]),
        clause('c2', '转换样例', [para('conv', '待转换的段落')]),
      ],
    },
    {
      type: 'chapter', attrs: { nodeId: 'ch3' }, content: [
        { type: 'chapterTitle', content: [text('大纲样例')] },
        clause('o1', '条五一', [
          clause('o11', '条五一一', [], 2),
          clause('o12', '条五一二', [para('o12p', '五一二正文')], 2),
          clause('o13', '条五一三', [para('o13p', '五一三正文')], 2),
        ]),
      ],
    },
    {
      type: 'chapter', attrs: { nodeId: 'ch2' }, content: [
        { type: 'chapterTitle', content: [text('列项样例')] },
        { type: 'stdList', attrs: { nodeId: 'lst', listType: 'dash', level: 1 }, content: [
          { type: 'stdListItem', attrs: { nodeId: 'li1' }, content: [text('一级列项甲')] },
          { type: 'stdListItem', attrs: { nodeId: 'li2' }, content: [text('一级列项乙')] },
          { type: 'stdListItem', attrs: { nodeId: 'li3' }, content: [text('一级列项丙')] },
        ] },
      ],
    },
    {
      type: 'appendix', attrs: { nodeId: 'ap1', normative: true }, content: [
        { type: 'appendixLabel', content: [text('（规范性）')] },
        { type: 'appendixTitle', content: [text('附录样例')] },
        untitled('au1', 'au1p', '附录内无题条：编号与首段同行。', 1),
      ],
    },
  ],
}

// 已预装的 Chromium 版本与 playwright-chromium 期望的不一致时，用 WP76_CHROMIUM 指定可执行文件。
const browser = await chromium.launch({ headless: true, ...(process.env.WP76_CHROMIUM ? { executablePath: process.env.WP76_CHROMIUM } : {}) })
const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } })
const errors = []
page.on('pageerror', error => errors.push(error.message))
const steps = []
const pass = message => { steps.push(message); console.log('通过：', message) }
/** 元素截图：按视口坐标裁剪（Playwright 的 locator.screenshot 在个别编辑器节点上会误报节点已脱离 DOM）。 */
async function shot(selector, name) {
  const clip = await page.evaluate(sel => {
    const element = document.querySelector(sel)
    element.scrollIntoView({ block: 'start' })
    const rect = element.getBoundingClientRect()
    const top = Math.max(0, rect.top - 8)
    return { x: Math.max(0, rect.left - 8), y: top, width: Math.min(rect.width + 16, window.innerWidth), height: Math.min(rect.height + 16, window.innerHeight - top) }
  }, selector)
  await page.screenshot({ path: join(output, name), clip })
}
try {
  await page.goto(origin)
  const existing = await (await page.request.get(`${origin}/api/documents`)).json()
  assert.equal(existing.length, 0, '拒绝向非空文档库写入；必须使用独立工作树的空数据库及正确 /api 代理')
  const created = await (await page.request.post(`${origin}/api/documents`, { data: {
    title: 'WP76 结构编辑样稿', stage: 'draft', meta: { titleCn: 'WP76 结构编辑样稿', standardNo: 'GB/T XXXXX—XXXX' }, content,
  } })).json()
  await page.goto(`${origin}/editor/${created.id}`)
  await page.locator('.tiptap .std-clause').first().waitFor()
  const docJson = () => page.evaluate(async id => (await (await fetch(`/api/documents/${id}`)).json()).content, created.id)

  // ---- 1. 无题条：编号与首段同一行（短、长文本，附录内） ----
  const measure = clauseId => page.evaluate(id => {
    const clauseEl = document.querySelector(`.tiptap [data-node-id="${id}"]`)
    const title = clauseEl.querySelector(':scope > .std-clause-title')
    const paragraph = clauseEl.querySelector(':scope > .std-paragraph')
    const titleRect = title.getBoundingClientRect()
    const paragraphRect = paragraph.getBoundingClientRect()
    const lineHeight = parseFloat(getComputedStyle(paragraph).lineHeight)
    let firstLine = null, secondLine = null, lastLine = null
    const walker = document.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT)
    const node = walker.nextNode()
    if (node) {
      const range = document.createRange()
      range.selectNodeContents(node)
      const rects = [...range.getClientRects()].filter(rect => rect.width > 0)
      firstLine = rects[0]
      secondLine = rects[1]
      lastLine = rects[rects.length - 1]
    }
    const label = getComputedStyle(title, '::before').content
    return {
      label, float: getComputedStyle(title).float, indent: getComputedStyle(title).textIndent, lineHeight,
      title: { top: titleRect.top, left: titleRect.left, right: titleRect.right, bottom: titleRect.bottom },
      paragraph: { top: paragraphRect.top, left: paragraphRect.left, height: paragraphRect.height },
      firstLine: firstLine && { top: firstLine.top, left: firstLine.left, bottom: firstLine.bottom },
      secondLine: secondLine && { top: secondLine.top, left: secondLine.left },
      lastLine: lastLine && { top: lastLine.top, left: lastLine.left },
      lines: Math.round(paragraphRect.height / lineHeight),
    }
  }, clauseId)
  for (const [id, name] of [['u1', '短条文'], ['u2', '长条文'], ['au1', '附录内无题条']]) {
    const m = await measure(id)
    assert.equal(m.float, 'left', `${name}：clauseTitle 应左浮动`)
    assert.ok(m.label.includes('.') || /\d/.test(m.label), `${name}：编号内容 ${m.label}`)
    assert.ok(Math.abs(m.title.top - m.paragraph.top) <= 1.5 && Math.abs(m.title.bottom - m.title.top - m.lineHeight) <= 1.5, `${name}：编号与首行同一顶边、同一行高 ${JSON.stringify(m)}`)
    assert.equal(m.indent, '0px', `${name}：编号不缩进`)
    assert.ok(m.firstLine.left >= m.title.right - 1, `${name}：首行文字应在编号右侧 ${JSON.stringify(m)}`)
    assert.ok(m.title.left <= m.paragraph.left + 1, `${name}：编号顶格 ${JSON.stringify(m)}`)
    if (id === 'u2') {
      assert.ok(m.lines >= 3, `长条文应换成多行 ${m.lines}`)
      assert.ok(Math.abs(m.secondLine.left - m.paragraph.left) < 1 && m.lastLine.left < m.firstLine.left, `长条文第二行起回到版心左侧（编号只占首行） ${JSON.stringify(m)}`)
    }
    pass(`${name}：编号与首段同行（编号 ${m.label}，${m.lines} 行）`)
  }
  // 首块是列项的无题条：不浮动，编号仍单独成行
  const listFirst = await page.evaluate(() => getComputedStyle(document.querySelector('.tiptap [data-node-id="u4"] > .std-clause-title')).float)
  assert.equal(listFirst, 'none')
  pass('首块为列项的无题条：编号不浮动')
  await shot('.tiptap [data-node-id="c1"]', '01-untitled-clauses.png')
  await shot('.tiptap [data-node-id="ap1"]', '02-appendix-untitled.png')

  // ---- 2. 点击首段可编辑；空无题条可输入；输入落在正文段，不进 clauseTitle ----
  await page.locator('.tiptap [data-node-id="u1p"]').click()
  await page.keyboard.press('End')
  await page.keyboard.type('【追加】')
  assert.ok((await page.locator('.tiptap [data-node-id="u1p"]').innerText()).endsWith('【追加】'))
  pass('点击首段可编辑')
  await page.locator('.tiptap [data-node-id="u3p"]').click()
  await page.keyboard.type('空无题条里输入')
  assert.equal(await page.locator('.tiptap [data-node-id="u3p"]').innerText(), '空无题条里输入')
  assert.equal((await page.locator('.tiptap [data-node-id="u3"] > .std-clause-title').innerText()).trim(), '')
  const emptyMeasure = await measure('u3')
  assert.ok(Math.abs(emptyMeasure.title.top - emptyMeasure.paragraph.top) <= 1.5)
  pass('空无题条可输入，文字进入正文段')
  // 点击编号位置（clauseTitle）：光标被重定向到首段起点，输入的文字进入首段开头，不在首段前新建段落
  await page.locator('.tiptap [data-node-id="u1"] > .std-clause-title').click({ position: { x: 4, y: 4 } })
  // ProseMirror 在 Chrome 里把鼠标按下期间的 DOM 选区同步推迟到 mouseup 后的下一个宏任务；真人点击与按键之间远大于此，
  // Playwright 的 click 与 type 背靠背，需等待一拍以模拟真人节奏。
  await page.waitForTimeout(100)
  await page.keyboard.type('X')
  assert.equal((await page.locator('.tiptap [data-node-id="u1"] > .std-clause-title').innerText()).trim(), '')
  assert.deepEqual(await page.locator('.tiptap [data-node-id="u1"] > .std-paragraph').allInnerTexts(), ['X短条文：编号与首段同行。【追加】'])
  pass('点击编号位置输入：文字进入首段开头，不新建段落')
  // 方向键：首段起点再往左/上，光标跳到前一个块末尾，不卡在编号块
  // 点击编号即把光标放在首段起点（偏移 0）
  await page.locator('.tiptap [data-node-id="u2"] > .std-clause-title').click({ position: { x: 4, y: 4 } })
  await page.waitForTimeout(100)
  await page.keyboard.press('ArrowLeft')
  await page.keyboard.type('Y')
  assert.ok((await page.locator('.tiptap [data-node-id="u1p"]').innerText()).endsWith('【追加】Y'), '左方向键应跳到前一个块末尾')
  await page.locator('.tiptap [data-node-id="u3"] > .std-clause-title').click({ position: { x: 4, y: 4 } })
  await page.waitForTimeout(100)
  await page.keyboard.press('ArrowUp')
  await page.keyboard.type('Z')
  assert.ok((await page.locator('.tiptap [data-node-id="u2p"]').innerText()).endsWith('Z'), '上方向键应跳到前一个块末尾')
  assert.equal((await page.locator('.tiptap [data-node-id="u2"] > .std-clause-title').innerText()).trim(), '')
  pass('首段起点按 ← / ↑：光标跳到前一个块末尾，编号块始终为空')

  // 无题条正文里按 Enter（真实键盘）：类似编号列表。c1 下原有无题条 u1~u4。
  const c1Untitled = () => page.evaluate(() => [...document.querySelectorAll('.tiptap [data-node-id="c1"] > .std-clause[data-has-title="false"]')].map(el => ({
    id: el.dataset.nodeId,
    label: getComputedStyle(el.querySelector(':scope > .std-clause-title'), '::before').content,
    title: el.querySelector(':scope > .std-clause-title').innerText.trim(),
    paragraphs: [...el.querySelectorAll(':scope > .std-paragraph')].map(paragraph => paragraph.innerText.trim()),
  })))
  assert.equal((await c1Untitled()).length, 4)
  // 键间留一拍：ProseMirror 要等 selectionchange 之后才把 DOM 选区同步进状态，背靠背的按键会读到旧选区
  const key = async name => { await page.keyboard.press(name); await page.waitForTimeout(100) }
  // 段末 Enter：在当前条之后新建同级无题条，光标进入新条正文段，输入落在新条
  await page.locator('.tiptap [data-node-id="u3p"]').click()
  await page.waitForTimeout(100)
  await key('End')
  await key('Enter')
  let untitledList = await c1Untitled()
  assert.equal(untitledList.length, 5, JSON.stringify(untitledList))
  assert.deepEqual(untitledList.slice(0, 3).map(item => item.id), ['u1', 'u2', 'u3'], JSON.stringify(untitledList))
  assert.deepEqual(untitledList[3].paragraphs, [''])
  assert.equal(untitledList[3].title, '')
  assert.equal(untitledList[4].id, 'u4')
  assert.equal(new Set(untitledList.map(item => item.label)).size, untitledList.length, '每个无题条编号各不相同')
  await page.keyboard.type('新条')
  await page.waitForTimeout(100)
  untitledList = await c1Untitled()
  assert.deepEqual(untitledList[3].paragraphs, ['新条'])
  assert.equal(untitledList[2].paragraphs[0], '空无题条里输入')
  pass('无题条段末 Enter：新建同级无题条（空编号块），光标进入新条正文段')
  // 段中 Enter：光标后的文字移入新条
  await key('ArrowLeft')
  await key('Enter')
  untitledList = await c1Untitled()
  assert.equal(untitledList.length, 6, JSON.stringify(untitledList))
  assert.deepEqual([untitledList[3].paragraphs, untitledList[4].paragraphs], [['新'], ['条']], JSON.stringify(untitledList))
  pass('无题条段中 Enter：光标后的文字移入新条，不丢字')
  // 末尾 Enter 新建空条，再在空条里 Enter：退回上一条另起一段（多段条文），随后输入落在该条第二段
  await key('End')
  await key('Enter')
  assert.equal((await c1Untitled()).length, 7)
  await key('Enter')
  untitledList = await c1Untitled()
  assert.equal(untitledList.length, 6, JSON.stringify(untitledList))
  assert.deepEqual(untitledList[4].paragraphs, ['条', ''], JSON.stringify(untitledList))
  await page.keyboard.type('续段')
  await page.waitForTimeout(100)
  untitledList = await c1Untitled()
  assert.deepEqual(untitledList[4].paragraphs, ['条', '续段'], JSON.stringify(untitledList))
  pass('空无题条 Enter：回到上一条末尾另起一段，条数减一，输入落在第二段')
  // Shift+Enter 仍是换行，不新建条
  await key('Shift+Enter')
  assert.equal((await c1Untitled()).length, 6)
  assert.equal(await page.locator('.tiptap [data-node-id="c1"] > .std-clause[data-has-title="false"] > .std-paragraph br:not(.ProseMirror-trailingBreak)').count(), 1)
  pass('无题条里 Shift+Enter 仍为换行')
  // 撤销一步还原新建的条（等待超过撤销分组间隔，使 Enter 单独成为一步）
  await page.waitForTimeout(700)
  await key('End')
  await key('Enter')
  assert.equal((await c1Untitled()).length, 7)
  await page.waitForTimeout(700)
  await key('Control+z')
  assert.equal((await c1Untitled()).length, 6)
  pass('无题条 Enter 新建的条可一步撤销')
  await shot('.tiptap [data-node-id="c1"]', '03a-untitled-enter.png')
  await page.screenshot({ path: join(output, '03-after-typing.png') })

  // ---- 3. 工具栏：段落 → 无题条，失败原因提示各不相同 ----
  const toolbar = async (button, item) => {
    await page.locator('.tbar-btn', { hasText: new RegExp(`^${button}`) }).first().click()
    await page.locator('.el-dropdown-menu__item', { hasText: item }).last().click()
  }
  await page.locator('.tiptap [data-node-id="conv"]').click()
  await toolbar('无题条', '二级无题条')
  await page.waitForFunction(() => document.querySelector('.tiptap [data-node-id="c2"] > .std-clause > .std-clause-title') !== null)
  const converted = await page.evaluate(() => {
    const clauseEl = document.querySelector('.tiptap [data-node-id="c2"] > .std-clause')
    return { untitled: clauseEl.dataset.hasTitle, title: clauseEl.querySelector(':scope > .std-clause-title').innerText.trim(), text: clauseEl.querySelector(':scope > .std-paragraph').innerText }
  })
  assert.deepEqual(converted, { untitled: 'false', title: '', text: '待转换的段落' })
  const convertedMeasure = await page.evaluate(() => {
    const title = document.querySelector('.tiptap [data-node-id="c2"] > .std-clause > .std-clause-title')
    const paragraph = title.nextElementSibling
    const range = document.createRange(); range.selectNodeContents(paragraph.firstChild)
    return { dy: Math.abs(title.getBoundingClientRect().top - range.getClientRects()[0].top) }
  })
  assert.ok(convertedMeasure.dy < 12, '新转换的无题条同行')
  pass('工具栏：段落转二级无题条，clauseTitle 为空、条文在首段、同行显示')
  await page.screenshot({ path: join(output, '04-toolbar-untitled.png') })

  const expectWarning = async (action, pattern, name) => {
    await action()
    const message = page.locator('.el-message--warning', { hasText: pattern }).last()
    await message.waitFor({ timeout: 5000 })
    return (await message.innerText()).trim()
  }
  const messages = []
  await page.locator('.tiptap [data-node-id="au1p"]').click()
  messages.push(await expectWarning(() => toolbar('条', '三级条'), /缺少上级/, '附录首条设三级'))
  await page.locator('.tiptap [data-node-id="c2"] > .std-clause-title').click()
  messages.push(await expectWarning(() => toolbar('条', '四级条'), /跳级/, '一级条直接改四级'))
  await page.locator('.tiptap [data-node-id="c1"] > .std-clause-title').click()
  messages.push(await expectWarning(() => toolbar('无题条', '一级无题条'), /无题条不能再分条/, '含子条的条转无题'))
  await page.locator('.tiptap [data-node-id="li2"]').click()
  messages.push(await expectWarning(() => toolbar('条', '一级条'), /悬置/, '中间列项转条留悬置段'))
  assert.equal(new Set(messages).size, messages.length, '不同失败原因应给出不同提示')
  pass(`失败原因提示各不相同：${messages.join(' | ')}`)

  // ---- 4. 大纲式改级可逆（真实 UI）：2.1.1 升为一级后可再降回二级，文档与原稿一致 ----
  const labels = () => page.evaluate(() => ['o1', 'o11', 'o12', 'o13'].map(id => document.querySelector(`.tiptap [data-node-id="${id}"] > .std-clause-title`).dataset.resolvedLabel))
  assert.deepEqual(await labels(), ['2.1', '2.1.1', '2.1.2', '2.1.3'])
  // 编辑器会补齐默认属性（id/number/secType 为 null、hasTitle 为 true）；比较前统一去掉，其余（含 nodeId、level）逐字比较
  const plain = node => JSON.stringify(node, (key, value) => (value === null || (key === 'hasTitle' && value === true) ? undefined : value))
  const outlineBefore = plain((await docJson()).content.find(node => node.attrs?.nodeId === 'ch3'))
  await page.locator('.tiptap [data-node-id="o11"] > .std-clause-title').click()
  await toolbar('条', '一级条')
  await page.waitForFunction(() => document.querySelector('.tiptap [data-node-id="o11"]').dataset.level === '1')
  assert.deepEqual(await labels(), ['2.1', '2.2', '2.2.1', '2.2.2'])
  await shot('.tiptap [data-node-id="ch3"]', '07-outline-promoted.png')
  await toolbar('条', '二级条')
  await page.waitForFunction(() => document.querySelector('.tiptap [data-node-id="o11"]').dataset.level === '2')
  assert.deepEqual(await labels(), ['2.1', '2.1.1', '2.1.2', '2.1.3'])
  await shot('.tiptap [data-node-id="ch3"]', '08-outline-restored.png')
  await page.waitForTimeout(3800) // 自动保存
  const outlineAfter = plain((await docJson()).content.find(node => node.attrs?.nodeId === 'ch3'))
  assert.equal(outlineAfter, outlineBefore, '往返后已保存的章 JSON 应与原稿逐字一致（含 nodeId）')
  pass('条改级可逆：2.1.1 → 一级（2.1、2.2、2.2.1、2.2.2）→ 二级，编号与保存的章 JSON 均与原稿一致')

  // ---- 5. 列项：选中一级列项点二级列项，文字不消失 ----
  await page.locator('.tiptap [data-node-id="li2"]').click({ clickCount: 3 })
  await toolbar('列项', '数字编号列项（二级）')
  await page.waitForFunction(() => document.querySelector('.tiptap .std-list-numeric') !== null)
  const lists = await page.evaluate(() => [...document.querySelectorAll('.tiptap [data-node-id="ch2"] > .std-list')].map(list => ({
    type: list.dataset.listType, items: [...list.querySelectorAll('.std-list-item')].map(item => item.innerText.trim()),
  })))
  assert.deepEqual(lists, [
    { type: 'dash', items: ['一级列项甲'] }, { type: 'numeric', items: ['一级列项乙'] }, { type: 'dash', items: ['一级列项丙'] },
  ])
  pass('选中一级列项点「二级列项」：列项文字保留，前后部分保持原类型')
  await page.locator('.tiptap [data-node-id="ch2"] .std-list').first().scrollIntoViewIfNeeded()
  await page.screenshot({ path: join(output, '05-list-format.png') })

  // ---- 6. 列项一步转无题条 ----
  await page.locator('.tiptap [data-node-id="li1"]').click()
  await toolbar('无题条', '一级无题条')
  await page.waitForFunction(() => document.querySelector('.tiptap [data-node-id="li1"]')?.tagName === 'P')
  assert.equal(await page.locator('.tiptap [data-node-id="li1"]').innerText(), '一级列项甲')
  const after = await page.evaluate(() => {
    const clauseEl = document.querySelector('.tiptap [data-node-id="li1"]').parentElement
    return { hasTitle: clauseEl.dataset.hasTitle, title: clauseEl.querySelector(':scope > .std-clause-title').innerText.trim(), lists: [...clauseEl.querySelectorAll(':scope > .std-list')].length }
  })
  assert.deepEqual(after, { hasTitle: 'false', title: '', lists: 2 })
  pass('列项一步转无题条：条文进入首段，后续列项成为该条的正文，文字不丢')
  await shot('.tiptap [data-node-id="ch2"]', '06-list-to-untitled.png')

  // 自动保存后的持久化：无 unsupportedContent 所需的 IR 形态
  await page.waitForTimeout(3800)
  const saved = await docJson()
  const stale = []
  const walk = node => {
    if (node.type === 'clause' && node.attrs?.hasTitle === false) {
      const title = node.content?.[0]
      if (title?.content?.length) stale.push(node.attrs.nodeId)
    }
    ;(node.content ?? []).forEach(walk)
  }
  walk(saved)
  assert.deepEqual(stale, [])
  pass('保存后的文档中，无题条的 clauseTitle 均为空')

  // ---- 7. 旧稿载入：无题条的条文在 clauseTitle 里，载入后规范化、提示并保存 ----
  const legacyTitle = value => [{ type: 'clauseTitle', attrs: { level: 1 }, content: [text(value)] }]
  const legacy = await (await page.request.post(`${origin}/api/documents`, { data: {
    title: 'WP76 旧稿样稿', stage: 'draft', meta: { titleCn: 'WP76 旧稿样稿', standardNo: 'GB/T XXXXX—XXXX' },
    content: { type: 'doc', content: [{ type: 'chapter', attrs: { nodeId: 'lch' }, content: [
      { type: 'chapterTitle', content: [text('旧稿章')] },
      { type: 'clause', attrs: { nodeId: 'lc1', level: 1, hasTitle: false }, content: [...legacyTitle('旧稿无题条文一'), { type: 'stdParagraph', attrs: { nodeId: 'lc1p' } }] },
      { type: 'clause', attrs: { nodeId: 'lc2', level: 1, hasTitle: false }, content: legacyTitle('旧稿无题条文二') },
    ] }] },
  } })).json()
  await page.goto(`${origin}/editor/${legacy.id}`)
  await page.locator('.el-message--info', { hasText: '已将 2 处无题条的条文移入正文段' }).waitFor({ timeout: 8000 })
  await page.locator('.tiptap [data-node-id="lc1"]').waitFor()
  assert.equal((await page.locator('.tiptap [data-node-id="lc1p"]').innerText()).trim(), '旧稿无题条文一')
  assert.equal((await page.locator('.tiptap [data-node-id="lc2"] > .std-paragraph').innerText()).trim(), '旧稿无题条文二')
  await shot('.tiptap [data-node-id="lch"]', '09-legacy-normalized.png')
  await page.locator('.tab-dirty-mark').first().waitFor({ timeout: 3000 }).catch(() => {}) // 载入后标记为未保存（自动保存前可见）
  await page.waitForTimeout(4000)
  const legacySaved = await (await page.request.get(`${origin}/api/documents/${legacy.id}`)).json()
  const legacyStale = []
  const walkLegacy = node => {
    if (node.type === 'clause' && node.attrs?.hasTitle === false && node.content?.[0]?.content?.length) legacyStale.push(node.attrs.nodeId)
    ;(node.content ?? []).forEach(walkLegacy)
  }
  walkLegacy(legacySaved.content)
  assert.deepEqual(legacyStale, [])
  assert.ok(legacySaved.revision > 0, '规范化后的内容已自动保存')
  pass('旧稿载入：提示「已将 2 处无题条的条文移入正文段」，规范化后的内容已保存')
  assert.deepEqual(errors, [], `页面错误：${errors.join('; ')}`)
  console.log(`\n全部通过，截图目录：${output}`)
} catch (error) {
  await page.screenshot({ path: join(output, 'failure.png') }).catch(() => {})
  console.error('验收失败：', error)
  process.exitCode = 1
} finally {
  await browser.close()
}
