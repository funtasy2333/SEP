/**
 * WP8.M G3 输出边界：figure.legend（M-8.5-01～06）、IRInline.image（M-8.3-02）、figure.examples（M-8.4-03）
 * 与 figure.notes（M-8.2-11）。
 *
 * 设计 §7.1：图例、图中示例、行内图本阶段只做模型、Schema 与显示，HTML、DOCX、XML、XML46687 四种格式都报
 * unsupported-output（由既有机制自动生效：figure 字段表、inline 字段表都不含它们，BASE_FIELDS 不改）；
 * figure.notes 是唯一的“新放行”（渲染器早已支持），四种格式的边界都不报，HTML 与 DOCX 另有渲染回归（wp8mG3Render.test.ts）。
 *
 * WP8.2 T2.4b：XML46687 自此放行图例、图中示例、行内图与文档级资源目录（`XML46687_FIGURES_BOUNDARY`，已声明差异），
 * 渲染器写成 fig/legend、fig 内的 non-normative-example、inline-graphic；HTML、DOCX、旧 XML 的阻断断言**保持不变**
 * （下面 `BLOCKING_FORMATS`），XML46687 的断言改为“放行且已声明”。放行后的输出见 xml46687.figures.test.ts。
 */

import { describe, expect, it } from 'vitest'
import { pmToIr } from '../../ir/pmToIr'
import type { IRDoc, IRFigure, IRParagraph } from '../../ir/types'
import {
  g3Example, g3Figure, g3Figure1, g3IrDoc, g3Legend, g3Note, g3PmDoc, inlineImage, legendItem, para,
} from '../../ir/__tests__/wp8mG3Fixtures'
import { getOutputSupportProblems, type OutputBoundaryFormat } from '../outputBoundary'
import { findDeclaredDifference } from '../xml46687Boundary'

const FORMATS: OutputBoundaryFormat[] = ['HTML', 'DOCX', 'XML', 'XML46687']
/** 仍阻断 G3 内容的格式（XML46687 自 WP8.2 T2.4b 起放行）。 */
const BLOCKING_FORMATS: OutputBoundaryFormat[] = ['HTML', 'DOCX', 'XML']

/** 只含一章、一幅图的最小文档，便于逐项断言路径。 */
function docWith(figure: IRFigure, extra: IRParagraph[] = []): IRDoc {
  return {
    schemaVersion: 1,
    meta: { standardType: 'gb', title: 'G3 边界', stdCode: 'GB/T 99999—2026' },
    front: { foreword: [], introduction: [] },
    body: [{ kind: 'chapter', id: 'b-ch', secType: 'general', title: [{ text: '章' }], children: [...extra, figure] }],
    appendices: [],
    bibliography: [],
  }
}

const paths = (doc: IRDoc, format: OutputBoundaryFormat) => getOutputSupportProblems(doc, format).map(problem => problem.path)

describe('[M-8.5-01] 输出边界：figure.legend 四种格式都报 unsupported-output', () => {
  const figure = g3Figure('b-fig', '图', { legend: g3Legend('b-legend', '图例', legendItem('b-lg-1', '1', '主电路')) })

  it('HTML、DOCX、旧 XML 每种格式恰报一条，路径是 figure.legend，带图的节点 id 与格式名', () => {
    for (const format of BLOCKING_FORMATS) {
      const problems = getOutputSupportProblems(docWith(figure), format)
      expect(problems.map(problem => problem.path), format).toEqual(['doc.body[0].children[0].legend'])
      expect(problems[0]).toMatchObject({ code: 'unsupported-output', nodeId: 'b-fig' })
      expect(problems[0]!.message).toContain(format)
      expect(problems[0]!.message).toContain('请保留 JSON 文档')
    }
  })

  it('XML46687 自 WP8.2 T2.4b 起放行图例（已声明差异），旧 XML 仍阻断', () => {
    expect(getOutputSupportProblems(docWith(figure), 'XML46687')).toEqual([])
    expect(findDeclaredDifference(docWith(figure), 'doc.body[0].children[0].legend')).toMatchObject({ kind: 'field', name: 'legend', task: 'T2.4b' })
    expect(getOutputSupportProblems(docWith(figure), 'XML').map(problem => problem.path)).toEqual(['doc.body[0].children[0].legend'])
  })

  it('空数组 / 缺省的图例不报（present 判定）；去掉图例后四种格式都没有问题', () => {
    for (const format of FORMATS) expect(paths(docWith(g3Figure('b-fig', '图')), format), format).toEqual([])
  })

  it('图例内的内容（标题、项、行内）不再单独报：整块只报一条 legend，避免重复噪音；XML46687 放行后按图例的字段表校验内容，合法内容零问题', () => {
    const rich = g3Figure('b-fig', '图', {
      legend: g3Legend('b-legend', '图例', legendItem('b-lg-1', [{ text: '', formula: { id: 'b-f', latex: 'x' } }], [{ text: 'a', marks: [{ type: 'strike' }] }])),
    })
    for (const format of BLOCKING_FORMATS) expect(paths(docWith(rich), format), format).toEqual(['doc.body[0].children[0].legend'])
    expect(paths(docWith(rich), 'XML46687')).toEqual([])
  })

  it('XML46687 的图例按 shape 校验：图例项里不放行的内容（行内样式）仍被精确报出，路径落在 legend.items 内', () => {
    const styled = g3Figure('b-fig', '图', {
      legend: g3Legend('b-legend', '图例', legendItem('b-lg-1', '1', [{ text: '红', style: { color: '#ff0000' } } as never])),
    })
    expect(paths(docWith(styled), 'XML46687')).toEqual(['doc.body[0].children[0].legend.items[0].definition[0].style'])
  })
})

