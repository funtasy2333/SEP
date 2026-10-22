/**
 * WP8.M G5：术语领域 `subjectField` 与 `termEntry` 独立 id（设计 §4.5）——shared 层。
 *
 * 覆盖 pmToIr / irToPm 双向映射、Resolver 的 `termEntryXmlId`、`hasSemanticExtensions`、写作入口的明确拒绝，
 * 以及旧文档（不含领域）的 IR/PM 投影不变。生产 Schema、HTML 往返与保存重开见 client 的 wp8mG5.test.ts，
 * 输出边界见 renderers/__tests__/wp8mG5Boundary.test.ts。
 */

import { describe, expect, it } from 'vitest'
import { normalizeAuthoringFragment } from '../authoring'
import { hasSemanticExtensions } from '../extensions'
import { irToPm } from '../irToPm'
import { pmToIr, type PMJsonNode } from '../pmToIr'
import { resolve } from '../resolve'
import type { IRChapterChild, IRDoc, IRTermEntry } from '../types'
import { fullFixture } from './fixtures'
import {
  SUBJECT_CUSTOMER, SUBJECT_ISO_IEC, g5IrDoc, g5PmDoc, g5PrintDoc,
} from './wp8mG5Fixtures'

function termEntries(children: IRChapterChild[], out: IRTermEntry[] = []): IRTermEntry[] {
  for (const child of children) {
    if (child.kind === 'termEntry') {
      out.push(child)
      termEntries(child.nestedEntries ?? [], out)
    } else if (child.kind === 'clause') termEntries(child.children, out)
  }
  return out
}

function allTerms(doc: IRDoc): IRTermEntry[] {
  return [...doc.body.flatMap(chapter => termEntries(chapter.children)), ...doc.appendices.flatMap(app => termEntries(app.children))]
}

function termDefNodes(node: PMJsonNode, out: PMJsonNode[] = []): PMJsonNode[] {
  if (node.type === 'termDef') out.push(node)
  node.content?.forEach(child => termDefNodes(child, out))
  return out
}

describe('[M-9.2.9-01] pmToIr：termSubjectField → IRTermEntry.subjectField', () => {
  it('领域节点映射为条目级 subjectField，纯领域名称不含 〈〉', () => {
    const { doc, warnings } = pmToIr(g5PmDoc())
    expect(warnings).toEqual([])
    expect(doc.unsupportedContent ?? []).toEqual([])
    const [withField, withoutField] = allTerms(doc)
    expect(withField!.subjectField).toEqual([{ text: SUBJECT_CUSTOMER }])
    expect(JSON.stringify(withField!.subjectField)).not.toMatch(/[〈〉<>]/)
    expect('subjectField' in withoutField!).toBe(false)
  })

  it('带格式的领域内容（mark）按行内规则保留', () => {
    const pm = g5PmDoc()
    const terms = termDefNodes(pm)
    terms[0]!.content!.find(node => node.type === 'termSubjectField')!.content = [
      { type: 'text', text: '化学', marks: [{ type: 'bold' }] },
      { type: 'text', text: '2', marks: [{ type: 'italic' }] },
    ]
    const entry = allTerms(pmToIr(pm).doc)[0]!
    expect(entry.subjectField).toEqual([
      { text: '化学', marks: [{ type: 'bold' }] },
      { text: '2', marks: [{ type: 'italic' }] },
    ])
  })

  it('空 termSubjectField 节点被忽略，不写空数组也不报告丢内容', () => {
    const pm = g5PmDoc()
    termDefNodes(pm)[0]!.content!.find(node => node.type === 'termSubjectField')!.content = []
    const { doc, warnings } = pmToIr(pm)
    expect(allTerms(doc)[0]!.subjectField).toBeUndefined()
    expect(warnings).toEqual([])
    expect(doc.unsupportedContent ?? []).toEqual([])
  })

  it('绕过 Schema 的多个领域节点被明确报告，而不是静默覆盖', () => {
    const pm = g5PmDoc()
    const term = termDefNodes(pm)[0]!
    const field = term.content!.find(node => node.type === 'termSubjectField')!
    term.content!.splice(term.content!.indexOf(field), 0, { type: 'termSubjectField', content: [{ type: 'text', text: '第二个领域' }] })
    const { doc } = pmToIr(pm)
    // 第一个有内容的领域保留；其余按“IR 只允许一个”明确诊断。
    expect(allTerms(doc)[0]!.subjectField).toEqual([{ text: '第二个领域' }])
    expect(doc.unsupportedContent).toEqual([expect.objectContaining({
      nodeId: 'g5-t1', nodeType: 'termSubjectField', reason: expect.stringContaining('多个领域字段'),
    })])
  })

  it('含领域的文档判定为语义扩展（extensionVersion=1），不含领域的旧术语文档保持未版本化', () => {
    expect(pmToIr(g5PmDoc()).doc.extensionVersion).toBe(1)
    const legacy = g5PmDoc()
    termDefNodes(legacy)[0]!.content = termDefNodes(legacy)[0]!.content!.filter(node => node.type !== 'termSubjectField')
    expect(pmToIr(legacy).doc.extensionVersion).toBeUndefined()
    expect(hasSemanticExtensions({ kind: 'termEntry', subjectField: [{ text: '领域' }] })).toBe(true)
    expect(hasSemanticExtensions({ kind: 'termEntry', subjectField: [] })).toBe(false)
    // 既有字节锁定 fixture 不含领域：IR 中不会凭空出现该字段。
    expect(JSON.stringify(pmToIr(fullFixture()).doc)).not.toContain('subjectField')
  })
})

