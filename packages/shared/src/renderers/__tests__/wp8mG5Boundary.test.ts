/**
 * WP8.M G5 输出边界：`termEntry.subjectField`（M-9.2.9-01）。
 *
 * 设计 §3.4 原定四种格式全部阻断；用户 2026-10-22 的决定（§7.1）把“术语领域”列为“本阶段排版”：
 * HTML 与 DOCX 放行（并在定义前输出“〈领域〉”），旧 XML 保持阻断；XML46687 由 WP8.2 T2.4c 放行（写成首个 langSet 内的
 * tbx:subjectField，已声明差异 field:subjectField），本文件保留旧 XML 的阻断断言。
 * 术语条目独立 id（M-9.2.1-05）是纯 Resolver 数据，不在 IR 内，因而不改变任何格式的边界结果。
 */

import { describe, expect, it } from 'vitest'
import { pmToIr } from '../../ir/pmToIr'
import type { IRDoc, IRTermEntry } from '../../ir/types'
import { g5IrDoc, g5PrintDoc, g5PmDoc } from '../../ir/__tests__/wp8mG5Fixtures'
import { getOutputSupportProblems, type OutputBoundaryFormat } from '../outputBoundary'
import { findDeclaredDifference } from '../xml46687Boundary'

const FORMATS: OutputBoundaryFormat[] = ['HTML', 'DOCX', 'XML', 'XML46687']

function withoutSubjectField(doc: IRDoc): IRDoc {
  const copy = structuredClone(doc)
  const strip = (children: unknown[]): void => {
    for (const child of children as Array<Record<string, unknown>>) {
      if (child.kind === 'termEntry') {
        delete child.subjectField
        strip((child.nestedEntries as unknown[] | undefined) ?? [])
      } else if (child.kind === 'clause') strip(child.children as unknown[])
    }
  }
  for (const chapter of copy.body) strip(chapter.children)
  for (const appendix of copy.appendices) strip(appendix.children)
  return copy
}

function subjectFieldProblems(doc: IRDoc, format: OutputBoundaryFormat) {
  return getOutputSupportProblems(doc, format).filter(problem => problem.path.endsWith('.subjectField'))
}

describe('[M-9.2.9-01] 输出边界：subjectField 对 HTML、DOCX 放行，旧 XML 阻断，XML46687 自 T2.4c 起放行', () => {
  it('HTML 与 DOCX：含领域的术语文档没有任何边界问题', () => {
    expect(getOutputSupportProblems(g5PrintDoc(), 'HTML')).toEqual([])
    expect(getOutputSupportProblems(g5PrintDoc(), 'DOCX')).toEqual([])
  })

  it('旧 XML：每个带领域的术语条目各报一条 unsupported-output（含节点 id 与路径）', () => {
    const problems = subjectFieldProblems(g5PrintDoc(), 'XML')
    expect(problems.map(problem => problem.nodeId).sort()).toEqual(['g5-t-app', 'g5-t-iso', 'g5-t-marked', 'g5-t1'])
    for (const problem of problems) {
      expect(problem.code).toBe('unsupported-output')
      expect(problem.message).toContain('XML')
      expect(problem.message).toContain('请保留 JSON 文档')
    }
  })

  it('XML46687（T2.4c）：subjectField 已放行——旧 XML 报的每一条都是已声明差异，XML46687 没有本字段相关问题', () => {
    const doc = g5PrintDoc()
    expect(subjectFieldProblems(doc, 'XML46687')).toEqual([])
    for (const problem of subjectFieldProblems(doc, 'XML')) {
      expect(findDeclaredDifference(doc, problem.path)).toMatchObject({ kind: 'field', name: 'subjectField', task: 'T2.4c' })
    }
  })

  it('同一份文档去掉领域后，四种格式都没有本字段相关问题（回归：放行只由该字段触发）', () => {
    for (const format of FORMATS) {
      expect(subjectFieldProblems(withoutSubjectField(g5PrintDoc()), format), format).toEqual([])
    }
    // 旧文档（无领域）在 HTML/DOCX 上本来就没有问题，XML 家族也没有新增问题。
    expect(getOutputSupportProblems(withoutSubjectField(g5PrintDoc()), 'HTML')).toEqual([])
    expect(getOutputSupportProblems(withoutSubjectField(g5PrintDoc()), 'DOCX')).toEqual([])
    expect(getOutputSupportProblems(withoutSubjectField(g5PrintDoc()), 'XML')).toEqual([])
    expect(getOutputSupportProblems(withoutSubjectField(g5PrintDoc()), 'XML46687')).toEqual([])
  })

  it('领域放行不连带放行其他未支持信息：嵌套术语（nestedEntries）仍被 HTML/DOCX 阻断', () => {
    for (const format of ['HTML', 'DOCX'] as const) {
      const problems = getOutputSupportProblems(g5IrDoc(), format)
      expect(problems.some(problem => problem.path.endsWith('.nestedEntries')), format).toBe(true)
      expect(problems.some(problem => problem.path.endsWith('.subjectField')), format).toBe(false)
    }
  })

  it('领域内的行内公式不放行（术语名/领域属于不开放行内公式的位置）', () => {
    const doc = g5PrintDoc()
    const entry = (doc.body[2]!.children[0] as IRTermEntry)
    entry.subjectField = [{ text: '', formula: { id: 'g5-formula', latex: 'x^2' } }]
    for (const format of ['HTML', 'DOCX'] as const) {
      const problems = getOutputSupportProblems(doc, format)
      expect(problems.some(problem => problem.message.includes('行内公式')), format).toBe(true)
    }
  })

  it('来自生产 PM 文档的路径一致：pmToIr 得到的 IR 与手写 IR 的边界结论相同', () => {
    const { doc } = pmToIr(g5PmDoc())
    expect(getOutputSupportProblems(doc, 'HTML')).toEqual([])
    expect(getOutputSupportProblems(doc, 'DOCX')).toEqual([])
    expect(subjectFieldProblems(doc, 'XML').map(problem => problem.nodeId)).toEqual(['g5-t1'])
    expect(subjectFieldProblems(doc, 'XML46687')).toEqual([])
  })
})

describe('[M-9.2.1-05] 输出边界：termEntryXmlId 是 Resolver 数据，不改变任何格式的边界结果', () => {
  it('无领域的术语文档在四种格式下均无问题（与 8.M 之前一致）', () => {
    for (const format of FORMATS) {
      expect(getOutputSupportProblems(withoutSubjectField(g5PrintDoc()), format), format).toEqual([])
    }
  })
})
