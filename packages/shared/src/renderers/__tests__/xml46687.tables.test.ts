import { describe, expect, it } from 'vitest'
import type { IRBlock, IRDoc, IRFootnote, IRInline, IRList, IRNote, IRTable, IRTableRow } from '../../ir/types'
import { buildXml46687Document, exportXml46687, renderXml46687 } from '../xml46687'
import {
  EMPTY_OPTIONS, appendix, chapter, codesOf, deepFreeze, exportDoc, find, labelsOf, makeDoc, para, renderOk, run,
} from './xml46687Kit'
import { shouldSkipValidation, stsCompatWithPython, validateWithPython } from './xml46687PythonValidation'

/**
 * 表（WP8.2 设计 §2.6）：table-wrap 的结构、XHTML 表模型、col、单元格 style、表注/表脚注/单位、各 warning/info/error。
 * 整条管线（`exportXml46687`）渲染，断言 `<table-wrap>` 内的片段（相邻元素间的缩进空白去掉）与问题。
 */

type Cell = IRTableRow['cells'][number]

const cell = (id: string, text: string | IRInline[], extra: Partial<Cell> = {}): Cell => ({
  id, colspan: 1, rowspan: 1, header: false,
  content: [para(`${id}.p`, ...(typeof text === 'string' ? [text] : text))], ...extra,
})
const hcell = (id: string, text: string | IRInline[], extra: Partial<Cell> = {}): Cell => cell(id, text, { header: true, ...extra })
const row = (id: string, cells: Cell[], style?: IRTableRow['style']): IRTableRow => ({ id, cells, ...(style ? { style } : {}) })

/** 前导全是表头单元格的行数（输出边界要求 headerRowCount 与之一致）。 */
const leadingHeaderRows = (rows: IRTableRow[]): number => {
  let count = 0
  for (const entry of rows) { if (entry.cells.length === 0 || !entry.cells.every((c) => c.header)) break; count += 1 }
  return count
}
const table = (id: string, rows: IRTableRow[], extra: Partial<IRTable> = {}): IRTable => ({
  kind: 'table', id, caption: [{ text: '表题' }], orientation: 'portrait', headerRowCount: leadingHeaderRows(rows), rows, notes: [], ...extra,
})
const simple = (id = 't1', extra: Partial<IRTable> = {}): IRTable => table(id, [row(`${id}.r0`, [cell(`${id}.c0`, '甲'), cell(`${id}.c1`, '乙')])], extra)
const note = (id: string, text: string): IRNote => ({ kind: 'note', id, content: [para(`${id}.p0`, text)] })

const docWith = (blocks: IRBlock[], rest: Partial<IRDoc> = {}): IRDoc => makeDoc([chapter('ch1', '范围', blocks, 'scope')], rest)
const norm = (xml: string): string => xml.replace(/>\s+</g, '><')
/** 渲染并取出第 n 个 `<table-wrap>`（相邻元素间缩进已去掉）。 */
function tableXml(blocks: IRBlock[], index = 0): { xml: string; problems: ReturnType<typeof renderOk>['problems'] } {
  const { xml, problems } = renderOk(docWith(blocks))
  const all = [...norm(xml).matchAll(/<table-wrap[\s\S]*?<\/table-wrap>/g)].map((match) => match[0])
  return { xml: all[index]!, problems }
}
const tbodyOf = (xml: string): string => /<tbody>([\s\S]*)<\/tbody>/.exec(xml)![1]!