describe('[M-9.2.9-01] irToPm：subjectField → termSubjectField（在英文名之后、定义之前）', () => {
  it('输出位置固定于 termNameEn 与 termDefinition 之间，且不带 nodeId', () => {
    const pm = irToPm(g5IrDoc())
    const [withField, withoutField] = termDefNodes(pm)
    expect(withField!.content!.map(node => node.type)).toEqual(['termName', 'termNameEn', 'termSubjectField', 'termDefinition'])
    expect(withField!.content![2]).toEqual({ type: 'termSubjectField', content: [{ type: 'text', text: SUBJECT_CUSTOMER }] })
    expect(withoutField!.content!.map(node => node.type)).toEqual(['termName', 'termDefinition'])
  })

  it('没有英文名时领域紧随术语名；领域不进入 tailOrder 顺序元数据', () => {
    const doc = g5IrDoc()
    const entry = allTerms(doc).find(item => item.id === 'g5-t-marked')!
    const pm = irToPm(doc)
    const node = termDefNodes(pm).find(item => item.attrs?.nodeId === 'g5-t-marked')!
    expect(node.content!.map(child => child.type)).toEqual(['termName', 'termSubjectField', 'termDefinition'])
    expect(entry.tailOrder).toBeUndefined()
    expect(allTerms(pmToIr(pm).doc).find(item => item.id === 'g5-t-marked')!.tailOrder).toBeUndefined()
  })

  it('subjectField 为空数组与缺省等价：不输出空节点', () => {
    const doc = g5IrDoc()
    allTerms(doc)[0]!.subjectField = []
    const node = termDefNodes(irToPm(doc))[0]!
    expect(node.content!.map(child => child.type)).toEqual(['termName', 'termNameEn', 'termDefinition'])
  })

  it('嵌套术语的领域也写入嵌套的 termDef', () => {
    const pm = irToPm(g5IrDoc())
    const nested = termDefNodes(pm).find(node => node.attrs?.nodeId === 'g5-t41')!
    expect(nested.content!.map(child => child.type)).toEqual(['termName', 'termSubjectField', 'termDefinition'])
  })
})

describe('[M-9.2.9-01] PM → IR → PM → IR 往返无损', () => {
  it('IR 原生文档：irToPm → pmToIr 深度相等，且经 JSON 序列化再投影结果不变', () => {
    const source = g5IrDoc()
    const projected = pmToIr(irToPm(source))
    expect(projected.warnings).toEqual([])
    expect(projected.doc.unsupportedContent ?? []).toEqual([])
    expect(allTerms(projected.doc).map(entry => [entry.id, entry.subjectField])).toEqual(
      allTerms(source).map(entry => [entry.id, entry.subjectField]),
    )
    const reparsed = pmToIr(JSON.parse(JSON.stringify(irToPm(projected.doc))) as PMJsonNode)
    expect(reparsed.doc).toEqual(projected.doc)
  })

  it('PM 原生文档：pmToIr → irToPm 保留领域节点的位置与文本', () => {
    const source = g5PmDoc()
    const rewritten = irToPm(pmToIr(source).doc)
    expect(termDefNodes(rewritten).map(node => node.content!.map(child => child.type))).toEqual(
      termDefNodes(source).map(node => node.content!.map(child => child.type)),
    )
    expect(JSON.stringify(rewritten)).toContain(SUBJECT_CUSTOMER)
  })

  it('不含领域的旧术语文档：投影不含任何领域痕迹（回归）', () => {
    const doc = pmToIr(fullFixture()).doc
    expect(JSON.stringify(doc)).not.toContain('subjectField')
    expect(JSON.stringify(irToPm(doc))).not.toContain('termSubjectField')
  })
})

