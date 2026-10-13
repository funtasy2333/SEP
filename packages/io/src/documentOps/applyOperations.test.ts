import { describe, expect, it } from 'vitest'
import { pmToIr, resolve, type PMJsonNode } from '@ses/shared'
import { applyDocumentOperations } from './apply'
import { buildOutline } from './outline'
import { parseDocumentOperations } from './operations'
import { readNode } from './readNode'
import {
  appendix, bibEntry, bibliography, chapter, clause, clone, deepFreeze, doc, foreword, introduction, node,
  para, PNG, richDocument, rootTypes, seqIds, smallDocument, termDef, text,
} from './testFixtures'
import type {
  ApplyDocumentOperationsOptions, ApplyDocumentOperationsSuccess, DocumentOperationIssue,
} from './types'

/** 成功时返回结果，失败时把问题连同输入抛出，便于定位。 */
function ok(source: PMJsonNode, operations: unknown, options: ApplyDocumentOperationsOptions = { generateId: seqIds() }): ApplyDocumentOperationsSuccess {
  const result = applyDocumentOperations(deepFreeze(clone(source)), operations, { generateId: seqIds(), ...options })
  if (!result.ok) throw new Error(JSON.stringify(result.issues, null, 2))
  return result
}

function failure(source: PMJsonNode, operations: unknown, options: ApplyDocumentOperationsOptions = {}): DocumentOperationIssue[] {
  const result = applyDocumentOperations(deepFreeze(clone(source)), operations, { generateId: seqIds(), ...options })
  if (result.ok) throw new Error('预期失败，实际成功')
  return result.issues
}

const types = (nodes: PMJsonNode[] | undefined): string[] => (nodes ?? []).map(child => child.type)
const ids = (nodes: PMJsonNode[] | undefined): (unknown)[] => (nodes ?? []).map(child => child.attrs?.nodeId)
const byId = (pm: PMJsonNode, id: string): PMJsonNode | undefined => {
  if (pm.attrs?.nodeId === id) return pm
  for (const child of pm.content ?? []) {
    const found = byId(child, id)
    if (found) return found
  }
  return undefined
}
const textOf = (pm: PMJsonNode | undefined): string =>
  !pm ? '' : pm.text ?? (pm.content ?? []).map(textOf).join('')
const labelOf = (pm: PMJsonNode, id: string): string | undefined => {
  const { doc: ir } = pmToIr(pm)
  return resolve(ir).labels[id]?.label
}

describe('操作的结构校验', () => {
  it('operations 必须是非空数组', () => {
    expect(failure(smallDocument(), { op: 'delete', nodeId: 'p-1' })).toEqual([
      { path: 'operations', code: 'invalid-operations', reason: expect.stringContaining('数组') },
    ])
    expect(failure(smallDocument(), [])[0]).toMatchObject({ path: 'operations', code: 'invalid-operations' })
    expect(failure(smallDocument(), undefined)[0]).toMatchObject({ code: 'invalid-operations' })
  })

  it('未知操作、缺少 op、非对象', () => {
    const issues = failure(smallDocument(), [{ op: 'remove', nodeId: 'p-1' }, { nodeId: 'p-1' }, 'delete'])
    expect(issues).toEqual([
      expect.objectContaining({ operationIndex: 0, path: 'operations[0].op', code: 'unknown-operation' }),
      expect.objectContaining({ operationIndex: 1, path: 'operations[1].op', code: 'missing-field' }),
      expect.objectContaining({ operationIndex: 2, path: 'operations[2]', code: 'invalid-type' }),
    ])
    expect(issues[0]!.reason).toContain('insert、replace、delete、move')
  })

  it('未知字段报错并给出支持的字段（防止拼写错误被静默忽略）', () => {
    const issues = failure(smallDocument(), [
      { op: 'delete', nodeId: 'p-1', recursive: true },
      { op: 'insert', parent: 'body', position: 'end', contnet: [] },
    ])
    expect(issues.map(item => [item.operationIndex, item.path, item.code])).toEqual([
      [0, 'operations[0].recursive', 'unknown-field'],
      [1, 'operations[1].contnet', 'unknown-field'],
      [1, 'operations[1].content', 'missing-field'],
    ])
    expect(issues[0]!.reason).toContain('nodeId')
  })

  it('缺字段与类型错误一次报全', () => {
    const issues = failure(smallDocument(), [
      { op: 'insert' },
      { op: 'replace', nodeId: 7 },
      { op: 'move', nodeId: 'p-1', parent: 'body', position: { before: 'a', after: 'b' } },
      { op: 'insert', parent: 'body', position: { before: '' }, content: [] },
      { op: 'insert', parent: 'body', position: 'middle', content: [] },
    ])
    expect(issues.map(item => [item.path, item.code])).toEqual([
      ['operations[0].parent', 'missing-field'],
      ['operations[0].position', 'missing-field'],
      ['operations[0].content', 'missing-field'],
      ['operations[1].nodeId', 'invalid-type'],
      ['operations[1].content', 'missing-field'],
      ['operations[2].position', 'invalid-value'],
      ['operations[3].position.before', 'invalid-type'],
      ['operations[4].position', 'invalid-value'],
    ])
  })

  it('parseDocumentOperations 只做结构校验并返回类型化操作', () => {
    const parsed = parseDocumentOperations([{ op: 'delete', nodeId: 'a' }, { op: 'move', nodeId: 'b', parent: 'body', position: { after: 'c' } }])
    expect(parsed).toEqual({
      ok: true,
      operations: [{ op: 'delete', nodeId: 'a' }, { op: 'move', nodeId: 'b', parent: 'body', position: { after: 'c' } }],
    })
    expect(parseDocumentOperations([{ op: 'delete' }]).ok).toBe(false)
  })

  it('acceptLoss 只能是布尔值，且只允许出现在 replace 上', () => {
    const issues = failure(smallDocument(), [
      { op: 'replace', nodeId: 'p-1', content: ['x'], acceptLoss: 'yes' },
      { op: 'replace', nodeId: 'p-1', content: ['x'], acceptLoss: 1 },
      { op: 'delete', nodeId: 'p-1', acceptLoss: true },
      { op: 'insert', parent: 'body', position: 'end', content: [], acceptLoss: true },
      { op: 'move', nodeId: 'p-1', parent: 'body', position: 'end', acceptLoss: false },
    ])
    expect(issues.map(item => [item.operationIndex, item.path, item.code])).toEqual([
      [0, 'operations[0].acceptLoss', 'invalid-type'],
      [1, 'operations[1].acceptLoss', 'invalid-type'],
      [2, 'operations[2].acceptLoss', 'unknown-field'],
      [3, 'operations[3].acceptLoss', 'unknown-field'],
      [4, 'operations[4].acceptLoss', 'unknown-field'],
    ])
    expect(issues[2]!.reason).toContain('只能用于 replace')
    expect(parseDocumentOperations([{ op: 'replace', nodeId: 'a', content: ['x'], acceptLoss: true }])).toEqual({
      ok: true, operations: [{ op: 'replace', nodeId: 'a', content: ['x'], acceptLoss: true }],
    })
    expect(parseDocumentOperations([{ op: 'replace', nodeId: 'a', content: ['x'] }])).toEqual({
      ok: true, operations: [{ op: 'replace', nodeId: 'a', content: ['x'] }],
    })
  })

  it('入参文档必须是 doc 根节点', () => {
    const result = applyDocumentOperations({ type: 'paragraph' }, [{ op: 'delete', nodeId: 'x' }])
    expect(result).toEqual({ ok: false, issues: [expect.objectContaining({ code: 'invalid-document' })] })
  })
})

