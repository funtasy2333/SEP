import { describe, expect, it } from 'vitest'
import type { IRParagraph, IRTable, PMJsonNode } from '../../ir/types'
import { irToPm, pmToIr } from '../../ir'
import { resolve } from '../../ir/resolve'
import { renderHtml } from '../html'
import { footnoteFixture } from './footnoteFixture'
import { renderDocxTraced } from '../docx/render'
import { assertFootnoteIntegrity, assertWellFormed } from '../docx/__tests__/helpers/checks'

const DOCX_OPTIONS = {
  formulaOmml: {}, images: {}, stage: 'approval_draft' as const, createdAt: '2026-10-08T00:00:00.000Z',
}

function sourceDoc() {
  const doc = footnoteFixture()
  const foreword = doc.front.foreword[0] as IRParagraph
  foreword.content = [{
    text: '前言 & <原文>\n续行',
    marks: [{ type: 'bold' }],
    footnote: { id: 'body-fn-1', content: [{ text: '脚注 & <内容>' }] },
  }]

  const table = doc.body[0]!.children[0] as IRTable
  table.footnotes!.push({ id: 'table-fn-c', content: [{ text: '定义C' }] })
  // irToPm derives the single table-note paragraph ID from its note ID; keep
  // this renderer fixture compatible with that existing projection contract.
  table.notes[0]!.content[0]!.id = 'table-note-1.p0'
  const paragraph = table.rows[0]!.cells[0]!.content[0] as IRParagraph
  paragraph.content = [
    {
      text: '作者正文 & <表格>\n继续',
      marks: [
        { type: 'bold' },
        { type: 'tableFootnoteRef', targetId: 'table-fn-b' },
        { type: 'tableFootnoteRef', targetId: 'table-fn-a' },
      ],
    },
    { text: '原文引用', marks: [
      { type: 'crossRef', targetId: 'chapter-1', targetKind: 'chapter' },
      { type: 'italic' },
    ] },
    { text: '', marks: [{ type: 'tableFootnoteRef', targetId: 'table-fn-c' }] },
  ]
  return doc
}

function paragraphHtmlAround(html: string, needle: string): string {
  const at = html.indexOf(needle)
  if (at < 0) return ''
  const start = html.lastIndexOf('<p', at)
  const end = html.indexOf('</p>', at)
  return start >= 0 && end >= 0 ? html.slice(start, end + '</p>'.length) : ''
}

function tableCellHtmlAround(html: string, needle: string): string {
  const at = html.indexOf(needle)
  if (at < 0) return ''
  const start = html.lastIndexOf('<td', at)
  const end = html.indexOf('</td>', at)
  return start >= 0 && end >= 0 ? html.slice(start, end + '</td>'.length) : ''
}

function xmlElementAround(xml: string, tag: 'w:p' | 'w:tc', needle: string): string {
  const at = xml.indexOf(needle)
  if (at < 0) return ''
  const start = xml.lastIndexOf(`<${tag}`, at)
  const close = `</${tag}>`
  const end = xml.indexOf(close, at)
  return start >= 0 && end >= 0 ? xml.slice(start, end + close.length) : ''
}

