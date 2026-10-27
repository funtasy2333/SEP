import { describe, expect, it } from 'vitest'
import { IRToPmError, irToPm, type IRToPmOptions } from '../irToPm'
import { pmToIr, type PMJsonNode } from '../pmToIr'
import { resolve } from '../resolve'
import type { IRBlock, IRDoc, IRExample, IRList, IRNote, IRTable, IRTermEntry } from '../types'

function docWithList(list: IRList): IRDoc {
  return {
    schemaVersion: 1,
    meta: { standardType: 'gb' },
    front: { foreword: [], introduction: [] },
    body: [{ kind: 'chapter', id: 'chapter-list', secType: 'general', title: [], children: [list] }],
    appendices: [],
    bibliography: [],
  }
}

function docWithChildren(children: IRDoc['body'][number]['children']): IRDoc {
  return {
    schemaVersion: 1,
    meta: { standardType: 'gb' },
    front: { foreword: [], introduction: [] },
    body: [{ kind: 'chapter', id: 'chapter-owner', secType: 'general', title: [{ text: '正文' }], children }],
    appendices: [],
    bibliography: [],
  }
}

function paragraph(id: string, text: string, targetId?: string): IRBlock {
  return {
    kind: 'paragraph',
    id,
    content: [{
      text,
      ...(targetId ? { marks: [{ type: 'crossRef' as const, targetId, targetKind: 'chapter' as const }] } : {}),
    }],
  }
}

function findNodes(root: PMJsonNode, type: string): PMJsonNode[] {
  return [
    ...(root.type === type ? [root] : []),
    ...(root.content ?? []).flatMap(child => findNodes(child, type)),
  ]
}

function captureIrToPmError(doc: IRDoc, options?: IRToPmOptions): IRToPmError {
  let caught: unknown
  try {
    irToPm(doc, options)
  } catch (error) {
    caught = error
  }
  expect(caught).toBeInstanceOf(IRToPmError)
  return caught as IRToPmError
}

function simpleList(listType: IRList['listType'], level?: IRList['level']): IRList {
  return {
    kind: 'list',
    id: `list-${listType}`,
    listType,
    ...(level === undefined ? {} : { level }),
    items: [{
      id: `item-${listType}`,
      content: [{ kind: 'paragraph', id: `item-${listType}.p0`, content: [{ text: '项' }] }],
    }],
  }
}