describe('insert：位置', () => {
  const source = richDocument()

  it('章的 start 在标题节点之后，end 在末尾，before/after 相对直接子节点', () => {
    const result = ok(source, [
      { op: 'insert', parent: 'ch-refs', position: 'start', content: ['开头段'] },
      { op: 'insert', parent: 'ch-refs', position: 'end', content: ['末尾段'] },
      { op: 'insert', parent: 'ch-refs', position: { before: 'refs-p1' }, content: ['之前段'] },
      { op: 'insert', parent: 'ch-refs', position: { after: 'refs-p1' }, content: ['之后段'] },
    ])
    const chapterNode = byId(result.doc, 'ch-refs')!
    expect(types(chapterNode.content)).toEqual(['chapterTitle', 'stdParagraph', 'stdParagraph', 'stdParagraph', 'stdParagraph', 'stdParagraph'])
    expect(chapterNode.content!.slice(1).map(textOf)).toEqual(['开头段', '之前段', '下列文件对于本文件的应用是必不可少的。', '之后段', '末尾段'])
  })

  it('附录的 start 在附录标识与标题之后', () => {
    const result = ok(source, [{ op: 'insert', parent: 'app-b', position: 'start', content: [{ kind: 'clause', title: '新条' }] }])
    expect(types(byId(result.doc, 'app-b')!.content)).toEqual(['appendixLabel', 'appendixTitle', 'clause', 'stdParagraph'])
  })

  it('条内：start 在条标题之后；子条的层级由位置推导（父条 2 级 → 新条 3 级），条标题层级同步', () => {
    const result = ok(source, [{
      op: 'insert', parent: 'cl-421', position: 'start',
      content: [{ kind: 'clause', title: '三级条', children: [{ kind: 'clause', title: '四级条' }] }],
    }])
    const clause3 = byId(result.doc, 'g1')!
    expect(clause3.attrs).toMatchObject({ level: 3, hasTitle: true })
    expect(clause3.content![0]).toMatchObject({ type: 'clauseTitle', attrs: { level: 3 } })
    expect(byId(result.doc, 'g2')!.attrs).toMatchObject({ level: 4 })
    expect(labelOf(result.doc, 'g1')).toBe('4.2.1.1')
    expect(types(byId(result.doc, 'cl-421')!.content)).toEqual(['clauseTitle', 'clause', 'stdParagraph'])
  })

  it('前言：start / end / before / after', () => {
    const result = ok(source, [
      { op: 'insert', parent: 'foreword', position: 'start', content: ['甲'] },
      { op: 'insert', parent: 'foreword', position: 'end', content: ['乙'] },
      { op: 'insert', parent: 'foreword', position: { after: 'fw-p1' }, content: ['丙'] },
      { op: 'insert', parent: 'foreword', position: { before: 'fw-note' }, content: ['丁'] },
    ])
    const forewordNode = result.doc.content!.find(child => child.type === 'foreword')!
    expect(forewordNode.content!.map(textOf)).toEqual(['甲', '本文件按照 GB/T 1.1—2020 的规定起草。', '丙', '丁', '前言中的注。', '乙'])
  })

  it('参考文献：start 在标题之后，end 在末尾，字符串就是文献条目', () => {
    const result = ok(source, [
      { op: 'insert', parent: 'bibliography', position: 'start', content: ['最前文献'] },
      { op: 'insert', parent: 'bibliography', position: { after: 'bib-1' }, content: [{ kind: 'bibEntry', id: 'bib-new', content: '新文献' }] },
      { op: 'insert', parent: 'bibliography', position: 'end', content: ['最后文献'] },
    ])
    const bib = result.doc.content!.find(child => child.type === 'bibliography')!
    expect(types(bib.content)).toEqual(['bibliographyTitle', ...Array(6).fill('bibEntry')])
    expect(bib.content!.slice(1).map(textOf)).toEqual(['最前文献', 'GB/T 20000.1—2014 标准化工作指南', '新文献', 'ISO/IEC Directives, Part 2', '带结构化字段的文献', '最后文献'])
  })

  it('正文：end 在最后一章之后、附录之前；start 在第一章之前', () => {
    const result = ok(source, [
      { op: 'insert', parent: 'body', position: 'end', content: [{ kind: 'chapter', id: 'ch-new-end', title: '末章' }] },
      { op: 'insert', parent: 'body', position: 'start', content: [{ kind: 'chapter', id: 'ch-new-start', title: '首章' }] },
    ])
    const order = result.doc.content!.map(child => child.attrs?.nodeId ?? child.type)
    expect(order).toEqual([
      'cover', 'foreword', 'introduction', 'ch-new-start', 'ch-scope', 'ch-refs', 'ch-terms', 'ch-4', 'ch-new-end',
      'app-a', 'app-b', 'bibliography', 'res-1',
    ])
  })

  it('正文：before/after 章；章按位置重新编号', () => {
    const result = ok(source, [{ op: 'insert', parent: 'body', position: { after: 'ch-scope' }, content: [{ kind: 'chapter', id: 'ch-x', title: '新章' }] }])
    expect(labelOf(result.doc, 'ch-x')).toBe('2')
    expect(labelOf(result.doc, 'ch-4')).toBe('5')
  })

  it('附录序列：end 在最后一个附录之后、参考文献之前；没有附录时在章之后', () => {
    const withAppendix = ok(source, [{ op: 'insert', parent: 'appendices', position: 'end', content: [{ kind: 'appendix', id: 'app-c', title: '新附录' }] }])
    expect(withAppendix.doc.content!.map(child => child.type)).toEqual([
      'coverPage', 'foreword', 'introduction', 'chapter', 'chapter', 'chapter', 'chapter', 'appendix', 'appendix', 'appendix',
      'bibliography', 'figureResource',
    ])
    expect(labelOf(withAppendix.doc, 'app-c')).toBe('附录C')
    const without = ok(doc(chapter('c1', '范围', para('p', text('x'))), bibliography(bibEntry('b', '文献'))),
      [{ op: 'insert', parent: 'appendices', position: 'start', content: [{ kind: 'appendix', title: '附录' }] }])
    expect(rootTypes(without.doc)).toEqual(['chapter', 'appendix', 'bibliography'])
  })

  it('结果记录写入的节点：片段顶层节点与其中可寻址的后代，按文档顺序', () => {
    const result = ok(smallDocument(), [{
      op: 'insert', parent: 'ch-1', position: 'end',
      content: [{ kind: 'clause', id: 'c-a', title: '甲', children: [{ kind: 'clause', id: 'c-b', title: '乙' }, '段落'] }, '尾段'],
    }])
    expect(result.operations).toEqual([{ index: 0, op: 'insert', inserted: ['c-a', 'c-b', 'g1', 'g2'], removed: [], moved: [] }])
  })
})

