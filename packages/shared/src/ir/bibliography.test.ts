import { expect, it } from 'vitest'
import { pmToIr, type PMJsonNode } from './pmToIr'

it('直接导出旧 JSON 时剥离跨格式片段的显示编号，保留标题格式且不改输入', () => {
  const source: PMJsonNode = { type: 'doc', content: [{ type: 'bibliography', content: [
    { type: 'bibliographyTitle' },
    { type: 'bibEntry', attrs: { nodeId: 'b1' }, content: [
      { type: 'text', text: '[', marks: [{ type: 'bold' }] },
      { type: 'text', text: '1] ' },
      { type: 'text', text: '文献甲', marks: [{ type: 'italic' }] },
    ] },
  ] }] }
  const before = structuredClone(source)
  expect(pmToIr(source).doc.bibliography[0]!.content).toEqual([{ text: '文献甲', marks: [{ type: 'italic' }] }])
  expect(source).toEqual(before)
})

it.each(['crossRef', 'externalLink', 'futureRichSemantic'])('旧编号识别保留 %s 标记及其诊断', type => {
  const source: PMJsonNode = { type: 'doc', content: [{ type: 'bibliography', content: [
    { type: 'bibliographyTitle' },
    { type: 'bibEntry', attrs: { nodeId: 'b1' }, content: [
      { type: 'text', text: '[1] ', marks: [{ type, attrs: { targetId: 'b2', refType: 'bibEntry', href: 'https://example.com' } }] },
      { type: 'text', text: '文献甲' },
    ] },
  ] }] }
  const before = structuredClone(source)
  const result = pmToIr(source)
  expect(result.doc.bibliography[0]!.content.map(run => run.text).join('')).toBe('[1] 文献甲')
  if (type === 'futureRichSemantic') expect(result.warnings.length).toBeGreaterThan(0)
  else expect(result.doc.bibliography[0]!.content[0]!.marks?.[0]?.type).toBe(type)
  expect(source).toEqual(before)
})

it.each([{}, [null]])('旧编号带畸形 marks 时保留现有转换诊断（%j）', marks => {
  const source = { type: 'doc', content: [{ type: 'bibliography', content: [
    { type: 'bibliographyTitle' },
    { type: 'bibEntry', attrs: { nodeId: 'b1' }, content: [
      { type: 'text', text: '[1] 文献甲', marks },
    ] },
  ] }] } as unknown as PMJsonNode
  const result = pmToIr(source)
  expect(result.doc.bibliography[0]!.content[0]!.text).toBe('[1] 文献甲')
  expect(result.warnings.length).toBeGreaterThan(0)
})
