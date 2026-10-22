/**
 * WP8.M G6：引言中的条在 io 出件链路里的行为（矩阵 M-4.3.4-02、M-4.3.4-03）。
 *
 * io 的两处遍历（公式 → OMML、图片资源）原先只看前言/引言的块，引言条里的图与独立公式会漏掉；
 * 这里用真实的 shared 渲染链验证它们被带进 DOCX 包，并确认 PDF 目次目标不含引言条。
 */

import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import type { IRDoc, PMJsonNode } from '@ses/shared'
import { pmToIr } from '@ses/shared'
import { buildDocx } from './docx'
import { convertFormulasToOmml } from './formulaOmml'
import { collectImageResources } from './imageResources'
import { buildPdfExportRequest, extractPdfTocTargets } from './pdfExport'
import { exportSemanticHtml } from './semanticExport'

const imageData = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6oJ8AAAAASUVORK5CYII='

const text = (value: string): PMJsonNode => ({ type: 'text', text: value })
const paragraph = (nodeId: string, value: string): PMJsonNode => ({ type: 'stdParagraph', attrs: { nodeId }, content: [text(value)] })

/** 引言只有条：0.1 背景（含图与独立公式）、0.1.1 子条；正文第 1 章。 */
function pmWithIntroductionClauses(): PMJsonNode {
  return {
    type: 'standardDoc',
    attrs: { standardType: 'national', titleCn: '引言分条样稿', standardNo: 'GB/T 12345—2026' },
    content: [
      { type: 'introduction', content: [
        { type: 'clause', attrs: { nodeId: 'intro-c1', level: 1 }, content: [
          { type: 'clauseTitle', content: [text('背景')] },
          { type: 'clause', attrs: { nodeId: 'intro-c1-1', level: 2 }, content: [
            { type: 'clauseTitle', content: [text('起因')] },
            paragraph('intro-c1-1-p', '编制起因。'),
            { type: 'figure', attrs: { nodeId: 'intro-fig' }, content: [
              { type: 'figureImage', attrs: { src: imageData } },
              { type: 'figureCaption', content: [text('引言图')] },
            ] },
            { type: 'formula', attrs: { nodeId: 'intro-formula' }, content: [
              { type: 'formulaContent', content: [text('x < 0 \\quad A \\& B')] },
            ] },
          ] },
        ] },
        { type: 'clause', attrs: { nodeId: 'intro-c2', level: 1 }, content: [
          { type: 'clauseTitle', content: [text('目的')] },
          paragraph('intro-c2-p', '编制目的。'),
        ] },
      ] },
      { type: 'chapter', attrs: { nodeId: 'ch1', secType: 'scope' }, content: [
        { type: 'chapterTitle', content: [text('范围')] },
        paragraph('ch1-p', '正文。'),
      ] },
    ],
  }
}

describe('[M-4.3.4-02] io：引言条里的公式与图片资源', () => {
  const { doc } = pmToIr(pmWithIntroductionClauses())

  it('pmToIr 把引言条放进 introductionClauses，图与公式在条内', () => {
    expect(doc.unsupportedContent).toBeUndefined()
    const nested = doc.front.introductionClauses![0]!.children.find(child => child.kind === 'clause')
    expect(nested && nested.kind === 'clause' && nested.children.map(child => child.kind)).toEqual(['paragraph', 'figure', 'formula'])
  })

  it('convertFormulasToOmml 覆盖引言条内的独立公式', async () => {
    const { formulaOmml, warnings } = await convertFormulasToOmml(doc)
    expect(Object.keys(formulaOmml)).toEqual(['intro-formula'])
    expect(formulaOmml['intro-formula']).toMatch(/^<m:oMath\b/)
    expect(warnings).toEqual([])
  })

  it('collectImageResources 覆盖引言条内的图', async () => {
    const { images, diagnostics } = await collectImageResources(doc)
    expect(Object.keys(images)).toEqual(['intro-fig'])
    expect(images['intro-fig']).toMatchObject({ contentType: 'image/png', widthPx: 1, heightPx: 1 })
    expect(diagnostics).toEqual([])
  })

  it('没有引言条的文档：两处遍历的结果与此前一致（不多不少）', async () => {
    const legacy: IRDoc = { ...doc, front: { foreword: [], introduction: [] } }
    expect((await convertFormulasToOmml(legacy)).formulaOmml).toEqual({})
    expect((await collectImageResources(legacy)).images).toEqual({})
  })
})

describe('[M-4.3.4-02][M-4.3.4-03] io：真实出件链路', () => {
  it('buildDocx：引言条用 A17 编号（0.%2）、图片与 OMML 公式进入包，无图片/公式告警', async () => {
    const { bytes, warnings } = await buildDocx({ pmDoc: pmWithIntroductionClauses(), createdAt: '2026-10-22T08:00:00Z' })
    const zip = await JSZip.loadAsync(bytes)
    const documentXml = await zip.file('word/document.xml')!.async('string')
    const numberingXml = await zip.file('word/numbering.xml')!.async('string')
    expect(documentXml).toContain('<w:drawing')
    expect(documentXml).toContain('<m:oMath ')
    expect(zip.file('word/media/image1.png')).not.toBeNull()
    expect(warnings.filter(warning => /^(?:image|formula)/.test(warning.code))).toEqual([])
    expect(numberingXml).toContain('<w:abstractNum w:abstractNumId="17"')
    expect(numberingXml).toContain('<w:lvlText w:val="0.%2　"/>')
    expect(documentXml).toContain('<w:pStyle w:val="SesClause1"/><w:numPr><w:ilvl w:val="1"/><w:numId w:val="101"/></w:numPr>')
    expect(documentXml).toContain('<w:pStyle w:val="SesClause2"/><w:numPr><w:ilvl w:val="2"/><w:numId w:val="101"/></w:numPr>')
  })

  it('exportSemanticHtml（screen）：引言条按条标题输出，编号 0.1，锚点 sec_0.1', () => {
    const html = exportSemanticHtml(pmWithIntroductionClauses())
    expect(html).toContain('<h3 class="ses-clause-title"><span class="ses-num">0.1</span>背景</h3>')
    expect(html).toContain('<h4 class="ses-clause-title"><span class="ses-num">0.1.1</span>起因</h4>')
    expect(html).toContain('id="sec_0.1"')
    expect(html).toContain('<span class="ses-num">0.2</span>目的')
    expect(html).toContain('<span class="ses-num">1</span>范围')
  })

  it('PDF 出件请求：print HTML 含引言条；目次目标只有「引言」与章，不含 sec_0.n（前置/正文分区按 front_intro 锚点划分）', () => {
    const request = buildPdfExportRequest(pmWithIntroductionClauses(), {})
    expect(request.html).toContain('<span class="ses-num">0.1</span>背景')
    expect(request.html).not.toContain('<a ')
    expect(request.toc).toEqual([
      { target: 'front_intro', text: '引言', division: 'front' },
      { target: 'sec_1', text: '1　范围', division: 'body' },
    ])
    expect(extractPdfTocTargets(request.html).map(item => item.target)).toEqual(['front_intro', 'sec_1'])
  })
})
