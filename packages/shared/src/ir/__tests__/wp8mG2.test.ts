/**
 * WP8.M G2：通用定义列表（缩略语 def-list）与 abbreviation 引用——shared 层（IR、PM 映射、Resolver、写作层）。
 * 矩阵行：M-10.1.4-01、-03、-04、-05，M-10.1.1-04。
 * 输出边界与排版见 renderers/__tests__/wp8mG2Boundary.test.ts、wp8mG2Render.test.ts。
 */

import { describe, expect, it } from 'vitest'
import { normalizeAuthoringFragment } from '../authoring'
import { hasSemanticExtensions } from '../extensions'
import { collectFootnotes } from '../footnotes'
import { IRToPmError, irToPm } from '../irToPm'
import { pmToIr, type PMJsonNode } from '../pmToIr'
import { resolve } from '../resolve'
import type { IRBlock, IRDefList, IRDoc, IRParagraph } from '../types'
import { abbrRef, defItem, g2IrDoc, g2MainList, g2PmDoc, pmDefItem } from './wp8mG2Fixtures'

const errors = (doc: IRDoc) => resolve(doc).problems.filter(problem => problem.severity === 'error')

function defLists(doc: IRDoc): IRDefList[] {
  const found: IRDefList[] = []
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) { value.forEach(visit); return }
    if (!value || typeof value !== 'object') return
    const row = value as Record<string, unknown>
    if (row.kind === 'defList') found.push(row as unknown as IRDefList)
    for (const child of Object.values(row)) visit(child)
  }
  visit(doc.body)
  visit(doc.appendices)
  return found
}

function findPm(node: PMJsonNode, type: string, nodeId: string): PMJsonNode {
  let found: PMJsonNode | undefined
  const visit = (current: PMJsonNode): void => {
    if (current.type === type && current.attrs?.nodeId === nodeId) found = current
    current.content?.forEach(visit)
  }
  visit(node)
  if (!found) throw new Error(`找不到 ${type}#${nodeId}`)
  return found
}

function pmTypes(node: PMJsonNode, out: string[] = []): string[] {
  out.push(node.type)
  node.content?.forEach(child => pmTypes(child, out))
  return out
}

