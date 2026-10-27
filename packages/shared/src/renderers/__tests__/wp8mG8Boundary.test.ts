/**
 * WP8.M G8 输出边界：`table.columns`（M-6.1-03）与单元格 `style.border*Style`（M-6.3.3.1-01）。
 *
 * 设计 §7.1：这两项“暂报 unsupported-output”，本阶段不排版——HTML、DOCX、旧 XML、XML46687 四种格式一律阻断，
 * 且不得被静默丢弃。机制是 `table` 字段表不含 `columns`、`cell` 字段表不含 `style`（自 WP6 起如此），因此无需新增白名单；
 * 这里钉住该结论，防止后续为别的组放行字段时误带上它们。
 *
 * 两条列宽通路互不影响：DOCX 仍消费单元格 `columnWidths`（CSS px，`cell` 字段表放行），`columns`（名义宽度）不参与。
 *
 * WP8.2 T2.4b：XML46687 自此放行 `columns`、单元格 `style`（含 `border*Style`）与单元格 `columnWidths`（`XML46687_TABLES_BOUNDARY`，
 * 已声明差异）。渲染器写成 `table/col`、`td/@style` 并对 px 列宽报 info `px-width-ignored`（D-X-03）；
 * HTML、DOCX、旧 XML 的阻断断言**保持不变**（下面 `BLOCKING_FORMATS`），XML46687 的断言改为“放行且已声明”。放行后的输出见 xml46687.tables.test.ts。
 */

import { describe, expect, it } from 'vitest'
import { pmToIr } from '../../ir/pmToIr'
import { resolve } from '../../ir/resolve'
import type { IRDoc, IRTable } from '../../ir/types'
import {
  G8_TWO_COLUMNS_PM, g8IrDoc, g8LegacyTable, g8MergedTable, g8PmDoc, g8TwoColumnTable, pmG8TwoColumnTable,
} from '../../ir/__tests__/wp8mG8Fixtures'
import { renderDocx } from '../docx'
import { renderHtml } from '../html'
import { UnsupportedOutputError, getOutputSupportProblems, type OutputBoundaryFormat } from '../outputBoundary'
import { findDeclaredDifference } from '../xml46687Boundary'

const FORMATS: OutputBoundaryFormat[] = ['HTML', 'DOCX', 'XML', 'XML46687']
/** 仍阻断 G8 字段的格式（XML46687 自 WP8.2 T2.4b 起放行）。 */
const BLOCKING_FORMATS: OutputBoundaryFormat[] = ['HTML', 'DOCX', 'XML']

function tableOf(doc: IRDoc, id: string): IRTable {
  const chapter = doc.body[0]!
  return chapter.children.find(child => child.kind === 'table' && child.id === id) as IRTable
}

function problemsAt(doc: IRDoc, format: OutputBoundaryFormat, suffix: string) {
  return getOutputSupportProblems(doc, format).filter(problem => problem.path.endsWith(suffix))
}

function withoutColumns(doc: IRDoc): IRDoc {
  const copy = structuredClone(doc)
  for (const child of copy.body[0]!.children) if (child.kind === 'table') delete child.columns
  return copy
}

function withoutCellStyles(doc: IRDoc): IRDoc {
  const copy = structuredClone(doc)
  for (const child of copy.body[0]!.children) {
    if (child.kind === 'table') for (const cell of child.rows.flatMap(row => row.cells)) delete cell.style
  }
  return copy
}

describe('[M-6.1-03] 输出边界：table.columns 在 HTML、DOCX、旧 XML 下均阻断，XML46687 放行', () => {
  for (const format of BLOCKING_FORMATS) {
    it(`${format}：每个带 columns 的表各报一条 unsupported-output（含表 id、路径与 JSON 提示），不影响其他字段`, () => {
      const problems = problemsAt(g8IrDoc([g8TwoColumnTable({ columns: [{ width: { value: 40, unit: '%' } }, { width: { value: 60, unit: '%' } }] }), g8MergedTable()]), format, '.columns')
      expect(problems.map(problem => problem.nodeId)).toEqual(['g8-tbl-2col', 'g8-tbl-merged'])
      for (const problem of problems) {
        expect(problem.code).toBe('unsupported-output')
        expect(problem.path).toMatch(/^doc\.body\[0\]\.children\[\d+\]\.columns$/)
        expect(problem.message).toContain(format)
        expect(problem.message).toContain('请保留 JSON 文档')
      }
    })

    it(`${format}：去掉 columns 后不再有 .columns 问题（放行只由该字段触发）`, () => {
      expect(problemsAt(withoutColumns(g8IrDoc()), format, '.columns')).toEqual([])
    })
  }

  it('XML46687：去掉 columns 与单元格样式后整份文档零问题', () => {
    expect(getOutputSupportProblems(withoutCellStyles(withoutColumns(g8IrDoc())), 'XML46687')).toEqual([])
  })

  it('XML46687 自 WP8.2 T2.4b 起放行 columns（已声明差异）；旧 XML 仍对同一文档逐表阻断', () => {
    const doc = g8IrDoc()
    expect(problemsAt(doc, 'XML46687', '.columns')).toEqual([])
    expect(problemsAt(doc, 'XML', '.columns').length).toBeGreaterThan(0)
    for (const problem of problemsAt(doc, 'XML', '.columns')) {
      expect(findDeclaredDifference(doc, problem.path)).toMatchObject({ kind: 'field', name: 'columns', task: 'T2.4b' })
    }
  })

  it('XML46687 的 columns 按 column 的字段表校验：合法的列（宽度、对齐）零问题；未登记的字段仍被精确报出', () => {
    const doc = g8IrDoc([g8TwoColumnTable({ columns: [{ width: { value: 40, unit: '%' }, textAlign: 'center' }, { verticalAlign: 'top', extra: 1 } as never] })])
    const found = getOutputSupportProblems(withoutCellStyles(doc), 'XML46687').map(problem => problem.path)
    expect(found).toEqual(['doc.body[0].children[1].columns[1].extra'])
  })

  it('columns 是空数组等价于缺省：不报告（与 present() 的既有判定一致）', () => {
    const doc = g8IrDoc([g8TwoColumnTable({ columns: [] })])
    for (const format of FORMATS) expect(problemsAt(doc, format, '.columns'), format).toEqual([])
  })

  it('不含 columns 的旧式表格：四种格式均无问题（回归）', () => {
    const doc = g8IrDoc([g8LegacyTable()])
    for (const format of FORMATS) expect(getOutputSupportProblems(doc, format), format).toEqual([])
  })
})

