import { describe, expect, it } from 'vitest'
import { normalizeAuthoringFragment } from '../authoring'
import { irToPm } from '../irToPm'
import { pmToIr, type PMJsonNode } from '../pmToIr'
import type { IRAppendix, IRDoc } from '../types'
import { getOutputSupportProblems } from '../../renderers/outputBoundary'

/** #75 附录整体横页：数据层（PM ⇄ IR、MCP 片段、输出边界）。 */

const text = (value: string): PMJsonNode => ({ type: 'text', text: value })

function pmDoc(appendixAttrs: Record<string, unknown>): PMJsonNode {
  return {
    type: 'doc', content: [
      { type: 'chapter', attrs: { nodeId: 'c1', secType: 'scope' }, content: [
        { type: 'chapterTitle', content: [text('范围')] },
        { type: 'stdParagraph', attrs: { nodeId: 'p1' }, content: [text('本文件规定了检验方法。')] },
      ] },
      { type: 'appendix', attrs: { nodeId: 'app-b', normative: false, ...appendixAttrs }, content: [
        { type: 'appendixLabel', content: [text('（资料性）')] },
        { type: 'appendixTitle', content: [text('方法验证汇总')] },
        { type: 'stdParagraph', attrs: { nodeId: 'lead' }, content: [text('方法参数及验证结果见表B.1。')] },
      ] },
    ],
  }
}

function appendixOf(doc: IRDoc): IRAppendix {
  return doc.appendices[0]
}

describe('附录方向：PM ⇄ IR', () => {
  it('横向附录写入 IR 的 orientation，并在 irToPm 后还原为同一属性', () => {
    const { doc } = pmToIr(pmDoc({ orientation: 'landscape' }))
    expect(appendixOf(doc).orientation).toBe('landscape')
    const back = irToPm(doc)
    const appendix = back.content!.find((node) => node.type === 'appendix')!
    expect(appendix.attrs?.orientation).toBe('landscape')
    expect(appendixOf(pmToIr(back).doc)).toEqual(appendixOf(doc))
  })

  it('未设置、null、portrait 或异常值都按纵向处理，IR 中不出现 orientation 字段（既有文档不变）', () => {
    for (const attrs of [{}, { orientation: null }, { orientation: 'portrait' }, { orientation: 'sideways' }]) {
      const { doc } = pmToIr(pmDoc(attrs))
      expect(Object.prototype.hasOwnProperty.call(appendixOf(doc), 'orientation')).toBe(false)
      const appendix = irToPm(doc).content!.find((node) => node.type === 'appendix')!
      expect(appendix.attrs).not.toHaveProperty('orientation')
    }
  })
})

describe('附录方向：MCP 写作片段', () => {
  it('接受 orientation: landscape / portrait，portrait 不写出', () => {
    const landscape = normalizeAuthoringFragment([{ kind: 'appendix', title: '汇总', orientation: 'landscape' }], { parent: 'appendices' }, { generateId: () => 'x' })
    expect(landscape.ok && landscape.nodes[0]).toMatchObject({ kind: 'appendix', orientation: 'landscape' })
    const portrait = normalizeAuthoringFragment([{ kind: 'appendix', title: '汇总', orientation: 'portrait' }], { parent: 'appendices' }, { generateId: () => 'x' })
    expect(portrait.ok && Object.prototype.hasOwnProperty.call(portrait.nodes[0], 'orientation')).toBe(false)
  })

  it('非法方向值报 invalid-value', () => {
    const result = normalizeAuthoringFragment([{ kind: 'appendix', title: '汇总', orientation: 'wide' }], { parent: 'appendices' }, { generateId: () => 'x' })
    expect(result.ok).toBe(false)
    expect(!result.ok && result.issues.some((issue) => issue.path === 'fragment[0].orientation' && issue.code === 'invalid-value')).toBe(true)
  })
})

describe('附录方向：输出边界', () => {
  const landscape = pmToIr(pmDoc({ orientation: 'landscape' })).doc
  const portrait = pmToIr(pmDoc({})).doc
  const orientationProblems = (doc: IRDoc, format: Parameters<typeof getOutputSupportProblems>[1]) =>
    getOutputSupportProblems(doc, format).filter((problem) => problem.path.endsWith('.orientation'))

  it('HTML、DOCX 放行横向附录', () => {
    expect(orientationProblems(landscape, 'HTML')).toEqual([])
    expect(orientationProblems(landscape, 'DOCX')).toEqual([])
  })

  it('XML 与 GB/T 46687.2 XML 无法表达附录方向：明确报 unsupported-output，不静默丢弃', () => {
    for (const format of ['XML', 'XML46687'] as const) {
      const problems = orientationProblems(landscape, format)
      expect(problems).toHaveLength(1)
      expect(problems[0]).toMatchObject({ code: 'unsupported-output', nodeId: 'app-b', path: 'doc.appendices[0].orientation' })
    }
  })

  it('纵向附录在所有格式都不产生方向问题', () => {
    for (const format of ['HTML', 'DOCX', 'XML', 'XML46687'] as const) expect(orientationProblems(portrait, format)).toEqual([])
  })
})