describe('[M-8.4-03] 输出边界：figure.examples 四种格式都报 unsupported-output', () => {
  const figure = g3Figure('b-fig', '图', { examples: [g3Example('b-ex', { text: '图中示例。' })] })

  it('HTML、DOCX、旧 XML 每种格式恰报一条，路径是 figure.examples；XML46687 自 WP8.2 T2.4b 起放行（已声明差异）', () => {
    for (const format of BLOCKING_FORMATS) {
      const problems = getOutputSupportProblems(docWith(figure), format)
      expect(problems.map(problem => problem.path), format).toEqual(['doc.body[0].children[0].examples'])
      expect(problems[0]).toMatchObject({ code: 'unsupported-output', nodeId: 'b-fig' })
    }
    expect(getOutputSupportProblems(docWith(figure), 'XML46687')).toEqual([])
    expect(findDeclaredDifference(docWith(figure), 'doc.body[0].children[0].examples')).toMatchObject({ kind: 'field', name: 'examples', task: 'T2.4b' })
  })

  it('空 examples 数组不报；与 notes 并存时（HTML、DOCX、旧 XML）只有 examples 被报，notes 仍放行；XML46687 两者都放行', () => {
    for (const format of FORMATS) {
      expect(paths(docWith(g3Figure('b-fig', '图', { examples: [] })), format), format).toEqual([])
      const both = g3Figure('b-fig', '图', { notes: [g3Note('b-n', { text: '注' })], examples: [g3Example('b-ex', { text: '例' })] })
      expect(paths(docWith(both), format), format).toEqual(format === 'XML46687' ? [] : ['doc.body[0].children[0].examples'])
    }
  })
})

