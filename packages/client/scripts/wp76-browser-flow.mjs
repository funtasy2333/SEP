/**
 * WP7.6 浏览器验收：真实 UI → 隔离 SQLite API → 重开 → 复制 → 下载。
 * node packages/client/scripts/wp76-browser-flow.mjs <source.xml> <output-dir>
 * 只允许 http://localhost:5174 的空文档库；先将 Vite /api 代理指向独立工作树的 3076 服务。
 * 输入的真实性须人工确认；脚本不会把输入文件认定为真实标准文稿。
 * 使用 server 已有 playwright-chromium，不新增依赖，不进入 CI。
 */
import { chromium } from '../../server/node_modules/playwright-chromium/index.mjs'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { createHash } from 'node:crypto'
import assert from 'node:assert/strict'

const [sourceArg, outputArg] = process.argv.slice(2)
if (!sourceArg || !outputArg) throw new Error('请提供 XML 原稿路径和输出目录')
const source = resolve(sourceArg), output = resolve(outputArg)
const sourceBytes = await readFile(source)
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, acceptDownloads: true })
const origin = 'http://localhost:5174'
const evidence = { source, sourceSha256: createHash('sha256').update(sourceBytes).digest('hex'),
  sourceQualification: source.includes('/__fixtures__/') ? 'fixture' : 'unconfirmed: caller must identify real manuscript or fixture',
  origin, status: 'in-progress', steps: [], artifacts: [], consoleErrors: [] }
page.on('pageerror', (err) => evidence.consoleErrors.push(err.message))
const documentData = async (id) => {
  const response = await page.request.get(`${origin}/api/documents/${id}`)
  assert.equal(response.ok(), true)
  return response.json()
}
const waitWrite = (method) => page.waitForResponse((r) =>
  /\/api\/documents(?:\/\d+)?$/.test(r.url()) && r.request().method() === method && r.ok())
