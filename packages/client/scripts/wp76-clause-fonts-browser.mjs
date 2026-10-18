/**
 * WP76 条标题样式浏览器验收：一至五级条标题（章内、附录内、含 ::before 编号）的字体、字重、字号、外边距一致。
 * clauseTitle 按级别渲染成 h3–h6，样式必须按类名（.std-clause-title）而不是标签统一，否则只有一、二级吃到黑体变量。
 * 真实 UI → 隔离 SQLite API，启动方式与 wp76-structure-browser.mjs 相同（空文档库、PORT=3000 服务端、5173 Vite）：
 *   PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node packages/client/scripts/wp76-clause-fonts-browser.mjs <output-dir>
 * 使用 server 已有 playwright-chromium，不新增依赖，不进入 CI。
 */
import { chromium } from '../../server/node_modules/playwright-chromium/index.mjs'
import { mkdir } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import assert from 'node:assert/strict'

const output = resolve(process.argv[2] || 'tmp-e2e/wp76-clause-fonts')
await mkdir(output, { recursive: true })
const origin = process.env.WP76_BROWSER_ORIGIN || 'http://127.0.0.1:5173'
const originUrl = new URL(origin)
if (originUrl.protocol !== 'http:' || !['localhost', '127.0.0.1'].includes(originUrl.hostname) || originUrl.origin !== origin) throw new Error('验收只允许本机HTTP origin')

const text = value => ({ type: 'text', text: value })
const para = (id, value) => ({ type: 'stdParagraph', attrs: { nodeId: id }, content: value ? [text(value)] : [] })
const levelNames = ['一', '二', '三', '四', '五']
/** 一至五级嵌套的条树：每级一个标题条，最深一级带正文（避免悬置段）。 */
const tree = (prefix, level = 1) => ({
  type: 'clause', attrs: { nodeId: `${prefix}${level}`, level },
  content: [
    { type: 'clauseTitle', attrs: { level }, content: [text(`${levelNames[level - 1]}级条标题`)] },
    ...(level < 5 ? [tree(prefix, level + 1)] : [para(`${prefix}body`, '五级条正文。')]),
  ],
})
const content = {
  type: 'doc',
  content: [
    { type: 'chapter', attrs: { nodeId: 'ch' }, content: [{ type: 'chapterTitle', content: [text('总体要求')] }, tree('c')] },
    { type: 'appendix', attrs: { nodeId: 'ap', normative: true }, content: [
      { type: 'appendixLabel', content: [text('（规范性）')] }, { type: 'appendixTitle', content: [text('附录样例')] }, tree('a'),
    ] },
    { type: 'chapter', attrs: { nodeId: 'ch2' }, content: [
      { type: 'chapterTitle', content: [text('无题条')] },
      { type: 'clause', attrs: { nodeId: 'top', level: 1 }, content: [
        { type: 'clauseTitle', attrs: { level: 1 }, content: [text('一级条标题')] },
        { type: 'clause', attrs: { nodeId: 'u', level: 2, hasTitle: false }, content: [{ type: 'clauseTitle', attrs: { level: 2 } }, para('up', '无题条：编号与首段同行。')] },
      ] },
    ] },
  ],
}

