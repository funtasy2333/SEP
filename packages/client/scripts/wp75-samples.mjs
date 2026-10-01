/** WP7.5：通过真实 buildDocxBlob 导出六类封面及额外草案样稿。
 * node packages/client/scripts/wp75-samples.mjs /absolute/output-directory
 */
import { writeFile, mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const output = process.argv[2]
if (!output?.startsWith('/')) throw new Error('请提供输出目录绝对路径')
const text = (value) => ({ type: 'text', text: value })
const p = (id, value) => ({ type: 'stdParagraph', attrs: { nodeId: id }, content: [text(value)] })
const specs = [
  ['gb', 'national', 'GB/T 12345-2026', 'published', {}],
  ['guide', 'guidance', 'GB/Z 12345-2026', 'approval_draft', {}],
  ['industry', 'industry', 'HG/T 1234-2026', 'comment_draft', { industryName: '化工', filingNo: '12345—2026', issuer: '中华人民共和国工业和信息化部' }],
  ['local', 'local', 'DB33/T 123-2026', 'review_draft', { regionName: '浙江省', issuer: '浙江省市场监督管理局' }],
  ['group', 'group', 'T/TEST 123-2026', 'public_draft', { issuer: '标准化服务协会' }],
  ['enterprise', 'enterprise', 'Q/TEST 123-2026', 'working_draft', { issuer: '标准化服务有限公司' }],
  ['gb-review-discussion', 'national', 'GB/T 12345-2026', 'review_discussion_draft', {}],
  ['gb-comment', 'national', 'GB/T 12345-2026', 'comment_draft', {}],
  ['gb-review', 'national', 'GB/T 12345-2026', 'review_draft', {}],
]
const server = await createServer({ root, configFile: false, resolve: { alias: { '@': resolve(root, 'src') } }, optimizeDeps: { noDiscovery: true }, server: { middlewareMode: true } })
try {
  const { buildDocxBlob } = await server.ssrLoadModule('/src/serializer/docxExporter.ts')
  await mkdir(output, { recursive: true })
  const manifest = []
  for (const [name, standardType, standardNo, stage, extra] of specs) {
    const pmDoc = { type: 'standardDoc', attrs: {
      standardType, standardNo, titleCn: '标准化服务规范　第1部分：服务流程与质量控制',
      titleEn: 'Standardization services — Part 1: Service process and quality control',
      icsCode: '01.040.03', ccsCode: 'A 00', publishDate: '2026-09-30', implementDate: '2027-01-01',
    }, content: [
      { type: 'coverPage', attrs: { replaces: standardNo.replace('2026', '2020'), consistency: '（ISO 1234:2020，MOD）', ...extra }, content: [p('cover-data', '封面数据')] },
      { type: 'foreword', content: [p('foreword-p', '本文件为WP7.5六类封面核验样稿，相关机构名称仅为验收数据。')] },
      { type: 'chapter', attrs: { nodeId: 'ch-1' }, content: [{ type: 'chapterTitle', content: [text('范围')] }, p('scope-p', '本文件规定标准化服务的流程与质量控制。封面节点元数据经IR映射后进入真实DOCX渲染链。')] },
    ] }
    const { blob, warnings } = await buildDocxBlob({ pmDoc, stage, createdAt: '2026-09-30T00:00:00Z' })
    const path = resolve(output, `${name}.docx`)
    await writeFile(path, new Uint8Array(await blob.arrayBuffer()))
    manifest.push({ name, stage, path, bytes: blob.size, warnings })
  }
  await writeFile(resolve(output, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
  console.log(JSON.stringify(manifest, null, 2))
} finally { await server.close() }
