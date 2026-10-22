/**
 * WP8.M G2 输出边界：defList（M-10.1.4-01/-03/-04/-05）与 crossRef targetKind=abbreviation（M-10.1.1-04）。
 *
 * 设计 §3.4 原定四种格式全部阻断 defList；用户 2026-10-22 的决定（§7.1）把“缩略语表”列为“本阶段排版”：
 * HTML 与 DOCX 放行并排版，旧 XML 保持阻断，XML46687 的白名单留给 WP8.2。
 * crossRef 的 targetKind 是既有 mark 字段，四种格式的边界都不因它报问题（旧 XML 的目标检查在序列化器里，
 * 且含 defList 的文档已被整体阻断）。
 */

import { describe, expect, it } from 'vitest'
import { pmToIr } from '../../ir/pmToIr'
import type { IRDefList, IRDoc } from '../../ir/types'
import { abbrRef, defItem, g2IrDoc, g2MainList, g2PmDoc } from '../../ir/__tests__/wp8mG2Fixtures'
import { getOutputSupportProblems, type OutputBoundaryFormat } from '../outputBoundary'

const FORMATS: OutputBoundaryFormat[] = ['HTML', 'DOCX', 'XML', 'XML46687']

/** 去掉全部缩略语表与对它们的引用，其余内容不变。 */
function withoutDefLists(doc: IRDoc): IRDoc {
  const copy = structuredClone(doc)
  copy.body[0]!.children = [{ kind: 'paragraph', id: 'g2-scope-p', content: [{ text: '无引用。' }] }]
  copy.body[2]!.children = copy.body[2]!.children.filter(child => child.kind !== 'defList')
  copy.appendices[0]!.children = copy.appendices[0]!.children.filter(child => child.kind !== 'defList')
  return copy
}

const defListProblems = (doc: IRDoc, format: OutputBoundaryFormat) =>
  getOutputSupportProblems(doc, format).filter(problem => problem.path.includes('defList') || problem.nodeId?.startsWith('g2-list'))

describe('[M-10.1.4-01] 输出边界：defList 仅对 HTML、DOCX 放行', () => {
  it('HTML 与 DOCX：含缩略语表与 abbreviation 引用的文档没有任何边界问题', () => {
    expect(getOutputSupportProblems(g2IrDoc(), 'HTML')).toEqual([])
    expect(getOutputSupportProblems(g2IrDoc(), 'DOCX')).toEqual([])
  })

  it('旧 XML 与 XML46687：每个 defList 各报一条 unsupported-output（kind 不支持，含节点 id 与路径）', () => {
    for (const format of ['XML', 'XML46687'] as const) {
      const problems = getOutputSupportProblems(g2IrDoc(), format)
      expect(problems.map(problem => [problem.nodeId, problem.path.endsWith('.kind')]), format).toEqual([
        ['g2-list', true], ['g2-list-app', true],
      ])
      for (const problem of problems) {
        expect(problem.code).toBe('unsupported-output')
        expect(problem.message).toContain(format)
        expect(problem.message).toContain('请保留 JSON 文档')
      }
    }
  })

  it('XML46687 在 8.M 内不得放开：它与旧 XML 对 defList 的结果逐条相同', () => {
    expect(getOutputSupportProblems(g2IrDoc(), 'XML46687')).toEqual(
      getOutputSupportProblems(g2IrDoc(), 'XML').map(problem => ({ ...problem, message: problem.message.replace('XML ', 'XML46687 ') })),
    )
  })

  it('去掉缩略语表后，四种格式都没有 defList 相关问题（回归：放行与阻断都只由该块触发）', () => {
    for (const format of FORMATS) {
      expect(defListProblems(withoutDefLists(g2IrDoc()), format), format).toEqual([])
      expect(getOutputSupportProblems(withoutDefLists(g2IrDoc()), format), format).toEqual([])
    }
  })

  it('来自生产 PM 文档的路径一致：pmToIr 得到的 IR 与手写 IR 的边界结论相同', () => {
    const { doc } = pmToIr(g2PmDoc())
    expect(getOutputSupportProblems(doc, 'HTML')).toEqual([])
    expect(getOutputSupportProblems(doc, 'DOCX')).toEqual([])
    expect(getOutputSupportProblems(doc, 'XML').map(problem => problem.nodeId)).toEqual(['g2-list', 'g2-list-app'])
    expect(getOutputSupportProblems(doc, 'XML46687').map(problem => problem.nodeId)).toEqual(['g2-list', 'g2-list-app'])
  })
})

