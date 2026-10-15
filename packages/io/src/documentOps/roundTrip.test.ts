/**
 * 关键性质：对文档里每个可替换节点执行「readNode → 用返回的 IR 原样 replace」，文档保持不变；
 * 不可替换的节点被 readNode 标出，并且原样 replace 确实会被拒绝或丢失内容。
 *
 * 「不变」的含义分两层：
 * 1. 语义层（对所有可替换节点断言）：`pmToIr` 读回的 IR 逐字段相同，Resolver 的编号与问题相同；
 * 2. PM 层（去掉值为 null 的属性、不计属性顺序后）逐节点相同——除下面登记的、由 `irToPm` 规范化造成的差异：
 *    - 术语条目的「来源/注/示例」尾项按 irToPm 的固定顺序（来源、注、示例）输出；IR 在没有嵌套术语/TBX 语言集时
 *      不记录尾项的作者顺序，所以原顺序不同的术语条目会被规范化；
 *    - 术语定义段落获得派生的 nodeId（`<术语 id>.def0`）；
 *    更多规范化（旧版表脚注 `tableFootnote` → `tableNoteRow`、公式自由文本说明 → `whereList`、空的可选子节点被省略）
 *    只发生在遗留形态的文档里，由 shared 的往返测试覆盖，这里的文档不含。
 */

import { describe, expect, it } from 'vitest'
import { pmToIr, resolve, type PMJsonNode } from '@ses/shared'
import standardDocument from '../../../server/src/export/__fixtures__/standard-document.json'
import { applyDocumentOperations } from './apply'
import { indexDocument } from './locator'
import { readNode } from './readNode'
import {
  appendix, bibEntry, bibliography, chapter, clause, clone, deepFreeze, example, introduction, note, para, richDocument,
  seqIds, simpleTable, termDef, text, xref,
} from './testFixtures'
import type { DocumentOperation } from './types'

/** 服务端导出测试用的编辑器文档，补充引言、术语、附录、参考文献，覆盖更多节点种类。 */
function extendedServerFixture(): PMJsonNode {
  const base = clone(standardDocument) as unknown as PMJsonNode
  const content = base.content!
  const at = content.findIndex(child => child.type === 'foreword') + 1
  content.splice(at, 0, introduction(
    para('x-intro-p', text('引言说明，见'), xref('公式', 'cl-formula')),
    note('x-intro-note', '引言的注。'),
  ))
  const scope = content.findIndex(child => child.attrs?.nodeId === 'ch-scope')
  content.splice(scope + 1, 0, chapter('x-terms', '术语和定义',
    para('x-terms-lead', text('下列术语和定义适用于本文件。')),
    termDef('x-term-1', '导出', '把文档转换为交付格式的活动。', example('x-term-1-ex', '导出 DOCX。')),
    clause('x-terms-group', 1, '分类术语', termDef('x-term-2', '出件', '导出的结果。'))))
  content.push(
    appendix('x-app-a', true, '试验方法',
      clause('x-app-a1', 1, '试验步骤', para('x-app-a1-p', text('按下列步骤进行。')), simpleTable('x-app-tbl', '试验结果')),
      para('x-app-note-host', text('附录说明。'))),
    bibliography(bibEntry('x-bib-1', 'GB/T 1.1—2020 标准化工作导则'), bibEntry('x-bib-2', 'ISO/IEC Directives, Part 2')),
  )
  return base
}

/** 去掉 null 属性、键排序，再比较 PM 节点（忽略编辑器 schema 会补齐的默认值与属性顺序）。 */
function canonicalPm(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalPm)
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(value).sort()) {
      const child = (value as Record<string, unknown>)[key]
      if (child === null || child === undefined) continue
      out[key] = canonicalPm(child)
    }
    return out
  }
  return value
}

function findPm(pm: PMJsonNode, id: string): PMJsonNode | undefined {
  if (pm.attrs?.nodeId === id) return pm
  for (const child of pm.content ?? []) {
    const found = findPm(child, id)
    if (found) return found
  }
  return undefined
}