describe('[M-9.2.1-05] Resolver：termEntryXmlId = term_<编号>（R-3）', () => {
  it('每个术语条目都有 term_<编号>，编号与该条目的 label 相同；sec_<编号> 保持不变', () => {
    const { labels, problems } = resolve(g5IrDoc())
    expect(problems.filter(problem => problem.severity === 'error')).toEqual([])
    const expected: Record<string, [string, string]> = {
      'g5-t1': ['3.1', 'term_3.1'],
      'g5-t2': ['3.2', 'term_3.2'],
      'g5-t-iso': ['3.3.1', 'term_3.3.1'],
      'g5-t-marked': ['3.3.2', 'term_3.3.2'],
      'g5-t4': ['3.4', 'term_3.4'],
      'g5-t41': ['3.4.1', 'term_3.4.1'],
      'g5-t-app': ['A.1', 'term_A.1'],
    }
    for (const [id, [label, termId]] of Object.entries(expected)) {
      expect(labels[id], id).toEqual({ label, xmlId: `sec_${label}`, refText: label, termEntryXmlId: termId })
      // 编号与 label 相同：term_<label>
      expect(labels[id]!.termEntryXmlId).toBe(`term_${labels[id]!.label}`)
    }
  })

  it('sec_<n> 与 term_<n> 并存、互不覆盖，且 term_ 值在全文唯一', () => {
    const { labels } = resolve(g5IrDoc())
    const termIds = Object.values(labels).map(label => label.termEntryXmlId).filter((value): value is string => value !== undefined)
    expect(termIds).toHaveLength(7)
    expect(new Set(termIds).size).toBe(termIds.length)
    const xmlIds = Object.values(labels).map(label => label.xmlId)
    expect(xmlIds.filter(id => termIds.includes(id))).toEqual([])
    expect(labels['g5-t1']!.xmlId).toBe('sec_3.1')
    expect(labels['g5-t1']!.termEntryXmlId).toBe('term_3.1')
  })

  it('只有术语条目带 termEntryXmlId；章、条、附录、术语定义段等其他实体不带', () => {
    const { labels } = resolve(g5IrDoc())
    const withTermId = Object.entries(labels).filter(([, label]) => 'termEntryXmlId' in label).map(([id]) => id).sort()
    expect(withTermId).toEqual(['g5-t-app', 'g5-t-iso', 'g5-t-marked', 'g5-t1', 'g5-t2', 'g5-t4', 'g5-t41'])
    expect(labels['g5-terms']).toEqual({ label: '3', xmlId: 'sec_3', refText: '第3章' })
    expect(labels['g5-clause']!.xmlId).toBe('sec_3.3')
    expect('termEntryXmlId' in labels['g5-clause']!).toBe(false)
  })

  it('termRef 与 crossRef(targetKind=term) 的 refText 仍为条目编号，不受独立 id 影响', () => {
    const { labels, problems } = resolve(g5IrDoc())
    expect(problems.filter(problem => problem.code === 'dangling-xref' || problem.code === 'dangling-typed-ref')).toEqual([])
    expect(labels['g5-t1']!.refText).toBe('3.1')
  })

  it('无领域的旧术语文档同样得到 term_<n>；结果为纯函数且不改入参', () => {
    const doc = pmToIr(fullFixture()).doc
    const before = JSON.stringify(doc)
    const first = resolve(doc)
    const second = resolve(doc)
    expect(JSON.stringify(doc)).toBe(before)
    expect(first.labels).toEqual(second.labels)
    expect(first.labels['term-1']).toMatchObject({ label: '3.1', xmlId: 'sec_3.1', termEntryXmlId: 'term_3.1' })
  })

  it('termEntryXmlId 不进入语义 JSON 的既有 number/path 输出（label 对象整体不被泄漏）', () => {
    const labels = resolve(g5PrintDoc()).labels
    expect(JSON.parse(JSON.stringify(labels['g5-t1']))).toEqual({
      label: '3.1', xmlId: 'sec_3.1', refText: '3.1', termEntryXmlId: 'term_3.1',
    })
  })
})

describe('[M-9.2.9-01] Resolver：领域内容的脚注限制沿用术语条目规则', () => {
  it('领域内的条文脚注报 invalid-footnote（inTerm）', () => {
    const doc = g5IrDoc()
    allTerms(doc)[0]!.subjectField = [{ text: SUBJECT_ISO_IEC, footnote: { id: 'g5-fn', content: [{ text: '脚注' }] } }]
    const problems = resolve(doc).problems.filter(problem => problem.code === 'invalid-footnote')
    expect(problems.some(problem => problem.severity === 'error' && problem.nodeId === 'g5-t1')).toBe(true)
  })

  it('领域内的行内 mark（crossRef）被访问并解析，不落入 ext_ 占位标签', () => {
    const doc = g5IrDoc()
    allTerms(doc)[1]!.subjectField = [{ text: '参见', marks: [{ type: 'crossRef', targetId: 'g5-t1', targetKind: 'term' }] }]
    const { labels, problems } = resolve(doc)
    expect(problems.filter(problem => problem.severity === 'error')).toEqual([])
    expect(Object.values(labels).some(label => label.xmlId.startsWith('ext_'))).toBe(false)
  })
})

describe('[M-9.2.9-01] 写作入口：subjectField 暂不支持，给出明确提示而非“未知字段”', () => {
  it('termEntry 片段携带 subjectField → unsupported-field', () => {
    const result = normalizeAuthoringFragment([{
      kind: 'termEntry', id: 'x', term: [{ text: '术语' }],
      definition: [{ kind: 'paragraph', content: [{ text: '定义' }] }],
      subjectField: [{ text: '领域' }],
    }], { parent: 'chapter' }, { generateId: (() => { let n = 0; return () => `w${++n}` })() })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.issues.some(issue => issue.code === 'unsupported-field' && issue.path.endsWith('.subjectField'))).toBe(true)
      expect(result.issues.some(issue => issue.code === 'unknown-field')).toBe(false)
    }
  })
})