describe('native IR 脚注 atom 与行内正文共存', () => {
  it('HTML screen/print 与 IR→PM→IR 重开都保留正文、脚注和全部表脚注引用', () => {
    const source = sourceDoc()
    const sourceBefore = JSON.stringify(source)
    const reopened = pmToIr(irToPm(source) as PMJsonNode).doc
    const sourceResolution = resolve(source)
    const reopenedResolution = resolve(reopened)
    expect(sourceResolution.problems.filter(problem => problem.severity === 'error')).toEqual([])
    expect(reopenedResolution.problems.filter(problem => problem.severity === 'error')).toEqual([])

    for (const variant of ['screen', 'print'] as const) {
      const direct = renderHtml(source, sourceResolution.labels, { variant })
      const afterReopen = renderHtml(reopened, reopenedResolution.labels, { variant })
      const bodyDirect = paragraphHtmlAround(direct, '前言 &amp; &lt;原文&gt;')
      const bodyReopened = paragraphHtmlAround(afterReopen, '前言 &amp; &lt;原文&gt;')
      const cellDirect = tableCellHtmlAround(direct, '作者正文 &amp; &lt;表格&gt;')
      const cellReopened = tableCellHtmlAround(afterReopen, '作者正文 &amp; &lt;表格&gt;')

      expect(bodyDirect).toBe(bodyReopened)
      expect(bodyDirect).toContain('<strong>前言 &amp; &lt;原文&gt;</strong><br /><strong>续行</strong>')
      expect(bodyDirect.indexOf('续行')).toBeLessThan(bodyDirect.indexOf('class="ses-footnote"'))
      expect(bodyDirect).toContain('脚注 &amp; &lt;内容&gt;')

      expect(cellDirect).toBe(cellReopened)
      expect(cellDirect).toContain('<strong>作者正文 &amp; &lt;表格&gt;</strong><br /><strong>继续</strong>')
      expect(cellDirect).toContain('class="ses-table-footnote-call">a</sup>')
      expect(cellDirect).toContain('class="ses-table-footnote-call">b</sup>')
      expect(cellDirect).toContain('class="ses-table-footnote-call">c</sup>')
      const callPositions = ['a', 'b', 'c'].map(label => cellDirect.indexOf(`class="ses-table-footnote-call">${label}</sup>`))
      expect(callPositions[0]).toBeLessThan(callPositions[1]!)
      expect(callPositions[1]).toBeLessThan(callPositions[2]!)
      expect(cellDirect).toContain(variant === 'screen'
        ? '<a class="ses-xref" href="#sec_1" data-ref-target="chapter-1"><em>第1章</em></a>'
        : '<span class="ses-xref" data-ref-target="chapter-1"><em>第1章</em></span>')
    }

    expect(JSON.stringify(source)).toBe(sourceBefore)
  })

  it('DOCX XML 与 IR→PM→IR 重开都保留正文、body脚注和多个表脚注 atom', () => {
    const source = sourceDoc()
    const sourceBefore = JSON.stringify(source)
    const reopened = pmToIr(irToPm(source) as PMJsonNode).doc
    const sourceResolution = resolve(source)
    const reopenedResolution = resolve(reopened)
    const directPackage = renderDocxTraced(source, sourceResolution.labels, DOCX_OPTIONS).pkg
    const reopenedPackage = renderDocxTraced(reopened, reopenedResolution.labels, DOCX_OPTIONS).pkg
    const directDocument = directPackage.parts['word/document.xml']!
    const reopenedDocument = reopenedPackage.parts['word/document.xml']!
    const directForeword = xmlElementAround(directDocument, 'w:p', '前言 &amp; &lt;原文&gt;')
    const reopenedForeword = xmlElementAround(reopenedDocument, 'w:p', '前言 &amp; &lt;原文&gt;')
    const directCell = xmlElementAround(directDocument, 'w:tc', '作者正文 &amp; &lt;表格&gt;')
    const reopenedCell = xmlElementAround(reopenedDocument, 'w:tc', '作者正文 &amp; &lt;表格&gt;')

    expect(directForeword).toBe(reopenedForeword)
    expect(directForeword).toContain('<w:t xml:space="preserve">前言 &amp; &lt;原文&gt;</w:t>')
    expect(directForeword).toContain('<w:br/>')
    expect(directForeword.indexOf('<w:footnoteReference')).toBeGreaterThan(directForeword.indexOf('续行'))
    expect(directCell).toBe(reopenedCell)
    expect(directCell).toContain('<w:t xml:space="preserve">作者正文 &amp; &lt;表格&gt;</w:t>')
    expect(directCell).toContain('<w:b/>')
    const tableReferenceRuns = [...directCell.matchAll(/<w:r>([\s\S]*?)<\/w:r>/g)]
      .map(match => match[1]!)
      .filter(run => run.includes('<w:vertAlign w:val="superscript"/>'))
    expect(tableReferenceRuns).toHaveLength(3)
    expect(tableReferenceRuns.every(run => !run.includes('<w:b/>') && !run.includes('<w:i/>'))).toBe(true)
    const referenceTextPositions = ['a', 'b', 'c'].map(label => directCell.indexOf(`<w:t xml:space="preserve">${label}</w:t>`))
    expect(referenceTextPositions[0]).toBeLessThan(referenceTextPositions[1]!)
    expect(referenceTextPositions[1]).toBeLessThan(referenceTextPositions[2]!)
    expect(directCell).toContain('<w:t xml:space="preserve">第1章</w:t>')
    expect(directPackage.parts['word/footnotes.xml']).toBe(reopenedPackage.parts['word/footnotes.xml'])
    expect(directPackage.parts['word/footnotes.xml']).toContain('脚注 &amp; &lt;内容&gt;')
    expect(() => assertWellFormed(directPackage)).not.toThrow()
    expect(() => assertFootnoteIntegrity(directPackage)).not.toThrow()
    expect(() => assertWellFormed(reopenedPackage)).not.toThrow()
    expect(() => assertFootnoteIntegrity(reopenedPackage)).not.toThrow()
    expect(JSON.stringify(source)).toBe(sourceBefore)
  })
})