describe('insert：根节点顺序与容器创建', () => {
  const baseChapter = (): PMJsonNode => chapter('c1', '范围', para('p1', text('正文')))

  it('前言不存在时创建在封面/元数据之后、第一章之前', () => {
    const source = doc(node('coverPage', { nodeId: 'cv' }, [node('paragraph')]), baseChapter(), bibliography(bibEntry('b', '文献')))
    const result = ok(source, [{ op: 'insert', parent: 'foreword', position: 'end', content: ['前言正文'] }])
    expect(rootTypes(result.doc)).toEqual(['coverPage', 'foreword', 'chapter', 'bibliography'])
    expect(result.operations[0]).toMatchObject({ createdContainer: 'foreword', inserted: ['g1'] })
    expect(result.doc.content![1]!.attrs).toEqual({ nodeId: 'g2' })
  })

  it('引言创建在前言之后；没有前言时紧邻封面之后', () => {
    const withForeword = ok(doc(foreword(para('f', text('前言'))), baseChapter()),
      [{ op: 'insert', parent: 'introduction', position: 'start', content: ['引言'] }])
    expect(rootTypes(withForeword.doc)).toEqual(['foreword', 'introduction', 'chapter'])
    const noForeword = ok(doc(node('coverPage', { nodeId: 'cv' }, [node('paragraph')]), node('metadataBlock', undefined, []), baseChapter()),
      [{ op: 'insert', parent: 'introduction', position: 'start', content: ['引言'] }])
    expect(rootTypes(noForeword.doc)).toEqual(['coverPage', 'metadataBlock', 'introduction', 'chapter'])
  })

  it('参考文献创建在附录之后、索引与图资源之前，带 bibliographyTitle', () => {
    const source = doc(baseChapter(), appendix('a', true, '附录', para('pa', text('x'))), node('indexBlock', { nodeId: 'ix' }, []),
      node('figureResource', { nodeId: 'r', encoding: 'dataUrl', data: '' }))
    const result = ok(source, [{ op: 'insert', parent: 'bibliography', position: 'end', content: ['GB/T 1.1—2020', { kind: 'bibEntry', content: '第二条' }] }])
    expect(rootTypes(result.doc)).toEqual(['chapter', 'appendix', 'bibliography', 'indexBlock', 'figureResource'])
    const bib = result.doc.content![2]!
    expect(bib.content![0]).toEqual({ type: 'bibliographyTitle', content: [{ type: 'text', text: '参考文献' }] })
    expect(types(bib.content)).toEqual(['bibliographyTitle', 'bibEntry', 'bibEntry'])
    expect(result.operations[0]!.createdContainer).toBe('bibliography')
  })

  it('没有章时，正文章放在前言/引言之后、附录之前', () => {
    const source = doc(foreword(para('f', text('前言'))), introduction(para('i', text('引言'))), appendix('a', false, '附录', para('pa', text('x'))))
    const result = ok(source, [{ op: 'insert', parent: 'body', position: 'end', content: [{ kind: 'chapter', title: '范围' }] }])
    expect(rootTypes(result.doc)).toEqual(['foreword', 'introduction', 'chapter', 'appendix'])
  })

  it('容器不存在时不能相对节点定位', () => {
    const issues = failure(doc(baseChapter()), [{ op: 'insert', parent: 'foreword', position: { before: 'p1' }, content: ['x'] }])
    expect(issues).toEqual([expect.objectContaining({ operationIndex: 0, path: 'operations[0].position.before', code: 'anchor-not-found' })])
  })

  it('后续操作可以向刚创建的容器继续插入', () => {
    const result = ok(doc(baseChapter()), [
      { op: 'insert', parent: 'foreword', position: 'start', content: [{ kind: 'paragraph', id: 'fw-1', content: '甲' }] },
      { op: 'insert', parent: 'foreword', position: { after: 'fw-1' }, content: ['乙'] },
    ])
    expect(rootTypes(result.doc)).toEqual(['foreword', 'chapter'])
    expect(result.doc.content![0]!.content!.map(textOf)).toEqual(['甲', '乙'])
    expect(result.operations[1]!.createdContainer).toBeUndefined()
  })
})

describe('insert：拒绝', () => {
  const source = richDocument()

  it('片段不合法：问题带操作序号与完整路径（含片段内部路径）', () => {
    const issues = failure(source, [
      { op: 'insert', parent: 'ch-refs', position: 'end', content: [{ kind: 'paragraph', content: '好' }] },
      { op: 'insert', parent: 'cl-41', position: 'end', content: [{ kind: 'clause', level: 3, title: '错层级', children: [{ kind: 'table', caption: 'x', rows: [['a', 'b'], ['c']] }] }] },
    ])
    expect(issues.map(item => [item.operationIndex, item.path, item.code])).toEqual([
      [1, 'operations[1].content[0].level', 'level-mismatch'],
      [1, 'operations[1].content[0].children[0].rows[1]', 'table-grid'],
    ])
    expect(issues[0]!.reason).toContain('层级')
  })

  it('节点种类与位置不符：章不能插入附录序列，段落不能放进参考文献', () => {
    const issues = failure(source, [
      { op: 'insert', parent: 'appendices', position: 'end', content: [{ kind: 'chapter', title: '章' }] },
      { op: 'insert', parent: 'bibliography', position: 'end', content: [{ kind: 'paragraph', content: '段' }] },
      { op: 'insert', parent: 'foreword', position: 'end', content: [{ kind: 'clause', title: '条' }] },
    ])
    expect(issues.map(item => [item.operationIndex, item.path, item.code])).toEqual([
      [0, 'operations[0].content[0].kind', 'not-allowed-here'],
      [1, 'operations[1].content[0].kind', 'not-allowed-here'],
      [2, 'operations[2].content[0].kind', 'not-allowed-here'],
    ])
  })

  it('5 级条内不能再插入条', () => {
    let deepest = para('p-deep', text('x'))
    for (let level = 5; level >= 1; level -= 1) deepest = clause(`c${level}`, level, `第${level}级`, deepest)
    const issues = failure(doc(chapter('ch', '范围', deepest)), [{ op: 'insert', parent: 'c5', position: 'end', content: [{ kind: 'clause', title: '六级' }] }])
    expect(issues[0]).toMatchObject({ code: 'not-allowed-here', path: 'operations[0].content[0].kind' })
    expect(issues[0]!.reason).toContain('最大层级')
  })

  it('父节点：不存在、不能作父节点的种类、位于表内部', () => {
    const issues = failure(source, [
      { op: 'insert', parent: 'nope', position: 'end', content: ['x'] },
      { op: 'insert', parent: 'p-411', position: 'end', content: ['x'] },
      { op: 'insert', parent: 'tbl-1-r1c1', position: 'end', content: ['x'] },
    ])
    expect(issues.map(item => [item.path, item.code])).toEqual([
      ['operations[0].parent', 'node-not-found'],
      ['operations[1].parent', 'invalid-parent'],
      ['operations[2].parent', 'node-not-addressable'],
    ])
    expect(issues[1]!.reason).toContain('段落')
    expect(issues[2]!.reason).toContain('表「tbl-1」')
  })

  it('锚点：不存在、不是目标的直接子节点、位于别处', () => {
    const issues = failure(source, [
      { op: 'insert', parent: 'ch-refs', position: { after: 'nope' }, content: ['x'] },
      { op: 'insert', parent: 'ch-refs', position: { after: 'scope-p1' }, content: ['x'] },
      { op: 'insert', parent: 'foreword', position: { before: 'intro-p1' }, content: ['x'] },
      { op: 'insert', parent: 'body', position: { before: 'app-a' }, content: [{ kind: 'chapter', title: '章' }] },
    ])
    expect(issues.map(item => [item.path, item.code])).toEqual([
      ['operations[0].position.after', 'anchor-not-found'],
      ['operations[1].position.after', 'anchor-not-in-parent'],
      ['operations[2].position.before', 'anchor-not-in-parent'],
      ['operations[3].position.before', 'anchor-not-in-parent'],
    ])
    expect(issues[1]!.reason).toContain('章「ch-scope」')
  })

  it('id：与文档已有 id 冲突、容器保留字、片段内重复', () => {
    const issues = failure(source, [
      { op: 'insert', parent: 'ch-refs', position: 'end', content: [{ kind: 'paragraph', id: 'p-411', content: 'x' }] },
      { op: 'insert', parent: 'ch-refs', position: 'end', content: [{ kind: 'paragraph', id: 'body', content: 'x' }] },
      { op: 'insert', parent: 'ch-refs', position: 'end', content: [{ kind: 'paragraph', id: 'same', content: 'x' }, { kind: 'paragraph', id: 'same', content: 'y' }] },
    ])
    expect(issues.map(item => [item.path, item.code])).toEqual([
      ['operations[0].content[0].id', 'id-conflict'],
      ['operations[1].content[0].id', 'id-conflict'],
      ['operations[2].content[1].id', 'duplicate-id'],
    ])
  })

  it('派生 id（如列项项的 .p0）也算已占用', () => {
    const conflict = failure(richDocument(), [{ op: 'insert', parent: 'ch-refs', position: 'end', content: [{ kind: 'paragraph', id: 'li-1.p0', content: 'x' }] }])
    expect(conflict[0]).toMatchObject({ code: 'id-conflict', path: 'operations[0].content[0].id' })
  })

  it('多个同类容器无法确定目标', () => {
    const source2 = doc(foreword(para('a', text('x'))), foreword(para('b', text('y'))), chapter('c', '范围', para('p', text('z'))))
    expect(failure(source2, [{ op: 'insert', parent: 'foreword', position: 'end', content: ['x'] }])[0]).toMatchObject({ code: 'container-ambiguous' })
  })

  it('文档里重复的 id 无法定位', () => {
    const source2 = doc(chapter('c', '范围', para('dup', text('x')), para('dup', text('y'))))
    expect(failure(source2, [{ op: 'delete', nodeId: 'dup' }])[0]).toMatchObject({ code: 'node-ambiguous' })
  })
})

