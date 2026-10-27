import { describe, expect, it } from 'vitest'
import { pmToIr, type PMJsonNode } from '@ses/shared'
import { applyDocumentOperations } from './apply'
import { indexDocument } from './locator'
import { buildOutline } from './outline'
import { readNode } from './readNode'
import { chapter, clone, deepFreeze, doc, node, para, seqIds, text, xref } from './testFixtures'

const item = (nodeId: string, term: string, definition: string): PMJsonNode =>
  node('whereItem', { nodeId }, [
    node('whereTerm', undefined, [text(term)]),
    node('whereDefinition', undefined, [text(definition)]),
  ])

/** 第 4 章：段落 → 缩略语表（两项）→ 段落（含对缩略语项的引用）；用来核对 defList 参与 IR 兄弟序列且不偏移后续索引。 */
function documentWithDefList(): PMJsonNode {
  return doc(chapter('ch-abbr', '符号和缩略语',
    para('p-intro', text('下列缩略语适用于本文件。')),
    node('defList', { nodeId: 'dl-1' }, [item('abb-adc', 'ADC', '模数转换器'), item('abb-ct', 'CT', '计算机断层扫描')]),
    para('p-after', text('见'), xref('ADC', 'abb-adc', 'abbreviation')),
  ))
}

describe('[M-10.1.4-01] documentOps：缩略语表（defList）可寻址，但不可被写作片段整体替换', () => {
  const source = deepFreeze(documentWithDefList())

  it('定位索引把 defList 当作章内的块：位置与兄弟总数按 IR 序列计，后续节点索引不偏移', () => {
    const index = indexDocument(source)
    const located = (id: string) => index.byId.get(id)!
    expect(located('dl-1')).toMatchObject({ kind: 'defList', index: 1, siblingCount: 3 })
    expect(located('p-after')).toMatchObject({ kind: 'paragraph', index: 2, siblingCount: 3 })
    expect(located('p-intro')).toMatchObject({ kind: 'paragraph', index: 0, siblingCount: 3 })
    // 表内的项不是可寻址节点（属于 defList 的一部分，与公式式中项一致）
    expect(index.byId.has('abb-adc')).toBe(false)
  })

  it('readNode：IR 为 defList，项带 id/term/definition；不可整体替换，原因是 unsupported-kind', () => {
    const result = readNode(source, 'dl-1')
    if (!result.ok) throw new Error(result.reason)
    expect(result.node.kind).toBe('defList')
    expect(result.node.ir).toMatchObject({
      kind: 'defList', id: 'dl-1',
      items: [
        { id: 'abb-adc', term: [{ text: 'ADC' }], definition: [{ text: '模数转换器' }] },
        { id: 'abb-ct', term: [{ text: 'CT' }], definition: [{ text: '计算机断层扫描' }] },
      ],
    })
    expect(result.node.replaceable).toBe(false)
    expect(result.node.notReplaceable).toEqual([expect.objectContaining({ code: 'unsupported-kind', message: expect.stringContaining('缩略语表') })])
  })

  it('replace 默认被拒绝（写作片段无法重建 defList）；acceptLoss 也不放宽片段检查，文档不变', () => {
    const operations = [{ op: 'replace', nodeId: 'dl-1', content: [{ kind: 'paragraph', content: ['改成段落'] }] }]
    const refused = applyDocumentOperations(clone(source), operations, { generateId: seqIds() })
    expect(refused.ok).toBe(false)
    if (!refused.ok) expect(refused.issues.map(issue => issue.code)).toEqual(['replace-loses-content'])
  })

  it('写作片段不能创建 defList：插入以 unsupported-kind 拒绝', () => {
    const refused = applyDocumentOperations(clone(source), [
      { op: 'insert', parent: 'ch-abbr', position: 'end', content: [{ kind: 'defList', items: [{ term: 'X', definition: 'Y' }] }] },
    ], { generateId: seqIds() })
    expect(refused.ok).toBe(false)
    if (!refused.ok) expect(refused.issues.map(issue => issue.code)).toEqual(['unsupported-kind'])
  })

  it('删除整个缩略语表可行：其余节点原样保留（引用段仍在，引用是否悬空由 Resolver 另行报告）', () => {
    const result = applyDocumentOperations(clone(source), [{ op: 'delete', nodeId: 'dl-1' }], { generateId: seqIds() })
    expect(result.ok).toBe(true)
    if (result.ok) {
      const types = result.doc.content![0]!.content!.map(child => child.type)
      expect(types).toEqual(['chapterTitle', 'stdParagraph', 'stdParagraph'])
    }
  })

  it('其他节点的操作不碰缩略语表：替换相邻段落后，表与项 id 原样保留', () => {
    const result = applyDocumentOperations(clone(source), [
      { op: 'replace', nodeId: 'p-intro', content: [{ kind: 'paragraph', content: ['下列符号和缩略语适用于本文件。'] }] },
    ], { generateId: seqIds() })
    expect(result.ok).toBe(true)
    if (result.ok) {
      const lists = result.doc.content![0]!.content!.filter(child => child.type === 'defList')
      expect(lists).toHaveLength(1)
      expect(lists[0]!.content!.map(child => child.attrs?.nodeId)).toEqual(['abb-adc', 'abb-ct'])
    }
  })

  it('移动缩略语表到章内另一位置：保持 defList 与项 id，不丢内容', () => {
    const result = applyDocumentOperations(clone(source), [
      { op: 'move', nodeId: 'dl-1', parent: 'ch-abbr', position: 'start' },
    ], { generateId: seqIds() })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.doc.content![0]!.content!.map(child => child.attrs?.nodeId ?? child.type)).toEqual(['chapterTitle', 'dl-1', 'p-intro', 'p-after'])
    }
  })

  it('结构树：defList 与段落一样只计入章的 blockCount（不单独列出）', () => {
    const outline = buildOutline(source)
    expect(outline.body[0]!.blockCount).toBe(3)
    expect(outline.body[0]!.children).toEqual([])
  })

  it('含 defList 与 abbreviation 引用的文档：pmToIr 无告警、无 unsupportedContent', () => {
    const { doc: ir, warnings } = pmToIr(source)
    expect(warnings).toEqual([])
    expect(ir.unsupportedContent ?? []).toEqual([])
  })
})
