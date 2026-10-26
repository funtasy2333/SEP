/** Real-browser layout regression, using only an in-memory API (no user database).
 * Start the client with Vite, then:
 * node packages/client/scripts/outline-scroll-browser.mjs http://127.0.0.1:5188 <output-dir>
 */
import { chromium } from '../../server/node_modules/playwright-chromium/index.mjs'
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

const origin = process.argv[2] || 'http://127.0.0.1:5188'
const url = new URL(origin)
if (!['127.0.0.1', 'localhost'].includes(url.hostname) || url.protocol !== 'http:' || url.origin !== origin) {
  throw new Error('Only a local HTTP origin is allowed')
}
const output = resolve(process.argv[3] || 'tmp-e2e/outline-scroll')
await mkdir(output, { recursive: true })
const text = value => ({ type: 'text', text: value })
const fixture = {
  id: 9002, title: '大纲滚动验收', stage: 'working_draft', revision: 1,
  meta: { titleCn: '大纲滚动验收', standardType: 'group', standardNo: 'T/TEST 1—2026' },
  content: { type: 'doc', content: Array.from({ length: 48 }, (_, index) => ({
    type: 'chapter', attrs: { nodeId: `ch-${index}` }, content: [
      { type: 'chapterTitle', content: [text(`章节-${index + 1}`)] },
      ...Array.from({ length: 2 }, (_, sub) => ({
        type: 'clause', attrs: { nodeId: `cl-${index}-${sub}`, level: 1, hasTitle: true }, content: [
          { type: 'clauseTitle', content: [text(`条款-${index + 1}-${sub + 1}`)] },
          { type: 'stdParagraph', attrs: { nodeId: `p-${index}-${sub}` }, content: [text('正文滚动对照。'.repeat(20))] },
        ],
      })),
    ],
  })) },
}
const browser = await chromium.launch({ headless: true })
const evidence = { status: 'in-progress', viewports: [], errors: [] }
try {
  for (const viewport of [{ width: 1440, height: 900 }, { width: 1024, height: 600 }]) {
    const page = await browser.newPage({ viewport })
    page.setDefaultTimeout(10000)
    page.on('pageerror', error => evidence.errors.push(error.message))
    // Intercept every API request; even editor normalization cannot write to a real document.
    await page.route(`${origin}/api/**`, route => route.fulfill({ json:
      new URL(route.request().url()).pathname === '/api/convert/capabilities' ? { htmlToPdf: false } : fixture,
    }))
    await page.goto(`${origin}/editor/9002`)
    const outline = page.locator('.outline-body')
    await page.waitForFunction(() => document.querySelectorAll('.outline-item').length === 144)
    await page.locator('.el-loading-mask').waitFor({ state: 'hidden' })
    const initial = await outline.evaluate(element => ({
      height: element.clientHeight, contentHeight: element.scrollHeight,
      bottom: element.getBoundingClientRect().bottom, viewportHeight: innerHeight,
      canvasTop: document.querySelector('.editor-content-wrapper').scrollTop,
      windowTop: scrollY,
      containers: [element.parentElement, element.parentElement.parentElement, element.parentElement.parentElement.parentElement]
        .map(parent => ({ class: parent.className, height: parent.clientHeight, display: getComputedStyle(parent).display,
          minHeight: getComputedStyle(parent).minHeight, flexDirection: getComputedStyle(parent).flexDirection })),
    }))
    evidence.viewports.push({ viewport, initial })
    assert.ok(initial.bottom <= initial.viewportHeight + 1, `大纲超出视口：${JSON.stringify(initial)}`)
    assert.ok(initial.contentHeight > initial.height, '长大纲应有内部滚动区域')
    const bounds = await outline.boundingBox()
    await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + Math.min(100, bounds.height / 2))
    await page.mouse.wheel(0, 10000)
    await page.waitForFunction(() => {
      const element = document.querySelector('.outline-body')
      return element.scrollTop + element.clientHeight >= element.scrollHeight - 1
    })
    const afterScroll = await outline.evaluate(element => ({
      top: element.scrollTop, canvasTop: document.querySelector('.editor-content-wrapper').scrollTop, windowTop: scrollY,
    }))
    assert.ok(afterScroll.top > 0)
    assert.equal(afterScroll.canvasTop, initial.canvasTop, '大纲滚动不能带动正文')
    assert.equal(afterScroll.windowTop, initial.windowTop, '大纲滚动不能带动整个页面')
    const last = page.locator('.outline-item').last()
    await last.click()
    await page.waitForFunction(() => document.querySelector('.outline-item.active')?.textContent.includes('条款-48-2'))
    await page.screenshot({ path: join(output, `outline-bottom-${viewport.width}.png`) })
    await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + Math.min(100, bounds.height / 2))
    await page.mouse.wheel(0, -10000)
    await page.waitForFunction(() => document.querySelector('.outline-body').scrollTop === 0)
    await page.locator('.outline-item').first().click()
    await page.waitForFunction(() => document.querySelector('.outline-item.active')?.textContent.includes('章节-1'))
    await page.screenshot({ path: join(output, `outline-top-${viewport.width}.png`) })
    evidence.viewports.at(-1).afterScroll = afterScroll
    await page.close()
  }
  assert.deepEqual(evidence.errors, [])
  evidence.status = 'passed'
} catch (error) {
  evidence.status = 'failed'
  evidence.failure = error.message
  throw error
} finally {
  await writeFile(join(output, 'results.json'), JSON.stringify(evidence, null, 2))
  await browser.close()
}
console.log('通过：长大纲上下滚动、正文独立滚动、首末条目定位，1440×900 和 1024×600。')
