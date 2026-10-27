/**
 * T2.4b 三个域的输出边界测试共用的文档构造（`outputBoundaryXml46687.{tables,figures,formulas}.test.ts`）。
 * 差异集合断言与逐项正例的辅助在 `xml46687BoundaryKit.ts`。
 */

import type { IRBlock, IRDoc, IRInline, IRParagraph } from '../../ir/types'
import { getOutputSupportProblems, type OutputSupportProblem } from '../outputBoundary'
import { describeDeclared } from './xml46687BoundaryKit'
import type { Xml46687DeclaredDifference } from '../xml46687Boundary'
import { expect } from 'vitest'

/** 一章一个段落的最小文档（段落 id 为 p1，在 `doc.body[0].children[0]`）。 */
export function baseDoc(): IRDoc {
  return {
    schemaVersion: 1, meta: { standardType: 'gb' },
    front: { foreword: [], introduction: [] },
    body: [{ kind: 'chapter', id: 'chapter', secType: 'scope', title: [{ text: '范围' }], children: [{ kind: 'paragraph', id: 'p1', content: [{ text: '原正文' }] }] }],
    appendices: [], bibliography: [],
  }
}

/** 追加一个块（路径从 `doc.body[0].children[1]` 起）。 */
export function pushBlock(doc: IRDoc, block: unknown): IRDoc {
  doc.body[0]!.children.push(block as IRDoc['body'][number]['children'][number])
  return doc
}

export function firstParagraph(doc: IRDoc): IRParagraph {
  return doc.body[0]!.children[0] as IRParagraph
}

export function pushRun(doc: IRDoc, run: IRInline): IRDoc {
  firstParagraph(doc).content.push(run)
  return doc
}

export const para = (id: string, text: string): IRParagraph => ({ kind: 'paragraph', id, content: [{ text }] })

export const xml46687Paths = (doc: IRDoc): string[] => getOutputSupportProblems(doc, 'XML46687').map((problem: OutputSupportProblem) => problem.path)
export const xmlPaths = (doc: IRDoc): string[] => getOutputSupportProblems(doc, 'XML').map((problem: OutputSupportProblem) => problem.path)

/** 声明项的人读名（`it.each` 标题的一部分）。 */
export const titleOf = (entry: Xml46687DeclaredDifference): string => describeDeclared(entry)

/**
 * shape 登记探针：在 `doc` 中某个对象里放入未登记字段 `zzz` 后，XML46687 恰好只报这一条（路径精确）。
 * 如果该对象类型没有在 childShape 链里登记，默认会按 `inline` 校验，整棵子树的合法字段都会被误报，探针就会失败。
 */
export function expectOnlyUnknownField(doc: IRDoc, path: string): void {
  expect(xml46687Paths(doc), path).toEqual([path])
}

export type { IRBlock }