describe('replace', () => {
  const source = richDocument()

  it('一个节点替换为多个节点，位置不变', () => {
    const result = ok(source, [{ op: 'replace', nodeId: 'refs-p1', content: ['甲', { kind: 'note', content: '乙' }] }])
    const chapterNode = byId(result.doc, 'ch-refs')!
    expect(chapterNode.content!.slice(1).map(child => [child.type, textOf(child)])).toEqual([['stdParagraph', '甲'], ['note', '乙']])
    expect(result.operations[0]).toMatchObject({ op: 'replace', removed: ['refs-p1'], inserted: ['g1', 'g2'] })
  })

  it('片段按被替换节点所在位置的上下文归一化：条的层级由位置决定', () => {
    const result = ok(source, [{ op: 'replace', nodeId: 'cl-421', content: [{ kind: 'clause', id: 'cl-new', title: '新条', children: ['说明'] }] }])
    expect(byId(result.doc, 'cl-new')!.attrs).toMatchObject({ level: 2 })
    expect(labelOf(result.doc, 'cl-new')).toBe('4.2.1')
    expect(byId(result.doc, 'cl-421')).toBeUndefined()
  })

  it('被替换子树的 id 可以复用；他处已有的 id 仍然冲突', () => {
    const reuse = ok(source, [{ op: 'replace', nodeId: 'cl-421', content: [{ kind: 'clause', id: 'cl-421', title: '重写', children: [{ kind: 'paragraph', id: 'p-4211', content: '新内容' }] }] }])
    expect(textOf(byId(reuse.doc, 'p-4211'))).toBe('新内容')
    const conflict = failure(source, [{ op: 'replace', nodeId: 'cl-421', content: [{ kind: 'paragraph', id: 'p-411', content: 'x' }] }])
    expect(conflict[0]).toMatchObject({ code: 'id-conflict', path: 'operations[0].content[0].id' })
  })

  it('章替换为章；术语条目替换为术语条目', () => {
    const result = ok(source, [
      { op: 'replace', nodeId: 'ch-refs', content: [{ kind: 'chapter', id: 'ch-refs', title: '规范性引用文件', children: ['无。'] }] },
      { op: 'replace', nodeId: 'term-2', content: [{ kind: 'termEntry', id: 'term-2', term: '序号', definition: '新定义。' }] },
    ])
    expect(textOf(byId(result.doc, 'ch-refs'))).toBe('规范性引用文件无。')
    expect(labelOf(result.doc, 'term-2')).toBe('3.2')
  })

  it('替换前言唯一的块后，前言仍在原位置', () => {
    const result = ok(doc(foreword(para('only', text('旧'))), smallDocument().content![0]!), [{ op: 'replace', nodeId: 'only', content: ['新'] }])
    expect(rootTypes(result.doc)).toEqual(['foreword', 'chapter'])
    expect(result.operations[0]!.removedContainer).toBeUndefined()
  })

  describe('被替换节点含写作片段无法表达的内容', () => {
    const styled = [{ kind: 'table', id: 'tbl-styled', caption: '带列宽的表', rows: [['项目', '值'], ['甲', '乙']] }]

    it('默认拒绝：reason 列出将丢失的项与位置，问题带操作序号与节点 id，文档不变', () => {
      const issues = failure(source, [{ op: 'replace', nodeId: 'tbl-styled', content: styled }])
      expect(issues).toEqual([{
        operationIndex: 0, path: 'operations[0].nodeId', code: 'replace-loses-content', nodeId: 'tbl-styled',
        reason: expect.stringContaining('columnWidths'),
      }])
      expect(issues[0]!.reason).toContain('ir.rows[0].cells[0].columnWidths')
      expect(issues[0]!.reason).toContain('acceptLoss')
      // 与 readNode 的说明一致
      const read = readNode(source, 'tbl-styled')
      expect(read.ok && read.node.notReplaceable?.[0]?.message).toBeTruthy()
      expect(issues[0]!.reason).toContain(read.ok ? read.node.notReplaceable![0]!.message : '')
    })

    it('acceptLoss: false 与缺省相同', () => {
      expect(failure(source, [{ op: 'replace', nodeId: 'tbl-styled', content: styled, acceptLoss: false }])[0]).toMatchObject({ code: 'replace-loses-content' })
    })

    it('acceptLoss: true 才执行，成功结果的 warnings 说明实际丢失了什么', () => {
      const result = ok(source, [{ op: 'replace', nodeId: 'tbl-styled', content: styled, acceptLoss: true }])
      // 新表的单元格不再有列宽
      expect(byId(result.doc, 'tbl-styled')!.content![1]!.content![0]!.content![0]!.attrs?.colwidth ?? null).toBeNull()
      expect(result.warnings).toHaveLength(1)
      expect(result.warnings[0]).toMatchObject({ operationIndex: 0, code: 'replace-loses-content', nodeId: 'tbl-styled' })
      expect(result.warnings[0]!.reason).toContain('columnWidths')
      expect(result.warnings[0]!.reason).toContain('已丢失')
    })

    it('图的资源引用、MathML、TBX 语言集、脚注、警告块、结构化文献同样默认拒绝', () => {
      const cases: [string, unknown[], string][] = [
        ['fig-res', [{ kind: 'figure', caption: '图', src: PNG }], 'resourceId'],
        ['f-mathml', [{ kind: 'formula', latex: 'a+b' }], 'mathml'],
        ['term-3', [{ kind: 'termEntry', term: '术语', definition: '定义' }], 'languageSets'],
        ['scope-p1', ['新段落'], 'footnote'],
        ['warn-1', ['新段落'], '警告块'],
        ['bib-3', ['新文献'], 'identifiers'],
      ]
      for (const [nodeId, content, mention] of cases) {
        const issues = failure(source, [{ op: 'replace', nodeId, content }])
        expect(issues.map(item => item.code), nodeId).toEqual(['replace-loses-content'])
        expect(issues[0]!.reason, nodeId).toContain(mention)
        const accepted = ok(source, [{ op: 'replace', nodeId, content, acceptLoss: true }])
        expect(accepted.warnings.map(item => item.code), nodeId).toEqual(['replace-loses-content'])
      }
    })

    it('后代含有无法表达的内容时，替换祖先同样拒绝，并列出全部丢失项', () => {
      const issues = failure(source, [{ op: 'replace', nodeId: 'ch-4', content: [{ kind: 'chapter', title: '技术要求' }] }])
      expect(issues).toHaveLength(1)
      expect(issues[0]).toMatchObject({ code: 'replace-loses-content', nodeId: 'ch-4' })
      for (const mention of ['columnWidths', 'resourceId', 'mathml', 'warning']) expect(issues[0]!.reason).toContain(mention)
    })

    it('全有或全无：同批里其它操作都合法，也整批不生效；与片段本身的问题一并报出', () => {
      const issues = failure(source, [
        { op: 'insert', parent: 'foreword', position: 'end', content: ['合法'] },
        { op: 'replace', nodeId: 'tbl-styled', content: [{ kind: 'table', caption: 't', rows: [['a', 'b'], ['c']] }] },
      ])
      expect(issues.map(item => [item.operationIndex, item.code, item.path])).toEqual([
        [1, 'replace-loses-content', 'operations[1].nodeId'],
        [1, 'table-grid', 'operations[1].content[0].rows[1]'],
      ])
    })

    it('可替换的节点不需要 acceptLoss，带了也没有警告', () => {
      expect(ok(source, [{ op: 'replace', nodeId: 'p-411', content: ['x'] }]).warnings).toEqual([])
      expect(ok(source, [{ op: 'replace', nodeId: 'p-411', content: ['x'], acceptLoss: true }]).warnings).toEqual([])
    })

    it('把 readNode 返回的 IR 原样回传给不可替换的节点：默认被拒绝，acceptLoss 也不能放行不支持的字段', () => {
      const read = readNode(source, 'tbl-styled')
      if (!read.ok) throw new Error(read.reason)
      const plain = failure(source, [{ op: 'replace', nodeId: 'tbl-styled', content: [read.node.ir] }])
      expect(plain.map(item => item.code)).toContain('replace-loses-content')
      const accepted = failure(source, [{ op: 'replace', nodeId: 'tbl-styled', content: [read.node.ir], acceptLoss: true }])
      // 原样回传的 IR 里仍带着片段不支持的字段（两个带列宽的单元格），被归一化拒绝：调用方必须先去掉它们
      expect(accepted.map(item => item.code)).toEqual(['unknown-field', 'unknown-field'])
      expect(accepted[0]!.path).toBe('operations[0].content[0].rows[0].cells[0].columnWidths')
    })
  })

  it('空片段与不存在的节点', () => {
    const issues = failure(source, [
      { op: 'replace', nodeId: 'p-411', content: [] },
      { op: 'replace', nodeId: 'zzz', content: ['x'] },
    ])
    expect(issues.map(item => [item.operationIndex, item.path, item.code])).toEqual([
      [0, 'operations[0].content', 'empty-fragment'],
      [1, 'operations[1].nodeId', 'node-not-found'],
    ])
  })

  it('替换后不再有被引用的目标时，新引入悬空引用问题', () => {
    const result = ok(source, [{ op: 'replace', nodeId: 'tbl-1', content: [{ kind: 'table', caption: '新表', rows: [['a']] }] }])
    const dangling = result.problems.filter(problem => problem.code === 'dangling-xref')
    expect(dangling).toHaveLength(1)
    expect(dangling[0]).toMatchObject({ nodeId: 'p-411', introduced: true })
  })
})

