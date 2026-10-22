import { describe, expect, it } from 'vitest'
import { pmToIr, type PMJsonNode } from '@ses/shared'
import { applyDocumentOperations } from './apply'
import { readNode } from './readNode'
import { chapter, clone, deepFreeze, doc, node, seqIds, text } from './testFixtures'

/** 术语章：term-field 带领域，term-plain 不带。 */
function documentWithSubjectField(): PMJsonNode {
  return doc(chapter('ch-terms', '术语和定义',
    node('termDef', { nodeId: 'term-field', level: 1 }, [
      node('termName', undefined, [text('协会')]),
      node('termNameEn', undefined, [text('association')]),
      node('termSubjectField', undefined, [text('顾客满意')]),
      node('termDefinition', undefined, [text('由成员组织或个人组成的组织。')]),
    ]),
    node('termDef', { nodeId: 'term-plain', level: 1 }, [
      node('termName', undefined, [text('编号')]),
      node('termDefinition', undefined, [text('为要素赋予序号。')]),
    ]),
  ))
}

describe('[M-9.2.9-01] documentOps：含领域的术语条目不能被写作片段静默整体替换', () => {
  const source = deepFreeze(documentWithSubjectField())

  it('readNode：IR 带 subjectField；该条目标为不可整体替换，原因指向“术语领域”，无领域的条目不受影响', () => {
    const result = readNode(source, 'term-field')
    if (!result.ok) throw new Error(result.reason)
    expect(result.node.ir).toMatchObject({ kind: 'termEntry', subjectField: [{ text: '顾客满意' }] })
    expect(result.node.replaceable).toBe(false)
    expect(result.node.notReplaceable).toEqual([expect.objectContaining({
      code: 'unsupported-field', path: 'ir.subjectField', message: expect.stringContaining('术语领域'),
    })])

    const plain = readNode(source, 'term-plain')
    if (!plain.ok) throw new Error(plain.reason)
    expect(plain.node.replaceable).toBe(true)
  })

  it('replace 默认被拒绝（replace-loses-content），文档不变；acceptLoss 才执行并留下警告', () => {
    const operations = [{ op: 'replace', nodeId: 'term-field', content: [{ kind: 'termEntry', term: '协会', definition: '新的定义。' }] }]
    const refused = applyDocumentOperations(clone(source), operations, { generateId: seqIds() })
    expect(refused.ok).toBe(false)
    if (!refused.ok) {
      expect(refused.issues).toEqual([expect.objectContaining({ code: 'replace-loses-content', nodeId: 'term-field' })])
      expect(refused.issues[0]!.reason).toContain('subjectField')
    }
    const accepted = applyDocumentOperations(clone(source), [{ ...operations[0]!, acceptLoss: true }], { generateId: seqIds() })
    expect(accepted.ok).toBe(true)
    if (accepted.ok) {
      expect(accepted.warnings.map(item => item.code)).toEqual(['replace-loses-content'])
      expect(JSON.stringify(accepted.doc)).not.toContain('termSubjectField')
    }
  })

  it('不触及领域的其它操作保持领域：替换同章的无领域条目后，含领域条目原样保留', () => {
    const result = applyDocumentOperations(clone(source), [{ op: 'replace', nodeId: 'term-plain', content: [{ kind: 'termEntry', term: '编号', definition: '改写。' }] }], { generateId: seqIds() })
    expect(result.ok).toBe(true)
    if (result.ok) {
      const entries = pmToIr(result.doc).doc.body[0]!.children.filter(child => child.kind === 'termEntry')
      expect(entries.map(entry => entry.kind === 'termEntry' ? entry.subjectField : undefined)).toEqual([[{ text: '顾客满意' }], undefined])
    }
  })
})