const browser = await chromium.launch({ headless: true, ...(process.env.WP76_CHROMIUM ? { executablePath: process.env.WP76_CHROMIUM } : {}) })
const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } })
const errors = []
page.on('pageerror', error => errors.push(error.message))
const pass = message => console.log('通过：', message)
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
    title: 'WP76 条标题样稿', stage: 'draft', meta: { titleCn: 'WP76 条标题样稿', standardNo: 'GB/T XXXXX—XXXX' }, content,
  } })).json()
  await page.goto(`${origin}/editor/${created.id}`)
  await page.locator('.tiptap .std-clause').first().waitFor()

  const measure = prefix => page.evaluate(({ prefix: p }) => [1, 2, 3, 4, 5].map(level => {
    const title = document.querySelector(`.tiptap [data-node-id="${p}${level}"] > .std-clause-title`)
    const own = getComputedStyle(title)
    const before = getComputedStyle(title, '::before')
    return {
      level, tag: title.tagName, label: title.dataset.resolvedLabel, className: title.className,
      fontFamily: own.fontFamily, fontWeight: own.fontWeight, fontSize: own.fontSize, marginTop: own.marginTop, marginBottom: own.marginBottom,
      lineHeight: own.lineHeight, color: own.color,
      before: { content: before.content, fontFamily: before.fontFamily, fontWeight: before.fontWeight, fontSize: before.fontSize },
    }
  }), { prefix })
  const zhHei = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--ses-font-zh-hei').trim())
  assert.ok(zhHei.length > 0, '--ses-font-zh-hei 未定义')
  const normalize = value => value.replace(/["'\s]/g, '')

  for (const [prefix, name] of [['c', '章内条标题'], ['a', '附录内条标题']]) {
    const rows = await measure(prefix)
    assert.deepEqual(rows.map(row => row.tag), ['H3', 'H4', 'H5', 'H6', 'H6'], `${name}：按级别渲染的标签`)
    assert.equal(new Set(rows.map(row => row.label)).size, 5, `${name}：5 级编号各不相同`)
    for (const row of rows) {
      assert.equal(normalize(row.fontFamily), normalize(zhHei), `${name} ${row.level} 级：font-family 应为 --ses-font-zh-hei，实际 ${row.fontFamily}`)
      assert.equal(row.fontWeight, '700', `${name} ${row.level} 级字重`)
      assert.equal(row.fontSize, '14px', `${name} ${row.level} 级字号`)
      assert.equal(`${row.marginTop} ${row.marginBottom}`, '12px 6px', `${name} ${row.level} 级外边距`)
      assert.ok(row.before.content.length > 2, `${name} ${row.level} 级编号 ::before 有内容 ${row.before.content}`)
      assert.deepEqual(
        { fontFamily: normalize(row.before.fontFamily), fontWeight: row.before.fontWeight, fontSize: row.before.fontSize },
        { fontFamily: normalize(row.fontFamily), fontWeight: row.fontWeight, fontSize: row.fontSize },
        `${name} ${row.level} 级编号与标题文字同字体/字重/字号`,
      )
    }
    const [first, ...rest] = rows
    for (const row of rest) {
      const { level: _l, tag: _t, label: _a, className: _c, before: b1, ...a } = row
      const { level: _l0, tag: _t0, label: _a0, className: _c0, before: b0, ...base } = first
      assert.deepEqual(a, base, `${name}：${row.level} 级与一级逐项一致`)
      assert.deepEqual({ ...b1, content: '' }, { ...b0, content: '' }, `${name}：${row.level} 级编号与一级一致`)
    }
    pass(`${name}：一至五级 font-family=--ses-font-zh-hei、font-weight=700、font-size=14px、外边距 12px 0 6px，编号 ::before 与标题一致`)
  }
  await shot('.tiptap [data-node-id="c1"]', '01-chapter-clauses-1-5.png')
  await shot('.tiptap [data-node-id="a1"]', '02-appendix-clauses-1-5.png')

  // 章标题（h2）不受影响；无题条同排布局不受影响
  const chapter = await page.evaluate(() => {
    const own = getComputedStyle(document.querySelector('.tiptap [data-node-id="ch"] > .std-chapter-title'))
    return { tag: document.querySelector('.tiptap [data-node-id="ch"] > .std-chapter-title').tagName, fontSize: own.fontSize, fontWeight: own.fontWeight }
  })
  assert.deepEqual(chapter, { tag: 'H2', fontSize: '16px', fontWeight: '700' })
  const untitled = await page.evaluate(() => {
    const title = document.querySelector('.tiptap [data-node-id="u"] > .std-clause-title')
    const paragraph = document.querySelector('.tiptap [data-node-id="up"]')
    const style = getComputedStyle(title)
    return {
      float: style.float, marginTop: style.marginTop, marginBottom: style.marginBottom, fontWeight: style.fontWeight, fontFamily: style.fontFamily,
      titleTop: title.getBoundingClientRect().top, paragraphTop: paragraph.getBoundingClientRect().top,
    }
  })
  assert.equal(untitled.float, 'left')
  assert.equal(`${untitled.marginTop} ${untitled.marginBottom}`, '0px 0px', '无题条编号浮动块仍无外边距')
  assert.ok(Math.abs(untitled.titleTop - untitled.paragraphTop) <= 1.5, `无题条编号与首段同一顶边 ${JSON.stringify(untitled)}`)
  assert.equal(untitled.fontWeight, '700')
  assert.equal(normalize(untitled.fontFamily), normalize(zhHei))
  pass('章标题（h2，16px/700）不受影响；无题条编号仍左浮动、无外边距、与首段同一顶边，字体与条标题一致')
  await shot('.tiptap [data-node-id="ch2"]', '03-untitled-clause.png')
  await page.screenshot({ path: join(output, '04-full-page.png') })

  assert.deepEqual(errors, [], `页面错误：${errors.join('; ')}`)
  console.log(`\n全部通过，截图目录：${output}`)
} catch (error) {
  await page.screenshot({ path: join(output, 'failure.png') }).catch(() => {})
  console.error('验收失败：', error)
  process.exitCode = 1
} finally {
  await browser.close()
}
