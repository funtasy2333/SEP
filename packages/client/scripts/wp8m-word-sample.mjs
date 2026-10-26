/**
 * WP8.M M-Z-b：生成供真实 Word 检查的 DOCX 样稿（不入库）。
 *   node packages/client/scripts/wp8m-word-sample.mjs /absolute/output.docx
 *
 * 内容 = M-Z-a 全要素 fixture 去掉设计 §7.1 暂不排版的结构（图例、图中示例、行内图及其资源、列宽、单元格边框样式），
 * 并把第 8.1 条的罗马列项扩成 9 项（i）～ix），其中第 5～9 项文字较长、会回行），以便在 Word 里检查：
 *   - 引言条（A17 编号）0.1 / 0.1.1 / 0.1.2 / 0.2 / 0.3；
 *   - 罗马列项 i）～ix）：iii）～vi）的文字是否仍落在第五字位，vii）及以上是否被推到下一个制表位；
 *   - 缩略语表、规范性引用清单、〈领域〉术语、多段注 / 示例。
 * 走真实的 buildDocxBlob（PM JSON → IR → Resolver → DOCX 渲染器），与编辑器“导出 DOCX”同一条链路。
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const output = process.argv[2]
if (!output?.startsWith('/') || !output.toLowerCase().endsWith('.docx')) throw new Error('请提供以 .docx 结尾的输出绝对路径')

/** 与 wp8m-browser-walkthrough.mjs 里的去除逻辑一致（那边在浏览器里执行，这里在 Node 里执行，所以各写一份）。 */
function stripUnsupported(value) {
  if (Array.isArray(value)) return value.filter(entry => !(entry && ['figureLegend', 'inlineImage', 'figureResource'].includes(entry.type))).map(stripUnsupported)
  if (!value || typeof value !== 'object') return value
  const row = { ...value }
  if (row.type === 'figure' && Array.isArray(row.content)) row.content = row.content.filter(child => child.type !== 'example')
  if (row.type === 'stdTable' && row.attrs) row.attrs = { ...row.attrs, columns: null }
  if (['tableCell', 'tableHeader'].includes(row.type) && row.attrs) {
    const attrs = { ...row.attrs }
    for (const side of ['Top', 'Right', 'Bottom', 'Left']) for (const suffix of ['', 'Unit', 'Style']) attrs[`border${side}${suffix}`] = null
    row.attrs = attrs
  }
  if (Array.isArray(row.content)) row.content = stripUnsupported(row.content)
  return row
}

const text = value => ({ type: 'text', text: value })
const ROMAN = ['i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii', 'viii', 'ix']
const SHORT = ['准备', '实施', '检查', '处置']
const LONG = '该项文字较长，用来观察回行后的第二行是否与本项首行文字左对齐，并核对标识之后的文字落在第五字位还是被推到下一个制表位。'

function extendRomanList(node) {
  if (node.attrs?.nodeId !== 'g7-l-roman') return node.content ? { ...node, content: node.content.map(extendRomanList) } : node
  const items = ROMAN.map((label, index) => ({
    type: 'stdListItem',
    attrs: { nodeId: index < 4 ? `g7-r${index + 1}` : `wp8m-word-r${index + 1}`, marker: null },
    content: [text(index < 4 ? `${SHORT[index]}（第${index + 1}项，应显示 ${label}）` : `第${index + 1}项，应显示 ${label}）。${LONG}`)],
  }))
  return { ...node, content: items }
}

const server = await createServer({ root, configFile: false, resolve: { alias: { '@': resolve(root, 'src') } }, optimizeDeps: { noDiscovery: true }, server: { middlewareMode: true } })
try {
  const { createWp8mFixture } = await server.ssrLoadModule('/src/extensions/__fixtures__/wp8m.ts')
  const { createEditorSchema } = await server.ssrLoadModule('/src/extensions/editorSchema.ts')
  const { buildDocxBlob } = await server.ssrLoadModule('/src/serializer/docxExporter.ts')
  const schema = createEditorSchema()
  const full = schema.nodeFromJSON(createWp8mFixture()).toJSON()
  const body = extendRomanList(stripUnsupported(full))
  const meta = { titleCn: 'WP8.M Word 实测样稿', titleEn: 'WP8.M Word check sample', standardType: 'national', standardNo: 'GB/T 99999—2026' }
  const cover = { type: 'coverPage', attrs: { ...meta, publishDate: '2026-10-26', implementDate: '2027-01-01', icsCode: '01.040.03', ccsCode: 'A 00' }, content: [{ type: 'paragraph' }] }
  const pmDoc = { ...body, content: [cover, ...body.content] }
  schema.nodeFromJSON(pmDoc).check()
  const { blob, warnings } = await buildDocxBlob({ pmDoc, documentMeta: meta, stage: 'working_draft', createdAt: '2026-10-26T08:00:00.000Z' })
  await mkdir(dirname(output), { recursive: true })
  await writeFile(output, new Uint8Array(await blob.arrayBuffer()))
  console.log(JSON.stringify({ output, bytes: blob.size, warnings }, null, 2))
} finally {
  await server.close()
}