describe('table-wrap 的结构（设计 §2.6）', () => {
  it('[M-6.2.1-01] [M-6.2.1-03] [M-6.2.1-05] [M-6.1-01] [M-6.2.5-01] table-wrap ＞ label、caption/title、table/tbody；label 取 Resolver（表1，无空格），表题用 inline 容器', () => {
    const { xml } = tableXml([simple('t1', { caption: [{ text: '性能' }, { text: '指标', marks: [{ type: 'bold' }] }] })])
    expect(xml).toBe(
      '<table-wrap id="tab_1"><label>表1</label><caption><title>性能<bold>指标</bold></title></caption>'
      + '<table><tbody><tr><td>甲</td><td>乙</td></tr></tbody></table></table-wrap>',
    )
  })

  it('[M-6.2.1-02] [M-D.1-01] id 是 Resolver 的 xmlId：正文表 tab_1、tab_2，附录表 tab_A.1；各 id 全文唯一', () => {
    const doc = makeDoc(
      [chapter('ch1', '范围', [simple('t1'), simple('t2')], 'scope')],
      { appendices: [appendix('app-a', false, '附录', [simple('t3')])] },
    )
    const { xml } = renderOk(doc)
    expect([...xml.matchAll(/<table-wrap id="([^"]*)"/g)].map((match) => match[1])).toEqual(['tab_1', 'tab_2', 'tab_A.1'])
    expect(xml).toContain('<label>表A.1</label>')
  })

  it('[M-D.1-01] id 必须唯一：两个表取到同一个 xmlId 时 P4 报 xml-id-duplicate（error）并阻断导出', () => {
    const doc = docWith([simple('t1'), simple('t2')])
    const labels = labelsOf(doc)
    labels.t2 = { ...labels.t2!, xmlId: labels.t1!.xmlId }
    const result = exportXml46687(doc, labels, EMPTY_OPTIONS)
    expect(result.xml).toBeNull()
    expect(find(result.problems, 'xml-id-duplicate')).toHaveLength(1)
    expect(find(result.problems, 'xml-id-duplicate')[0]).toMatchObject({ severity: 'error' })
  })

  it('[M-6.6-01] 横向表写 orientation="landscape"，纵向（默认）不写', () => {
    expect(tableXml([simple('t1', { orientation: 'landscape' })]).xml).toContain('<table-wrap id="tab_1" orientation="landscape">')
    expect(tableXml([simple('t1')]).xml).toContain('<table-wrap id="tab_1">')
  })

  it('[M-6.2.1-04] 导出的表总带 caption/title：表题为空时给 warning caption-empty，仍写出 <caption><title/></caption>', () => {
    const { xml, problems } = tableXml([simple('t1', { caption: [] })])
    expect(xml).toContain('<caption><title/></caption>')
    expect(find(problems, 'caption-empty')).toHaveLength(1)
    expect(find(problems, 'caption-empty')[0]).toMatchObject({ severity: 'warning', nodeId: 't1', path: 'doc.body[0].children[0].caption' })
  })

  it('[M-6.2.1-06] 英文表题在 GB/T 46687.2 中没有写法：warning caption-en-not-expressed，不导出', () => {
    const { xml, problems } = tableXml([simple('t1', { captionEn: [{ text: 'Performance' }] })])
    expect(xml).not.toContain('Performance')
    expect(find(problems, 'caption-en-not-expressed')).toHaveLength(1)
    expect(find(problems, 'caption-en-not-expressed')[0]).toMatchObject({ severity: 'warning', path: 'doc.body[0].children[0].captionEn' })
  })

  it('[M-6.2.3-01] 导出的 table 不带 border/frame/rules/cellspacing/cellpadding/style（6.3.1 默认 1px 实线）；表级样式无表达，warning table-style-not-expressed', () => {
    const { xml, problems } = tableXml([simple('t1', { style: { borderWidth: { value: 2, unit: 'px' }, borderColor: '#000000', cellPadding: { value: 4, unit: 'px' } } })])
    expect(xml).toContain('<table><tbody>')
    expect(xml).not.toMatch(/ (?:border|frame|rules|cellspacing|cellpadding)=/)
    const styles = find(problems, 'table-style-not-expressed')
    expect(styles).toHaveLength(1)
    expect(styles[0]).toMatchObject({ severity: 'warning', path: 'doc.body[0].children[0].style' })
    expect(styles[0]!.message).toContain('borderWidth')
  })
})

describe('thead / tbody / tr / th / td（设计 §2.6）', () => {
  it('[M-6.2.2-01] [M-6.2.4-01] 前 headerRowCount 行放 thead、单元格用 th，其余放 tbody；没有表头行则不写 thead', () => {
    const head1 = row('r0', [hcell('c00', '项目'), hcell('c01', '值')])
    const head2 = row('r1', [hcell('c10', '甲'), hcell('c11', '乙')])
    const body = row('r2', [cell('c20', 'x'), cell('c21', 'y')])
    expect(tableXml([table('t1', [head1, head2, body])]).xml).toContain(
      '<table><thead><tr><th>项目</th><th>值</th></tr><tr><th>甲</th><th>乙</th></tr></thead><tbody><tr><td>x</td><td>y</td></tr></tbody></table>',
    )
    expect(tableXml([table('t1', [body])]).xml).not.toContain('<thead>')
  })

  it('[M-6.4-01] tbody 里的表头单元格（行表头）仍写 th；td/th 由 header 标志决定', () => {
    const { xml } = tableXml([table('t1', [row('r0', [hcell('c0', '项目'), hcell('c1', '值')]), row('r1', [hcell('c2', '行头'), cell('c3', '数据')])])])
    expect(tbodyOf(xml)).toBe('<tr><th>行头</th><td>数据</td></tr>')
  })

  it('[M-6.4-02] [M-6.4-03] colspan / rowspan 仅大于 1 时写，不写 scope', () => {
    const { xml } = tableXml([table('t1', [
      row('r0', [hcell('c0', '合并表头', { colspan: 2 }), hcell('c1', '单列')]),
      row('r1', [cell('c2', '跨行', { rowspan: 2 }), cell('c3', 'b'), cell('c4', 'c')]),
      row('r2', [cell('c5', 'd'), cell('c6', 'e', { colspan: 1, rowspan: 1 })]),
    ])])
    expect(xml).toContain('<th colspan="2">合并表头</th><th>单列</th>')
    expect(xml).toContain('<td rowspan="2">跨行</td>')
    expect(xml).toContain('<tr><td>d</td><td>e</td></tr>')
    expect(xml).not.toContain('scope=')
  })

  it('[M-6.2.2-02] [M-6.3.2-01] [M-6.3.2-02] 行与单元格的对齐写成 tr/td 的 align、valign（6.3.2 的取值）；行样式的其余字段 warning 省略', () => {
    const { xml, problems } = tableXml([table('t1', [
      row('r0', [cell('c0', '甲', { style: { textAlign: 'right', verticalAlign: 'bottom' } }), cell('c1', '乙', { style: { textAlign: 'justify', verticalAlign: 'top' } })],
        { textAlign: 'center', verticalAlign: 'middle', backgroundColor: '#EEEEEE', height: { value: 20, unit: 'px' } }),
    ])])
    expect(xml).toContain('<tr align="center" valign="middle"><td align="right" valign="bottom">甲</td><td align="justify" valign="top">乙</td></tr>')
    const styles = find(problems, 'table-style-not-expressed')
    expect(styles).toHaveLength(1)
    expect(styles[0]!.message).toContain('backgroundColor')
    expect(styles[0]!.message).toContain('height')
  })

  it('[M-6.3.2-02] 取值不在 6.3.2 内（baseline、center 作 valign）：warning table-style-not-expressed 并省略该属性，聚合成一条', () => {
    const { xml, problems } = tableXml([table('t1', [row('r0', [
      cell('c0', '甲', { style: { verticalAlign: 'baseline', textAlign: 'char' } }),
      cell('c1', '乙', { style: { verticalAlign: 'center' } }),
    ])])])
    expect(xml).toContain('<td>甲</td><td>乙</td>')
    const styles = find(problems, 'table-style-not-expressed')
    expect(styles).toHaveLength(1)
    expect(styles[0]!.message).toContain('共 3 处')
    expect(styles[0]!.message).toContain('baseline')
  })

  it('[M-6.1-02] table/@width 仅 33%、66%、100% 才写；其他宽度 warning table-width-not-expressed 并省略', () => {
    for (const percent of [33, 66, 100]) {
      expect(tableXml([simple('t1', { width: { value: percent, unit: '%' } })]).xml).toContain(`<table width="${percent}%">`)
    }
    for (const width of [{ value: 50, unit: '%' }, { value: 400, unit: 'px' }]) {
      const { xml, problems } = tableXml([simple('t1', { width })])
      expect(xml).toContain('<table><tbody>')
      const warnings = find(problems, 'table-width-not-expressed')
      expect(warnings).toHaveLength(1)
      expect(warnings[0]).toMatchObject({ severity: 'warning', path: 'doc.body[0].children[0].width' })
    }
  })
})

describe('col（M-6.1-03）', () => {
  const twoColumns = (columns: IRTable['columns']): IRBlock => simple('t1', { columns })

  it('[M-6.1-03] 名义列宽写成 thead 之前的 col：width="N%"（无多余 0）、align、valign；属性次序 align、valign、width（p22 示例 <col align="center" valign="middle" width="50%"/>）', () => {
    const { xml } = tableXml([twoColumns([
      { width: { value: 50, unit: '%' }, textAlign: 'center', verticalAlign: 'middle' },
      { width: { value: 33.3333, unit: '%' } },
    ])])
    expect(xml).toContain('<table><col align="center" valign="middle" width="50%"/><col width="33.3333%"/><tbody>')
  })

  it('[M-6.1-03] col 在 thead 之前；每列一个 col，保持位置：任一列非空时空列也写成 <col/>', () => {
    const rows = [row('r0', [hcell('c0', '甲'), hcell('c1', '乙'), hcell('c2', '丙')]), row('r1', [cell('c3', 'a'), cell('c4', 'b'), cell('c5', 'c')])]
    const { xml } = tableXml([table('t1', rows, { columns: [{ width: { value: 20, unit: '%' } }, {}, { textAlign: 'right' }] })])
    expect(xml).toContain('<table><col width="20%"/><col/><col align="right"/><thead>')
  })

  it('[M-6.1-03] columns 缺省、为空数组、或各列都是空对象时不写任何 col', () => {
    for (const columns of [undefined, [], [{}, {}]]) {
      expect(tableXml([twoColumns(columns)]).xml).toContain('<table><tbody>')
    }
  })

  it('[M-6.1-03] 非百分数的列宽（px、em，或超过 100%）不由 px 换算：warning table-width-not-expressed 并省略 width，其余属性保留', () => {
    const { xml, problems } = tableXml([twoColumns([{ width: { value: 120, unit: 'px' }, textAlign: 'left' }, { width: { value: 150, unit: '%' } }])])
    expect(xml).toContain('<table><col align="left"/><col/><tbody>')
    const warnings = find(problems, 'table-width-not-expressed')
    expect(warnings).toHaveLength(1)
    expect(warnings[0]!.message).toContain('共 2 处')
    expect(warnings[0]).toMatchObject({ severity: 'warning', path: 'doc.body[0].children[0].columns[0].width' })
  })

  it('[M-6.1-03] col 的 align/valign 取值不在 6.3.2 内（baseline）：warning table-style-not-expressed 并省略', () => {
    const { xml, problems } = tableXml([twoColumns([{ verticalAlign: 'baseline', textAlign: 'center' }, {}])])
    expect(xml).toContain('<col align="center"/><col/>')
    expect(find(problems, 'table-style-not-expressed')).toHaveLength(1)
  })

  it('[M-6.1-03] 拖拽得到的 px 列宽（cell.columnWidths）与 columns 互相独立：只写 columns；px 列宽 info px-width-ignored，同一表合并成一条', () => {
    const rows = [row('r0', [cell('c0', '甲', { columnWidths: [151] }), cell('c1', '乙', { columnWidths: [226] })])]
    const { xml, problems } = tableXml([table('t1', rows, { columns: [{ width: { value: 40, unit: '%' } }, { width: { value: 60, unit: '%' } }] })])
    expect(xml).toContain('<col width="40%"/><col width="60%"/>')
    expect(xml).not.toMatch(/151|226/)
    const infos = find(problems, 'px-width-ignored')
    expect(infos).toHaveLength(1)
    expect(infos[0]).toMatchObject({ severity: 'info', nodeId: 'c0', path: 'doc.body[0].children[0].rows[0].cells[0].columnWidths' })
    expect(infos[0]!.message).toContain('表1 有 2 个单元格')
  })

  it('[M-6.1-03] 只有拖拽 px 列宽、没有 columns 的表可以导出（D-X-03 = A）：不写 col，info px-width-ignored', () => {
    const { xml, problems } = tableXml([table('t1', [row('r0', [cell('c0', '甲', { columnWidths: [70] })])])])
    expect(xml).toContain('<table><tbody>')
    expect(codesOf(problems, 'info')).toContain('px-width-ignored')
  })
})

describe('单元格 style：边框与背景色（M-6.3.3.1-01、M-6.3.4-01，D-X-17）', () => {
  const styleOf = (style: NonNullable<Cell['style']>, extra: Partial<IRTable> = {}) => {
    const result = tableXml([table('t1', [row('r0', [cell('c0', 'x', { style })])], extra)])
    return { ...result, style: /<td(?: [^>]*?)? style="([^"]*)"/.exec(result.xml)?.[1] }
  }

  it('[M-6.3.3.1-01] 6.3.3.1 p24 示例的四边：只写与默认（solid 1px）不同的边，次序左、上、右、下；none 写 border-<边>: none', () => {
    const { style, xml } = styleOf({
      borderLeft: { value: 1, unit: 'px' }, borderLeftStyle: 'solid',
      borderTop: { value: 5, unit: 'px' }, borderTopStyle: 'solid',
      borderRightStyle: 'none',
      borderBottom: { value: 3, unit: 'px' }, borderBottomStyle: 'dashed',
    })
    expect(style).toBe('border-top: solid 5px; border-right: none; border-bottom: dashed 3px')
    expect(xml).toContain('<td style="border-top: solid 5px; border-right: none; border-bottom: dashed 3px">x</td>')
  })

  it('[M-6.3.3.1-01] 四边都与默认不同时按左、上、右、下全写（冒号加空格，分号分隔）；dotted 取值', () => {
    const edge = { value: 2, unit: 'px' }
    const { style } = styleOf({
      borderTop: edge, borderTopStyle: 'dotted', borderRight: edge, borderRightStyle: 'dotted',
      borderBottom: edge, borderBottomStyle: 'dotted', borderLeft: edge, borderLeftStyle: 'dotted',
    })
    expect(style).toBe('border-left: dotted 2px; border-top: dotted 2px; border-right: dotted 2px; border-bottom: dotted 2px')
  })

  it('[M-6.3.3.1-01] D-X-17：与默认（solid 1px）相同的边省略；只给样式时宽度取默认 1px；只给宽度时样式取 solid', () => {
    expect(styleOf({ borderLeft: { value: 1, unit: 'px' }, borderTopStyle: 'solid' }).style).toBeUndefined()
    expect(styleOf({ borderTopStyle: 'dashed' }).style).toBe('border-top: dashed 1px')
    expect(styleOf({ borderBottom: { value: 4, unit: 'px' } }).style).toBe('border-bottom: solid 4px')
  })

  it('[M-6.3.3.1-01] 表级默认：table.style.borderWidth 为 1～5 px 时取它作默认宽度，等于它的边省略（表级样式本身仍 warning）', () => {
    const { style, problems } = styleOf(
      { borderLeft: { value: 2, unit: 'px' }, borderTop: { value: 1, unit: 'px' } },
      { style: { borderWidth: { value: 2, unit: 'px' } } },
    )
    expect(style).toBe('border-top: solid 1px')
    expect(find(problems, 'table-style-not-expressed')).toHaveLength(1)
  })

  it('[M-6.3.3.1-01] 宽度非 px 或不在 1～5、样式不在 solid/dashed/dotted/none 内：warning table-style-not-expressed 并省略该边，其余边照常', () => {
    const { style, problems } = styleOf({
      borderLeft: { value: 2, unit: 'em' }, borderTop: { value: 9, unit: 'px' }, borderRightStyle: 'wavy',
      borderBottom: { value: 3, unit: 'px' },
    })
    expect(style).toBe('border-bottom: solid 3px')
    const warnings = find(problems, 'table-style-not-expressed')
    expect(warnings).toHaveLength(1)
    expect(warnings[0]!.message).toContain('共 3 处')
  })

  it('[M-6.3.4-01] 背景色：# 加 6 位十六进制（输出大写）或 none，写在边框之后；rgb()、命名色 warning 并省略', () => {
    expect(styleOf({ backgroundColor: '#efefef' }).style).toBe('background-color: #EFEFEF')
    expect(styleOf({ backgroundColor: 'none' }).style).toBe('background-color: none')
    expect(styleOf({ backgroundColor: '#d4d4d4', borderTopStyle: 'dashed' }).style).toBe('border-top: dashed 1px; background-color: #D4D4D4')
    for (const color of ['rgb(1,2,3)', 'red', '#fff']) {
      const { style, problems } = styleOf({ backgroundColor: color })
      expect(style, color).toBeUndefined()
      expect(find(problems, 'table-style-not-expressed'), color).toHaveLength(1)
    }
  })

  it('单元格内边距 padding* 无 XML 表达：warning table-style-not-expressed；整个 style 为空则不写 style 属性', () => {
    const { style, problems, xml } = styleOf({ paddingLeft: { value: 4, unit: 'px' } })
    expect(style).toBeUndefined()
    expect(xml).toContain('<td>x</td>')
    expect(find(problems, 'table-style-not-expressed')).toHaveLength(1)
    expect(styleOf({}).style).toBeUndefined()
  })
})