describe('[M-8.3-02] 输出边界：IRInline.image 四种格式都报 unsupported-output', () => {
  it('段落内的行内图：（HTML、DOCX、旧 XML）每个图一条，路径是 content[n].image；XML46687 自 WP8.2 T2.4b 起放行（已声明差异）', () => {
    const doc = docWith(g3Figure('b-fig', '图'), [para('b-p', { text: '见' }, inlineImage({ size: 'M' }), { text: '与' }, inlineImage())])
    for (const format of BLOCKING_FORMATS) {
      const problems = getOutputSupportProblems(doc, format)
      expect(problems.map(problem => problem.path), format).toEqual([
        'doc.body[0].children[0].content[1].image', 'doc.body[0].children[0].content[3].image',
      ])
      expect(problems[0]).toMatchObject({ code: 'unsupported-output', nodeId: 'b-p' })
      expect(problems[0]!.message).toContain(format)
    }
    expect(getOutputSupportProblems(doc, 'XML46687')).toEqual([])
    expect(findDeclaredDifference(doc, 'doc.body[0].children[0].content[1].image')).toMatchObject({ kind: 'field', name: 'image', task: 'T2.4b' })
  })

  it('列项、注、单元格里的行内图同样被报（不会因为嵌套较深而漏报）；XML46687 一个也不报', () => {
    for (const format of BLOCKING_FORMATS) {
      const reported = paths(g3IrDoc(), format).filter(path => path.endsWith('.image'))
      expect(reported.length, format).toBe(6) // 范围章 1 + 资源图段 2 + 列项 1 + 注 1 + 单元格 1
    }
    expect(paths(g3IrDoc(), 'XML46687').filter(path => path.endsWith('.image'))).toEqual([])
  })

  it('不报的是 image 以外的东西：去掉所有行内图后，g3IrDoc 在 HTML/DOCX 只剩 legend 与 examples 两类问题', () => {
    const doc = g3IrDoc()
    const strip = (value: unknown): void => {
      if (Array.isArray(value)) { value.forEach(strip); return }
      if (!value || typeof value !== 'object') return
      const row = value as Record<string, unknown>
      if (Array.isArray(row.content) && row.content.some(item => item && typeof item === 'object' && 'image' in item)) {
        row.content = (row.content as Array<Record<string, unknown>>).filter(item => !('image' in item))
      }
      Object.values(row).forEach(strip)
    }
    strip(doc.body)
    // doc.resources（行内图 / 图所引用的文档级资源）本就不在 doc 字段表内：这是 WP6 起的既有限制，G3 不改，单独排除后再比较。
    for (const format of BLOCKING_FORMATS) {
      expect(paths(doc, format).filter(path => path !== 'doc.resources').every(path => /\.(legend|examples)$/.test(path)), format).toBe(true)
      expect(paths(doc, format)).toContain('doc.resources')
    }
    // XML46687：图例、示例与文档级资源目录自 WP8.2 T2.4b 起一并放行，什么都不剩
    expect(paths(doc, 'XML46687')).toEqual([])
  })
})

describe('[M-8.2-11] 输出边界：figure.notes 放行（唯一的新放行，渲染器早已支持）', () => {
  it('图注不论一条还是多条，四种格式的边界都没有问题', () => {
    const one = g3Figure('b-fig', '图', { notes: [g3Note('b-n1', { text: '图注。' })] })
    const two = g3Figure('b-fig', '图', { notes: [g3Note('b-n1', { text: '图注一。' }), g3Note('b-n2', { text: '图注二。' })] })
    for (const format of FORMATS) {
      expect(paths(docWith(one), format), format).toEqual([])
      expect(paths(docWith(two), format), format).toEqual([])
    }
  })

  it('图注内的内容走既有字段表：注内行内图仍被报（image 不在 inline 字段表），其余内容放行', () => {
    const figure = g3Figure('b-fig', '图', { notes: [g3Note('b-n1', { text: '图注。' }, inlineImage())] })
    for (const format of BLOCKING_FORMATS) {
      expect(paths(docWith(figure), format), format).toEqual(['doc.body[0].children[0].notes[0].content[0].content[1].image'])
    }
    expect(paths(docWith(figure), 'XML46687')).toEqual([])
  })

  it('来自生产 PM 文档的路径一致：pmToIr 得到的 IR 与手写 IR 的边界结论相同（g3-fig-1 同时含图例、图注、示例）', () => {
    const fromPm = pmToIr(g3PmDoc()).doc
    for (const format of FORMATS) {
      expect(paths(fromPm, format).sort(), format).toEqual(paths(g3IrDoc(), format).sort())
    }
  })

  it('完整 G3 文档：HTML、DOCX、XML 都因 legend / examples / image 被阻断（三类各自出现）；XML46687 全部放行', () => {
    expect(paths(g3IrDoc(), 'XML46687')).toEqual([])
    for (const format of BLOCKING_FORMATS) {
      const reported = paths(g3IrDoc(), format)
      expect(reported.some(path => path.endsWith('.legend')), format).toBe(true)
      expect(reported.some(path => path.endsWith('.examples')), format).toBe(true)
      expect(reported.some(path => path.endsWith('.image')), format).toBe(true)
      expect(reported.some(path => path.includes('.notes')), format).toBe(false)
    }
  })

  it('图 1 的内容（图例 + 注 + 示例）在 HTML、DOCX、旧 XML 下各只因图例、示例被报，注没有被报；XML46687 全部放行', () => {
    for (const format of BLOCKING_FORMATS) {
      expect(paths(docWith(g3Figure1()), format).sort(), format).toEqual(['doc.body[0].children[0].examples', 'doc.body[0].children[0].legend'])
    }
    expect(paths(docWith(g3Figure1()), 'XML46687')).toEqual([])
  })
})
