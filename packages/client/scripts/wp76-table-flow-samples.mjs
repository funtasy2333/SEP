/** 续表样稿：生产 schema 文档经真实 buildDocxBlob 导出（自动续表；页位置未知的表退回自然分页）并统计分页标记。
 * node packages/client/scripts/wp76-table-flow-samples.mjs <absolute output directory> [--sweep]
 * 输出 <name>.docx 与 stats.json，并在 stdout 打印统计表。
 * 所有材料均为功能 fixture，不代替真实标准文稿；LibreOffice 等非 Word 渲染不是验收依据。
 * 同一脚本可在修改前后的源码上运行，用于对照 pageBreakBefore 数。 */
import { createRequire } from 'node:module'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { writeFile, mkdir } from 'node:fs/promises'
import assert from 'node:assert/strict'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const output = process.argv[2]
if (!output?.startsWith('/')) throw new Error('请提供输出目录绝对路径')
const require = createRequire(resolve(root, 'package.json'))
const { createServer } = await import(require.resolve('vite'))
const { getSchema } = await import(require.resolve('@tiptap/core'))
const { Window } = await import(require.resolve('happy-dom'))
const ioRequire = createRequire(resolve(root, '../io/package.json'))
const JSZip = (await import(ioRequire.resolve('jszip'))).default
const window = new Window()
window.document.write('<!doctype html><html><body></body></html>')
for (const name of ['DOMParser', 'Node', 'Element', 'HTMLElement', 'CustomEvent']) globalThis[name] = window[name]
globalThis.document = window.document
globalThis.window = window
Object.defineProperty(globalThis, 'navigator', { value: window.navigator, configurable: true })
const server = await createServer({
  root, configFile: false, resolve: { alias: { '@': resolve(root, 'src') } },
  optimizeDeps: { noDiscovery: true }, server: { middlewareMode: true },
})

let counter = 0
const id = prefix => `${prefix}-${++counter}`
const t = text => ({ type: 'text', text })
const paragraph = text => ({ type: 'stdParagraph', attrs: { nodeId: id('p') }, content: [t(text)] })
const cell = (value, header = false) => ({
  type: header ? 'tableHeader' : 'tableCell', attrs: { colspan: 1, rowspan: 1 },
  content: [{ type: 'paragraph', content: [t(value)] }],
})
const meta = {
  titleCn: '续表样稿', titleEn: 'Table continuation samples', standardType: 'national',
  standardNo: 'GB/T XXXXX—XXXX', icsCode: '01.120', ccsCode: 'A 00',
}
const brokenLines = (count, text) => Array.from({ length: count }, (_, i) =>
  [...(i > 0 ? [{ type: 'hardBreak' }] : []), t(`${text}${i + 1}`)]).flat()
const filler = (count, label) => Array.from({ length: count }, (_, i) =>
  paragraph(`${label}${i + 1}：记录应按次序整理，保持各项说明的完整性，检查正文末尾与后续表格是否连续。`))
const formula = (name = id('formula')) => ({
  type: 'formula', attrs: { nodeId: name, id: name },
  content: [{ type: 'formulaContent', content: [t('x=1')] }],
})
const table = (caption, count, { orientation = 'portrait', note = true } = {}) => ({
  type: 'stdTable', attrs: { nodeId: id('table'), orientation }, content: [
    { type: 'tableCaption', content: [t(caption)] },
    { type: 'table', content: [
      { type: 'tableRow', content: [cell('记录编号', true), cell('记录说明', true)] },
      ...Array.from({ length: count }, (_, i) => ({ type: 'tableRow', content: [cell(`记录${i + 1}`), cell('检查数据顺序与跨页衔接。')] })),
    ] },
    ...(note ? [{ type: 'tableNoteRow', content: [{ type: 'note', attrs: { nodeId: id('note') }, content: [t(`本表共${count}条记录，表注仅置于最后。`)] }] }] : []),
  ],
})
const chapter = (title, children) => ({
  type: 'chapter', attrs: { nodeId: id('chapter') }, content: [{ type: 'chapterTitle', content: [t(title)] }, ...children],
})
const clause = (title, children) => ({
  type: 'clause', attrs: { nodeId: id('clause'), level: 1, hasTitle: true },
  content: [{ type: 'clauseTitle', attrs: { level: 1 }, content: [t(title)] }, ...children],
})
const doc = (...chapters) => ({
  type: 'doc',
  content: [{ type: 'coverPage', attrs: { nodeId: id('cover'), ...meta }, content: [{ type: 'paragraph' }] }, ...chapters],
})

const samples = [
  // 1. 标题后接长表：标题链在页底附近，首段放不下
  ['heading-long-table', doc(chapter('记录编排', [
    { type: 'stdParagraph', attrs: { nodeId: id('p') }, content: brokenLines(30, '标题前正文行') },
    clause('表前条标题', [table('标题后长表', 70)]),
    paragraph('标题后长表结束。'),
  ]))],
  // 2. 段落含公式后接长表：公式高度不可估，页位置未知
  ['formula-then-long-table', doc(chapter('公式与表', [
    paragraph('公式前正文，当前页仍有充足空间。'),
    formula(),
    paragraph('式中各量含义见上。'),
    table('公式后长表', 70),
    paragraph('公式后长表结束。'),
  ]))],
  // 3. 短表
  ['short-table', doc(chapter('短表', [
    paragraph('短表前正文。'),
    table('短表', 3),
    paragraph('短表结束。'),
  ]))],
  // 4. 横排长表
  ['landscape-long-table', doc(chapter('横排长表', [
    paragraph('横排表前正文。'),
    table('横排长表', 70, { orientation: 'landscape' }),
    paragraph('恢复竖排后的正文。'),
  ]))],
  // 5. 两张相邻表（中间无任何段落）
  ['adjacent-tables', doc(chapter('相邻表', [
    paragraph('相邻表前正文。'),
    table('第一张相邻长表', 70),
    table('第二张相邻长表', 40),
    paragraph('相邻表结束。'),
  ]))],
  // 6. 综合稿：公式出现在第一张表之后，观察“位置未知”向同节后续表蔓延，以及横排节/附录重新锚定
  ['mixed-document', {
    type: 'doc',
    content: [
      { type: 'coverPage', attrs: { nodeId: id('cover'), ...meta }, content: [{ type: 'paragraph' }] },
      chapter('综合稿', [
        ...filler(12, '前置正文'),
        clause('第一节标题', [table('已知位置长表', 70)]),
        paragraph('第一张表之后的正文。'),
        formula(),
        clause('公式后标题', [table('公式后第一张长表', 70), table('紧邻的第二张长表', 40)]),
        table('位置仍未知的短表', 3),
        table('横排长表', 70, { orientation: 'landscape' }),
        paragraph('横排之后恢复竖排并重新已知。'),
        table('横排后的长表', 70),
      ]),
    ],
  }],
]