describe('delete', () => {
  const source = richDocument()

  it('删除节点连同子树，记录移除的可寻址节点', () => {
    const result = ok(source, [{ op: 'delete', nodeId: 'cl-42' }])
    expect(byId(result.doc, 'cl-42')).toBeUndefined()
    expect(byId(result.doc, 'tbl-1')).toBeUndefined()
    expect(result.operations[0]!.removed).toEqual([
      'cl-42', 'cl-421', 'p-4211', 'cl-422', 'tbl-1', 'fig-1', 'f-1', 'p-4221', 'tbl-styled', 'fig-res', 'f-mathml', 'warn-1',
    ])
    expect(labelOf(result.doc, 'app-a')).toBe('附录A')
  })

  it('前言/引言的最后一个块被删除时，容器一并移除（生产 schema 要求 block+）', () => {
    const result = ok(source, [
      { op: 'delete', nodeId: 'intro-p1' },
      { op: 'delete', nodeId: 'fw-p1' },
    ])
    expect(rootTypes(result.doc)).toContain('foreword')
    expect(rootTypes(result.doc)).not.toContain('introduction')
    expect(result.operations.map(effect => effect.removedContainer)).toEqual(['introduction', undefined])
    const both = ok(source, [{ op: 'delete', nodeId: 'fw-p1' }, { op: 'delete', nodeId: 'fw-note' }])
    expect(rootTypes(both.doc)).not.toContain('foreword')
    expect(both.operations[1]!.removedContainer).toBe('foreword')
  })

  it('参考文献的最后一个条目被删除时，整个参考文献一并移除（bibliography 需要至少一个条目）', () => {
    const result = ok(source, [{ op: 'delete', nodeId: 'bib-1' }, { op: 'delete', nodeId: 'bib-2' }, { op: 'delete', nodeId: 'bib-3' }])
    expect(rootTypes(result.doc)).not.toContain('bibliography')
    expect(result.operations[2]!.removedContainer).toBe('bibliography')
    // 之后可以重新创建
    const again = ok(result.doc, [{ op: 'insert', parent: 'bibliography', position: 'end', content: ['新文献'] }])
    expect(rootTypes(again.doc)).toEqual(['coverPage', 'foreword', 'introduction', 'chapter', 'chapter', 'chapter', 'chapter', 'appendix', 'appendix', 'bibliography', 'figureResource'])
  })

  it('章、条删完内容后保留标题，并新引入「没有任何内容」警告', () => {
    const result = ok(smallDocument(), [{ op: 'delete', nodeId: 'p-1' }])
    expect(types(byId(result.doc, 'ch-1')!.content)).toEqual(['chapterTitle'])
    expect(result.problems).toEqual([expect.objectContaining({ code: 'empty-section', nodeId: 'ch-1', introduced: true })])
  })

  it('删除后文档为空则拒绝', () => {
    const issues = failure(smallDocument(), [{ op: 'delete', nodeId: 'ch-1' }])
    expect(issues).toEqual([{ path: 'document', code: 'empty-document', reason: expect.stringContaining('没有任何内容') }])
  })

  it('不能单独删除表内部、术语条目内部的节点', () => {
    const issues = failure(source, [{ op: 'delete', nodeId: 'tbl-1-r2' }, { op: 'delete', nodeId: 'term-1-ex' }])
    expect(issues.map(item => item.code)).toEqual(['node-not-addressable', 'node-not-addressable'])
  })

  it('删除被引用的节点：新引入悬空引用，已有问题不算新引入', () => {
    const result = ok(source, [{ op: 'delete', nodeId: 'cl-41' }])
    expect(result.problems.filter(problem => problem.introduced).map(problem => [problem.code, problem.nodeId])).toEqual([
      ['dangling-xref', 'intro-p1'],
    ])
  })
})