describe('[M-10.1.4-03][M-10.1.4-04][M-10.1.4-05] 输出边界：项字段白名单（id、term、definition）', () => {
  it('项上出现未声明的字段 → HTML/DOCX 报该字段，路径含 items[n]，不静默丢弃', () => {
    for (const format of ['HTML', 'DOCX'] as const) {
      const doc = g2IrDoc()
      const list = doc.body[2]!.children[1] as IRDefList
      ;(list.items[1] as unknown as Record<string, unknown>).abbrType = 'initialism'
      const problems = getOutputSupportProblems(doc, format)
      expect(problems.map(problem => problem.path), format).toEqual(['doc.body[2].children[1].items[1].abbrType'])
    }
  })

  it('容器上出现未声明的字段（如 title / listContent）→ 报该字段', () => {
    const doc = g2IrDoc()
    Object.assign(doc.body[2]!.children[1] as object, { listContent: 'abbreviation' })
    for (const format of ['HTML', 'DOCX'] as const) {
      expect(getOutputSupportProblems(doc, format).map(problem => problem.path), format).toEqual(['doc.body[2].children[1].listContent'])
    }
  })

  it('项内的行内内容沿用既有行内白名单：不支持的 mark（strike）仍被阻断', () => {
    const doc = g2IrDoc()
    ;(doc.body[2]!.children[1] as IRDefList).items[0] = defItem('abb-adc', 'ADC', [{ text: '模数转换器', marks: [{ type: 'strike' }] }])
    for (const format of ['HTML', 'DOCX'] as const) {
      expect(getOutputSupportProblems(doc, format).some(problem => problem.path.endsWith('.marks[0].type')), format).toBe(true)
    }
  })

  it('项内的行内公式与“式中”项同等对待：放行（container 为 where.term / where.definition）', () => {
    const doc = g2IrDoc()
    ;(doc.body[2]!.children[1] as IRDefList).items.push(
      defItem('abb-f', [{ text: '', formula: { id: 'g2-f1', latex: 'x^2' } }], '平方'),
    )
    for (const format of ['HTML', 'DOCX'] as const) expect(getOutputSupportProblems(doc, format), format).toEqual([])
  })
})

describe('[M-10.1.1-04] 输出边界：crossRef targetKind=abbreviation 是既有 mark 字段，四种格式的边界都不因它报问题', () => {
  it('类型引用与无类型引用并存时，HTML/DOCX 没有边界问题', () => {
    const doc = g2IrDoc([abbrRef('abb-adc'), abbrRef('abb-agc', '缩略语', null)])
    expect(getOutputSupportProblems(doc, 'HTML')).toEqual([])
    expect(getOutputSupportProblems(doc, 'DOCX')).toEqual([])
  })

  it('XML/XML46687 对该引用本身不报问题（只有 defList 块被阻断）', () => {
    for (const format of ['XML', 'XML46687'] as const) {
      const problems = getOutputSupportProblems(g2IrDoc(), format)
      expect(problems.every(problem => problem.path.endsWith('.kind') && problem.nodeId?.startsWith('g2-list')), format).toBe(true)
    }
  })

  it('类型与目标不符的 abbreviation 引用：HTML/DOCX 经 Resolver 的 dangling-typed-ref 阻断（既有机制）', () => {
    const doc = g2IrDoc([{ text: '见图', marks: [{ type: 'crossRef', targetId: 'abb-adc', targetKind: 'figure' }] }])
    for (const format of ['HTML', 'DOCX'] as const) {
      expect(getOutputSupportProblems(doc, format).map(problem => problem.path), format).toEqual(['resolver.problems[dangling-typed-ref]'])
    }
  })

  it('xmlId 只在 Resolver 内：IR 里不出现 abb_ 字符串', () => {
    expect(JSON.stringify(g2IrDoc())).not.toContain('abb_')
    expect(JSON.stringify(g2MainList())).not.toContain('abb_')
  })
})