describe('单元格内容（M-6.5-01～03、M-6.2.4-02）', () => {
  it('[M-6.5-02] 单段、无单位的单元格：行内内容直接写在 td/th 里，不套 p；格式 marks 如实输出', () => {
    const { xml } = tableXml([table('t1', [row('r0', [cell('c0', [{ text: 'C', marks: [{ type: 'italic' }] }, { text: '3', marks: [{ type: 'italic' }, { type: 'sub' }] }, { text: '=1.0' }])])])])
    expect(xml).toContain('<td><italic>C<sub>3</sub></italic>=1.0</td>')
    expect(xml).not.toContain('<p>')
  })

  it('[M-6.5-01] 单元格内强制换行（\\n）写成 break', () => {
    expect(tableXml([table('t1', [row('r0', [cell('c0', '第一行\n第二行')])])]).xml).toContain('<td>第一行<break/>第二行</td>')
  })

  it('[M-6.5-02] 多个段落的单元格逐段写 p', () => {
    const multi = cell('c0', 'x', { content: [para('c0.a', '第一段'), para('c0.b', '第二段')] })
    expect(tbodyOf(tableXml([table('t1', [row('r0', [multi])])]).xml)).toBe('<tr><td><p>第一段</p><p>第二段</p></td></tr>')
  })

  it('[M-6.5-03] 单元格内允许列项：p 与 list 逐块写出', () => {
    const items: IRList = { kind: 'list', id: 'l1', listType: 'dash', items: [{ id: 'l1i', content: [para('l1i.p', '项一')] }] }
    const withList = cell('c0', 'x', { content: [para('c0.a', '说明'), items] })
    expect(tbodyOf(tableXml([table('t1', [row('r0', [withList])])]).xml)).toBe(
      '<tr><td><p>说明</p><list list-type="dash"><list-item><p>项一</p></list-item></list></td></tr>',
    )
  })

  it('空单元格（无内容）写成空的 td', () => {
    expect(tbodyOf(tableXml([table('t1', [row('r0', [cell('c0', 'x', { content: [] })])])]).xml)).toBe('<tr><td/></tr>')
  })

  it('[M-6.2.4-02] 表头单元格的单位写成 th 内最后一个无属性的 p（各栏单位不同，6.2.4）', () => {
    const { xml } = tableXml([table('t1', [
      row('r0', [hcell('c0', '公称厚度(e)', { unit: 'mm' }), hcell('c1', '平均厚度偏差', { unit: '%' })]),
      row('r1', [cell('c2', '1.0'), cell('c3', '0.2')]),
    ])])
    expect(xml).toContain('<thead><tr><th><p>公称厚度(e)</p><p>mm</p></th><th><p>平均厚度偏差</p><p>%</p></th></tr></thead>')
  })

  it('[M-6.2.4-02] 表头单元格有多个段落且带单位：单位 p 接在最后；单位只有空白不写', () => {
    const multi = hcell('c0', 'x', { content: [para('c0.a', '甲'), para('c0.b', '乙')], unit: 'kg' })
    const blank = hcell('c1', '丙', { unit: '  ' })
    const { xml } = tableXml([table('t1', [row('r0', [multi, blank]), row('r1', [cell('c2', 'a'), cell('c3', 'b')])])])
    expect(xml).toContain('<th><p>甲</p><p>乙</p><p>kg</p></th><th>丙</th>')
  })

  it('cell-unit-unsupported（error，D-X-03）：非表头单元格带 unit，原文只规定了表头单元格的单位', () => {
    const result = exportDoc(docWith([table('t1', [row('r0', [cell('c0', '值', { unit: 'mm' })])])]))
    expect(result.xml).toBeNull()
    const errors = find(result.problems, 'cell-unit-unsupported')
    expect(errors).toHaveLength(1)
    expect(errors[0]).toMatchObject({ severity: 'error', nodeId: 'c0', path: 'doc.body[0].children[0].rows[0].cells[0].unit' })
  })

  it('xml-cell-content（error）：单元格里的嵌套表（C-T-13）与段落、列项之外的块（注、代码……）', () => {
    const inner = simple('inner')
    const nested = exportDoc(docWith([table('t1', [row('r0', [cell('c0', 'x', { content: [para('c0.a', '说明'), inner] })])])]))
    expect(nested.xml).toBeNull()
    expect(find(nested.problems, 'xml-cell-content')).toHaveLength(1)
    expect(find(nested.problems, 'xml-cell-content')[0]).toMatchObject({ severity: 'error', nodeId: 'inner', path: 'doc.body[0].children[0].rows[0].cells[0].content[1]' })
    expect(find(nested.problems, 'xml-cell-content')[0]!.message).toContain('嵌套表')
    const code = exportDoc(docWith([table('t1', [row('r0', [cell('c0', 'x', { content: [{ kind: 'code', id: 'cd', text: 'a' }] })])])]))
    expect(find(code.problems, 'xml-cell-content')).toHaveLength(1)
    expect(find(code.problems, 'xml-cell-content')[0]!.message).toContain('code')
  })

  it('cell-attr-not-expressed（info）：cellType、width 无 XML 属性，同一文档合并成一条', () => {
    const rows = [row('r0', [cell('c0', 'a', { cellType: 'number', width: { value: 30, unit: '%' } }), cell('c1', 'b', { cellType: 'text' })])]
    const result = tableXml([simple('t0'), table('t1', rows)])
    const infos = find(result.problems, 'cell-attr-not-expressed')
    expect(infos).toHaveLength(1)
    expect(infos[0]).toMatchObject({ severity: 'info' })
    expect(infos[0]!.message).toContain('表2 有 2 个单元格')
    expect(result.xml).toContain('<tr><td>甲</td><td>乙</td></tr>')
  })
})