describe('[M-10.1.4-01] IR 块 defList：PM ↔ IR 映射', () => {
  it('pmToIr：defList 读成 IRDefList，无警告、无 unsupportedContent，语义扩展版本 1', () => {
    const { doc, warnings } = pmToIr(g2PmDoc())
    expect(warnings).toEqual([])
    expect(doc.unsupportedContent ?? []).toEqual([])
    expect(doc.extensionVersion).toBe(1)
    expect(defLists(doc).map(list => [list.kind, list.id, list.items.map(item => item.id)])).toEqual([
      ['defList', 'g2-list', ['abb-adc', 'abb-agc', 'abb-ct']],
      ['defList', 'g2-list-app', ['abb-app']],
    ])
  })

  it('irToPm：defList → PM defList > whereItem > whereTerm + whereDefinition，容器与项都带 nodeId', () => {
    const list = findPm(irToPm(g2IrDoc()), 'defList', 'g2-list')
    expect(list.attrs).toEqual({ nodeId: 'g2-list' })
    expect(list.content!.map(item => [item.type, item.attrs, item.content!.map(cell => cell.type)])).toEqual([
      ['whereItem', { nodeId: 'abb-adc' }, ['whereTerm', 'whereDefinition']],
      ['whereItem', { nodeId: 'abb-agc' }, ['whereTerm', 'whereDefinition']],
      ['whereItem', { nodeId: 'abb-ct' }, ['whereTerm', 'whereDefinition']],
    ])
  })

  it('IR → PM → IR 两轮 + JSON 往返后 IR 与 PM 都深度相等；PM → IR → PM 也稳定', () => {
    const first = pmToIr(irToPm(g2IrDoc())).doc
    const second = pmToIr(JSON.parse(JSON.stringify(irToPm(first))) as PMJsonNode).doc
    expect(second).toEqual(first)
    expect(irToPm(second)).toEqual(irToPm(first))
    const fromPm = pmToIr(g2PmDoc()).doc
    expect(pmToIr(irToPm(fromPm)).doc).toEqual(fromPm)
  })

  it('生产 PM 文档与手写 IR 文档描述同一份缩略语表（每项 id、术语、释义文本一致）', () => {
    const summary = (doc: IRDoc) => defLists(doc).map(list => list.items.map(item => [
      item.id, item.term.map(run => run.text).join(''), item.definition.map(run => run.text).join(''),
    ]))
    expect(summary(pmToIr(g2PmDoc()).doc)).toEqual(summary(g2IrDoc()))
  })

  it('空的缩略语表：IR → PM 报带路径与节点 id 的 IRToPmError（生产 Schema 要求至少一项）', () => {
    const doc = g2IrDoc()
    ;(doc.body[2]!.children[1] as IRDefList).items = []
    let caught: unknown
    try { irToPm(doc) } catch (error) { caught = error }
    expect(caught).toBeInstanceOf(IRToPmError)
    const diagnostics = (caught as IRToPmError).diagnostics
    expect(diagnostics.map(item => item.nodeId)).toEqual(['g2-list'])
    expect(diagnostics[0]!.path).toContain('.items')
  })

  it('defList 内出现非 whereItem 子节点：按未知内容报告，不静默丢弃', () => {
    const pm = g2PmDoc()
    const list = findPm(pm, 'defList', 'g2-list')
    list.content!.push({ type: 'stdParagraph', attrs: { nodeId: 'stray' }, content: [{ type: 'text', text: '游离段落' }] })
    const { doc } = pmToIr(pm)
    expect(doc.unsupportedContent?.some(item => item.nodeType === 'stdParagraph')).toBe(true)
    expect(defLists(doc)[0]!.items).toHaveLength(3)
  })

  it('公式 whereList 抽取为共享函数后行为不变：式中项仍映射为 formula.whereList，容器无 nodeId', () => {
    const pm: PMJsonNode = {
      type: 'doc',
      content: [{
        type: 'chapter', attrs: { nodeId: 'f-ch' },
        content: [
          { type: 'chapterTitle', content: [{ type: 'text', text: '一般要求' }] },
          {
            type: 'formula', attrs: { nodeId: 'f1', latex: 'a=b', numbered: true },
            content: [
              { type: 'formulaContent', content: [{ type: 'text', text: 'a=b' }] },
              { type: 'whereList', content: [pmDefItem('w1', 'a', '长度'), pmDefItem('w2', 'b', '宽度')] },
            ],
          },
        ],
      }],
    }
    const { doc } = pmToIr(pm)
    const formula = doc.body[0]!.children[0] as Extract<IRBlock, { kind: 'formula' }>
    expect(formula.whereList.map(item => [item.id, item.term[0]!.text, item.definition[0]!.text])).toEqual([
      ['w1', 'a', '长度'], ['w2', 'b', '宽度'],
    ])
    const where = findPm(irToPm(doc), 'formula', 'f1').content!.find(child => child.type === 'whereList')!
    expect(where.attrs).toBeUndefined()
    expect(where.content!.map(item => item.attrs)).toEqual([{ nodeId: 'w1' }, { nodeId: 'w2' }])
  })
})

describe('[M-10.1.4-04][M-10.1.4-05] 项的术语与释义（IRDefItem.term / definition）', () => {
  it('术语与释义各为行内数组，marks（粗体、crossRef）原样保留', () => {
    const { doc } = pmToIr(g2PmDoc())
    const ct = defLists(doc)[0]!.items[2]!
    expect(ct.term).toEqual([{ text: 'CT' }])
    expect(ct.definition).toEqual([
      { text: '计算机断层扫描，参见' },
      { text: 'ADC', marks: [{ type: 'crossRef', targetId: 'abb-adc', targetKind: 'abbreviation' }] },
      { text: '与', marks: [{ type: 'bold' }] },
      { text: '电流互感器' },
    ])
  })

  it('术语含上下标与斜体时同样保留；空释义不丢项', () => {
    const pm = g2PmDoc()
    const list = findPm(pm, 'defList', 'g2-list')
    list.content = [
      pmDefItem('x1', [
        { type: 'text', text: 'CO' },
        { type: 'text', text: '2', marks: [{ type: 'subscript' }] },
      ], '二氧化碳'),
      pmDefItem('x2', 'N/A', ''),
    ]
    const { doc } = pmToIr(pm)
    expect(defLists(doc)[0]!.items).toEqual([
      { id: 'x1', term: [{ text: 'CO' }, { text: '2', marks: [{ type: 'sub' }] }], definition: [{ text: '二氧化碳' }] },
      { id: 'x2', term: [{ text: 'N/A' }], definition: [] },
    ])
    expect(pmToIr(irToPm(doc)).doc).toEqual(doc)
  })
})

