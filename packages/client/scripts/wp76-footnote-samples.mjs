/** WP7.6 功能样稿；生产 schema → JSON重开 → XML → 复制 → buildDocxBlob。
 * node packages/client/scripts/wp76-footnote-samples.mjs <absolute output directory> [historical-border.json]
 * 所有材料均为测试 fixture，不代替真实标准文稿。 */
import { writeFile, readFile, mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { getSchema } from '@tiptap/core'
import { Window } from 'happy-dom'
import assert from 'node:assert/strict'
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const output = process.argv[2]
if (!output?.startsWith('/')) throw new Error('请提供输出目录绝对路径')
const window = new Window()
window.document.write("<!doctype html><html><body></body></html>")
for (const name of ["DOMParser", "Node", "Element", "HTMLElement", "CustomEvent"]) globalThis[name] = window[name]
globalThis.document = window.document
globalThis.window = window
Object.defineProperty(globalThis, "navigator", { value: window.navigator, configurable: true })
const server = await createServer({ root, configFile: false, resolve: { alias: { '@': resolve(root, 'src') } }, optimizeDeps: { noDiscovery: true }, server: { middlewareMode: true } })
let sequence = 0
const id = (prefix) => `${prefix}-${++sequence}`
const text = (value) => ({ type: 'text', text: value })
const p = (...content) => ({ type: 'stdParagraph', attrs: { nodeId: id('p') }, content: content.map(v => typeof v === 'string' ? text(v) : v) })
const fn = (value) => ({ type: 'footnoteRef', attrs: { nodeId: id('fn'), content: [text(value)] } })
const ref = (targetId) => ({ type: 'tableFootnoteRef', attrs: { nodeId: id('call'), targetId } })
const cell = (content = [], attrs = {}, header = false) => ({ type: header ? 'tableHeader' : 'tableCell', attrs: { colspan: 1, rowspan: 1, ...attrs }, content: [{ type: 'paragraph', content }] })
const row = (...content) => ({ type: 'tableRow', content })
function table(name, { notes = false, definitions = true, landscape = false, long = false } = {}) {
  const a = id('def-a'), b = id('def-b')
  const rows = [row(cell([text('项目')], {}, true), cell([text('说明')], {}, true)),
    row(cell(definitions ? [ref(b), ref(a), ref(b)] : []), cell()),
    row(cell(definitions ? [ref(a)] : [text('跨列')], { colspan: 2 })),
    row(cell(definitions ? [ref(b)] : [text('跨行')], { rowspan: 2 }), cell([text('合并首行')])),
    row(cell([text('合并续行')]))]
  if (long) rows.push(...Array.from({ length: 70 }, (_, i) => row(cell([text(`续表记录${i + 1}`)]), cell([text('数据保持，表注与定义只在末段出现。')]))))
  // 表格只允许表脚注；混合方向的条文分隔线另用物理分节探测副本验证。
  if (landscape) rows.push(row(cell([text('横排表内使用表脚注，上标a/b与表底定义对应。')], { colspan: 2 })))
  return { type: 'stdTable', attrs: { nodeId: id('table'), orientation: landscape ? 'landscape' : 'portrait' }, content: [
    { type: 'tableCaption', content: [text(name)] }, { type: 'table', content: rows },
    ...(notes ? [{ type: 'tableNoteRow', content: [{ type: 'note', attrs: { nodeId: id('note') }, content: [text('测试表注内容。')] }] }] : []),
    ...(definitions ? [{ type: 'tableFootnoteRow', content: [
      { type: 'tableFootnoteEntry', attrs: { nodeId: a }, content: [text('定义A：第二次首次引用；重复调用只保留本条定义。')] },
      { type: 'tableFootnoteEntry', attrs: { nodeId: b }, content: [text('定义B：首次引用应为上标a。')] },
    ] }] : []),
  ] }
}
const meta = { titleCn: 'WP7.6脚注交付补充测试样稿', titleEn: 'Footnote delivery regression fixture', standardType: 'national', standardNo: 'GB/T XXXXX—XXXX', icsCode: '01.120', ccsCode: 'A 00', replaces: 'GB/T XXXXX—XXXX', consistency: '（ISO XXXXX:XXXX，MOD）' }
const manuscript = { type: 'doc', content: [
  { type: 'coverPage', attrs: { nodeId: 'cover', ...meta }, content: [{ type: 'paragraph' }] },
  { type: 'foreword', attrs: { nodeId: 'foreword' }, content: [p('本稿为功能测试fixture，不是真实标准文稿。', fn('前言的条文脚注为全文第1条。'))] },
  { type: 'chapter', attrs: { nodeId: 'chapter' }, content: [
    { type: 'chapterTitle', content: [text('脚注交付核验')] },
    p('竖排正文调用', fn('竖排条文脚注测量：分隔线应为165 mm版心的四分之一。')),
    table('仅表注', { notes: true, definitions: false }),
    table('独立表脚注与仅上标单元格'),
    table('表注表脚注组合与合并续表', { notes: true, long: true }),
    table('横排表脚注', { landscape: true }),
    p('恢复竖排调用', fn('恢复竖排后仍用165 mm版心，不沿用横排宽度。')),
  ] },
] }
try {
  await mkdir(output, { recursive: true })
  const { createEditorExtensions } = await server.ssrLoadModule('/src/extensions/editorExtensions.ts')
  const { serializeToXml } = await server.ssrLoadModule('/src/serializer/xmlSerializer.ts')
  const { parseXmlToEditorJson } = await server.ssrLoadModule('/src/serializer/xmlParser.ts')
  const { createDocumentDuplicate } = await server.ssrLoadModule('/src/utils/duplicateDocument.ts')
  const { buildDocxBlob } = await server.ssrLoadModule('/src/serializer/docxExporter.ts')
  const schema = getSchema(createEditorExtensions())
  const normalize = (json) => { const node = schema.nodeFromJSON({ ...json, type: schema.topNodeType.name }); node.check(); return node }
  const original = normalize(manuscript)
  const saved = JSON.parse(JSON.stringify(original.toJSON()))
  const reopened = normalize(saved)
  assert.deepEqual(reopened.toJSON(), original.toJSON())
  const xml = serializeToXml(reopened)
  const roundtrip = normalize(parseXmlToEditorJson(xml, schema.topNodeType.name))
  const source = { title: meta.titleCn, meta, stage: 'working_draft', content: reopened.toJSON() }
  const duplicate = createDocumentDuplicate(source)
  assert.deepEqual(source.content, reopened.toJSON())
  const cases = [['delivery', reopened, meta], ['xml-roundtrip', roundtrip, meta], ['duplicate', normalize(duplicate.content), duplicate.meta]]
  if (process.argv[3]) {
    const historical = JSON.parse(await readFile(process.argv[3], 'utf8'))
    cases.push(['standalone-border', normalize(historical.content), historical.meta])
  }
  const manifest = []
  for (const [name, pmDoc, documentMeta] of cases) {
    const { blob, warnings } = await buildDocxBlob({ pmDoc, documentMeta, stage: 'working_draft', createdAt: '2026-10-03T00:00:00Z' })
    await writeFile(resolve(output, `${name}.docx`), new Uint8Array(await blob.arrayBuffer()))
    await writeFile(resolve(output, `${name}.xml`), serializeToXml(pmDoc))
    await writeFile(resolve(output, `${name}.json`), JSON.stringify({ title: documentMeta.titleCn, meta: documentMeta, stage: 'working_draft', content: pmDoc.toJSON() }, null, 2))
    manifest.push({ name, warnings, bytes: blob.size, qualification: 'fixture' })
  }
  await writeFile(resolve(output, 'manifest.json'), JSON.stringify(manifest, null, 2))
  console.log(JSON.stringify(manifest))
} finally { await server.close(); window.happyDOM.abort() }
