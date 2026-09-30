/** 新建表单 → 持久化内容 → 真实 DOCX 导出验收。node ... /absolute/output.docx */
import { writeFile, mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const output = process.argv[2]
if (!output?.startsWith('/') || !output.toLowerCase().endsWith('.docx')) throw new Error('请提供以.docx结尾的输出绝对路径')
const server = await createServer({ root, configFile: false, resolve: { alias: { '@': resolve(root, 'src') } },
  optimizeDeps: { noDiscovery: true }, server: { middlewareMode: true } })
try {
  const { createNewDocument } = await server.ssrLoadModule('/src/utils/newDocument.ts')
  const { buildDocxBlob } = await server.ssrLoadModule('/src/serializer/docxExporter.ts')
  const draft = createNewDocument({ type: 'national', stage: 'working_draft', stdPrefix: '', stdNo: '',
    titleCn: '新建标准初始化验收样稿', titleEn: '', icsCode: '01.040.03', ccsCode: 'A 00',
    issuer: '', applicant: '测试起草单位甲、测试起草单位乙', proposer: '测试提出单位', technicalCommittee: '测试归口单位',
    replaces: 'GB/T 12345—2020', consistency: '（ISO 1234:2020，MOD）' })
  const saved = JSON.parse(JSON.stringify(draft))
  const { blob, warnings } = await buildDocxBlob({ pmDoc: saved.content, documentMeta: saved.meta,
    stage: saved.stage, createdAt: '2026-09-30T00:00:00Z' })
  await mkdir(dirname(output), { recursive: true })
  await writeFile(output, new Uint8Array(await blob.arrayBuffer()))
  await writeFile(output.replace(/\.docx$/i, '.json'), JSON.stringify({ draft: saved, warnings }, null, 2) + '\n')
  console.log(JSON.stringify({ output, bytes: blob.size, warnings }, null, 2))
} finally { await server.close() }
