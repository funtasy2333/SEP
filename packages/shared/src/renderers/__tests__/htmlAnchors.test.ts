import { describe, expect, it } from 'vitest'
import { resolve } from '../../ir/resolve'
import type { IRBlock, IRDoc, IRInline, IRReferenceTargetKind, NodeId, ResolvedLabel } from '../../ir/types'
import { renderHtml } from '../html'

const targetKinds: Record<string, IRReferenceTargetKind> = {
  chapter: 'chapter',
  clause: 'clause',
  appendix: 'appendix',
  figure: 'figure',
  table: 'table',
  numberedFormula: 'formula',
  unnumberedFormula: 'formula',
  mainParagraph: 'paragraph',
  note: 'note',
  example: 'example',
  term: 'term',
  bibliography: 'bibliography',
  noteParagraph: 'paragraph',
  exampleParagraph: 'paragraph',
  cellParagraph: 'paragraph',
  listParagraph: 'paragraph',
  nestedListParagraph: 'paragraph',
  termDefinition: 'paragraph',
  untitledFirstParagraph: 'paragraph',
}

const untypedCarrierTargetIds = [
  'list', 'listItem', 'nestedList', 'nestedListItem', 'tableRow', 'tableCell', 'whereItem',
] as const

const targetIds = [
  ...Object.keys(targetKinds),
  'inlineFootnote',
  'tableFootnote',
] as const

function text(value: string): IRInline {
  return { text: value }
}

function paragraph(id: NodeId, content: IRInline[] = [text(id)]): IRBlock {
  return { kind: 'paragraph', id, content }
}

function reference(targetId: NodeId, targetKind?: IRReferenceTargetKind): IRInline {
  return {
    text: 'source ' + targetId,
    marks: [{ type: 'crossRef', targetId, ...(targetKind ? { targetKind } : {}) }],
  }
}

function anchorFixture(): IRDoc {
  const references: IRInline[] = []
  for (const targetId of targetIds) {
    const targetKind = targetKinds[targetId]
    if (targetKind) references.push(reference(targetId, targetKind))
    // Legacy IR marks omit targetKind; Resolver still resolves numbered targets.
    references.push(reference(targetId))
  }

  return {
    schemaVersion: 1,
    meta: { standardType: 'gb' },
    front: { foreword: [], introduction: [] },
    body: [{
      kind: 'chapter',
      id: 'chapter',
      secType: 'general',
      title: [text('正文')],
      children: [
        paragraph('mainParagraph', [{
          text: '正文目标',
          footnote: { id: 'inlineFootnote', content: [text('脚注内容')] },
        }]),
        {
          kind: 'clause',
          id: 'clause',
          level: 1,
          titled: true,
          title: [text('条')],
          children: [
            {
              kind: 'note',
              id: 'note',
              content: [paragraph('noteParagraph')],
            },
            {
              kind: 'example',
              id: 'example',
              content: [paragraph('exampleParagraph')],
            },
            {
              kind: 'list',
              id: 'list',
              listType: 'dash',
              items: [{
                id: 'listItem',
                content: [
                  paragraph('listParagraph'),
                  {
                    kind: 'list',
                    id: 'nestedList',
                    listType: 'number',
                    items: [{ id: 'nestedListItem', content: [paragraph('nestedListParagraph')] }],
                  },
                ],
              }],
            },
            {
              kind: 'table',
              id: 'table',
              caption: [text('表')],
              orientation: 'portrait',
              headerRowCount: 0,
              rows: [{
                id: 'tableRow',
                cells: [{
                  id: 'tableCell',
                  colspan: 1,
                  rowspan: 1,
                  header: false,
                  content: [{
                    kind: 'paragraph',
                    id: 'cellParagraph',
                    content: [
                      text('单元格段落'),
                      { text: '', marks: [{ type: 'tableFootnoteRef', targetId: 'tableFootnote' }] },
                    ],
                  }],
                }],
              }],
              notes: [],
              footnotes: [{ id: 'tableFootnote', content: [text('表脚注')] }],
            },
            {
              kind: 'figure',
              id: 'figure',
              caption: [text('图')],
              orientation: 'portrait',
              src: 'data:image/png;base64,xx',
              notes: [],
            },
            {
              kind: 'formula',
              id: 'numberedFormula',
              latex: 'x = 1',
              numbered: true,
              whereList: [{ id: 'whereItem', term: [text('x')], definition: [text('变量')] }],
            },
            {
              kind: 'formula',
              id: 'unnumberedFormula',
              latex: 'y = 1',
              numbered: false,
              whereList: [],
            },
            {
              kind: 'termEntry',
              id: 'term',
              term: [text('术语')],
              definition: [paragraph('termDefinition')],
              notes: [],
              examples: [],
            },
            {
              kind: 'clause',
              id: 'untitledClause',
              level: 2,
              titled: false,
              title: [],
              children: [paragraph('untitledFirstParagraph')],
            },
          ],
        },
        paragraph('referenceSource', references),
      ],
    }],
    appendices: [{
      kind: 'appendix',
      id: 'appendix',
      normative: false,
      title: [text('附录')],
      children: [paragraph('appendixParagraph')],
    }],
    bibliography: [{
      kind: 'bibEntry',
      id: 'bibliography',
      content: [text('文献')],
    }],
  }
}

