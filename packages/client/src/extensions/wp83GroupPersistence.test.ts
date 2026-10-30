import { describe, expect, it } from 'vitest'
import { getOutputSupportProblems, irToPm, pmToIr, resolve, type IRDoc, type PMJsonNode } from '@ses/shared'
import { createEditorSchema } from './editorSchema'
import { Fragment, Slice } from '@tiptap/pm/model'
import { remapPastedSliceIds } from './plugins/ensureNodeId'

describe('WP8.3 组节点保存', () => {
  it('保留组级编号与成员公式的顺序和身份', () => {
    const group = { kind: 'formulaGroup', id: 'group', numbered: true, formulas: [
      { kind: 'formula', id: 'one', latex: 'x', mathml: '<math><mi>x</mi></math>', numbered: false, whereList: [] },
      { kind: 'formula', id: 'two', latex: 'y', mathml: '<math><mi>y</mi></math>', numbered: false, whereList: [] },
    ] }
    const source = { schemaVersion: 1, meta: { standardType: 'gb' }, front: { foreword: [], introduction: [] },
      body: [{ kind: 'chapter', id: 'chapter', secType: 'general', title: [], children: [group] }], appendices: [], bibliography: [] } as unknown as IRDoc
    const schema = createEditorSchema()
    const first = schema.nodeFromJSON(irToPm(source))
    first.check()
    const restored = schema.nodeFromJSON(JSON.parse(JSON.stringify(first.toJSON())))
    restored.check()
    const result = pmToIr(restored.toJSON() as PMJsonNode)
    expect(result.doc.unsupportedContent ?? []).toEqual([])
    expect(result.doc.body[0]!.children[0]).toMatchObject(group)
    expect(schema.nodeFromJSON(irToPm(result.doc)).toJSON()).toEqual(first.toJSON())
    for (const format of ['HTML', 'DOCX', 'XML', 'XML46687'] as const) {
      expect(getOutputSupportProblems(result.doc, format).some(problem => problem.path.includes('children[0]'))).toBe(true)
    }
  })

  it('公式组只占一个编号，成员不改变之后公式的编号', () => {
    const formula = (id: string) => ({ kind: 'formula' as const, id, latex: 'x', numbered: true, whereList: [] })
    const doc: IRDoc = { schemaVersion: 1, meta: { standardType: 'gb' }, front: { foreword: [], introduction: [] },
      body: [{ kind: 'chapter', id: 'c', secType: 'general', title: [], children: [
        { kind: 'formulaGroup', id: 'group', numbered: true, formulas: [formula('one'), formula('two')] }, formula('after'),
      ] }], appendices: [], bibliography: [] }
    const { labels } = resolve(doc)
    expect(labels.group?.xmlId).toBe('formula_1')
    expect(labels.after?.xmlId).toBe('formula_2')
    expect(labels.one).toBeUndefined()
    expect(labels.two).toBeUndefined()
  })

  it('公式引用可指向有编号的公式组', () => {
    const doc: IRDoc = { schemaVersion: 1, meta: { standardType: 'gb' }, front: { foreword: [], introduction: [] },
      body: [{ kind: 'chapter', id: 'c', secType: 'general', title: [], children: [
        { kind: 'paragraph', id: 'p', content: [{ text: '公式', marks: [{ type: 'crossRef', targetId: 'group', targetKind: 'formula' }] }] },
        { kind: 'formulaGroup', id: 'group', numbered: true, formulas: [{ kind: 'formula', id: 'child', latex: 'x', numbered: false, whereList: [] }] },
      ] }], appendices: [], bibliography: [] }
    expect(resolve(doc).problems.filter(problem => problem.severity === 'error')).toEqual([])
  })

  it('两个引用和其后唯一脚注定义按原位保存并共用编号', () => {
    const doc: IRDoc = { schemaVersion: 1, meta: { standardType: 'gb' }, front: { foreword: [], introduction: [] },
      body: [{ kind: 'chapter', id: 'c', secType: 'general', title: [], children: [
        { kind: 'paragraph', id: 'p', content: [
          { text: '甲' }, { text: '', footnoteRef: { targetId: 'fn', refText: '1' } },
          { text: '乙' }, { text: '', footnoteRef: { targetId: 'fn', refText: '1' } },
          { text: '', footnoteDefinition: { id: 'fn', content: [{ text: '脚注内容' }] } },
        ] },
      ] }], appendices: [], bibliography: [] }
    const schema = createEditorSchema()
    const first = schema.nodeFromJSON(irToPm(doc))
    first.check()
    const reopened = schema.nodeFromJSON(JSON.parse(JSON.stringify(first.toJSON())))
    reopened.check()
    const result = pmToIr(reopened.toJSON() as PMJsonNode).doc
    expect(result.body[0]!.children[0]).toEqual(doc.body[0]!.children[0])
    expect(resolve(result).labels.fn?.xmlId).toBe('fn_1')
    expect(resolve(result).problems.filter(problem => problem.severity === 'error')).toEqual([])
    expect(schema.nodeFromJSON(irToPm(result)).toJSON()).toEqual(first.toJSON())
  })

  it('共享脚注拒绝悬空、重复定义和脚注内嵌套', () => {
    const para = { kind: 'paragraph' as const, id: 'p', content: [
      { text: '', footnoteRef: { targetId: 'missing', refText: '1' } },
      { text: '', footnoteRef: { targetId: 'same', refText: '2' } },
      { text: '', footnoteDefinition: { id: 'same', content: [{ text: '第一' }] } },
      { text: '', footnoteDefinition: { id: 'same', content: [{ text: '第二', footnote: { id: 'nested', content: [{ text: '嵌套' }] } }] } },
    ] }
    const doc: IRDoc = { schemaVersion: 1, meta: { standardType: 'gb' }, front: { foreword: [], introduction: [] },
      body: [{ kind: 'chapter', id: 'c', secType: 'general', title: [], children: [para] }], appendices: [], bibliography: [] }
    const problems = resolve(doc).problems
    expect(problems).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'dangling-footnote', severity: 'error' }),
      expect.objectContaining({ code: 'duplicate-id', severity: 'error' }),
      expect.objectContaining({ code: 'invalid-footnote', severity: 'error' }),
    ]))
    expect(() => irToPm(doc)).toThrow()
  })

  it('旧脚注与共享定义不得共用 ID，标题和表格禁止共享脚注', () => {
    const reference = { text: '', footnoteRef: { targetId: 'same', refText: '1' } }
    const doc: IRDoc = { schemaVersion: 1, meta: { standardType: 'gb' }, front: { foreword: [], introduction: [] },
      body: [{ kind: 'chapter', id: 'c', secType: 'general', title: [reference], children: [
        { kind: 'paragraph', id: 'p', content: [{ text: '', footnote: { id: 'same', content: [{ text: '旧' }] } }] },
        { kind: 'table', id: 'table', caption: [], orientation: 'portrait', headerRowCount: 0, notes: [],
          rows: [{ id: 'r', cells: [{ id: 'cell', colspan: 1, rowspan: 1, header: false, content: [
            { kind: 'paragraph', id: 'cp', content: [{ text: '', footnoteDefinition: { id: 'same', content: [{ text: '共享' }] } }] },
          ] }] }] },
      ] }], appendices: [], bibliography: [] }
    const issues = resolve(doc).problems
    expect(issues.filter(issue => issue.code === 'invalid-footnote').length).toBeGreaterThanOrEqual(3)
    expect(issues.some(issue => issue.code === 'duplicate-id' && issue.nodeId === 'same')).toBe(true)
  })

  it('数组网格内的共享脚注按受限网格容器拒绝', () => {
    const doc: IRDoc = { schemaVersion: 1, meta: { standardType: 'gb' }, front: { foreword: [], introduction: [] },
      body: [{ kind: 'chapter', id: 'c', secType: 'general', title: [], children: [
        { kind: 'array', id: 'array', columns: [{}], rows: [{ id: 'r', cells: [{ id: 'cell', colspan: 1, rowspan: 1, header: false, content: [
          { kind: 'paragraph', id: 'p', content: [{ text: '', footnoteRef: { targetId: 'fn', refText: '1' } },
            { text: '', footnoteDefinition: { id: 'fn', content: [{ text: '正文' }] } }] },
        ] }] }] },
      ] }], appendices: [], bibliography: [] }
    expect(resolve(doc).problems.filter(issue => issue.code === 'invalid-footnote').length).toBeGreaterThanOrEqual(2)
  })

  it('复制时共享脚注定义和两个引用一起重映射', () => {
    const schema = createEditorSchema()
    const doc = schema.nodeFromJSON({ type: 'doc', content: [{ type: 'chapter', attrs: { nodeId: 'chapter' }, content: [
      { type: 'chapterTitle' }, { type: 'stdParagraph', attrs: { nodeId: 'p' }, content: [
        { type: 'sharedFootnoteRef', attrs: { targetId: 'fn', refText: '1' } },
        { type: 'sharedFootnoteRef', attrs: { targetId: 'fn', refText: '1' } },
        { type: 'sharedFootnoteDefinition', attrs: { nodeId: 'fn', content: [{ type: 'text', text: '定义' }] } },
      ] },
    ] }] })
    const copied = remapPastedSliceIds(new Slice(Fragment.from(doc.firstChild!), 0, 0), doc).content.firstChild!
    const para = copied.child(1)
    const id = para.child(2).attrs.nodeId
    expect(id).not.toBe('fn')
    expect(para.child(0).attrs.targetId).toBe(id)
    expect(para.child(1).attrs.targetId).toBe(id)
  })

  it('拒绝无题条中丢失的共享脚注及非法定义载荷', () => {
    const pm: PMJsonNode = { type: 'doc', content: [{ type: 'chapter', attrs: { nodeId: 'c' }, content: [
      { type: 'chapterTitle' }, { type: 'clause', attrs: { nodeId: 'clause', titled: false, level: 1 }, content: [
        { type: 'clauseTitle', content: [{ type: 'sharedFootnoteRef', attrs: { targetId: 'fn', refText: '1' } }] },
        { type: 'stdParagraph', attrs: { nodeId: 'p' }, content: [{ type: 'sharedFootnoteDefinition', attrs: {
          nodeId: 'fn', content: [{ type: 'footnoteRef', attrs: { nodeId: 'nested', content: [{ type: 'text', text: 'nested' }] } }],
        } }] },
      ] },
    ] }] }
    const result = pmToIr(pm).doc
    expect(result.unmappedFootnotes?.length).toBeGreaterThan(0)
    expect(resolve(result).problems.some(problem => problem.code === 'invalid-footnote' && problem.severity === 'error')).toBe(true)
  })

  it('缺少引用文字或定义正文的共享脚注不能转换为合法投影', () => {
    const pm: PMJsonNode = { type: 'doc', content: [{ type: 'chapter', attrs: { nodeId: 'c' }, content: [
      { type: 'chapterTitle' }, { type: 'stdParagraph', attrs: { nodeId: 'p' }, content: [
        { type: 'sharedFootnoteRef', attrs: { targetId: 'fn', refText: '' } },
        { type: 'sharedFootnoteDefinition', attrs: { nodeId: 'fn', content: [] } },
      ] },
    ] }] }
    const doc = pmToIr(pm).doc
    expect(resolve(doc).problems.filter(problem => problem.severity === 'error').length).toBeGreaterThan(0)
    expect(() => irToPm(doc)).toThrow()
  })

  it('共享脚注的空正文不能投影为生产文档', () => {
    const doc: IRDoc = { schemaVersion: 1, meta: { standardType: 'gb' }, front: { foreword: [], introduction: [] },
      body: [{ kind: 'chapter', id: 'c', secType: 'general', title: [], children: [
        { kind: 'paragraph', id: 'p', content: [{ text: '', footnoteRef: { targetId: 'fn', refText: '1' } },
          { text: '', footnoteDefinition: { id: 'fn', content: [] } }] },
      ] }], appendices: [], bibliography: [] }
    expect(() => irToPm(doc)).toThrow()
  })

  it('图组保留组图例和各分图的顺序', () => {
    const group = { kind: 'figureSet' as const, id: 'set', legend: { id: 'legend', items: [
      { id: 'item', term: [{ text: 'a' }], definition: [{ text: '说明' }] },
    ] }, figures: [
      { kind: 'figure' as const, id: 'f1', caption: [{ text: '一' }], orientation: 'portrait' as const, src: 'a.png', notes: [] },
      { kind: 'figure' as const, id: 'f2', caption: [{ text: '二' }], orientation: 'portrait' as const, src: 'b.png', notes: [] },
    ] }
    const doc: IRDoc = { schemaVersion: 1, meta: { standardType: 'gb' }, front: { foreword: [], introduction: [] },
      body: [{ kind: 'chapter', id: 'c', secType: 'general', title: [], children: [group] }], appendices: [], bibliography: [] }
    const schema = createEditorSchema()
    const first = schema.nodeFromJSON(irToPm(doc))
    first.check()
    const reopened = schema.nodeFromJSON(JSON.parse(JSON.stringify(first.toJSON())))
    reopened.check()
    const result = pmToIr(reopened.toJSON() as PMJsonNode)
    expect(result.doc.body[0]!.children[0]).toMatchObject(group)
    expect(result.doc.unsupportedContent ?? []).toEqual([])
    expect(resolve(result.doc).labels.f1?.xmlId).toBe('fig_1')
    expect(resolve(result.doc).labels.f2?.xmlId).toBe('fig_2')
    expect(schema.nodeFromJSON(irToPm(result.doc)).toJSON()).toEqual(first.toJSON())
  })

  it('无编号数组保留列组、列属性和网格，后续表编号不受影响', () => {
    const cell = (id: string, value: string) => ({ id, colspan: 1, rowspan: 1, header: false,
      content: [{ kind: 'paragraph' as const, id: `${id}-p`, content: [{ text: value }] }] })
    const array = { kind: 'array' as const, id: 'array', columns: [{ textAlign: 'center' }, {}], columnGroups: [{ start: 0, count: 2 }],
      rows: [{ id: 'row1', cells: [cell('a', '1'), cell('b', '2')] }, { id: 'row2', cells: [cell('c', '3'), cell('d', '4')] }] }
    const table = { kind: 'table' as const, id: 'table', caption: [], orientation: 'portrait' as const, headerRowCount: 0, notes: [],
      rows: [{ id: 'tr', cells: [cell('tc', '表')] }] }
    const doc: IRDoc = { schemaVersion: 1, meta: { standardType: 'gb' }, front: { foreword: [], introduction: [] },
      body: [{ kind: 'chapter', id: 'chapter', secType: 'general', title: [], children: [array, table] }], appendices: [], bibliography: [] }
    const schema = createEditorSchema()
    const first = schema.nodeFromJSON(irToPm(doc))
    first.check()
    const reopened = schema.nodeFromJSON(JSON.parse(JSON.stringify(first.toJSON())))
    reopened.check()
    const result = pmToIr(reopened.toJSON() as PMJsonNode)
    expect(result.doc.body[0]!.children[0]).toMatchObject(array)
    expect(result.doc.unsupportedContent ?? []).toEqual([])
    expect(resolve(result.doc).labels.table?.xmlId).toBe('tab_1')
    expect(schema.nodeFromJSON(irToPm(result.doc)).toJSON()).toEqual(first.toJSON())
  })

  it('非法数组列组和公式组多余节点不会被静默丢弃', () => {
    const pm: PMJsonNode = { type: 'doc', content: [{ type: 'chapter', attrs: { nodeId: 'chapter' }, content: [
      { type: 'chapterTitle' },
      { type: 'alignedArray', attrs: { nodeId: 'array', columns: [{}, {}], columnGroups: [{ start: 1, count: 2 }] }, content: [
        { type: 'table', content: [{ type: 'tableRow', attrs: { nodeId: 'row' }, content: [
          { type: 'tableCell', attrs: { nodeId: 'a' }, content: [{ type: 'paragraph', attrs: { nodeId: 'p1' } }] },
          { type: 'tableCell', attrs: { nodeId: 'b' }, content: [{ type: 'paragraph', attrs: { nodeId: 'p2' } }] },
        ] }] },
      ] },
      { type: 'formulaGroup', attrs: { nodeId: 'group', numbered: true }, content: [
        { type: 'formula', attrs: { nodeId: 'formula', numbered: false }, content: [{ type: 'formulaContent' }] },
        { type: 'stdParagraph', attrs: { nodeId: 'unexpected' }, content: [{ type: 'text', text: '不能丢' }] },
      ] },
    ] }] }
    expect(pmToIr(pm).doc.unsupportedContent).toEqual(expect.arrayContaining([
      expect.objectContaining({ nodeType: 'alignedArray' }), expect.objectContaining({ nodeType: 'stdParagraph' }),
    ]))
  })
})