describe('table-wrap-foot：单位、表注、表脚注（M-6.2.3-03～11、M-6.2.5-02）', () => {
  const footnote = (id: string, text: string): IRFootnote => ({ id, content: [{ text }] })
  const ref = (target: string): IRInline => ({ text: '', marks: [{ type: 'tableFootnoteRef', targetId: target }] })

  it('[M-6.2.3-03] 没有单位、表注、表脚注时不写 table-wrap-foot', () => {
    expect(tableXml([simple('t1')]).xml).not.toContain('table-wrap-foot')
  })

  it('[M-6.2.5-02] 通用单位写成 table-wrap-foot/p[@content-type="dimension"]，文字原样；空白单位不写', () => {
    expect(tableXml([simple('t1', { unit: '单位为纳米' })]).xml).toContain('<table-wrap-foot><p content-type="dimension">单位为纳米</p></table-wrap-foot>')
    expect(tableXml([simple('t1', { unit: '   ' })]).xml).not.toContain('table-wrap-foot')
  })

  it('[M-6.2.3-04] [M-6.2.3-05] [M-6.2.3-06] 表注：non-normative-note，label 取 Resolver（单条“注：”，多条“注1：”“注2：”），内容在 p 里；表注与正文注的编号独立', () => {
    const single = tableXml([simple('t1', { notes: [note('n1', '表注一')] })]).xml
    expect(single).toContain('<table-wrap-foot><non-normative-note><label>注：</label><p>表注一</p></non-normative-note></table-wrap-foot>')
    const double = tableXml([simple('t1', { notes: [note('n1', '甲'), note('n2', '乙')] })]).xml
    expect(double).toContain('<label>注1：</label><p>甲</p>')
    expect(double).toContain('<label>注2：</label><p>乙</p>')
  })

  it('[M-6.2.3-04] 表注的 id 仅被引用时写（note_<n>）；前向引用同样成立', () => {
    const referencing = para('ref', '见', run('注', { type: 'crossRef', targetId: 'n2', targetKind: 'note' }))
    const { xml } = renderOk(docWith([referencing, simple('t1', { notes: [note('n1', '甲'), note('n2', '乙')] })]))
    const text = norm(xml)
    expect(text).toContain('<non-normative-note><label>注1：</label><p>甲</p></non-normative-note>')
    expect(text).toMatch(/<non-normative-note id="note_\d+"><label>注2：<\/label><p>乙<\/p><\/non-normative-note>/)
    expect(text.match(/<non-normative-note id=/g)).toHaveLength(1)
  })

  it('[M-6.2.3-07] [M-6.2.3-08] [M-6.2.3-09] 表脚注：fn[@id=table-fn_<表号>.<k>]，label/sup 放字母，p 放正文；附录表为 table-fn_A.1.<k>', () => {
    const t = simple('t1', {
      rows: [row('r0', [cell('c0', [{ text: '甲' }, ref('f1')]), cell('c1', [{ text: '乙' }, ref('f2')])])],
      footnotes: [footnote('f1', '第一个表脚注。'), footnote('f2', '第二个表脚注。')],
    })
    const { xml } = tableXml([t])
    expect(xml).toContain('<table-wrap-foot>'
      + '<fn id="table-fn_1.1"><label><sup>a</sup></label><p>第一个表脚注。</p></fn>'
      + '<fn id="table-fn_1.2"><label><sup>b</sup></label><p>第二个表脚注。</p></fn></table-wrap-foot>')
    const inAppendix = makeDoc(
      [chapter('ch1', '范围', [para('p', '正文')], 'scope')],
      { appendices: [appendix('app-a', false, '附录', [t])] },
    )
    expect(norm(renderOk(inAppendix).xml)).toContain('<fn id="table-fn_A.1.1">')
  })

  it('[M-6.2.3-10] [M-6.2.3-11] 单元格内的表脚注引用：xref[@ref-type="table-fn"]，rid 为同一表内 fn 的 id，内容是字母（不套 sup）', () => {
    const t = simple('t1', {
      rows: [row('r0', [cell('c0', [{ text: '甲' }, ref('f1')]), cell('c1', [{ text: '乙' }])])],
      footnotes: [footnote('f1', '脚注。')],
    })
    const { xml } = tableXml([t])
    expect(xml).toContain('<td>甲<xref ref-type="table-fn" rid="table-fn_1.1">a</xref></td>')
  })

  it('[M-6.2.3-07] 表脚注按字母序输出，而不是 IR 数组序', () => {
    const t = simple('t1', {
      rows: [row('r0', [cell('c0', [{ text: '甲' }, ref('f1'), ref('f2')]), cell('c1', [{ text: '乙' }])])],
      footnotes: [footnote('f2', '后者。'), footnote('f1', '前者。')],
    })
    const { xml } = tableXml([t])
    expect(xml.indexOf('table-fn_1.1"><label>')).toBeLessThan(xml.indexOf('table-fn_1.2"><label>'))
    expect(xml).toContain('<fn id="table-fn_1.1"><label><sup>a</sup></label><p>前者。</p></fn>')
  })

  it('[M-6.2.3-03] foot 内次序：单位 p、表注、表脚注', () => {
    const t = simple('t1', {
      unit: '单位为毫米',
      notes: [note('n1', '表注')],
      rows: [row('r0', [cell('c0', [{ text: '甲' }, ref('f1')]), cell('c1', '乙')])],
      footnotes: [footnote('f1', '脚注。')],
    })
    const { xml } = tableXml([t])
    const foot = /<table-wrap-foot>([\s\S]*)<\/table-wrap-foot>/.exec(xml)![1]!
    expect(foot.indexOf('dimension')).toBeLessThan(foot.indexOf('non-normative-note'))
    expect(foot.indexOf('non-normative-note')).toBeLessThan(foot.indexOf('<fn '))
  })

  it('[M-6.2.3-12] [M-6.2.3-13] 表脚注正文里的上下标、格式 marks 如实输出（inline 容器）', () => {
    const t = simple('t1', {
      rows: [row('r0', [cell('c0', [{ text: '甲' }, ref('f1')]), cell('c1', '乙')])],
      footnotes: [{ id: 'f1', content: [{ text: 'C' }, { text: '6', marks: [{ type: 'sub' }] }, { text: '为苯环' }] }],
    })
    expect(tableXml([t]).xml).toContain('<p>C<sub>6</sub>为苯环</p>')
  })
})