describe('move', () => {
  const source = richDocument()

  it('章重新排序，编号随之变化', () => {
    const result = ok(source, [{ op: 'move', nodeId: 'ch-4', parent: 'body', position: { before: 'ch-scope' } }])
    expect(result.doc.content!.filter(child => child.type === 'chapter').map(child => child.attrs?.nodeId)).toEqual(['ch-4', 'ch-scope', 'ch-refs', 'ch-terms'])
    expect(labelOf(result.doc, 'ch-4')).toBe('1')
    expect(result.operations[0]).toMatchObject({ op: 'move', moved: ['ch-4'], inserted: [], removed: [] })
    expect(rootTypes(result.doc)).toEqual(rootTypes(source))
  })

  it('章移到末尾仍在附录之前（根节点顺序保持）', () => {
    const result = ok(source, [{ op: 'move', nodeId: 'ch-scope', parent: 'body', position: 'end' }])
    const order = result.doc.content!.map(child => child.attrs?.nodeId ?? child.type)
    expect(order.indexOf('ch-scope')).toBe(order.indexOf('app-a') - 1)
  })

  it('附录之间重新排序，附录字母随之变化', () => {
    const result = ok(source, [{ op: 'move', nodeId: 'app-b', parent: 'appendices', position: 'start' }])
    expect(labelOf(result.doc, 'app-b')).toBe('附录A')
    expect(labelOf(result.doc, 'app-a')).toBe('附录B')
  })

  it('条移到章下：层级降为 1，子条一并调整，条标题层级同步', () => {
    const result = ok(source, [{ op: 'move', nodeId: 'cl-422', parent: 'ch-refs', position: 'end' }])
    const moved = byId(result.doc, 'cl-422')!
    expect(moved.attrs).toMatchObject({ level: 1 })
    expect(moved.content![0]).toMatchObject({ type: 'clauseTitle', attrs: { level: 1 } })
    expect(labelOf(result.doc, 'cl-422')).toBe('2.1')
    expect(labelOf(result.doc, 'tbl-1')).toBe('表1')
    expect(result.operations[0]!.levelChanged).toEqual(['cl-422'])
    expect(byId(result.doc, 'cl-42')!.content!.map(child => child.attrs?.nodeId).filter(Boolean)).toEqual(['cl-421'])
  })

  it('条移到更深的位置：自身与子条层级同时加深', () => {
    const base = doc(chapter('ch', '范围',
      clause('a', 1, '甲', clause('a1', 2, '甲一', clause('a11', 3, '甲一一', para('pa', text('x'))))),
      clause('b', 1, '乙', para('pb', text('y')))))
    const result = ok(base, [{ op: 'move', nodeId: 'a', parent: 'b', position: 'start' }])
    expect(['a', 'a1', 'a11'].map(id => byId(result.doc, id)!.attrs!.level)).toEqual([2, 3, 4])
    expect(['a', 'a1', 'a11'].map(id => byId(result.doc, id)!.content![0]!.attrs!.level)).toEqual([2, 3, 4])
    expect(result.operations[0]!.levelChanged).toEqual(['a', 'a1', 'a11'])
    expect(labelOf(result.doc, 'a11')).toBe('1.1.1.1.1')
  })

  it('移动后层级超过 5 则拒绝', () => {
    let nested = para('p', text('x'))
    for (let level = 4; level >= 1; level -= 1) nested = clause(`d${level}`, level, `深${level}`, nested)
    const base = doc(chapter('ch', '范围',
      clause('a', 1, '甲', clause('a1', 2, '甲一', clause('a11', 3, '甲一一', para('pa', text('x'))))),
      nested))
    const issues = failure(base, [{ op: 'move', nodeId: 'a', parent: 'd4', position: 'end' }])
    // a 移到 4 级条下成为 5 级，其 2、3 级子条将变为 6、7 级
    expect(issues.map(item => [item.code, item.nodeId])).toEqual([['level-overflow', 'a1'], ['level-overflow', 'a11']])
    expect(issues[0]).toMatchObject({ path: 'operations[0].parent' })
    expect(issues[0]!.reason).toContain('层级将为 6')
    expect(issues[1]!.reason).toContain('层级将为 7')
  })

  it('术语条目移到另一章：显示层级与位置对齐', () => {
    const base = doc(
      chapter('t1', '术语和定义', clause('tc', 1, '分类', termDef('te', '术语', '定义'))),
      chapter('t2', '其他'))
    const result = ok(base, [{ op: 'move', nodeId: 'te', parent: 't2', position: 'end' }])
    expect(byId(result.doc, 'te')!.attrs).toMatchObject({ level: 1 })
  })

  it('移动含术语条目的条：术语的显示层级按同一差值平移，自定义层级的相对关系保留', () => {
    const base = doc(chapter('t', '术语和定义',
      clause('k', 1, '分类', node('termDef', { nodeId: 'te', level: 3 }, [
        node('termName', undefined, [text('术语')]), node('termDefinition', undefined, [text('定义')]),
      ])),
      clause('host', 1, '宿主')))
    const result = ok(base, [{ op: 'move', nodeId: 'k', parent: 'host', position: 'end' }])
    expect(byId(result.doc, 'k')!.attrs).toMatchObject({ level: 2 })
    expect(byId(result.doc, 'te')!.attrs).toMatchObject({ level: 4 })
    expect(result.operations[0]!.levelChanged).toEqual(['k', 'te'])
  })

  it('块移到别的容器：移空前言则移除前言；目标容器不存在则创建', () => {
    const base = doc(foreword(para('only', text('前言'))), chapter('c', '范围', para('p', text('正文'))))
    const toChapter = ok(base, [{ op: 'move', nodeId: 'only', parent: 'c', position: 'start' }])
    expect(rootTypes(toChapter.doc)).toEqual(['chapter'])
    expect(toChapter.operations[0]).toMatchObject({ moved: ['only'], removedContainer: 'foreword' })
    const toIntro = ok(base, [{ op: 'move', nodeId: 'p', parent: 'introduction', position: 'end' }])
    expect(rootTypes(toIntro.doc)).toEqual(['foreword', 'introduction', 'chapter'])
    expect(toIntro.operations[0]).toMatchObject({ createdContainer: 'introduction' })
  })

  it('移动到自己所在的容器内重新排序时不会把容器移除再重建', () => {
    const base = doc(foreword(para('a', text('甲')), para('b', text('乙'))), chapter('c', '范围', para('p', text('x'))))
    const result = ok(base, [{ op: 'move', nodeId: 'a', parent: 'foreword', position: 'end' }])
    expect(result.doc.content![0]!.content!.map(textOf)).toEqual(['乙', '甲'])
    expect(result.operations[0]!.createdContainer).toBeUndefined()
    expect(result.operations[0]!.removedContainer).toBeUndefined()
    const only = doc(foreword(para('a', text('甲'))), chapter('c', '范围', para('p', text('x'))))
    const same = ok(only, [{ op: 'move', nodeId: 'a', parent: 'foreword', position: 'start' }])
    expect(same.doc.content![0]!.content!.map(textOf)).toEqual(['甲'])
  })

  it('参考文献条目在参考文献内重新排序', () => {
    const result = ok(source, [{ op: 'move', nodeId: 'bib-3', parent: 'bibliography', position: 'start' }])
    const bib = result.doc.content!.find(child => child.type === 'bibliography')!
    expect(ids(bib.content)).toEqual([undefined, 'bib-3', 'bib-1', 'bib-2'])
  })

  it('目标上下文不允许该节点时拒绝', () => {
    const issues = failure(source, [
      { op: 'move', nodeId: 'ch-4', parent: 'ch-refs', position: 'end' },
      { op: 'move', nodeId: 'p-411', parent: 'bibliography', position: 'end' },
      { op: 'move', nodeId: 'cl-41', parent: 'foreword', position: 'end' },
      { op: 'move', nodeId: 'ch-scope', parent: 'appendices', position: 'end' },
      { op: 'move', nodeId: 'bib-1', parent: 'cl-41', position: 'end' },
    ])
    expect(issues.map(item => [item.operationIndex, item.path, item.code])).toEqual([
      [0, 'operations[0].parent', 'not-allowed-here'],
      [1, 'operations[1].parent', 'not-allowed-here'],
      [2, 'operations[2].parent', 'not-allowed-here'],
      [3, 'operations[3].parent', 'not-allowed-here'],
      [4, 'operations[4].parent', 'not-allowed-here'],
    ])
    expect(issues[0]!.reason).toContain('章不能放在')
  })

  it('不能移动到自己或自己的子孙之内', () => {
    const issues = failure(source, [
      { op: 'move', nodeId: 'cl-42', parent: 'cl-42', position: 'end' },
      { op: 'move', nodeId: 'cl-42', parent: 'cl-422', position: 'end' },
      { op: 'move', nodeId: 'ch-4', parent: 'cl-421', position: 'end' },
    ])
    expect(issues.map(item => item.code)).toEqual(['move-into-self', 'move-into-self', 'move-into-self'])
  })

  it('锚点不能是被移动的节点本身，也必须是目标的直接子节点', () => {
    const issues = failure(source, [
      { op: 'move', nodeId: 'p-411', parent: 'cl-41', position: { after: 'p-411' } },
      { op: 'move', nodeId: 'p-411', parent: 'cl-42', position: { after: 'list-1' } },
    ])
    expect(issues.map(item => [item.path, item.code])).toEqual([
      ['operations[0].position.after', 'anchor-not-in-parent'],
      ['operations[1].position.after', 'anchor-not-in-parent'],
    ])
  })
})