// --sweep：表前正文行数从 12 扫到 40，覆盖“页底附近首段放不下”的各种位置；只统计，不落盘。
const sweep = []
if (process.argv.includes('--sweep')) {
  const longHeading = () => ({ type: 'clauseTitle', attrs: { level: 1 }, content: brokenLines(12, '跨页标题行') })
  for (let lines = 12; lines <= 40; lines += 2) {
    const preface = () => ({ type: 'stdParagraph', attrs: { nodeId: id('p') }, content: brokenLines(lines, '表前正文行') })
    sweep.push([`sweep-plain-${lines}`, doc(chapter('扫描', [preface(), table('扫描长表', 70)]))])
    sweep.push([`sweep-heading-${lines}`, doc(chapter('扫描', [preface(), clause('表前条标题', [table('扫描长表', 70)])]))])
    sweep.push([`sweep-longheading-${lines}`, doc(chapter('扫描', [preface(), {
      type: 'clause', attrs: { nodeId: id('clause'), level: 1, hasTitle: true },
      content: [longHeading(), table('扫描长表', 70)],
    }]))])
  }
}

const count = (xml, pattern) => (xml.match(pattern) ?? []).length

try {
  await mkdir(output, { recursive: true })
  const { createEditorExtensions } = await server.ssrLoadModule('/src/extensions/editorExtensions.ts')
  const { buildDocxBlob } = await server.ssrLoadModule('/src/serializer/docxExporter.ts')
  const schema = getSchema(createEditorExtensions())
  const normalize = source => {
    const node = schema.nodeFromJSON({ ...source, type: schema.topNodeType.name })
    node.check()
    return node
  }
  const stats = []
  for (const [name, source] of [...samples, ...sweep]) {
    const node = normalize(source)
    assert.deepEqual(normalize(JSON.parse(JSON.stringify(node.toJSON()))).toJSON(), node.toJSON())
    const { blob, warnings } = await buildDocxBlob({
      pmDoc: node, documentMeta: meta, stage: 'working_draft', createdAt: '2026-10-15T00:00:00Z',
    })
    const bytes = new Uint8Array(await blob.arrayBuffer())
    if (!name.startsWith('sweep-')) await writeFile(resolve(output, `${name}.docx`), bytes)
    const xml = await (await JSZip.loadAsync(bytes)).file('word/document.xml').async('string')
    stats.push({
      sample: name,
      pageBreakBefore: count(xml, /<w:pageBreakBefore\/>/g),
      pageBreakRuns: count(xml, /<w:br w:type="page"\/>/g),
      tables: count(xml, /<w:tbl>/g),
      continuationCaptions: count(xml, /w:val="(?:SesTblCapCont|SesAppTblCapCont)"/g),
      landscapeSections: count(xml, /w:orient="landscape"/g),
      // 同类告警合并为「code:表1/表2」，表号来自 Resolver labels。
      warnings: Object.entries(warnings.filter(w => w.code.startsWith('table-')).reduce((groups, w) => {
        ;(groups[w.code] ??= []).push(w.label ?? '?')
        return groups
      }, {})).map(([code, labels]) => `${code}:${labels.join('/')}`),
      bytes: bytes.length,
    })
  }
  await writeFile(resolve(output, 'stats.json'), JSON.stringify(stats, null, 2))
  console.log('| 样稿 | pageBreakBefore | w:br page | w:tbl | 续表题 | 横排节 | 表格类告警 |')
  console.log('| --- | ---: | ---: | ---: | ---: | ---: | --- |')
  for (const s of stats.filter(item => !item.sample.startsWith('sweep-'))) {
    console.log(`| ${s.sample} | ${s.pageBreakBefore} | ${s.pageBreakRuns} | ${s.tables} | ${s.continuationCaptions} | ${s.landscapeSections} | ${s.warnings.join('、') || '—'} |`)
  }
  const swept = stats.filter(item => item.sample.startsWith('sweep-'))
  if (swept.length > 0) {
    for (const kind of ['plain', 'heading', 'longheading']) {
      const group = swept.filter(item => item.sample.startsWith(`sweep-${kind}-`))
      console.log(`sweep ${kind}: ${group.length} 份，写 pageBreakBefore 的 ${group.filter(item => item.pageBreakBefore > 0).length} 份，` +
        `pageBreakBefore 总数 ${group.reduce((sum, item) => sum + item.pageBreakBefore, 0)}，` +
        `自然分页回退告警 ${group.filter(item => item.warnings.some(w => w.startsWith('table-flow-natural-fallback'))).length} 份`)
    }
  }
} finally {
  await server.close()
  window.happyDOM.abort()
}