describe('[M-6.3.3.1-01] 输出边界：单元格 style（含 border*Style）在 HTML、DOCX、旧 XML 下均阻断，XML46687 放行', () => {
  for (const format of BLOCKING_FORMATS) {
    it(`${format}：每个带样式的单元格报一条 unsupported-output，路径落在 cells[i].style`, () => {
      const problems = problemsAt(g8IrDoc([g8TwoColumnTable({ columns: null })]), format, '.style')
      // 两个数据单元格带边框样式（p24 示例与 dotted）；表头单元格没有样式。
      expect(problems.map(problem => problem.path)).toEqual([
        'doc.body[0].children[1].rows[1].cells[0].style',
        'doc.body[0].children[1].rows[1].cells[1].style',
      ])
      expect(problems.map(problem => problem.nodeId)).toEqual(['g8-tbl-2col.r1c0', 'g8-tbl-2col.r1c1'])
      for (const problem of problems) {
        expect(problem.code).toBe('unsupported-output')
        expect(problem.message).toContain(format)
        expect(problem.message).toContain('请保留 JSON 文档')
      }
    })

    it(`${format}：去掉单元格样式后不再有 .style 问题`, () => {
      expect(problemsAt(withoutCellStyles(g8IrDoc([g8TwoColumnTable({ columns: null })])), format, '.style')).toEqual([])
    })
  }

  it('仅有一个边框样式字段的单元格同样被阻断（不会因为样式对象“只有新字段”而漏过）', () => {
    const table = g8LegacyTable()
    table.rows[1]!.cells[0]!.style = { borderLeftStyle: 'none' }
    const doc = g8IrDoc([table])
    for (const format of BLOCKING_FORMATS) {
      expect(problemsAt(doc, format, '.style').map(problem => problem.nodeId), format).toEqual(['g8-tbl-legacy.r1c0'])
    }
    expect(problemsAt(doc, 'XML46687', '.style')).toEqual([])
  })

  it('XML46687 自 WP8.2 T2.4b 起放行单元格样式（已声明差异）；旧 XML 仍逐格阻断', () => {
    const doc = g8IrDoc()
    expect(problemsAt(doc, 'XML46687', '.style')).toEqual([])
    const blocked = problemsAt(doc, 'XML', '.style')
    expect(blocked.length).toBeGreaterThan(0)
    for (const problem of blocked) {
      expect(findDeclaredDifference(doc, problem.path)).toMatchObject({ kind: 'field', name: 'style', task: 'T2.4b', pathSuffix: 'cells.style' })
    }
  })

  it('XML46687 的单元格样式按 cellStyle / measure 的字段表校验：全部合法字段零问题，未登记的字段被精确报出', () => {
    const table = g8LegacyTable()
    table.rows[1]!.cells[0]!.style = {
      textAlign: 'center', verticalAlign: 'middle', backgroundColor: '#EFEFEF',
      borderTop: { value: 1, unit: 'px' }, borderTopStyle: 'solid', paddingLeft: { value: 2, unit: 'px' },
    }
    expect(getOutputSupportProblems(g8IrDoc([table]), 'XML46687')).toEqual([])
    table.rows[1]!.cells[0]!.style = { borderTop: { value: 1, unit: 'px', extra: 1 } as never, glow: 'x' } as never
    expect(problemsAt(g8IrDoc([table]), 'XML46687', '').map(problem => problem.path)).toEqual([
      'doc.body[0].children[1].rows[1].cells[0].style.borderTop.extra',
      'doc.body[0].children[1].rows[1].cells[0].style.glow',
    ])
  })
})