describe('批量执行：顺序、全有或全无、不修改入参', () => {
  const source = richDocument()

  it('操作按顺序执行，后一个可引用前一个创建的节点', () => {
    const result = ok(source, [
      { op: 'insert', parent: 'ch-refs', position: 'end', content: [{ kind: 'clause', id: 'c-new', title: '新条' }] },
      { op: 'insert', parent: 'c-new', position: 'end', content: [{ kind: 'paragraph', id: 'p-new', content: '内容' }] },
      { op: 'move', nodeId: 'p-new', parent: 'foreword', position: 'start' },
      { op: 'delete', nodeId: 'c-new' },
    ])
    expect(byId(result.doc, 'c-new')).toBeUndefined()
    expect(result.doc.content!.find(child => child.type === 'foreword')!.content!.map(child => child.attrs?.nodeId)[0]).toBe('p-new')
    expect(result.operations.map(effect => effect.index)).toEqual([0, 1, 2, 3])
  })

  it('先删除再用相同 id 插入', () => {
    const result = ok(source, [
      { op: 'delete', nodeId: 'p-411' },
      { op: 'insert', parent: 'cl-41', position: 'start', content: [{ kind: 'paragraph', id: 'p-411', content: '重写' }] },
    ])
    expect(textOf(byId(result.doc, 'p-411'))).toBe('重写')
  })

  it('任一操作出错整批不生效，返回所有问题（带操作序号）', () => {
    const issues = failure(source, [
      { op: 'delete', nodeId: 'p-411' },
      { op: 'insert', parent: 'nope', position: 'end', content: ['x'] },
      { op: 'insert', parent: 'cl-41', position: 'end', content: [{ kind: 'paragraph', contnet: 'x' }] },
      { op: 'delete', nodeId: 'also-missing' },
    ])
    expect(issues.map(item => [item.operationIndex, item.code])).toEqual([
      [1, 'node-not-found'], [2, 'unknown-field'], [2, 'missing-field'], [3, 'node-not-found'],
    ])
  })

  it('后续操作因找不到本应由失败操作创建的节点而出错时，提示里指出前面的失败', () => {
    const issues = failure(source, [
      { op: 'insert', parent: 'ch-refs', position: 'end', content: [{ kind: 'paragraph', id: 'later', content: 'x', bad: 1 }] },
      { op: 'delete', nodeId: 'later' },
    ])
    expect(issues[1]).toMatchObject({ operationIndex: 1, code: 'node-not-found' })
    expect(issues[1]!.reason).toContain('operations[0] 已失败')
  })

  it('不修改入参：冻结的入参和操作都能正常执行，入参内容不变', () => {
    const frozen = deepFreeze(clone(source))
    const before = JSON.stringify(frozen)
    const operations = deepFreeze([
      { op: 'insert', parent: 'foreword', position: 'start', content: ['新'] },
      { op: 'replace', nodeId: 'cl-421', content: [{ kind: 'clause', title: '换', children: ['x'] }] },
      { op: 'move', nodeId: 'ch-4', parent: 'body', position: 'start' },
      { op: 'delete', nodeId: 'bib-1' },
    ])
    const result = applyDocumentOperations(frozen, operations, { generateId: seqIds() })
    expect(result.ok).toBe(true)
    expect(JSON.stringify(frozen)).toBe(before)
    if (result.ok) expect(result.doc).not.toBe(frozen)
  })

  it('未改动的子树与入参共享（结构共享），改动路径上的节点是新对象', () => {
    const frozen = deepFreeze(clone(source))
    const result = applyDocumentOperations(frozen, [{ op: 'insert', parent: 'ch-refs', position: 'end', content: ['x'] }], { generateId: seqIds() })
    if (!result.ok) throw new Error(JSON.stringify(result.issues))
    expect(byId(result.doc, 'ch-terms')).toBe(byId(frozen, 'ch-terms'))
    expect(byId(result.doc, 'ch-refs')).not.toBe(byId(frozen, 'ch-refs'))
  })

  it('同样的输入和 id 序列得到同样的结果（确定性）', () => {
    const operations = [
      { op: 'insert', parent: 'ch-refs', position: 'end', content: ['甲', { kind: 'table', caption: 't', rows: [['a']] }] },
      { op: 'insert', parent: 'bibliography', position: 'end', content: ['文献'] },
    ]
    const first = ok(source, operations, { generateId: seqIds('d') })
    const second = ok(source, operations, { generateId: seqIds('d') })
    expect(second).toEqual(first)
  })
})