function attributeValues(html: string, attribute: string): string[] {
  const expression = new RegExp('(?:^|\\s)' + attribute + '="([^"]*)"', 'g')
  return [...html.matchAll(expression)].map(match => match[1]!)
}

function xrefLinks(html: string): Array<{ href: string; target: string }> {
  return [...html.matchAll(/<a class="ses-xref" href="#([^"]*)" data-ref-target="([^"]*)"/g)]
    .map(match => ({ href: match[1]!, target: match[2]! }))
}

describe('renderHtml cross-reference anchors', () => {
  it('screen Resolver labels link to one actual carrier across every supported target path', () => {
    const doc = anchorFixture()
    const { labels, problems } = resolve(doc)
    expect(problems.filter(problem => ['dangling-xref', 'dangling-typed-ref'].includes(problem.code))).toEqual([])

    const sourceBefore = JSON.stringify(doc)
    const html = renderHtml(doc, labels, { variant: 'screen' })
    const ids = attributeValues(html, 'id')
    const links = xrefLinks(html)

    for (const link of links) {
      expect(ids.filter(id => id === link.href), link.target).toHaveLength(1)
    }
    for (const targetId of targetIds) {
      const targetLinks = links.filter(link => link.target === targetId)
      const label = labels[targetId]
      const expectedLinks = label?.xmlId ? (targetKinds[targetId] ? 2 : 1) : 0
      expect(targetLinks.length, targetId).toBe(expectedLinks)
      if (label?.xmlId) expect(targetLinks.every(link => link.href === label.xmlId), targetId).toBe(true)
    }

    // Each paragraph path has an actual carrier in the serialized output.
    for (const id of [
      'mainParagraph', 'noteParagraph', 'exampleParagraph', 'cellParagraph',
      'listParagraph', 'nestedListParagraph', 'termDefinition', 'untitledFirstParagraph',
    ]) {
      expect(ids).toContain(labels[id]?.xmlId)
    }
    expect(ids.filter(id => id === labels.inlineFootnote?.xmlId)).toHaveLength(1)
    expect(ids.filter(id => id === labels.tableFootnote?.xmlId)).toHaveLength(1)
    expect(JSON.stringify(doc)).toBe(sourceBefore)
  })

  it('anchors visible list/item/row/cell/where carriers when the caller supplies Resolver-shaped labels', () => {
    const doc = anchorFixture()
    const { labels: resolved } = resolve(doc)
    const labels: Record<NodeId, ResolvedLabel> = { ...resolved }
    const supplied: Array<[NodeId, string]> = [
      ['list', 'custom_list'],
      ['listItem', 'custom_item'],
      ['nestedList', 'custom_nested_list'],
      ['nestedListItem', 'custom_nested_item'],
      ['tableRow', 'custom_row'],
      ['tableCell', 'custom_cell'],
      ['whereItem', 'custom_where'],
    ]
    for (const [id, xmlId] of supplied) labels[id] = { label: '', xmlId, refText: id }

    const html = renderHtml(doc, labels, { variant: 'screen' })
    const ids = attributeValues(html, 'id')
    for (const [, xmlId] of supplied) expect(ids.filter(id => id === xmlId)).toHaveLength(1)
  })

  it('does not create hrefs for missing/empty labels or unknown targets and preserves resolved text and marks', () => {
    const doc = anchorFixture()
    const { labels: resolved } = resolve(doc)
    const labels: Record<NodeId, ResolvedLabel> = { ...resolved }
    labels.clause = { label: '', xmlId: '', refText: '解析文字' }
    const source = doc.body[0]!
    source.children.push({
      kind: 'paragraph',
      id: 'invalidReferenceSource',
      content: [
        { text: 'source', marks: [{ type: 'crossRef', targetId: 'clause' }, { type: 'italic' }] },
        { text: 'unknown text', marks: [{ type: 'crossRef', targetId: 'unknown-target' }, { type: 'bold' }] },
      ],
    })

    const sourceBefore = JSON.stringify(doc)
    const html = renderHtml(doc, labels, { variant: 'screen' })
    expect(html).toContain('<span class="ses-xref" data-ref-target="clause"><em>解析文字</em></span>')
    expect(html).toContain('<span class="ses-xref" data-ref-target="unknown-target"><strong>unknown text</strong></span>')
    expect(html).not.toContain('href="#"')
    expect(JSON.stringify(doc)).toBe(sourceBefore)
  })

  it('keeps print references as text with no internal links', () => {
    const doc = anchorFixture()
    const sourceBefore = JSON.stringify(doc)
    const { labels } = resolve(doc)
    const html = renderHtml(doc, labels, { variant: 'print' })

    expect(html).not.toMatch(/<a[\s>]/)
    expect(html).toContain('<span class="ses-xref" data-ref-target="clause">')
    expect(JSON.stringify(doc)).toBe(sourceBefore)
  })
})