describe('错误与降级（设计 §4.4）', () => {
  it('xml-table-empty（error）：rows 为空，或全部是表头行（XHTML 表要求至少一个 tbody 行）', () => {
    for (const rows of [[], [row('r0', [hcell('c0', '表头')])]]) {
      const result = exportDoc(docWith([table('t1', rows)]))
      expect(result.xml).toBeNull()
      expect(find(result.problems, 'xml-table-empty')).toHaveLength(1)
      expect(find(result.problems, 'xml-table-empty')[0]).toMatchObject({ severity: 'error', nodeId: 't1', path: 'doc.body[0].children[0]' })
    }
  })

  it('xml-table-empty（error）：行里没有任何单元格（tr 至少需要一个 th/td）', () => {
    const result = exportDoc(docWith([table('t1', [row('r0', [cell('c0', '甲')]), row('r1', [])])]))
    expect(result.xml).toBeNull()
    expect(find(result.problems, 'xml-table-empty')).toHaveLength(1)
    expect(find(result.problems, 'xml-table-empty')[0]).toMatchObject({ severity: 'error', nodeId: 'r1', path: 'doc.body[0].children[0].rows[1].cells' })
  })

  it('xml-label-missing（error）：Resolver 没有给出表的标签（缺 xmlId）或编号文本为空', () => {
    const doc = docWith([simple('t1')])
    const missing = labelsOf(doc)
    delete missing.t1
    const noLabel = exportXml46687(doc, missing, EMPTY_OPTIONS)
    expect(noLabel.xml).toBeNull()
    expect(find(noLabel.problems, 'xml-label-missing')[0]).toMatchObject({ severity: 'error', nodeId: 't1', path: 'doc.body[0].children[0]' })
    const blank = labelsOf(doc)
    blank.t1 = { ...blank.t1!, label: '' }
    expect(find(exportXml46687(doc, blank, EMPTY_OPTIONS).problems, 'xml-label-missing')).toHaveLength(1)
  })

  it('表脚注的 Resolver 标签无效时无法排序：xml-label-missing（error），不抛异常（直接走构建管线；经入口导出时由脚注核对先报 invalid-footnote）', () => {
    const t = simple('t1', {
      rows: [row('r0', [cell('c0', [{ text: '甲' }, { text: '', marks: [{ type: 'tableFootnoteRef', targetId: 'f1' }] }]), cell('c1', '乙')])],
      footnotes: [{ id: 'f1', content: [{ text: '脚注' }] }],
    })
    const doc = docWith([t])
    const labels = labelsOf(doc)
    labels.f1 = { ...labels.f1!, xmlId: 'table-fn_bad' }
    const built = buildXml46687Document(doc, labels, EMPTY_OPTIONS)
    expect(find(built.problems, 'xml-label-missing').some((problem) => problem.path.endsWith('.footnotes'))).toBe(true)
    const result = exportXml46687(doc, labels, EMPTY_OPTIONS)
    expect(result.xml).toBeNull()
    expect(codesOf(result.problems, 'error')).toEqual(['invalid-footnote'])
  })

  it('table-style-not-expressed 跨表聚合成一条（共 N 处）', () => {
    const { problems } = tableXml([simple('t1', { style: { layout: 'fixed' } }), simple('t2', { style: { textAlign: 'center' } })])
    const styles = find(problems, 'table-style-not-expressed')
    expect(styles).toHaveLength(1)
    expect(styles[0]!.message).toContain('共 2 处')
  })
})