describe('[M-10.1.4-03] Resolver：缩略语项的标签与 xmlId（abb_<k>，D-M-02）', () => {
  it('label 与 refText 为术语纯文本，xmlId 按全文文档序编号（含附录）', () => {
    const { labels, problems } = resolve(g2IrDoc())
    expect(problems.filter(problem => problem.severity === 'error')).toEqual([])
    expect(labels['abb-adc']).toEqual({ label: 'ADC', xmlId: 'abb_1', refText: 'ADC' })
    expect(labels['abb-agc']).toEqual({ label: 'AGC', xmlId: 'abb_2', refText: 'AGC' })
    expect(labels['abb-ct']).toEqual({ label: 'CT', xmlId: 'abb_3', refText: 'CT' })
    expect(labels['abb-app']).toEqual({ label: 'UTF-8', xmlId: 'abb_4', refText: 'UTF-8' })
  })

  it('术语含格式时 label 取纯文本（不含标记）；表本身不赋标签', () => {
    const doc = g2IrDoc()
    ;(doc.body[2]!.children[1] as IRDefList).items[0] = defItem('abb-adc', [{ text: 'CO' }, { text: '2', marks: [{ type: 'sub' }] }], '二氧化碳')
    const { labels } = resolve(doc)
    expect(labels['abb-adc']).toEqual({ label: 'CO2', xmlId: 'abb_1', refText: 'CO2' })
    expect(labels['g2-list']).toBeUndefined()
    expect(labels['g2-list-app']).toBeUndefined()
  })

  it('xmlId 唯一，且全文没有 ext_ 占位标签（R-5：XML 不得出现 ext_）', () => {
    const { labels } = resolve(g2IrDoc())
    const ids = Object.values(labels).map(entry => entry.xmlId)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids.filter(id => id.startsWith('ext_'))).toEqual([])
  })

  it('没有缩略语表的文档：编号序不受影响，旧文档标签集合不变', () => {
    const doc = g2IrDoc()
    doc.body[2]!.children = doc.body[2]!.children.filter(child => child.kind !== 'defList')
    doc.appendices = []
    doc.body[0]!.children = [{ kind: 'paragraph', id: 'g2-scope-p', content: [{ text: '无引用。' }] }]
    const { labels } = resolve(doc)
    expect(Object.values(labels).some(entry => entry.xmlId.startsWith('abb_'))).toBe(false)
    expect(errors(doc)).toEqual([])
  })

  it('缩略语项 id 与其他节点重复 → duplicate-id；缺 id → missing-id', () => {
    const duplicated = g2IrDoc()
    ;(duplicated.body[2]!.children[1] as IRDefList).items[1]!.id = 'abb-adc'
    expect(errors(duplicated).map(problem => problem.code)).toContain('duplicate-id')
    const missing = g2IrDoc()
    ;(missing.body[2]!.children[1] as IRDefList).items[0]!.id = ''
    expect(errors(missing).map(problem => problem.code)).toContain('missing-id')
  })

  it('经 PM 往返后的 Resolver 结果与手写 IR 一致', () => {
    const fromPm = resolve(pmToIr(g2PmDoc()).doc).labels
    const fromIr = resolve(g2IrDoc()).labels
    for (const id of ['abb-adc', 'abb-agc', 'abb-ct', 'abb-app']) expect(fromPm[id], id).toEqual(fromIr[id])
  })
})