describe('irToPm / native IR roundtrip', () => {
  it('preserves multiple term-definition paragraph IDs and an unprefixed typed source', () => {
    const term: IRTermEntry = {
      kind: 'termEntry',
      id: 'term-1',
      level: 1,
      term: [{ text: '术语' }],
      definition: [
        { kind: 'paragraph', id: 'definition-main', content: [{ text: '主定义' }] },
        { kind: 'paragraph', id: 'definition-continuation', content: [{ text: '续行定义' }] },
      ],
      source: [{ text: 'ISO vocabulary, 2026' }],
      notes: [],
      examples: [],
    }
    const authored: IRDoc = {
      schemaVersion: 1,
      extensionVersion: 1,
      meta: { standardType: 'gb' },
      front: { foreword: [], introduction: [] },
      body: [{ kind: 'chapter', id: 'chapter-1', secType: 'terms', title: [{ text: '术语和定义' }], children: [term] }],
      appendices: [],
      bibliography: [],
    }

    const pm = irToPm(authored)
    const termPm = pm.content?.[0]?.content?.[1]
    expect(termPm?.content?.filter(child => child.type === 'termDefinition' || child.type === 'stdParagraph' || child.type === 'termSource')).toEqual([
      { type: 'termDefinition', attrs: { nodeId: 'definition-main' }, content: [{ type: 'text', text: '主定义' }] },
      { type: 'stdParagraph', attrs: { nodeId: 'definition-continuation' }, content: [{ type: 'text', text: '续行定义' }] },
      { type: 'termSource', content: [{ type: 'text', text: 'ISO vocabulary, 2026' }] },
    ])

    const reopened = pmToIr(pm).doc.body[0].children[0] as IRTermEntry
    expect(reopened).toEqual(term)
  })

  it('roundtrips a standard-list paragraph only when its ID matches the production-derived ID', () => {
    const list = simpleList('dash')
    const doc = docWithList(list)
    const pm = irToPm(doc)
    const stdList = pm.content?.[0]?.content?.[1]

    expect(stdList?.type).toBe('stdList')
    expect(pmToIr(pm).doc.body[0]?.children[0]).toEqual(list)

    const mismatched = simpleList('dash')
    mismatched.items[0]!.content[0]!.id = 'authored-paragraph-id'
    const error = captureIrToPmError(docWithList(mismatched))
    expect(error.diagnostics).toContainEqual(expect.objectContaining({
      path: 'body[0][0].items[0].content[0]',
      nodeId: 'authored-paragraph-id',
      reason: expect.stringContaining('无法保留'),
    }))
  })

  // WP8.M G7-a：原用例断言「roman 与 romanUpper 都被拒绝（不静默转数字）」；M-5.7-04 起 roman 往返成功，仅 romanUpper 仍被拒绝。
  it('[M-5.7-04] roman 列项投影为 stdList(listType=roman) 并往返；romanUpper 仍被拒绝而不是静默转成数字', () => {
    const roman = simpleList('roman')
    const pm = irToPm(docWithList(roman))
    const stdList = findNodes(pm, 'stdList')[0]!
    expect(stdList.attrs).toMatchObject({ listType: 'roman', level: 1 })
    expect(pm.attrs?.extensionVersion).toBe(1)
    expect(pmToIr(pm).doc.body[0]?.children[0]).toEqual(roman)

    const error = captureIrToPmError(docWithList(simpleList('romanUpper')))
    expect(error.diagnostics).toContainEqual(expect.objectContaining({
      path: 'body[0][0].listType',
      nodeId: 'list-romanUpper',
      reason: expect.stringContaining('不支持'),
    }))
  })

  it('rejects explicit levels that conflict with production list levels', () => {
    const mismatches: Array<[IRList['listType'], NonNullable<IRList['level']>]> = [
      ['number', 1],
      ['dot', 1],
      ['dash', 2],
      ['alpha', 2],
      ['boxed', 2],
    ]

    for (const [listType, level] of mismatches) {
      const error = captureIrToPmError(docWithList(simpleList(listType, level)))
      expect(error.diagnostics).toContainEqual(expect.objectContaining({
        path: 'body[0][0].level',
        nodeId: `list-${listType}`,
        reason: expect.stringContaining('固定为'),
      }))
    }
  })

  it('checks level consistency inside the nested StarterList branch', () => {
    const nested: IRList = {
      kind: 'list',
      id: 'nested-number-list',
      listType: 'number',
      level: 1,
      items: [{
        id: 'nested-item',
        content: [
          { kind: 'paragraph', id: 'nested-paragraph-1', content: [{ text: '第一段' }] },
          { kind: 'paragraph', id: 'nested-paragraph-2', content: [{ text: '第二段' }] },
        ],
      }],
    }
    const outer: IRList = {
      kind: 'list',
      id: 'outer-dash-list',
      listType: 'dash',
      items: [{
        id: 'outer-item',
        content: [
          { kind: 'paragraph', id: 'outer-item.p0', content: [{ text: '外层' }] },
          nested,
        ],
      }],
    }

    const error = captureIrToPmError(docWithList(outer))
    expect(error.diagnostics).toContainEqual(expect.objectContaining({
      path: 'body[0][0].outer-item[1].level',
      nodeId: 'nested-number-list',
      reason: expect.stringContaining('固定为 2 级'),
    }))
  })

  it('preserves derived paragraph IDs for every note/example inline owner and retains cross-references', () => {
    const blockNote: IRNote = { kind: 'note', id: 'block-note', content: [paragraph('block-note.p0', '注释', 'chapter-target')] }
    const blockExample: IRExample = { kind: 'example', id: 'block-example', content: [paragraph('block-example.p0', '示例')] }
    const termNote: IRNote = { kind: 'note', id: 'term-note', content: [paragraph('term-note.p0', '术语注')] }
    const termExample: IRExample = { kind: 'example', id: 'term-example', content: [paragraph('term-example.p0', '术语示例')] }
    const term: IRTermEntry = {
      kind: 'termEntry',
      id: 'term-owner',
      term: [{ text: '术语' }],
      definition: [paragraph('term-owner.def0', '定义')],
      notes: [termNote],
      examples: [termExample],
    }
    const tableNote: IRNote = { kind: 'note', id: 'table-note', content: [paragraph('table-note.p0', '表注')] }
    const table: IRTable = {
      kind: 'table',
      id: 'table-owner',
      caption: [{ text: '表题' }],
      orientation: 'portrait',
      headerRowCount: 0,
      rows: [{ id: 'table-row', cells: [{
        id: 'table-cell', colspan: 1, rowspan: 1, header: false, content: [paragraph('table-cell.p0', '单元格')],
      }] }],
      notes: [tableNote],
    }
    const warning = {
      kind: 'warning' as const,
      id: 'warning-owner',
      content: [paragraph('warning-paragraph', '警告段落')],
    }
    const authored = docWithChildren([
      blockNote,
      blockExample,
      term,
      table,
      warning,
      { kind: 'paragraph', id: 'target-paragraph', content: [{ text: '见注段落', marks: [{ type: 'crossRef', targetId: 'block-note.p0', targetKind: 'paragraph' }] }] },
    ])
    authored.body.push({ kind: 'chapter', id: 'chapter-target', secType: 'general', title: [{ text: '引用目标' }], children: [paragraph('target-body', '目标')] })

    const reopened = pmToIr(irToPm(authored)).doc
    const children = reopened.body[0]!.children
    expect((children[0] as IRNote).content[0]?.id).toBe('block-note.p0')
    expect((children[1] as IRExample).content[0]?.id).toBe('block-example.p0')
    expect((children[2] as IRTermEntry).notes[0]?.content[0]?.id).toBe('term-note.p0')
    expect((children[2] as IRTermEntry).examples[0]?.content[0]?.id).toBe('term-example.p0')
    expect((children[3] as IRTable).notes[0]?.content[0]?.id).toBe('table-note.p0')
    expect((children[4] as Extract<IRBlock, { kind: 'warning' }>).content[0]?.id).toBe('warning-paragraph')

    expect(resolve(reopened).problems.filter(problem => problem.severity === 'error')).toEqual([])
  })

  // WP8.M G7-b：原用例断言「块位置、术语条目、表注 5 个调用点遇到非派生段落 id 都拒绝」。块位置的注/示例现在有承载
  // 节点（noteBlock/exampleBlock，段落 id 取自 stdParagraph.nodeId），不再需要把段落压平成行内内容，因而不再拒绝（见下一用例）；
  // 仍压平为旧单段 note/example 的 3 个调用点（术语条目的注、示例，表注）继续拒绝，断言不变。
  it('rejects non-derived paragraph IDs at every note/example flattening callsite', () => {
    const cases: Array<{ path: string; makeDoc: (paragraphId: string) => IRDoc }> = [
      {
        path: 'body[0][0].notes.term-note.content[0]',
        makeDoc: paragraphId => docWithChildren([{
          kind: 'termEntry', id: 'term-owner', term: [{ text: '术语' }],
          definition: [paragraph('term-owner.def0', '定义')],
          notes: [{ kind: 'note', id: 'term-note', content: [paragraph(paragraphId, '注')] }], examples: [],
        }]),
      },
      {
        path: 'body[0][0].examples.term-example.content[0]',
        makeDoc: paragraphId => docWithChildren([{
          kind: 'termEntry', id: 'term-owner', term: [{ text: '术语' }],
          definition: [paragraph('term-owner.def0', '定义')], notes: [],
          examples: [{ kind: 'example', id: 'term-example', content: [paragraph(paragraphId, '示例')] }],
        }]),
      },
      {
        path: 'body[0][0].notes.table-note.content[0]',
        makeDoc: paragraphId => docWithChildren([{
          kind: 'table', id: 'table-owner', caption: [], orientation: 'portrait', headerRowCount: 0, rows: [],
          notes: [{ kind: 'note', id: 'table-note', content: [paragraph(paragraphId, '表注')] }],
        }]),
      },
    ]

    for (const testCase of cases) {
      const paragraphId = 'authored-paragraph-id'
      const error = captureIrToPmError(testCase.makeDoc(paragraphId))
      expect(error.diagnostics).toContainEqual(expect.objectContaining({
        path: testCase.path,
        nodeId: paragraphId,
        reason: expect.stringContaining('无法保留'),
      }))
    }
  })

  it('[M-5.6-05] 块位置的注/示例：单个非派生 id 的段落投影为 noteBlock/exampleBlock 并保留段落 id（不再拒绝）', () => {
    const doc = docWithChildren([
      { kind: 'note', id: 'block-note', content: [paragraph('authored-note-p', '注')] },
      { kind: 'example', id: 'block-example', content: [paragraph('authored-example-p', '示例')] },
      // 派生 id 的单段仍是旧 note/example（输出与此前逐字节相同）
      { kind: 'note', id: 'legacy-note', content: [paragraph('legacy-note.p0', '旧注')] },
    ])
    const pm = irToPm(doc)
    const chapter = pm.content!.find(node => node.type === 'chapter')!
    expect(chapter.content!.slice(1).map(node => node.type)).toEqual(['noteBlock', 'exampleBlock', 'note'])
    expect(findNodes(pm, 'noteBlock')[0]!.content![0]).toMatchObject({ type: 'stdParagraph', attrs: { nodeId: 'authored-note-p' } })
    expect(findNodes(pm, 'note')[0]!.content).toEqual([{ type: 'text', text: '旧注' }])
    expect(pmToIr(pm).doc.body[0]!.children).toEqual(doc.body[0]!.children)
  })

  it('projects table-footnote references as atoms while retaining other text/formula marks', () => {
    const table: IRTable = {
      kind: 'table',
      id: 'footnote-table',
      caption: [],
      orientation: 'portrait',
      headerRowCount: 0,
      rows: [{ id: 'footnote-row', cells: [{
        id: 'footnote-cell', colspan: 1, rowspan: 1, header: false,
        content: [{
          kind: 'paragraph',
          id: 'footnote-paragraph',
          content: [
            { text: '加粗文字', marks: [
              { type: 'bold' },
              { type: 'tableFootnoteRef', id: 'text-ref', targetId: 'table-footnote' },
            ] },
            { text: '', formula: { id: 'inline-formula', latex: 'x' }, marks: [
              { type: 'italic' },
              { type: 'tableFootnoteRef', id: 'formula-ref', targetId: 'table-footnote' },
            ] },
          ],
        }],
      }] }],
      notes: [],
      footnotes: [{ id: 'table-footnote', content: [{ text: '表脚注内容' }] }],
    }
    const pm = irToPm(docWithChildren([table]))
    const textNode = findNodes(pm, 'text').find(item => item.text === '加粗文字')!
    const formulaNode = findNodes(pm, 'formulaInline')[0]!
    const refs = findNodes(pm, 'tableFootnoteRef')

    expect(textNode.marks).toEqual([{ type: 'bold' }])
    expect(formulaNode.marks).toEqual([{ type: 'italic' }])
    expect(refs.map(ref => ref.attrs)).toEqual([
      { nodeId: 'text-ref', targetId: 'table-footnote' },
      { nodeId: 'formula-ref', targetId: 'table-footnote' },
    ])

    const reopenedTable = pmToIr(pm).doc.body[0]!.children[0] as IRTable
    expect(reopenedTable.rows[0]!.cells[0]!.content[0]).toMatchObject({
      kind: 'paragraph',
      content: [
        { text: '加粗文字', marks: [{ type: 'bold' }] },
        { text: '', marks: [{ type: 'tableFootnoteRef', id: 'text-ref', targetId: 'table-footnote' }] },
        { text: '', formula: { id: 'inline-formula', latex: 'x' }, marks: [{ type: 'italic' }] },
        { text: '', marks: [{ type: 'tableFootnoteRef', id: 'formula-ref', targetId: 'table-footnote' }] },
      ],
    })
  })

  it('rejects empty warning and quote nodes without dropping existing diagnostics', () => {
    const doc = docWithChildren([
      { kind: 'warning', id: 'empty-warning', content: [] },
      { kind: 'quote', id: 'empty-quote', content: [] },
    ])
    doc.unsupportedContent = [{ nodeId: 'future-node', path: 'chapter.future', nodeType: 'futureNode', reason: 'unsupported' }]

    const error = captureIrToPmError(doc)
    expect(error.diagnostics).toContainEqual(expect.objectContaining({
      path: 'body[0][0]',
      nodeId: 'empty-warning',
      reason: expect.stringContaining('至少一个块'),
    }))
    expect(error.diagnostics).toContainEqual(expect.objectContaining({
      path: 'body[0][1]',
      nodeId: 'empty-quote',
      reason: expect.stringContaining('至少一个块'),
    }))
    expect(error.diagnostics).toContainEqual(expect.objectContaining({
      path: 'chapter.future',
      nodeId: 'future-node',
      reason: expect.stringContaining('futureNode'),
    }))
  })

  it('rejects all empty PM containers with their source paths and IDs while aggregating diagnostics', () => {
    const nestedList: IRList = {
      kind: 'list', id: 'nested-first-block', listType: 'dash',
      items: [{ id: 'nested-first-item', content: [{ kind: 'paragraph', id: 'nested-first-item.p0', content: [{ text: '嵌套项' }] }] }],
    }
    const starterList: IRList = {
      kind: 'list', id: 'starter-list', listType: 'dash',
      items: [
        { id: 'starter-empty-item', content: [] },
        { id: 'starter-first-nested', content: [nestedList] },
      ],
    }
    const emptyList: IRList = { kind: 'list', id: 'empty-list', listType: 'alpha', items: [] }
    const tableBase = (id: string, rows: IRTable['rows']): IRTable => ({
      kind: 'table', id, caption: [], orientation: 'portrait', headerRowCount: 0, rows, notes: [],
    })
    const term: IRTermEntry = {
      kind: 'termEntry', id: 'tbx-owner', term: [{ text: '术语' }],
      definition: [paragraph('tbx-definition', '定义')], notes: [], examples: [],
      languageSets: [
        { id: 'empty-language-set', language: 'en', groups: [] },
        { id: 'language-set-with-empty-tig', language: 'en', groups: [{ id: 'empty-tig', terms: [] }] },
      ],
    }
    const doc = docWithChildren([
      emptyList,
      starterList,
      tableBase('empty-rows-table', []),
      tableBase('empty-cells-table', [{ id: 'empty-cells-row', cells: [] }]),
      tableBase('empty-cell-content-table', [{ id: 'row-with-empty-cell', cells: [{
        id: 'empty-cell', colspan: 1, rowspan: 1, header: false, content: [],
      }] }]),
      term,
    ])
    doc.index = { id: 'index-root', groups: [{ id: 'empty-index-group', entries: [] }] }
    doc.unsupportedContent = [{ nodeId: 'prior-diagnostic', path: 'unsupported.previous', nodeType: 'future', reason: 'kept' }]

    const error = captureIrToPmError(doc)
    const diagnostics = [
      ['body[0][0].items', 'empty-list'],
      ['body[0][1].items[0].content[0]', 'starter-empty-item'],
      ['body[0][1].items[1].content[0]', 'nested-first-block'],
      ['body[0][2].rows', 'empty-rows-table'],
      ['body[0][3].rows[0].cells', 'empty-cells-row'],
      ['body[0][4].rows[0].cells[0].content', 'empty-cell'],
      ['body[0][5].languageSets[0].groups', 'empty-language-set'],
      ['body[0][5].languageSets[1].groups[0].terms', 'empty-tig'],
      ['index.groups[0].entries', 'empty-index-group'],
      ['unsupported.previous', 'prior-diagnostic'],
    ] as const
    for (const [path, nodeId] of diagnostics) {
      expect(error.diagnostics).toContainEqual(expect.objectContaining({ path, nodeId }))
    }
  })

  it('allows an empty first paragraph when a StarterKit list item has a first block', () => {
    const list: IRList = {
      kind: 'list', id: 'starter-empty-paragraph-list', listType: 'dash',
      items: [{
        id: 'starter-empty-paragraph-item',
        content: [
          { kind: 'paragraph', id: 'starter-empty-paragraph-item.empty', content: [] },
          { kind: 'paragraph', id: 'starter-empty-paragraph-item.p1', content: [{ text: '后续段落' }] },
        ],
      }],
    }

    const pm = irToPm(docWithList(list))
    const item = findNodes(pm, 'listItem')[0]!
    expect(item.content?.[0]).toEqual({ type: 'paragraph', attrs: { nodeId: 'starter-empty-paragraph-item.empty' }, content: [] })
    expect(pmToIr(pm).doc.body[0]!.children[0]).toEqual(list)
  })

  it('projects each IR standardType onto both standardDoc root and cover from one mapping', () => {
    const mappings = [
      ['gb', 'national'],
      ['industry', 'industry'],
      ['local', 'local'],
      ['group', 'group'],
      ['enterprise', 'enterprise'],
      ['guide', 'guidance'],
    ] as const
    for (const [standardType, expectedPmType] of mappings) {
      const authored = docWithChildren([])
      authored.meta.standardType = standardType
      const projected = irToPm(authored, { rootType: 'standardDoc' })
      const cover = projected.content?.find(child => child.type === 'coverPage')

      expect(projected.type).toBe('standardDoc')
      expect(projected.attrs?.standardType).toBe(expectedPmType)
      expect(cover?.attrs?.standardType).toBe(expectedPmType)
    }
  })

  it('keeps standardType on coverPage for the default doc root', () => {
    const authored = docWithChildren([])
    authored.meta.standardType = 'industry'
    const projected = irToPm(authored)
    const cover = projected.content?.find(child => child.type === 'coverPage')

    expect(projected.type).toBe('doc')
    expect(projected.attrs?.standardType).toBeUndefined()
    expect(cover?.attrs?.standardType).toBe('industry')
  })

  it('rejects empty roots and standardDoc roots without chapters', () => {
    const emptyDoc: IRDoc = {
      schemaVersion: 1, meta: { standardType: 'gb' },
      front: { foreword: [], introduction: [] }, body: [], appendices: [], bibliography: [],
    }
    const docRootError = captureIrToPmError(emptyDoc)
    expect(docRootError.diagnostics).toContainEqual(expect.objectContaining({
      path: 'doc.content',
      reason: expect.stringContaining('至少需要一个内容节点'),
    }))

    const standardDocError = captureIrToPmError(emptyDoc, { rootType: 'standardDoc' })
    expect(standardDocError.diagnostics).toContainEqual(expect.objectContaining({
      path: 'body',
      reason: expect.stringContaining('至少需要一个chapter'),
    }))
  })
})

it.each(['different', ''])('rejects conflicting native formula source text %j before projecting an IR document', sourceText => {
  const input = docWithChildren([{ kind: 'formula', id: 'conflicting-formula', latex: 'x=1', numbered: true,
    sourceInlines: sourceText ? [{ text: sourceText, marks: [{ type: 'bold' }] }] : [], whereList: [],
  }])
  const before = JSON.stringify(input)
  expect(() => irToPm(input)).toThrow(IRToPmError)
  try {
    irToPm(input)
  } catch (error) {
    expect((error as IRToPmError).diagnostics).toContainEqual(expect.objectContaining({
      nodeId: 'conflicting-formula', path: expect.stringContaining('sourceInlines'),
    }))
  }
  expect(JSON.stringify(input)).toBe(before)
})