describe('整体检查：extensionVersion、宿主校验、问题对比', () => {
  const source = richDocument()

  it('插入含语义扩展的内容时，根节点 extensionVersion 按 irToPm 的规则设置；不含则不设置', () => {
    const plain = ok(smallDocument(), [{ op: 'insert', parent: 'ch-1', position: 'end', content: ['普通段落'] }])
    expect(plain.doc.attrs?.extensionVersion).toBeUndefined()
    const semantic = ok(smallDocument(), [{
      op: 'insert', parent: 'ch-1', position: 'end',
      content: [{ kind: 'paragraph', content: [{ text: '删除线', marks: [{ type: 'strike' }] }] }],
    }])
    expect(semantic.doc.attrs?.extensionVersion).toBe(1)
    expect(pmToIr(semantic.doc).doc.extensionVersion).toBe(1)
    // 已经是 1 的文档保持不变
    const kept = ok(semantic.doc, [{ op: 'insert', parent: 'ch-1', position: 'end', content: ['再来一段'] }])
    expect(kept.doc.attrs?.extensionVersion).toBe(1)
  })

  it('crossRef 带 targetKind 同样需要 extensionVersion', () => {
    const result = ok(smallDocument(), [{
      op: 'insert', parent: 'ch-1', position: 'end',
      content: [{ kind: 'paragraph', content: [{ text: '范围', marks: [{ type: 'crossRef', targetId: 'ch-1', targetKind: 'chapter' }] }] }],
    }])
    expect(result.doc.attrs?.extensionVersion).toBe(1)
  })

  it('宿主校验通过：沿用规范化后的文档；校验收到的是最终文档（含 extensionVersion）', () => {
    let received: PMJsonNode | undefined
    const result = ok(smallDocument(), [{
      op: 'insert', parent: 'ch-1', position: 'end',
      content: [{ kind: 'paragraph', content: [{ text: 'x', marks: [{ type: 'strike' }] }] }],
    }], {
      generateId: seqIds(),
      validateContent: content => {
        received = content
        return { ok: true, content: { ...content, attrs: { ...content.attrs, normalized: true } } }
      },
    })
    expect(received?.attrs?.extensionVersion).toBe(1)
    expect(result.doc.attrs).toMatchObject({ normalized: true, extensionVersion: 1 })
  })

  it('宿主校验不通过：整批拒绝；问题尽量归属到写入该节点的操作', () => {
    const issues = failure(smallDocument(), [
      { op: 'insert', parent: 'ch-1', position: 'end', content: [{ kind: 'paragraph', id: 'bad', content: '甲' }] },
      { op: 'insert', parent: 'ch-1', position: 'end', content: [{ kind: 'paragraph', id: 'fine', content: '乙' }] },
    ], {
      validateContent: () => ({ ok: false, message: '子节点不符合内容约束', path: '/content/0/content/1', nodeId: 'bad', code: 'invalid-content' }),
    })
    expect(issues).toEqual([{
      operationIndex: 0, path: 'operations[0]', code: 'schema-invalid', nodeId: 'bad',
      reason: expect.stringContaining('子节点不符合内容约束'),
    }])
    expect(issues[0]!.reason).toContain('/content/0/content/1')
    const unattributed = failure(smallDocument(), [{ op: 'delete', nodeId: 'p-1' }], { validateContent: () => ({ ok: false, message: '不合法' }) })
    expect(unattributed[0]).toMatchObject({ path: 'document', code: 'schema-invalid' })
    expect(unattributed[0]!.operationIndex).toBeUndefined()
  })

  it('未注入宿主校验时跳过', () => {
    expect(applyDocumentOperations(smallDocument(), [{ op: 'insert', parent: 'ch-1', position: 'end', content: ['x'] }]).ok).toBe(true)
  })

  it('Resolver 问题全部返回，并标出本批新引入的；不因此拒绝写入', () => {
    const result = ok(source, [{
      op: 'insert', parent: 'ch-refs', position: 'end',
      content: [{ kind: 'paragraph', content: [{ text: '见', marks: [] }, { text: '9.9', marks: [{ type: 'crossRef', targetId: 'missing-target' }] }] }],
    }])
    const introduced = result.problems.filter(problem => problem.introduced)
    expect(introduced).toEqual([expect.objectContaining({ code: 'dangling-xref', severity: 'error', nodeId: 'g1' })])
    expect(result.problems.filter(problem => !problem.introduced)).toEqual([])
  })

  it('执行前已有的问题不算新引入，即使编号变化使消息文字改变', () => {
    // 原文档：第 1 章含子条与悬置段（hanging-paragraph 警告，消息里有「第1章」）
    const base = doc(chapter('c1', '范围', clause('k', 1, '条', para('pk', text('x'))), para('hang', text('悬置段'))))
    const before = ok(base, [{ op: 'insert', parent: 'k', position: 'end', content: ['y'] }])
    expect(before.problems).toEqual([expect.objectContaining({ code: 'hanging-paragraph', introduced: false })])
    // 在它前面插入一章：同一问题的消息变成「第2章」，仍不是新引入
    const shifted = ok(base, [{ op: 'insert', parent: 'body', position: 'start', content: [{ kind: 'chapter', title: '新首章', children: ['内容'] }] }])
    expect(shifted.problems).toHaveLength(1)
    expect(shifted.problems[0]!.message).toContain('第2章')
    expect(shifted.problems[0]!.introduced).toBe(false)
  })

  it('已有悬置段之外，本批再造成一个：只标出新的一个', () => {
    const base = doc(chapter('c1', '范围', clause('k', 1, '条', para('pk', text('x'))), para('hang', text('悬置段'))),
      chapter('c2', '其他', para('q', text('y'))))
    const result = ok(base, [{ op: 'insert', parent: 'c2', position: 'start', content: [{ kind: 'clause', title: '子条' }] }])
    const hanging = result.problems.filter(problem => problem.code === 'hanging-paragraph')
    expect(hanging.map(problem => [problem.nodeId, problem.introduced])).toEqual([['c1', false], ['c2', true]])
  })

  it('遗留的 unsupportedContent 不阻止编辑，作为问题原样返回（introduced: false）', () => {
    const base = doc(chapter('c', '范围', para('p', text('x')), node('horizontalRule')))
    const result = ok(base, [{ op: 'insert', parent: 'c', position: 'end', content: ['新'] }])
    expect(result.problems.filter(problem => problem.code === 'unsupported-content')).toEqual([
      expect.objectContaining({ introduced: false, severity: 'error' }),
    ])
  })

  it('本批新产生的 unsupportedContent 视为错误，整批拒绝', () => {
    const issues = failure(smallDocument(), [{ op: 'insert', parent: 'ch-1', position: 'end', content: ['x'] }], {
      // 模拟宿主规范化把文档变成了 IR 无法表达的形态
      validateContent: content => ({
        ok: true,
        content: { ...content, content: [{ ...content.content![0]!, content: [...content.content![0]!.content!, node('horizontalRule')] }] },
      }),
    })
    expect(issues).toEqual([expect.objectContaining({ code: 'unsupported-content', reason: expect.stringContaining('horizontalRule') })])
  })

  it('结构树与编号在批量修改后一致', () => {
    const result = ok(source, [
      { op: 'insert', parent: 'ch-refs', position: 'end', content: [{ kind: 'clause', id: 'ins', title: '新条', children: [{ kind: 'table', id: 'tbl-ins', caption: '新表', rows: [['a']] }] }] },
    ])
    const outline = buildOutline(result.doc)
    const refs = outline.body.find(item => item.nodeId === 'ch-refs')!
    expect(refs.children![0]).toMatchObject({ nodeId: 'ins', number: '2.1', children: [{ nodeId: 'tbl-ins', number: '表1' }] })
    expect(outline.body.find(item => item.nodeId === 'ch-4')!.children!.flatMap(item => item.children ?? []).length).toBeGreaterThan(0)
  })
})

describe('其它', () => {
  it('术语条目、示例、注插入后编号正确', () => {
    const base = doc(chapter('t', '术语和定义', para('lead', text('下列术语和定义适用于本文件。')), termDef('a', '甲', '定义甲')))
    const result = ok(base, [{ op: 'insert', parent: 't', position: 'end', content: [{ kind: 'termEntry', id: 'b', term: '乙', definition: '定义乙', notes: ['术语的注'] }] }])
    expect(labelOf(result.doc, 'b')).toBe('1.2')
  })
})