/** 登记的规范化差异：把子树里所有术语条目规范化为 irToPm 的输出，用于与替换后的结果比较。 */
function normalizeTerms(node: PMJsonNode): PMJsonNode {
  const rank = (child: PMJsonNode): number =>
    ({ termName: 0, termNameEn: 1, termDefinition: 2, stdParagraph: 3, termSource: 4, note: 5, example: 6 } as Record<string, number>)[child.type] ?? 9
  const children = (node.content ?? []).map(normalizeTerms)
  if (node.type !== 'termDef') return node.content ? { ...node, content: children } : node
  return {
    ...node,
    content: [...children].sort((a, b) => rank(a) - rank(b)).map(child =>
      child.type === 'termDefinition' && !child.attrs?.nodeId
        ? { ...child, attrs: { ...child.attrs, nodeId: `${node.attrs!.nodeId}.def0` } } : child),
  }
}

interface Case {
  name: string
  document: PMJsonNode
  /** 预期不可整体替换的节点（含包含它们的祖先）。 */
  notReplaceable: string[]
}

const CASES: Case[] = [
  {
    name: '较完整的文档（richDocument）',
    document: richDocument(),
    notReplaceable: [
      // 脚注（行内）
      'ch-scope', 'scope-p1',
      // TBX 语言集
      'ch-terms', 'term-3',
      // 其内含样式表（列宽）、带资源引用的图、MathML 公式、警告块
      'ch-4', 'cl-42', 'cl-422', 'tbl-styled', 'fig-res', 'f-mathml', 'warn-1',
      // 结构化文献标识符
      'bib-3',
    ],
  },
  {
    name: '服务端导出用的编辑器文档 + 引言/术语/附录/参考文献',
    document: extendedServerFixture(),
    // 范围章里的脚注
    notReplaceable: ['ch-scope', 'scope-p'],
  },
]

