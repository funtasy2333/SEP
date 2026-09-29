import JSZip from 'jszip'
import { describe, expect, it, vi } from 'vitest'
import type { DocumentMeta, PMJsonNode } from '@ses/shared'
import {
  buildDocxBlob,
  convertDocxToPdf,
  packageDocx,
  prepareDocxInput,
  resolveDocumentStage,
  DOCX_MIME_TYPE,
} from './docxExporter'

async function readZip(blob: Blob) {
  return JSZip.loadAsync(await blob.arrayBuffer())
}

const pmDoc: PMJsonNode = {
  type: 'standardDoc',
  attrs: {
    standardType: 'national',
    titleCn: 'PM 标题',
    titleEn: 'PM title',
    standardNo: 'PM 1',
    icsCode: 'PM ICS',
    ccsCode: 'PM CCS',
    publishDate: '2025-01-01',
    implementDate: '2025-02-01',
  },
  content: [],
}

describe('DOCX client exporter', () => {
  it('用全部已提供的文档库元数据覆盖 IR，并保留空字符串覆盖', () => {
    const documentMeta: DocumentMeta = {
      titleCn: '数据库标题',
      titleEn: 'Database title',
      standardNo: '',
      icsCode: 'DB ICS',
      ccsCode: 'DB CCS',
      standardType: 'guidance',
      issuer: '发布单位',
      applicant: '申请单位',
      publishDate: '2026-03-01',
      implementDate: '2026-04-01',
    }

    const { doc } = prepareDocxInput(pmDoc, documentMeta)

    expect(doc.meta).toEqual({
      standardType: 'guide',
      title: '数据库标题',
      titleEn: 'Database title',
      stdCode: '',
      icsCode: 'DB ICS',
      ccsCode: 'DB CCS',
      issuer: '发布单位',
      applicant: '申请单位',
      publishDate: '2026-03-01',
      implementDate: '2026-04-01',
    })
  })

  it('将 XML parts 和 base64 binaries 都打入 DOCX Blob', async () => {
    const blob = await packageDocx({
      parts: { '[Content_Types].xml': '<types/>', 'word/document.xml': '<document/>' },
      binaries: { 'word/media/pixel.png': 'AQID' },
      warnings: [],
    })

    expect(blob.type).toBe(DOCX_MIME_TYPE)
    const zip = await readZip(blob)
    expect(await zip.file('word/document.xml')!.async('string')).toBe('<document/>')
    expect(await zip.file('word/media/pixel.png')!.async('uint8array')).toEqual(new Uint8Array([1, 2, 3]))
  })

  it('同一包重复打包得到相同字节，且条目日期固定为 UTC、无隐式目录', async () => {
    const pkg = {
      parts: { 'word/document.xml': '<document/>', '[Content_Types].xml': '<types/>' },
      binaries: { 'word/media/pixel.png': 'AQID' },
      warnings: [],
    }
    const first = await packageDocx(pkg)
    const second = await packageDocx(pkg)
    expect(new Uint8Array(await first.arrayBuffer())).toEqual(new Uint8Array(await second.arrayBuffer()))
    const zip = await readZip(first)
    expect(Object.keys(zip.files)).toEqual(['[Content_Types].xml', 'word/document.xml', 'word/media/pixel.png'])
    expect(Object.values(zip.files).map(file => file.date.toISOString())).toEqual(
      Array(3).fill('1980-01-01T00:00:00.000Z'),
    )
  })

  it('通过真实 shared 渲染链生成带创建时间和文档标题的 DOCX', async () => {
    const { blob } = await buildDocxBlob({
      pmDoc,
      documentMeta: { titleCn: '导出标题', standardType: 'national' },
      stage: 'approval_draft',
      createdAt: '2026-09-28T01:02:03.000Z',
    })

    const zip = await readZip(blob)
    const core = await zip.file('docProps/core.xml')!.async('string')
    expect(core).toContain('导出标题')
    expect(core).toContain('2026-09-28T01:02:03Z')
    expect(zip.file('word/document.xml')).not.toBeNull()
  })

  it('将同一 DOCX Blob 作为 file 上传并返回 PDF，服务端错误包含响应详情', async () => {
    const docx = new Blob(['docx bytes'], { type: DOCX_MIME_TYPE })
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(new Blob(['pdf bytes'], { type: 'application/pdf' }), { status: 200 }),
    )

    const pdf = await convertDocxToPdf(docx, '交付稿.docx', fetcher)
    const [url, init] = fetcher.mock.calls[0]!
    const uploaded = (init?.body as FormData).get('file') as File

    expect(url).toBe('/api/convert/docx-to-pdf')
    expect(init?.method).toBe('POST')
    expect(uploaded.name).toBe('交付稿.docx')
    expect(await uploaded.text()).toBe('docx bytes')
    expect(await pdf.text()).toBe('pdf bytes')

    const failingFetch = vi.fn<typeof fetch>().mockResolvedValue(new Response('LibreOffice failed', { status: 500 }))
    await expect(convertDocxToPdf(docx, '交付稿', failingFetch)).rejects.toThrow(
      '服务器转换失败 (500): LibreOffice failed',
    )
  })

  it('无效或缺失的阶段回退到工作草案', () => {
    expect(resolveDocumentStage('approval_draft')).toBe('approval_draft')
    expect(resolveDocumentStage(undefined)).toBe('working_draft')
    expect(resolveDocumentStage('unknown')).toBe('working_draft')
  })
})
