import { describe, expect, it } from 'vitest'
import { pmToIr, type PMJsonNode } from '@ses/shared'
import { applyDocumentOperations } from './apply'
import { readNode } from './readNode'
import { chapter, clause, clone, deepFreeze, doc, example, node, note, para, seqIds, stdList, text } from './testFixtures'

/**
 * [M-5.6-05] WP8.M G7-b：块内容的注/示例（noteBlock / exampleBlock）在 documentOps 里读成 IR 的 note/example，
 * 可以单独寻址、移动、删除；写作片段只能表达单段注，所以整体替换多块注会丢失内容，必须默认拒绝。
 * [M-5.7-04] 罗马列项（stdList roman）：同样不能被写作片段整体替换（写作入口本阶段不放开）。
 */
function documentWithBlockNotes(): PMJsonNode {
  return doc(chapter('ch-1', '技术要求',
    clause('cl-1', 1, '注与示例',
      para('p-1', text('引语。')),
      note('n-legacy', '旧式单段注。'),
      node('noteBlock', { nodeId: 'n-block' }, [
        para('n-block-p1', text('多块注第一段。')),
        para('n-block-p2', text('多块注第二段。')),
        stdList('n-block-l', 'dash', ['n-block-i1', '注内列项']),
      ]),
      example('e-legacy', '旧式单段示例。'),
      node('exampleBlock', { nodeId: 'e-block' }, [
        para('e-block-p1', text('多块示例引语：')),
        stdList('e-block-l', 'roman', ['e-block-i1', '示例项甲'], ['e-block-i2', '示例项乙']),
      ]),
    ),
    clause('cl-2', 1, '目标条', para('p-2', text('目标条正文。'))),
    clause('cl-3', 1, '罗马列项', stdList('l-roman', 'roman', ['l-roman-i1', '甲'], ['l-roman-i2', '乙'])),
  ))
}

const source = deepFreeze(documentWithBlockNotes())

describe('[M-5.6-05] documentOps：noteBlock / exampleBlock 是可寻址的 note / example', () => {
  it('readNode：IR 为 note/example，内容保留多块；编号来自 Resolver（注1：/注2：、示例1：/示例2：）；父节点与位置按 IR 兄弟序列计算', () => {
    const block = readNode(source, 'n-block')
    if (!block.ok) throw new Error(block.reason)
    expect(block.node).toMatchObject({ nodeId: 'n-block', kind: 'note', number: '注2：', parent: { nodeId: 'cl-1', kind: 'clause' }, index: 2, siblingCount: 5 })
    expect(block.node.ir).toMatchObject({ kind: 'note', id: 'n-block' })
    expect((block.node.ir as { content: Array<{ kind: string; id: string }> }).content.map(item => [item.kind, item.id]))
      .toEqual([['paragraph', 'n-block-p1'], ['paragraph', 'n-block-p2'], ['list', 'n-block-l']])
    const example = readNode(source, 'e-block')
    if (!example.ok) throw new Error(example.reason)
    expect(example.node).toMatchObject({ kind: 'example', number: '示例2：', index: 4 })
  })

  it('整体替换：多块注/示例/含罗马列项的列表写作片段表达不了，readNode 标为不可替换；单段旧 note 仍可替换', () => {
    for (const id of ['n-block', 'e-block', 'l-roman']) {
      const info = readNode(source, id)
      if (!info.ok) throw new Error(info.reason)
      expect(info.node.replaceable, id).toBe(false)
      expect(info.node.notReplaceable?.length, id).toBeGreaterThan(0)
    }
    const legacy = readNode(source, 'n-legacy')
    if (!legacy.ok) throw new Error(legacy.reason)
    expect(legacy.node.replaceable).toBe(true)
  })

  it('replace 多块注默认被拒绝、文档不变；acceptLoss 才执行（替换为单段注）并留下警告', () => {
    const operations = [{ op: 'replace', nodeId: 'n-block', content: [{ kind: 'note', content: '改写后的单段注。' }] }]
    const refused = applyDocumentOperations(clone(source), operations, { generateId: seqIds() })
    expect(refused.ok).toBe(false)
    if (!refused.ok) expect(refused.issues.map(item => item.nodeId)).toContain('n-block')
    const accepted = applyDocumentOperations(clone(source), [{ ...operations[0]!, acceptLoss: true }], { generateId: seqIds() })
    expect(accepted.ok).toBe(true)
    if (accepted.ok) {
      expect(JSON.stringify(accepted.doc)).not.toContain('noteBlock')
      expect(JSON.stringify(accepted.doc)).toContain('改写后的单段注。')
    }
  })

  it('delete / move：noteBlock 整体删除或移动到其他条，子块 id 保持；前后兄弟不受影响', () => {
    const deleted = applyDocumentOperations(clone(source), [{ op: 'delete', nodeId: 'n-block' }], { generateId: seqIds() })
    expect(deleted.ok).toBe(true)
    if (deleted.ok) {
      expect(JSON.stringify(deleted.doc)).not.toContain('n-block')
      expect(JSON.stringify(deleted.doc)).toContain('n-legacy')
      expect(JSON.stringify(deleted.doc)).toContain('e-block')
    }
    const moved = applyDocumentOperations(clone(source), [{ op: 'move', nodeId: 'e-block', parent: 'cl-2', position: 'end' }], { generateId: seqIds() })
    expect(moved.ok).toBe(true)
    if (moved.ok) {
      const ir = pmToIr(moved.doc).doc
      const target = ir.body[0]!.children.find(child => child.id === 'cl-2')
      expect(target?.kind === 'clause' && target.children.map(child => child.id)).toEqual(['p-2', 'e-block'])
      expect(pmToIr(moved.doc).doc.unsupportedContent).toBeUndefined()
    }
  })

  it('insert 以 noteBlock 为锚点（before/after）：锚点按 IR 兄弟序列定位，不因多块内容偏移', () => {
    const inserted = applyDocumentOperations(clone(source), [
      { op: 'insert', parent: 'cl-1', position: { after: 'n-block' }, content: [{ kind: 'paragraph', content: '插入在多块注之后。' }] },
    ], { generateId: seqIds() })
    expect(inserted.ok).toBe(true)
    if (inserted.ok) {
      const clause1 = pmToIr(inserted.doc).doc.body[0]!.children[0]!
      expect(clause1.kind === 'clause' && clause1.children.map(child => child.kind)).toEqual(['paragraph', 'note', 'note', 'paragraph', 'example', 'example'])
    }
  })
})