describe.each(CASES)('读回原样替换，文档不变：$name', ({ document, notReplaceable }) => {
  const frozen = deepFreeze(clone(document))
  const index = indexDocument(frozen)
  const originalIr = pmToIr(frozen).doc
  const originalLabels = resolve(originalIr).labels
  const originalProblems = resolve(originalIr).problems

  it('文档里有足够多的可寻址节点，覆盖各种种类', () => {
    const kinds = new Set(index.order.map(located => located.kind))
    for (const kind of ['chapter', 'clause', 'appendix', 'termEntry', 'bibEntry', 'paragraph', 'table', 'figure', 'formula']) {
      expect(kinds, kind).toContain(kind)
    }
    expect(index.order.every(located => located.id !== '')).toBe(true)
    expect(index.duplicates.size).toBe(0)
  })

  it('不可替换的节点恰好是预期的那些，并且都说明了原因', () => {
    const flagged = index.order.filter(located => {
      const result = readNode(frozen, located.id)
      if (!result.ok) throw new Error(result.reason)
      return !result.node.replaceable
    }).map(located => located.id)
    expect(flagged.sort()).toEqual([...notReplaceable].sort())
    for (const id of flagged) {
      const result = readNode(frozen, id)
      expect(result.ok && result.node.notReplaceable?.length, id).toBeGreaterThan(0)
    }
  })

  it('每个可替换节点：readNode → 原样 replace，IR、编号与问题都不变', () => {
    let replaced = 0
    for (const located of index.order) {
      const read = readNode(frozen, located.id)
      if (!read.ok || !read.node.replaceable) continue
      const result = applyDocumentOperations(frozen, [{ op: 'replace', nodeId: located.id, content: [read.node.ir] }], { generateId: seqIds() })
      if (!result.ok) throw new Error(`${located.id}：${JSON.stringify(result.issues)}`)
      expect(result.warnings, located.id).toEqual([])
      expect(result.operations[0]!.removed[0], located.id).toBe(located.id)
      expect(result.operations[0]!.inserted[0], located.id).toBe(located.id)
      const { doc: newIr } = pmToIr(result.doc)
      expect(newIr, located.id).toEqual(originalIr)
      const resolved = resolve(newIr)
      expect(resolved.labels, located.id).toEqual(originalLabels)
      expect(resolved.problems, located.id).toEqual(originalProblems)
      expect(result.problems.some(problem => problem.introduced), located.id).toBe(false)
      replaced += 1
    }
    expect(replaced).toBeGreaterThan(index.order.length / 2)
  })

  it('PM 层：去掉 null 属性后逐节点相同，除登记的术语条目规范化', () => {
    for (const located of index.order) {
      const read = readNode(frozen, located.id)
      if (!read.ok || !read.node.replaceable) continue
      const result = applyDocumentOperations(frozen, [{ op: 'replace', nodeId: located.id, content: [read.node.ir] }], { generateId: seqIds() })
      if (!result.ok) throw new Error(`${located.id}：${JSON.stringify(result.issues)}`)
      // 只比较被替换节点本身（祖先的 attrs 等不在替换范围内，且对象身份不同）
      const before = findPm(frozen, located.id)!
      const after = findPm(result.doc, located.id)!
      const expected = normalizeTerms(before)
      expect(canonicalPm(after), `${located.id} (${located.kind})`).toEqual(canonicalPm(expected))
    }
  })

  it('所有可替换的叶子节点在同一批里一起原样替换，文档不变', () => {
    const leaves = index.order.filter(located => !['chapter', 'appendix', 'clause'].includes(located.kind))
    const operations: DocumentOperation[] = []
    for (const located of leaves) {
      const read = readNode(frozen, located.id)
      if (read.ok && read.node.replaceable) operations.push({ op: 'replace', nodeId: located.id, content: [read.node.ir] })
    }
    expect(operations.length).toBeGreaterThan(5)
    const result = applyDocumentOperations(frozen, operations, { generateId: seqIds() })
    if (!result.ok) throw new Error(JSON.stringify(result.issues))
    expect(pmToIr(result.doc).doc).toEqual(originalIr)
    expect(result.operations).toHaveLength(operations.length)
  })

  it('不可替换的节点：原样 replace 默认被拒绝（replace-loses-content）；acceptLoss 也不会放行片段不支持的字段', () => {
    for (const id of notReplaceable) {
      const read = readNode(frozen, id)
      if (!read.ok) throw new Error(read.reason)
      const operation = { op: 'replace', nodeId: id, content: [read.node.ir] } as const
      const plain = applyDocumentOperations(frozen, [operation], { generateId: seqIds() })
      expect(plain.ok, id).toBe(false)
      if (plain.ok) continue
      expect(plain.issues.map(issue => issue.code), id).toContain('replace-loses-content')
      // reason 沿用 notReplaceable 的说明
      const lossIssue = plain.issues.find(issue => issue.code === 'replace-loses-content')!
      for (const reason of read.node.notReplaceable ?? []) {
        if (reason.code === 'unsupported-field' || reason.code === 'unsupported-content' || reason.code === 'unsupported-kind') {
          expect(lossIssue.reason, id).toContain(reason.message)
        }
      }
      // 带 acceptLoss 也不能把含有不支持字段的 IR 当作片段写入：被归一化拒绝（不再是丢失问题），调用方必须先去掉这些字段
      const accepted = applyDocumentOperations(frozen, [{ ...operation, acceptLoss: true }], { generateId: seqIds() })
      expect(accepted.ok, id).toBe(false)
      if (!accepted.ok) expect(accepted.issues.map(issue => issue.code), id).not.toContain('replace-loses-content')
    }
  })
})

describe('登记的规范化差异', () => {
  it('术语条目的来源/注/示例按 irToPm 的固定顺序输出', () => {
    const pm = deepFreeze(richDocument())
    const before = findPm(pm, 'term-1')!
    expect((before.content ?? []).map(child => child.type)).toEqual(['termName', 'termDefinition', 'note', 'example', 'termSource'])
    const read = readNode(pm, 'term-1')
    if (!read.ok) throw new Error(read.reason)
    const result = applyDocumentOperations(pm, [{ op: 'replace', nodeId: 'term-1', content: [read.node.ir] }])
    if (!result.ok) throw new Error(JSON.stringify(result.issues))
    expect((findPm(result.doc, 'term-1')!.content ?? []).map(child => child.type)).toEqual(['termName', 'termDefinition', 'termSource', 'note', 'example'])
    // 语义（IR、编号）不变
    expect(pmToIr(result.doc).doc).toEqual(pmToIr(pm).doc)
  })
})
