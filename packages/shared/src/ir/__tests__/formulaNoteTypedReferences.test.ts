import { describe, expect, it } from 'vitest'
import type { IRDoc, IRFormula, IRInline, IRParagraph, IRTable } from '../types'
import { resolve } from '../resolve'

function formula(id: string, noteId: string, text: string, content: IRInline[] = []): IRFormula {
  return { kind: 'formula', id, latex: 'x = 1', numbered: true, whereList: [], notes: [{ id: noteId, content: [{ text }, ...content] }] }
}

function reference(id: string, targetId: string, targetKind: 'note' | 'figure' | 'chapter' = 'note'): IRParagraph {
  return { kind: 'paragraph', id, content: [{ text: '引用', marks: [{ type: 'crossRef', targetId, targetKind }] }] }
}

function docWithFormulaNotes(): IRDoc {
  const frontFormula = formula('front-formula', 'front-note', '前言注', [
    { text: '指向正文注', marks: [{ type: 'crossRef', targetId: 'body-note', targetKind: 'note' }] },
  ])
  const bodyFormula = formula('body-formula', 'body-note', '正文注', [
    { text: '指向附录注', marks: [{ type: 'crossRef', targetId: 'appendix-note', targetKind: 'note' }] },
  ])
  const cellFormula = formula('cell-formula', 'cell-note', '单元格注', [
    { text: '指向正文注', marks: [{ type: 'crossRef', targetId: 'body-note', targetKind: 'note' }] },
  ])
  const appendixFormula = formula('appendix-formula', 'appendix-note', '附录注', [
    { text: '指向单元格注', marks: [{ type: 'crossRef', targetId: 'cell-note', targetKind: 'note' }] },
  ])
  const table: IRTable = {
    kind: 'table', id: 'table', caption: [], orientation: 'portrait', headerRowCount: 0, notes: [],
    rows: [{ id: 'row', cells: [{ id: 'cell', colspan: 1, rowspan: 1, header: false, content: [cellFormula] }] }],
  }
  return {
    schemaVersion: 1,
    meta: { standardType: 'gb' },
    front: { foreword: [frontFormula], introduction: [] },
    body: [{
      kind: 'chapter', id: 'chapter', secType: 'general', title: [{ text: '正文' }],
      children: [reference('body-ref-before', 'body-note'), reference('body-ref-backward', 'front-note'), bodyFormula, table,
        reference('body-ref-forward', 'appendix-note')],
    }],
    appendices: [{ kind: 'appendix', id: 'appendix', normative: true, title: [], children: [appendixFormula] }],
    bibliography: [],
  }
}


describe('Resolver formula-note typed references', () => {
  it('treats formula notes as note targets across front, body, appendix, and table-cell formulas', () => {
    const doc = docWithFormulaNotes()
    const sourceBefore = JSON.stringify(doc)
    const result = resolve(doc)

    expect(result.problems.filter(problem => problem.severity === 'error')).toEqual([])
    expect(result.bibliographyOrder).toEqual([])
    for (const [id, text] of [
      ['front-note', '前言注指向正文注'],
      ['body-note', '正文注指向附录注'],
      ['cell-note', '单元格注指向正文注'],
      ['appendix-note', '附录注指向单元格注'],
    ]) {
      expect(result.labels[id]).toMatchObject({ label: '', refText: text })
      expect(result.labels[id]?.xmlId).toBeTruthy()
    }
    expect(result.labels['front-note']).toEqual({
      label: '', xmlId: 'ext_66_72_6f_6e_74_2d_6e_6f_74_65', refText: '前言注指向正文注',
    })
    expect(JSON.stringify(doc)).toBe(sourceBefore)

    const reordered: IRDoc = {
      bibliography: doc.bibliography,
      appendices: doc.appendices,
      body: doc.body,
      front: doc.front,
      meta: doc.meta,
      schemaVersion: doc.schemaVersion,
    }
    const reorderedResult = resolve(reordered)
    expect(reorderedResult.labels).toEqual(result.labels)
    expect(reorderedResult.problems).toEqual(result.problems)
    expect(resolve(doc).labels).toEqual(result.labels)
  })

  it('reports a nonexistent formula-note target as dangling-xref on the reference owner', () => {
    const doc = docWithFormulaNotes()
    doc.body[0]!.children.unshift(reference('missing-note-owner', 'absent-note', 'note'))

    const problems = resolve(doc).problems
    expect(problems.filter(problem => problem.code === 'dangling-xref')).toEqual([
      expect.objectContaining({
        nodeId: 'missing-note-owner', severity: 'error',
        message: '交叉引用的目标「absent-note」在文档中不存在',
      }),
    ])
    expect(problems.filter(problem => problem.code === 'dangling-typed-ref')).toEqual([])
  })

  it('reports a wrong expected kind with the original referencing owner', () => {
    const doc = docWithFormulaNotes()
    doc.body[0]!.children.unshift(reference('wrong-owner', 'body-note', 'figure'))

    expect(resolve(doc).problems.filter(problem => problem.code === 'dangling-typed-ref')).toEqual([
      expect.objectContaining({
        nodeId: 'wrong-owner', severity: 'error',
        message: '引用目标「body-note」应为 figure，实际为 note',
      }),
    ])
  })

  it('keeps duplicate and missing formula-note ID diagnostics', () => {
    const duplicateDoc: IRDoc = {
      schemaVersion: 1, meta: { standardType: 'gb' }, front: { foreword: [], introduction: [] },
      body: [{ kind: 'chapter', id: 'chapter', secType: 'general', title: [], children: [
        reference('duplicate-ref', 'duplicate-note'),
        formula('formula-a', 'duplicate-note', '注A'),
        formula('formula-b', 'duplicate-note', '注B'),
      ] }],
      appendices: [], bibliography: [],
    }
    const duplicateProblems = resolve(duplicateDoc).problems
    expect(duplicateProblems.filter(problem => problem.code === 'duplicate-id')).toEqual([
      expect.objectContaining({ nodeId: 'duplicate-note', severity: 'error' }),
    ])
    expect(duplicateProblems.filter(problem => problem.code === 'dangling-typed-ref')).toEqual([])

    const missingDoc: IRDoc = {
      schemaVersion: 1, meta: { standardType: 'gb' }, front: { foreword: [], introduction: [] },
      body: [{ kind: 'chapter', id: 'chapter', secType: 'general', title: [], children: [
        reference('missing-ref', '__missing-1'),
        formula('formula-missing', '__missing-1', '缺失 ID 注'),
      ] }],
      appendices: [], bibliography: [],
    }
    const missingProblems = resolve(missingDoc).problems
    expect(missingProblems.filter(problem => problem.code === 'missing-id')).toEqual([
      expect.objectContaining({ nodeId: '__missing-1', severity: 'error' }),
    ])
    expect(missingProblems.filter(problem => problem.code === 'dangling-typed-ref')).toEqual([])
  })
})