describe('[M-10.1.1-04] crossRef targetKind=abbreviation', () => {
  it('类型引用解析成功：引用段的 crossRef 保留 abbreviation，无 Resolver 错误', () => {
    const doc = g2IrDoc()
    expect(errors(doc)).toEqual([])
    const reference = doc.body[0]!.children[0] as IRParagraph
    expect(reference.content.flatMap(run => run.marks ?? [])).toEqual([
      { type: 'crossRef', targetId: 'abb-adc', targetKind: 'abbreviation' },
      { type: 'crossRef', targetId: 'abb-ct' },
    ])
  })

  it('PM refType=abbreviation ↔ IR targetKind=abbreviation；无类型引用保持无类型', () => {
    const { doc, warnings } = pmToIr(g2PmDoc())
    expect(warnings).toEqual([])
    const reference = doc.body[0]!.children[0] as IRParagraph
    expect(reference.content.flatMap(run => run.marks ?? [])).toEqual([
      { type: 'crossRef', targetId: 'abb-adc', targetKind: 'abbreviation' },
      { type: 'crossRef', targetId: 'abb-ct' },
    ])
    const pm = irToPm(doc)
    const marks: unknown[] = []
    const visit = (node: PMJsonNode): void => {
      for (const mark of node.marks ?? []) if (mark.type === 'crossRef') marks.push(mark.attrs)
      node.content?.forEach(visit)
    }
    visit(findPm(pm, 'chapter', 'g2-scope'))
    expect(marks).toEqual([{ targetId: 'abb-adc', refType: 'abbreviation' }, { targetId: 'abb-ct', refType: '' }])
  })

  it('类型与目标不符：指向段落却声明 abbreviation、指向缩略语项却声明 figure，都报 dangling-typed-ref', () => {
    // 段落没有编号，类型不符之外还会同时报“没有编号”的 dangling-xref
    const wrongTarget = g2IrDoc([abbrRef('g2-norm-p')])
    expect(errors(wrongTarget).map(problem => problem.code)).toContain('dangling-typed-ref')
    const wrongKind = g2IrDoc([{ text: '见图', marks: [{ type: 'crossRef', targetId: 'abb-adc', targetKind: 'figure' }] }])
    expect(errors(wrongKind).map(problem => problem.code)).toEqual(['dangling-typed-ref'])
  })

  it('目标不存在 → dangling-xref；引用缩略语表本身（无编号）→ dangling-xref', () => {
    expect(errors(g2IrDoc([abbrRef('nope')])).map(problem => problem.code)).toEqual(['dangling-xref'])
    expect(errors(g2IrDoc([abbrRef('g2-list', '表', null)])).map(problem => problem.code)).toEqual(['dangling-xref'])
  })

  it('refText 取术语文本：引用处文字被替换为缩略语', () => {
    const { labels } = resolve(g2IrDoc())
    expect(labels['abb-adc']!.refText).toBe('ADC')
    expect(labels['abb-ct']!.refText).toBe('CT')
  })

  it('缩略语项内的引用（释义引用另一缩略语）同样登记并通过类型检查', () => {
    expect(errors(g2IrDoc([{ text: '无引用。' }]))).toEqual([])
    const bad = g2IrDoc([{ text: '无引用。' }])
    ;(bad.body[2]!.children[1] as IRDefList).items[2]!.definition.push(abbrRef('abb-ghost'))
    expect(errors(bad).map(problem => problem.code)).toEqual(['dangling-xref'])
  })
})