describe('确定性与不修改输入', () => {
  const rich = (): IRDoc => docWith([
    simple('t1', {
      unit: '单位为毫米', width: { value: 66, unit: '%' }, columns: [{ width: { value: 50, unit: '%' } }, {}],
      notes: [note('n1', '表注')],
      rows: [row('r0', [cell('c0', [{ text: '甲' }, { text: '', marks: [{ type: 'tableFootnoteRef', targetId: 'f1' }] }], { style: { borderTopStyle: 'dashed' } }), cell('c1', '乙')])],
      footnotes: [{ id: 'f1', content: [{ text: '脚注' }] }],
    }),
  ])

  it('同一输入两次导出逐字节相同；深冻结的输入不被修改、不抛错', () => {
    const doc = rich()
    const first = renderXml46687(doc, labelsOf(doc), EMPTY_OPTIONS)
    expect(renderXml46687(doc, labelsOf(doc), EMPTY_OPTIONS)).toBe(first)
    const frozen = deepFreeze(rich())
    const before = JSON.stringify(frozen)
    expect(renderXml46687(frozen, labelsOf(frozen), EMPTY_OPTIONS)).toBe(first)
    expect(JSON.stringify(frozen)).toBe(before)
  })
})

/** 域黄金样例：表的主要写法一次出齐（结构、thead、col、跨行跨列、align、边框与背景、单位、表头单位、表注、表脚注、引用）。 */
function domainDoc(): IRDoc {
  const footnotes: IRFootnote[] = [
    { id: 'tf-a', content: [{ text: '表脚注 a：C' }, { text: '6', marks: [{ type: 'sub' }] }, { text: ' 为参比值。' }] },
    { id: 'tf-b', content: [{ text: '表脚注 b。' }] },
  ]
  const full = table('tab-main', [
    row('r-head1', [hcell('h11', '项目', { rowspan: 2 }), hcell('h12', '测量结果', { colspan: 2 })]),
    row('r-head2', [hcell('h21', '公称厚度(e)', { unit: 'mm' }), hcell('h22', '平均厚度偏差', { unit: '%' })]),
    row('r-1', [
      cell('d11', '样品 A', { style: { textAlign: 'left' } }),
      cell('d12', [{ text: '1.5' }, { text: '', marks: [{ type: 'tableFootnoteRef', targetId: 'tf-a' }] }], {
        style: { textAlign: 'center', borderLeft: { value: 2, unit: 'px' }, borderTop: { value: 2, unit: 'px' }, borderTopStyle: 'solid', backgroundColor: '#efefef' },
      }),
      cell('d13', [{ text: '0.3' }], { style: { textAlign: 'right', borderBottomStyle: 'dashed', borderRightStyle: 'none' }, columnWidths: [120] }),
    ]),
    row('r-2', [
      cell('d21', '样品 B'),
      cell('d22', [{ text: 'x' }, { text: 'b', marks: [{ type: 'sub' }] }, { text: ' = 2.0' }, { text: '', marks: [{ type: 'tableFootnoteRef', targetId: 'tf-b' }] }, { text: '\n（见注）' }], { colspan: 2 }),
    ], { verticalAlign: 'middle' }),
    row('r-3', [
      cell('d31', 'x', { content: [para('d31.a', '多段单元格'), { kind: 'list', id: 'd31-l', listType: 'dash', items: [{ id: 'd31-li', content: [para('d31-li.p', '项一')] }] }] }),
      cell('d32', [{ text: '斜体', marks: [{ type: 'italic' }] }]),
      cell('d33', '—'),
    ]),
  ], {
    caption: [{ text: '带表头、合并单元格、表注与表脚注的表' }],
    unit: '单位为毫米', width: { value: 100, unit: '%' },
    columns: [{ width: { value: 30, unit: '%' }, textAlign: 'left' }, { width: { value: 35, unit: '%' }, textAlign: 'center', verticalAlign: 'middle' }, { width: { value: 35, unit: '%' }, textAlign: 'right' }],
    notes: [note('tab-main-n1', '表中数值为示例。'), note('tab-main-n2', '另一条表注。')],
    footnotes,
  })
  const wide = simple('tab-wide', { orientation: 'landscape', caption: [{ text: '横向表' }] })
  const plain = table('tab-plain', [row('p-r', [hcell('p-h1', '列 1'), hcell('p-h2', '列 2')]), row('p-b', [cell('p-b1', 'a'), cell('p-b2', 'b')])], { caption: [{ text: '简单表' }] })
  return makeDoc([
    chapter('ch1', '范围', [para('scope-p', '见', run('表1', { type: 'crossRef', targetId: 'tab-main', targetKind: 'table' }), '和', run('注', { type: 'crossRef', targetId: 'tab-main-n2', targetKind: 'note' }), '。')], 'scope'),
    chapter('ch2', '表', [full, wide, plain], 'general'),
  ])
}

