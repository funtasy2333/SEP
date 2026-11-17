// Real EditorView regression. Start Vite first; requests use a local in-memory fixture.
import { createRequire } from 'node:module'
import assert from 'node:assert/strict'
const require = createRequire(new URL('../../server/package.json', import.meta.url))
const { chromium } = require('playwright-chromium')
const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}), args: ['--no-sandbox'] })
const base = process.env.SES_TEST_ORIGIN || 'http://127.0.0.1:5175'
try {
  for (const width of [1440, 1000, 960, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 900 }, reducedMotion: 'reduce' })
    await page.route(`${base}/api/**`, route => {
      const url = route.request().url()
      const doc = { id: 1, title: '测试', meta: { titleCn: '测试', standardType: 'national' }, stage: 'working_draft', content: { type: 'doc', content: [
        { type: 'stdParagraph', attrs: { nodeId: 'p0' }, content: [{ type: 'text', text: '正文' }] },
        { type: 'appendix', attrs: { nodeId: 'app-b', normative: false }, content: [
          { type: 'appendixLabel', content: [{ type: 'text', text: '（资料性）' }] },
          { type: 'appendixTitle', content: [{ type: 'text', text: '方法验证' }] },
          { type: 'stdParagraph', attrs: { nodeId: 'p1' }, content: [{ type: 'text', text: '方法参数' }] },
        ] },
      ] }, revision: 1, updatedAt: '' }
      return route.fulfill({ json: url.includes('/versions') ? [] : doc })
    })
    await page.goto(`${base}/editor/1`)
    await page.locator('.ProseMirror').waitFor()
    const toolbar = page.locator('.ed-toolbar')
    const canvas = page.locator('.ed-main')
    const topBefore = (await canvas.boundingBox()).y
    const heightBefore = (await toolbar.boundingBox()).height
    await page.getByText('方法参数', { exact: true }).click()
    await page.getByTitle('在当前段落后插入公式：单独成行，可编号；运算式请用公式输入').click()
    const shelf = page.locator('.tbar-context-shelf')
    await shelf.waitFor()
    assert.equal(await shelf.locator('.tbar-context').count(), 2, `${width}: formula and appendix tools must coexist`)
    const canvasBox = await canvas.boundingBox()
    for (const group of await shelf.locator('.tbar-context').all()) {
      const box = await group.boundingBox()
      assert.ok(box.x >= canvasBox.x - 1 && box.x + box.width <= canvasBox.x + canvasBox.width + 1, `${width}: context group exceeds canvas`)
    }
    assert.equal((await canvas.boundingBox()).y, topBefore, `${width}: canvas moved`)
    assert.equal((await toolbar.boundingBox()).height, heightBefore, `${width}: toolbar changed height`)
    // Also exercise the narrow-screen outline overlay alongside the sidebar.
    if (width <= 960) await page.getByRole('button', { name: '显示文档结构', exact: true }).click()
    await page.getByRole('button', { name: '版本历史', exact: true }).click()
    const sidebar = page.getByTestId('version-sidebar')
    await sidebar.waitFor({ state: 'visible' })
    // A docked sidebar reduces the canvas; the floating groups must follow it.
    if (width > 1100) {
      await page.waitForFunction(() => {
        const canvas = document.querySelector('.ed-main').getBoundingClientRect()
        return [...document.querySelectorAll('.tbar-context')].every(el => {
          const group = el.getBoundingClientRect()
          return group.left >= canvas.left - 1 && group.right <= canvas.right + 1
        })
      })
    }
    await sidebar.getByRole('button', { name: '保存版本' }).click({ timeout: 5000 })
    await page.getByRole('dialog', { name: '保存版本' }).waitFor()
    await page.keyboard.press('Escape')
    await sidebar.getByRole('button', { name: '关闭', exact: true }).click({ timeout: 5000 })
    await sidebar.waitFor({ state: 'hidden' })
    await page.getByRole('button', { name: '打开质量检查' }).click()
    await page.locator('.validation-sidebar').getByRole('button', { name: '关闭质量检查' }).click({ timeout: 5000 })
    console.log(`${width}px: stable canvas and clickable version controls`)
    await page.close()
  }
} finally { await browser.close() }
