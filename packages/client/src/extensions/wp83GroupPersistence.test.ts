import { describe, expect, it } from 'vitest'
import { exportXml46687, getOutputSupportProblems, irToPm, pmToIr, resolve, type IRDoc, type PMJsonNode } from '@ses/shared'
import { createEditorSchema } from './editorSchema'
import { completeMeta } from '../../../shared/src/renderers/__tests__/xml46687Kit'
import { stubOptions } from '../../../shared/src/renderers/__tests__/xml46687StubKit'
import { Fragment, Slice } from '@tiptap/pm/model'
import { remapPastedSliceIds } from './plugins/ensureNodeId'

describe('WP8.3 组节点保存', () => {
  it('保留组级编号与成员公式的顺序和身份', () => {
    const group = { kind: 'formulaGroup', id: 'group', numbered: true, formulas: [
      { kind: 'formula', id: 'one', latex: 'x', mathml: '<mml:math><mml:mi>x</mml:mi></mml:math>', numbered: false, whereList: [] },
      { kind: 'formula', id: 'two', latex: 'y', mathml: '<mml:math><mml:mi>y</mml:mi></mml:math>', numbered: false, whereList: [] },
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
    for (const format of ['HTML', 'DOCX', 'XML'] as const) {
      expect(getOutputSupportProblems(result.doc, format).some(problem => problem.path.includes('children[0]'))).toBe(true)
    }
    const outputDoc = { ...result.doc, meta: completeMeta(), body: result.doc.body.map(chapter => ({ ...chapter, secType: 'scope' as const, title: [{ text: '范围' }] })) }
    const exported = exportXml46687(outputDoc, resolve(outputDoc).labels, stubOptions(outputDoc))
    expect(exported.problems.filter(problem => problem.severity === 'error')).toEqual([])
    const xml = exported.xml!.replace(/>\s+</g, '><')
    expect(xml).toContain('<disp-formula-group id="formula_1"><label>(1)</label><disp-formula><mml:math id="mml_m1" display="block"><mml:mi>x</mml:mi></mml:math></disp-formula><disp-formula><mml:math id="mml_m2" display="block"><mml:mi>y</mml:mi></mml:math></disp-formula></disp-formula-group>')
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
    const outputDoc = { ...result, meta: completeMeta(), body: result.body.map(chapter => ({ ...chapter, secType: 'scope' as const, title: [{ text: '范围' }] })) }
    const exported = exportXml46687(outputDoc, resolve(outputDoc).labels, stubOptions(outputDoc))
    expect(exported.problems.filter(problem => problem.severity === 'error')).toEqual([])
    const xml = exported.xml!.replace(/>\s+</g, '><')
    expect(xml.match(/<xref ref-type="fn" rid="fn_1">1<\/xref>/g)).toHaveLength(2)
    expect(xml.match(/<fn id="fn_1">/g)).toHaveLength(1)
    expect(xml.indexOf('<fn id="fn_1">')).toBeGreaterThan(xml.lastIndexOf('rid="fn_1"'))
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

  it('生产 Schema 拒绝嵌套脚注的定义载荷', () => {
    const schema = createEditorSchema()
    const pm: PMJsonNode = { type: 'doc', content: [{ type: 'chapter', attrs: { nodeId: 'c' }, content: [
      { type: 'chapterTitle' }, { type: 'stdParagraph', attrs: { nodeId: 'p' }, content: [
        { type: 'sharedFootnoteDefinition', attrs: { nodeId: 'fn', content: [
          { type: 'footnoteRef', attrs: { nodeId: 'nested', content: [{ type: 'text', text: '正文' }] } },
        ] } },
      ] },
    ] }] }
    expect(() => schema.nodeFromJSON(pm).check()).toThrow()
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
    const outputDoc = { ...result.doc, meta: completeMeta(), body: result.doc.body.map(chapter => ({ ...chapter, secType: 'scope' as const, title: [{ text: '范围' }] })) }
    const options = stubOptions(outputDoc)
    const exported = exportXml46687(outputDoc, resolve(outputDoc).labels, options)
    expect(exported.problems.filter(problem => problem.severity === 'error')).toEqual([])
    const xml = exported.xml!.replace(/>\s+</g, '><')
    expect(xml).toContain('<fig-group><legend><def-list list-content="figure"><def-item><term>a</term><def><p>说明</p></def></def-item></def-list></legend><fig id="fig_1">')
    expect(xml).toContain('<fig id="fig_2">')
    expect(options.resources.entries.map(({ href, key }) => ({ href, key }))).toEqual([{ href: 'fig_1', key: 'a.png' }, { href: 'fig_2', key: 'b.png' }])
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
    const outputDoc = { ...result.doc, meta: completeMeta(), body: result.doc.body.map(chapter => ({ ...chapter, secType: 'scope' as const, title: [{ text: '范围' }] })) }
    const exported = exportXml46687(outputDoc, resolve(outputDoc).labels, stubOptions(outputDoc))
    expect(exported.problems.filter(problem => problem.severity === 'error')).toEqual([])
    const xml = exported.xml!.replace(/>\s+</g, '><')
    expect(xml).toMatch(/<array><table><colgroup><col[^>]*\/><col[^>]*\/><\/colgroup><tbody><tr>.*?<\/tr><tr>.*?<\/tr><\/tbody><\/table><\/array>/)
    expect(xml).toContain('<table-wrap id="tab_1">')
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

  it('生产 Schema 拒绝非布尔的公式组编号和畸形列组', () => {
    const schema = createEditorSchema()
    const group = { type: 'doc', content: [{ type: 'chapter', attrs: { nodeId: 'c' }, content: [
      { type: 'chapterTitle' }, { type: 'formulaGroup', attrs: { nodeId: 'g', numbered: 'yes' }, content: [
        { type: 'formula', attrs: { nodeId: 'f' }, content: [{ type: 'formulaContent' }] },
      ] },
    ] }] }
    const array = { type: 'doc', content: [{ type: 'chapter', attrs: { nodeId: 'c' }, content: [
      { type: 'chapterTitle' }, { type: 'alignedArray', attrs: { nodeId: 'a', columns: [{}], columnGroups: [{ start: -1, count: 1 }] }, content: [
        { type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableCell', content: [{ type: 'paragraph' }] }] }] },
      ] },
    ] }] }
    expect(() => schema.nodeFromJSON(group).check()).toThrow()
    expect(() => schema.nodeFromJSON(array).check()).toThrow()
  })
})
