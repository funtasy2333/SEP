/**
 * WP8.M G2：缩略语表（defList）在 io 出件链路里的行为（矩阵 M-10.1.4-01/-03/-04/-05、M-10.1.1-04）。
 *
 * 用真实的 shared 渲染链验证 HTML（screen）、PDF 出件请求（print HTML）与 DOCX 都输出缩略语表，
 * 并确认旧 XML 出口按输出边界阻断（XML46687 白名单留给 WP8.2）。
 */

import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import type { PMJsonNode } from '@ses/shared'
import { buildDocx } from './docx'
import { checkExportGuard } from './exportGuard'
import { buildPdfExportRequest, extractPdfTocTargets } from './pdfExport'
import { exportSemanticHtml } from './semanticExport'

const text = (value: string, marks?: NonNullable<PMJsonNode['marks']>): PMJsonNode =>
  marks ? { type: 'text', text: value, marks } : { type: 'text', text: value }
const paragraph = (nodeId: string, ...content: PMJsonNode[]): PMJsonNode => ({ type: 'stdParagraph', attrs: { nodeId }, content })
const item = (nodeId: string, term: string, definition: PMJsonNode[]): PMJsonNode => ({
  type: 'whereItem', attrs: { nodeId },
  content: [{ type: 'whereTerm', content: [text(term)] }, { type: 'whereDefinition', content: definition }],
})

/** 范围章引用缩略语；第 2 章“符号和缩略语”含两项缩略语表。 */
function pmWithAbbreviations(): PMJsonNode {
  return {
    type: 'standardDoc',
    attrs: { standardType: 'national', titleCn: '缩略语样稿', standardNo: 'GB/T 12345—2026' },
    content: [
      { type: 'chapter', attrs: { nodeId: 'ch1', secType: 'scope' }, content: [
        { type: 'chapterTitle', content: [text('范围')] },
        paragraph('ch1-p', text('本文件使用'), text('模数转换器', [{ type: 'crossRef', attrs: { targetId: 'abb-adc', refType: 'abbreviation' } }]), text('。')),
      ] },
      { type: 'chapter', attrs: { nodeId: 'ch2', secType: 'general' }, content: [
        { type: 'chapterTitle', content: [text('符号和缩略语')] },
        paragraph('ch2-p', text('下列缩略语适用于本文件。')),
        { type: 'defList', attrs: { nodeId: 'dl-1' }, content: [
          item('abb-adc', 'ADC', [text('模数转换器（Analog-to-Digital Converter）')]),
          item('abb-agc', 'AGC', [text('自动增益控制（Automatic Gain Control）')]),
        ] },
      ] },
    ],
  }
}

describe('[M-10.1.4-01] io：真实出件链路', () => {
  it('exportSemanticHtml（screen）：缩略语表每项一段，缩略语、全角冒号、释义；引用链接到 abb_<k>', () => {
    const html = exportSemanticHtml(pmWithAbbreviations())
    expect(html).toContain('<div class="ses-def-list" data-type="def-list" data-node-id="dl-1">')
    expect(html).toContain('<span class="ses-def-term">ADC</span><span class="ses-def-sep">：</span><span class="ses-def-definition">模数转换器（Analog-to-Digital Converter）</span>')
    expect(html).toContain('<a class="ses-xref" href="#abb_1" data-ref-target="abb-adc">ADC</a>')
    expect(html).toContain('id="abb_1"')
    expect(html).toContain('id="abb_2"')
  })

  it('PDF 出件请求：print HTML 含缩略语表，无内部链接；目次目标不受影响', () => {
    const request = buildPdfExportRequest(pmWithAbbreviations(), {})
    expect(request.html).toContain('<span class="ses-def-term">AGC</span><span class="ses-def-sep">：</span>')
    expect(request.html).toContain('<span class="ses-xref" data-ref-target="abb-adc">ADC</span>')
    expect(request.html).not.toContain('<a ')
    expect(extractPdfTocTargets(request.html).map(entry => entry.target)).toEqual(['sec_1', 'sec_2'])
  })

  it('buildDocx：缩略语每项一个 SesPara 段（缩略语、全角冒号、释义），引用处为缩略语，无降级告警', async () => {
    const { bytes, warnings } = await buildDocx({ pmDoc: pmWithAbbreviations(), createdAt: '2026-10-22T08:00:00Z' })
    const zip = await JSZip.loadAsync(bytes)
    const xml = await zip.file('word/document.xml')!.async('string')
    const paragraphs = [...xml.matchAll(/<w:p>([\s\S]*?)<\/w:p>/g)].map(match => [...match[1]!.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)].map(run => run[1]).join(''))
    expect(paragraphs).toContain('ADC：模数转换器（Analog-to-Digital Converter）')
    expect(paragraphs).toContain('AGC：自动增益控制（Automatic Gain Control）')
    expect(paragraphs).toContain('本文件使用ADC。')
    expect(warnings.filter(warning => warning.nodeId?.startsWith('abb-') || warning.nodeId === 'dl-1')).toEqual([])
  })

  it('checkExportGuard：html/pdf/docx/json 放行；旧 xml 被输出边界阻止并指向 defList', () => {
    const doc = pmWithAbbreviations()
    for (const format of ['html', 'pdf', 'docx', 'json'] as const) expect(checkExportGuard(doc, format), format).toBeNull()
    const xml = checkExportGuard(doc, 'xml')
    expect(xml?.source).toBe('output-boundary')
    expect(xml?.problems.map(problem => problem.nodeId)).toEqual(['dl-1'])
  })
})
