import { describe, expect, it } from 'vitest'
import { getOutputSupportProblems, type OutputBoundaryFormat } from '../outputBoundary'
import { listItemDoc, xref } from '../../ir/__tests__/wp8mG4Fixtures'

const FORMATS: readonly OutputBoundaryFormat[] = ['HTML', 'DOCX', 'XML', 'XML46687']
const typedRefIssue = 'resolver.problems[dangling-typed-ref]'

/**
 * G4 不新增任何输出字段：`crossRef.targetKind` 是既有 mark 字段（BASE_FIELDS.mark），
 * `listItem` 只是新增的取值。设计 §3.4 / §7.1：HTML、DOCX 放行并输出 refText；
 * XML46687 的白名单在 WP8.M 内不动（既有 mark 字段本就放行）；旧 XML 的拒绝来自序列化器的目标检查，不在边界层。
 */
describe('[M-10.1.5-01] 输出边界：crossRef(targetKind=listItem)', () => {
  it.each(FORMATS)('%s：指向有序列项的引用不产生 unsupported-output', (format) => {
    const doc = listItemDoc([xref('a3', 'listItem'), xref('n2', 'listItem'), xref('r4', 'listItem')])
    expect(getOutputSupportProblems(doc, format)).toEqual([])
  })

  it.each(FORMATS)('%s：无类型的旧稿引用同样放行', (format) => {
    expect(getOutputSupportProblems(listItemDoc([xref('a2')]), format)).toEqual([])
  })

  it.each(FORMATS)('%s：被引用列项的 label/xmlId 不构成任何新字段（边界只读 IR，不读 labels）', (format) => {
    const doc = listItemDoc([xref('a1', 'listItem')])
    const before = JSON.stringify(doc)
    expect(getOutputSupportProblems(doc, format)).toEqual([])
    expect(JSON.stringify(doc)).toBe(before)
  })

  it.each(FORMATS)('%s：指向非列项的 listItem 引用被 dangling-typed-ref 阻断（既有机制）', (format) => {
    const problems = getOutputSupportProblems(listItemDoc([xref('c51', 'listItem')]), format)
    expect(problems).toHaveLength(1)
    expect(problems[0]).toMatchObject({ code: 'unsupported-output', path: typedRefIssue })
    expect(problems[0]!.message).toContain('应为 listItem，实际为 clause')
  })

  it.each(FORMATS)('%s：指向无序列项的引用只产生 Resolver 的 dangling-xref，不属于输出边界（照旧回退作者原文）', (format) => {
    expect(getOutputSupportProblems(listItemDoc([xref('d1', 'listItem')]), format)).toEqual([])
  })
})