async function download(format, name) {
  await page.getByRole('button', { name: '导出', exact: true }).click()
  const downloaded = page.waitForEvent('download')
  await page.locator('.export-card').filter({ has: page.getByText(format, { exact: true }) }).click()
  const path = join(output, name)
  await (await downloaded).saveAs(path)
  evidence.artifacts.push({ format, path, sha256: createHash('sha256').update(await readFile(path)).digest('hex') })
  if (await page.getByRole('dialog', { name: '导出文档' }).isVisible()) {
    await page.keyboard.press('Escape')
    await page.getByRole('dialog', { name: '导出文档' }).waitFor({ state: 'hidden' })
  }
}
try {
  await page.goto(origin)
  const initial = await (await page.request.get(`${origin}/api/documents`)).json()
  assert.equal(initial.length, 0, '拒绝向非空文档库写入；必须使用独立工作树的空数据库及正确 /api 代理')
  await page.getByRole('button', { name: '新建标准文件', exact: true }).first().click()
  await page.getByPlaceholder('例：信息技术 标准化文件编辑系统 通用要求').fill('WP7.6 浏览器初始化样稿')
  for (const [placeholder, value] of [
    ['如 GB/T 12345—2020', 'GB/T 12345—2020'], ['如 （ISO 1234:2020，MOD）', '（ISO 1234:2020，MOD）'],
    ['如 35.240.99', '35.240.99'], ['如 L 70', 'L 70'],
    ['如 工业和信息化部', '测试提出单位'],
    ['如 全国信息技术标准化技术委员会（SAC/TC 28）', '测试归口单位'],
    ['如 中国电子技术标准化研究院', '测试起草单位'],
  ]) await page.getByPlaceholder(placeholder, { exact: true }).fill(value)
  const created = waitWrite('POST')
  await page.getByRole('button', { name: /创建草案/ }).click()
  const draft = await (await created).json()
  await page.waitForURL(`**/editor/${draft.id}`)
  await page.locator('.tiptap').waitFor()
  assert.equal(draft.meta.standardNo, 'GB/T XXXXX—XXXX')
  assert.ok(JSON.stringify(draft.content).includes('本文件起草单位：测试起草单位。'))
  assert.ok(JSON.stringify(draft.content).includes('不承担识别这些专利的责任'))
  evidence.steps.push('UI 创建：空编号、替代/采标、单位和专利前言一次持久化')
  await download('DOCX', 'created.docx')
  await download('XML', 'created.xml')
  const reimported = waitWrite('PUT')
  await page.locator('input[type=file][accept=".xml"]').setInputFiles(join(output, 'created.xml'))
  const creationRoundtrip = await (await reimported).json()
  await page.getByText('XML 文件导入成功', { exact: true }).last().waitFor()
  for (const key of ['titleCn', 'standardNo', 'replaces', 'consistency', 'proposer', 'technicalCommittee', 'applicant']) {
    assert.equal(creationRoundtrip.meta[key], draft.meta[key], `新建 XML 往返元数据：${key}`)
  }
  evidence.steps.push('UI 新建 XML 导出再导入：替代/采标、空编号及单位元数据一致')
  const imported = waitWrite('PUT')
  await page.locator('input[type=file][accept=".xml"]').setInputFiles(source)
  const importedDocument = await (await imported).json()
  await page.getByText('XML 文件导入成功', { exact: true }).last().waitFor()
  await writeFile(join(output, 'imported.json'), JSON.stringify(importedDocument, null, 2))
  evidence.steps.push('UI XML 导入：题名、元数据、正文一起写入隔离数据库')
  const paragraph = page.locator('.tiptap p').filter({ hasText: /.+/ }).first()
  await paragraph.click()
  await page.keyboard.press('End')
  const marker = '【WP7.6编辑核验】'
  await page.keyboard.insertText(marker)
  const saved = waitWrite('PUT')
  await page.keyboard.press('Control+s')
  await saved
  const edited = await documentData(draft.id)
  assert.ok(JSON.stringify(edited.content).includes(marker))
  await page.reload()
  await page.locator('.tiptap').waitFor()
  assert.ok((await page.locator('.tiptap').innerText()).includes(marker))
  const reopened = await documentData(draft.id)
  assert.deepEqual(reopened.content, edited.content)
  assert.deepEqual(reopened.meta, edited.meta)
  evidence.steps.push('UI 编辑 + 保存 + reload 重开：数据库正文和元数据一致，未重套初始化模板')
  await download('DOCX', 'reopened.docx')
  await download('XML', 'reopened.xml')
  await page.screenshot({ path: join(output, 'editor.png'), fullPage: true })
  await page.goto(origin)
  await page.locator('.doc-card .doc-more').first().click()
  const copied = waitWrite('POST')
  await page.getByRole('menuitem', { name: '复制', exact: true }).click()
  const duplicate = await (await copied).json()
  assert.equal(duplicate.stage, 'working_draft')
  assert.equal(duplicate.meta.titleCn, `${reopened.meta.titleCn}（副本）`)
  assert.deepEqual(duplicate.meta, { ...reopened.meta, titleCn: `${reopened.meta.titleCn}（副本）` })
  assert.deepEqual(duplicate.content.content.filter((n) => n.type !== 'coverPage'),
    reopened.content.content.filter((n) => n.type !== 'coverPage'))
  assert.deepEqual((await documentData(draft.id)).content, reopened.content)
  assert.deepEqual((await documentData(draft.id)).meta, reopened.meta)
  await page.goto(`${origin}/editor/${duplicate.id}`)
  await page.locator('.tiptap').waitFor()
  await download('DOCX', 'duplicate.docx')
  await download('XML', 'duplicate.xml')
  await writeFile(join(output, 'reopened.json'), JSON.stringify(reopened, null, 2))
  await writeFile(join(output, 'duplicate.json'), JSON.stringify(duplicate, null, 2))
  evidence.steps.push('UI 复制 + 重开 + DOCX/XML 下载：副本题名/阶段更新，原正文和源文档保留')
  assert.deepEqual(evidence.consoleErrors, [])
  evidence.status = 'browser-flow-passed; Word and real-manuscript qualification are separate checks'
} catch (error) {
  evidence.status = 'failed'
  evidence.failure = error.message
  await page.screenshot({ path: join(output, 'failure.png'), fullPage: true }).catch(() => {})
  throw error
} finally {
  await writeFile(join(output, 'browser-evidence.json'), JSON.stringify(evidence, null, 2) + '\n')
  await browser.close()
}
console.log(JSON.stringify(evidence, null, 2))