describe('域黄金样例：表', () => {
  const doc = domainDoc()
  const labels = labelsOf(doc)

  it('XML 文件快照（toMatchFileSnapshot，便于直接喂给 validate.py）', async () => {
    await expect(renderXml46687(doc, labels, EMPTY_OPTIONS)).toMatchFileSnapshot('__snapshots__/xml46687.tables.xml')
  })

  it('问题集合恰为预期（防止告警悄悄增多）：没有 error；px 列宽 info、标准类型 info', () => {
    const { problems } = exportXml46687(doc, labels, EMPTY_OPTIONS)
    expect(codesOf(problems, 'error')).toEqual([])
    expect(problems.map((problem) => `${problem.severity} ${problem.code}`)).toEqual(['info meta-not-expressed', 'info px-width-ignored'])
  })

  it('表脚注与被引用的注：id 与引用一一对应', () => {
    const xml = renderXml46687(doc, labels, EMPTY_OPTIONS)
    expect(xml).toContain('<fn id="table-fn_1.1">')
    expect(xml).toContain('<fn id="table-fn_1.2">')
    expect(xml).toMatch(/<non-normative-note id="note_2">/)
    expect(xml.match(/<non-normative-note id=/g)).toHaveLength(1)
  })
})

describe.skipIf(shouldSkipValidation())('外部校验：python3 -I scripts/xml46687/validate.py --json --profile export', () => {
  it('域黄金样例：valid:true，errors:[]，warnings:[]', () => {
    const doc = domainDoc()
    const result = validateWithPython(renderXml46687(doc, labelsOf(doc), EMPTY_OPTIONS), 'export')
    expect(result.errors).toEqual([])
    expect(result.valid).toBe(true)
    expect(result.warnings).toEqual([])
  })

  it('sts_compat.py（与官方 NISO STS 1.2 DTD 对照）：退出码 0，零未解释偏差', () => {
    const doc = domainDoc()
    const result = stsCompatWithPython(renderXml46687(doc, labelsOf(doc), EMPTY_OPTIONS))
    expect(result.status, result.stdout).toBe(0)
    expect(result.stdout).toContain('未解释偏差 0 个')
  })
})