describe('[M-6.1-03] 两条列宽通路互不影响', () => {
  it('DOCX：只有单元格 columnWidths（px）时放行；同时有 columns 时仅 columns 被阻断', () => {
    const pxOnly = g8IrDoc([g8TwoColumnTable({ columns: null, columnWidths: true })])
    // 单元格 style 仍被阻断（既有行为），把它剔除以便只观察列宽通路。
    const clean = withoutCellStyles(pxOnly)
    expect(getOutputSupportProblems(clean, 'DOCX')).toEqual([])
    const both = withoutCellStyles(g8IrDoc([g8TwoColumnTable({ columnWidths: true })]))
    const problems = getOutputSupportProblems(both, 'DOCX')
    expect(problems.map(problem => problem.path)).toEqual(['doc.body[0].children[1].columns'])
  })

  it('HTML 与旧 XML：单元格 columnWidths 本来就不放行，与 columns 无关；XML46687 自 WP8.2 T2.4b 起放行（D-X-03，渲染时报 info px-width-ignored）', () => {
    const clean = withoutCellStyles(g8IrDoc([g8TwoColumnTable({ columns: null, columnWidths: true })]))
    for (const format of ['HTML', 'XML'] as const) {
      expect(problemsAt(clean, format, '.columnWidths').length, format).toBe(2)
    }
    expect(problemsAt(clean, 'XML46687', '.columnWidths')).toEqual([])
    expect(findDeclaredDifference(clean, 'doc.body[0].children[1].rows[1].cells[0].columnWidths')).toMatchObject({ kind: 'field', name: 'columnWidths', task: 'T2.4b' })
  })
})

describe('[M-6.1-03][M-6.3.3.1-01] 渲染入口：阻断发生在渲染之前，而不是静默输出', () => {
  const options = { formulaOmml: {}, images: {}, stage: 'approval_draft' as const, createdAt: '2026-09-25T08:00:00.000Z' }

  it('renderHtml / renderDocx 对含 columns 或边框样式的文档抛 UnsupportedOutputError，并列出全部问题', () => {
    const doc = g8IrDoc()
    const labels = resolve(doc).labels
    expect(() => renderHtml(doc, labels, { variant: 'print' })).toThrow(UnsupportedOutputError)
    expect(() => renderHtml(doc, labels, { variant: 'screen' })).toThrow(UnsupportedOutputError)
    expect(() => renderDocx(doc, labels, options)).toThrow(UnsupportedOutputError)
    try {
      renderHtml(doc, labels, { variant: 'print' })
    } catch (error) {
      const problems = (error as UnsupportedOutputError).problems
      expect(problems.some(problem => problem.path.endsWith('.columns'))).toBe(true)
      expect(problems.some(problem => problem.path.endsWith('.style'))).toBe(true)
    }
  })

  it('去掉这些字段后，同一文档可正常渲染（说明阻断只来自新字段）', () => {
    const doc = withoutCellStyles(withoutColumns(g8IrDoc()))
    const labels = resolve(doc).labels
    expect(() => renderHtml(doc, labels, { variant: 'print' })).not.toThrow()
    expect(() => renderDocx(doc, labels, options)).not.toThrow()
  })
})

describe('[M-6.1-03][M-6.3.3.1-01] 来自生产 PM 文档的路径一致', () => {
  it('pmToIr 得到的 IR 与手写 IR 的边界结论相同：columns 与单元格样式在 HTML、DOCX、旧 XML 下都被报告，XML46687 放行', () => {
    const { doc } = pmToIr(g8PmDoc())
    for (const format of BLOCKING_FORMATS) {
      expect(problemsAt(doc, format, '.columns').map(problem => problem.nodeId), format).toEqual(['g8-tbl-2col', 'g8-tbl-merged'])
      expect(problemsAt(doc, format, '.style').length, format).toBe(2)
    }
    expect(problemsAt(doc, 'XML46687', '.columns')).toEqual([])
    expect(problemsAt(doc, 'XML46687', '.style')).toEqual([])
    expect(tableOf(doc, 'g8-tbl-2col').columns).toBeDefined()
  })

  it('列数与网格不符 / 边框样式取值非法的 PM 文档：unsupportedContent 使四种格式都被阻断（不静默丢弃）', () => {
    const pm = g8PmDoc([pmG8TwoColumnTable([G8_TWO_COLUMNS_PM[0]])])
    const cell = pm.content![0]!.content!.find(child => child.type === 'stdTable')!.content!.find(child => child.type === 'table')!.content![1]!.content![0]!
    cell.attrs!.borderTopStyle = 'wavy'
    const { doc } = pmToIr(pm)
    expect(doc.unsupportedContent!.map(item => item.reason)).toEqual([
      expect.stringContaining('边框样式「borderTopStyle」的取值「wavy」'),
      expect.stringContaining('与表格网格列数 2 不符'),
    ])
    for (const format of FORMATS) {
      const problems = getOutputSupportProblems(doc, format).filter(problem => problem.message.includes('不能输出'))
      expect(problems.map(problem => problem.message.includes('wavy') || problem.message.includes('不符')), format).toEqual([true, true])
      expect(problems.every(problem => problem.code === 'unsupported-output' && problem.message.includes(format))).toBe(true)
    }
  })
})
