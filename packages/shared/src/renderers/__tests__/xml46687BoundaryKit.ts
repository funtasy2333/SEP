/**
 * XML46687 输出边界测试的共用辅助（WP8.2 设计 §1.3.4；T2.4a-1 建立，T2.4b/T2.4c 的域测试沿用）。
 *
 * 核心思路：XML46687 比旧 XML 多放行的项全部登记在 `XML46687_DECLARED_DIFFERENCES`（各领域文件里的常量汇总）。
 * 对任意文档，“XML 报而 XML46687 不报”的问题（差集）必须每条都落在某个已声明差异内，且 XML46687 不得比 XML 多阻断；
 * 一个领域的富文档还要求它自己的声明项全部被触发（登记了却没真正放行也会失败）。差集都是**计算值**，不写死个数。
 */

import { expect } from 'vitest'
import type { IRDoc } from '../../ir/types'
import { getOutputSupportProblems, type OutputSupportProblem } from '../outputBoundary'
import {
  XML46687_DECLARED_DIFFERENCES, findDeclaredDifference, type Xml46687DeclaredDifference,
} from '../xml46687Boundary'

/** 把消息里的格式名统一成 XML，其余文字必须逐字相同。 */
export const asXml = (problems: OutputSupportProblem[]): OutputSupportProblem[] =>
  problems.map(problem => ({ ...problem, message: problem.message.split('XML46687').join('XML') }))

export const pathsOf = (problems: OutputSupportProblem[]): string[] => problems.map(problem => problem.path)

const keyOf = (problem: OutputSupportProblem): string => `${problem.path}\u0000${problem.nodeId ?? ''}\u0000${problem.message}`

export interface BoundaryDifference {
  /** XML 阻断而 XML46687 放行的问题（XML 的原文消息）。 */
  onlyXml: OutputSupportProblem[]
  /** XML46687 阻断而 XML 不阻断的问题（必须为空）。 */
  onlyNew: OutputSupportProblem[]
  /** 两者都阻断的问题（XML 的消息写法）。 */
  common: OutputSupportProblem[]
}

export function boundaryDifference(doc: IRDoc): BoundaryDifference {
  const xml = getOutputSupportProblems(doc, 'XML')
  const next = asXml(getOutputSupportProblems(doc, 'XML46687'))
  const xmlKeys = new Set(xml.map(keyOf))
  const nextKeys = new Set(next.map(keyOf))
  return {
    onlyXml: xml.filter(problem => !nextKeys.has(keyOf(problem))),
    onlyNew: next.filter(problem => !xmlKeys.has(keyOf(problem))),
    common: xml.filter(problem => nextKeys.has(keyOf(problem))),
  }
}

/**
 * 断言差集“恰等于声明集合”：
 * 1. XML46687 不比 XML 多阻断；
 * 2. 差集里每条都落在某个已声明差异内（新增放行而不登记会失败）；
 * 3. `expected`（缺省为全部已声明差异）里的每一项都被差集触发（登记了却没真正放行会失败）；
 * 4. 两者共同阻断的问题，XML46687 的问题与 XML 逐条相同（含顺序、nodeId、path、消息）。
 * 返回被触发的声明项。
 */
export function expectDeclaredDifferences(
  doc: IRDoc,
  expected: readonly Xml46687DeclaredDifference[] = XML46687_DECLARED_DIFFERENCES,
): Set<Xml46687DeclaredDifference> {
  const difference = boundaryDifference(doc)
  expect(difference.onlyNew, 'XML46687 不得比 XML 多阻断').toEqual([])
  const triggered = new Set<Xml46687DeclaredDifference>()
  for (const problem of difference.onlyXml) {
    const declared = findDeclaredDifference(doc, problem.path)
    expect(declared, `差集中的 ${problem.path} 没有登记为已声明差异`).toBeDefined()
    triggered.add(declared!)
  }
  for (const entry of expected) expect(triggered.has(entry), `已声明的差异没有被触发：${entry.kind} ${entry.name} ${entry.pathSuffix}`).toBe(true)
  expect(asXml(getOutputSupportProblems(doc, 'XML46687')), '共同阻断的问题逐条相同').toEqual(
    getOutputSupportProblems(doc, 'XML').filter(problem => difference.common.some(other => keyOf(other) === keyOf(problem))),
  )
  return triggered
}

/** 声明项的人读名，用作 `it.each` 标题。 */
export function describeDeclared(entry: Xml46687DeclaredDifference): string {
  return `${entry.kind}:${entry.name}（${entry.pathSuffix}）`
}

/** 逐项正例：最小文档里 XML 至少报一条落在该声明项内的问题，XML46687 一条都不报。 */
export function expectReleased(doc: IRDoc, entry: Xml46687DeclaredDifference): void {
  const xml = getOutputSupportProblems(doc, 'XML')
  expect(xml.some(problem => findDeclaredDifference(doc, problem.path) === entry), `XML 应阻断 ${describeDeclared(entry)}`).toBe(true)
  expect(getOutputSupportProblems(doc, 'XML46687'), `XML46687 应放行 ${describeDeclared(entry)}`).toEqual([])
}
