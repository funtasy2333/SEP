// @vitest-environment happy-dom
import JSZip from 'jszip'
import { getSchema } from '@tiptap/core'
import { renderHtml, type PMJsonNode } from '@ses/shared'
import { describe, expect, it } from 'vitest'
import { createEditorExtensions } from '../extensions/editorExtensions'
import { buildDocxBlob, prepareDocxInput } from './docxExporter'
import { parseXmlToEditorJson } from './xmlParser'
import { serializeToXml } from './xmlSerializer'

const scenarios = ['only-ref', 'whitespace', 'multiple-paragraphs', 'repeated-ref', 'colspan', 'rowspan', 'header'] as const

function sample(scenario: typeof scenarios[number]): PMJsonNode {
  const reference = (id: string, targetId: string): PMJsonNode => ({ type: 'tableFootnoteRef', attrs: { nodeId: id, targetId } })
  const p = (content: PMJsonNode[] = []): PMJsonNode => ({ type: 'paragraph', content })
  const calls = [reference('call-b', 'fn-b'), reference('call-a', 'fn-a')]
  if (scenario === 'repeated-ref') calls.push(reference('call-b-again', 'fn-b'))
  const firstCell: PMJsonNode = {
    type: scenario === 'header' ? 'tableHeader' : 'tableCell',
    attrs: { colspan: scenario === 'colspan' ? 2 : 1, rowspan: scenario === 'rowspan' ? 2 : 1 },
    content: scenario === 'multiple-paragraphs' ? [p(), p(calls)] : [p([
      ...(scenario === 'whitespace' ? [{ type: 'text', text: ' \t ' }] : []), ...calls,
    ])],
  }
  const blankCell: PMJsonNode = { type: 'tableCell', attrs: { colspan: 1, rowspan: 1 }, content: [p()] }
  return { type: 'standardDoc', attrs: { standardType: 'national', titleCn: '上标单元格回归样稿' }, content: [{
    type: 'chapter', attrs: { nodeId: 'chapter' }, content: [
      { type: 'chapterTitle', content: [{ type: 'text', text: '核验' }] },
      { type: 'stdTable', attrs: { nodeId: 'table' }, content: [
        { type: 'tableCaption', content: [{ type: 'text', text: '仅有上标的单元格' }] },
        { type: 'table', content: [
          { type: 'tableRow', content: [firstCell, blankCell] },
          ...(scenario === 'rowspan' ? [{ type: 'tableRow', content: [blankCell] }] : []),
        ] },
        { type: 'tableFootnoteRow', content: [
          { type: 'tableFootnoteEntry', attrs: { nodeId: 'fn-a' }, content: [{ type: 'text', text: '定义A' }] },
          { type: 'tableFootnoteEntry', attrs: { nodeId: 'fn-b' }, content: [{ type: 'text', text: '定义B' }] },
        ] },
      ] },
    ],
  }] }
}

function texts(node: Element): string[] {
  return Array.from(node.getElementsByTagName('w:t')).map(t => t.textContent ?? '')
}

describe('仅含表脚注上标的单元格完整导出', () => {
  it.each(scenarios)('%s 在 schema / XML往返 / HTML / DOCX 中保留调用及唯一对应定义', async (scenario) => {
    const schema = getSchema(createEditorExtensions())
    const json = sample(scenario)
    json.type = schema.topNodeType.name
    const pm = schema.nodeFromJSON(json)
    pm.check()
    const xml = serializeToXml(pm)
    const reopened = schema.nodeFromJSON(parseXmlToEditorJson(xml, schema.topNodeType.name))
    reopened.check()
    const expectedCalls = scenario === 'repeated-ref' ? ['a', 'b', 'a'] : ['a', 'b']
    for (const source of [pm, reopened]) {
      const { doc, labels } = prepareDocxInput(source)
      const definitionLabels: Record<string, string | undefined> = {}
      source.descendants(node => {
        if (node.type.name === 'tableFootnoteEntry') definitionLabels[node.textContent] = labels[String(node.attrs.nodeId)]?.refText
      })
      expect(definitionLabels).toEqual({ '定义A': 'b', '定义B': 'a' })
      const html = renderHtml(doc, labels, { variant: 'print' })
      const tableBody = html.slice(html.indexOf('<table'), html.indexOf('<tfoot>'))
      expect((tableBody.match(/<sup[^>]*>a<\/sup>/g) ?? [])).toHaveLength(scenario === 'repeated-ref' ? 2 : 1)
      expect(tableBody).toMatch(/<sup[^>]*>b<\/sup>/)

      const { blob } = await buildDocxBlob({ pmDoc: source, createdAt: '2026-10-03T00:00:00Z' })
      const zip = await JSZip.loadAsync(await blob.arrayBuffer())
      const documentXml = await zip.file('word/document.xml')!.async('string')
      const dom = new DOMParser().parseFromString(documentXml, 'application/xml')
      expect(dom.getElementsByTagName('parsererror')).toHaveLength(0)
      const rows = Array.from(dom.getElementsByTagName('w:tbl')[0]!.getElementsByTagName('w:tr'))
      // 表题是 w:tbl 之外的独立段落，表格第 1 行即首个数据/表头行。
      const cells = rows[0]!.getElementsByTagName('w:tc')
      expect(texts(cells[0]!).filter(t => t.trim())).toEqual(expectedCalls)
      if (scenario === 'whitespace') expect(texts(cells[0]!)[0]).toBe(' \t ')
      const markers = Array.from(cells[0]!.getElementsByTagName('w:r')).filter(r => texts(r).some(t => /^[ab]$/.test(t)))
      expect(markers).toHaveLength(expectedCalls.length)
      for (const marker of markers) expect(marker.getElementsByTagName('w:vertAlign')[0]!.getAttribute('w:val')).toBe('superscript')
      expect(texts(cells[1]!)).toEqual(['—'])
      const footer = rows[rows.length - 1]!
      expect(texts(footer)).toEqual(['a', '定义B', 'b', '定义A'])
      if (scenario === 'colspan') expect(cells[0]!.getElementsByTagName('w:gridSpan')[0]!.getAttribute('w:val')).toBe('2')
      if (scenario === 'rowspan') {
        expect(cells[0]!.getElementsByTagName('w:vMerge')[0]!.getAttribute('w:val')).toBe('restart')
        expect(texts(rows[1]!.getElementsByTagName('w:tc')[0]!)).toEqual([])
      }
    }
  })
})