describe('[M-10.1.4-01] 定义列表内禁止条文脚注（ForbiddenFootnoteContainer 「定义列表」）', () => {
  const withFootnote = (where: 'term' | 'definition'): IRDoc => {
    const doc = g2IrDoc()
    const item = (doc.body[2]!.children[1] as IRDefList).items[0]!
    item[where] = [...item[where], { text: '', footnote: { id: 'fn-in-defs', content: [{ text: '脚注内容。' }] } }]
    return doc
  }

  it('术语或释义含脚注 → invalid-footnote（error），提示指向“定义列表”', () => {
    for (const where of ['term', 'definition'] as const) {
      const problems = errors(withFootnote(where)).filter(problem => problem.code === 'invalid-footnote')
      expect(problems, where).toHaveLength(1)
      expect(problems[0]!.nodeId).toBe('abb-adc')
      expect(problems[0]!.message).toContain('定义列表')
    }
  })

  it('collectFootnotes 仍能收集到该脚注（由 Resolver 报错而不是被静默漏掉）', () => {
    expect(collectFootnotes(withFootnote('definition')).map(note => note.id)).toEqual(['fn-in-defs'])
  })

  it('正文段落里的脚注不受影响：同一文档里的正常脚注编号为 1)', () => {
    const doc = g2IrDoc()
    ;(doc.body[0]!.children[0] as IRParagraph).content.push({ text: '', footnote: { id: 'fn-ok', content: [{ text: '正常脚注。' }] } })
    const { labels, problems } = resolve(doc)
    expect(problems.filter(problem => problem.severity === 'error')).toEqual([])
    expect(labels['fn-ok']).toEqual({ label: '1)', xmlId: 'fn_1', refText: '1)' })
  })
})

describe('[M-10.1.4-01] 语义扩展判定与写作层', () => {
  it('含 defList 的文档被判为语义扩展；既有 fixture 与不含 defList 的文档不受影响', () => {
    expect(hasSemanticExtensions(g2IrDoc())).toBe(true)
    // 去掉缩略语表、附录与引用后，其余内容不属于语义扩展；只加回一个 defList 就翻转判定（块 kind 判定）。
    const doc = g2IrDoc()
    doc.body[0]!.children = [{ kind: 'paragraph', id: 'g2-scope-p', content: [{ text: '无引用。' }] }]
    doc.body[2]!.children = doc.body[2]!.children.filter(child => child.kind !== 'defList')
    doc.appendices = []
    expect(hasSemanticExtensions(doc)).toBe(false)
    doc.body[2]!.children.push(g2MainList())
    expect(hasSemanticExtensions(doc)).toBe(true)
  })

  const generateId = (() => { let n = 0; return () => `gen-${++n}` })()
  const fragment = (targetKind: string) => [{
    kind: 'paragraph', content: [{ text: 'ADC', marks: [{ type: 'crossRef', targetId: 'abb-adc', targetKind }] }],
  }]

  it('写作层：crossRef 接受 targetKind=abbreviation', () => {
    const result = normalizeAuthoringFragment(fragment('abbreviation'), { parent: 'chapter' }, { generateId })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.nodes[0]).toMatchObject({ kind: 'paragraph', content: [{ text: 'ADC', marks: [{ type: 'crossRef', targetId: 'abb-adc', targetKind: 'abbreviation' }] }] })
  })

  it('写作层：拼写错误的取值仍被拒绝，提示列出 abbreviation', () => {
    const result = normalizeAuthoringFragment(fragment('abbr'), { parent: 'chapter' }, { generateId })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      const issue = result.issues.find(entry => entry.path === 'fragment[0].content[0].marks[0].targetKind')
      expect(issue?.code).toBe('invalid-value')
      expect(issue?.reason).toContain('abbreviation')
    }
  })

  it('写作层：不能创建 defList（写作入口本阶段不放开），以 unsupported-kind 拒绝', () => {
    const result = normalizeAuthoringFragment([{ kind: 'defList', items: [] }], { parent: 'chapter' }, { generateId })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.issues.map(issue => issue.code)).toEqual(['unsupported-kind'])
  })
})

describe('生产 PM 结构的节点类型序列（回归：缩略语表只用既有的式中项节点，P8）', () => {
  it('IR → PM：新增块只有 defList，项节点复用 whereItem/whereTerm/whereDefinition', () => {
    const types = new Set(pmTypes(irToPm(g2IrDoc())))
    expect(types.has('defList')).toBe(true)
    for (const type of ['whereItem', 'whereTerm', 'whereDefinition']) expect(types.has(type), type).toBe(true)
    expect(types.has('whereList')).toBe(false)
  })
})
