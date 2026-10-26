import { describe, expect, it } from 'vitest'
import { pmToIr, type PMJsonNode } from '@ses/shared'
import { applyDocumentOperations } from './apply'
import { readNode } from './readNode'
import { cell, chapter, clone, deepFreeze, doc, row, seqIds, simpleTable, table } from './testFixtures'

const COLUMNS = [
  { width: 40, widthUnit: '%', textAlign: 'center', verticalAlign: 'middle' },
  { width: 60, widthUnit: '%', textAlign: null, verticalAlign: null },
]

/** tbl-cols 带名义列宽；tbl-border 的一个单元格带分边边框样式；tbl-plain 两者皆无。 */
function documentWithColumnsAndBorders(): PMJsonNode {
  return doc(chapter('ch-tables', '表的版式',
    simpleTable('tbl-cols', '带列宽的表', { attrs: { columns: COLUMNS } }),
    table('tbl-border', '带边框样式的表', [
      row('tbl-border-r1', cell('tableHeader', 'tbl-border-r1c1', '项目'), cell('tableHeader', 'tbl-border-r1c2', '指标')),
      row('tbl-border-r2',
        cell('tableCell', 'tbl-border-r2c1', '精度', { borderTop: 5, borderTopUnit: 'px', borderTopStyle: 'solid', borderBottomStyle: 'dashed' }),
        cell('tableCell', 'tbl-border-r2c2', '0.1')),
    ]),
    simpleTable('tbl-plain', '普通表'),
  ))
}

describe('[M-6.1-03][M-6.3.3.1-01] documentOps：含列宽模型 / 边框样式的表不能被写作片段静默整体替换', () => {
  const source = deepFreeze(documentWithColumnsAndBorders())

  it('readNode：IR 带 columns；该表标为不可整体替换，原因指向“列宽模型”，普通表不受影响', () => {
    const result = readNode(source, 'tbl-cols')
    if (!result.ok) throw new Error(result.reason)
    expect(result.node.ir).toMatchObject({
      kind: 'table',
      columns: [{ width: { value: 40, unit: '%' }, textAlign: 'center', verticalAlign: 'middle' }, { width: { value: 60, unit: '%' } }],
    })
    expect(result.node.replaceable).toBe(false)
    expect(result.node.notReplaceable).toEqual([expect.objectContaining({
      code: 'unsupported-field', path: 'ir.columns', message: expect.stringContaining('列宽模型'),
    })])

    const plain = readNode(source, 'tbl-plain')
    if (!plain.ok) throw new Error(plain.reason)
    expect(plain.node.replaceable).toBe(true)
  })

  it('readNode：单元格的分边边框样式（IR 为 cell.style）同样使该表不可整体替换，原因指向“样式”', () => {
    const result = readNode(source, 'tbl-border')
    if (!result.ok) throw new Error(result.reason)
    const cellIr = (result.node.ir as { rows: Array<{ cells: Array<{ style?: Record<string, unknown> }> }> }).rows[1]!.cells[0]!
    expect(cellIr.style).toEqual({ borderTop: { value: 5, unit: 'px' }, borderTopStyle: 'solid', borderBottomStyle: 'dashed' })
    expect(result.node.replaceable).toBe(false)
    expect(result.node.notReplaceable).toEqual([expect.objectContaining({
      code: 'unsupported-field', path: 'ir.rows[1].cells[0].style', message: expect.stringContaining('（样式）'),
    })])
  })

  it('replace 默认被拒绝（replace-loses-content），文档不变；acceptLoss 才执行并留下警告，columns 随之丢失', () => {
    const operations = [{ op: 'replace', nodeId: 'tbl-cols', content: [{ kind: 'table', caption: '新表', rows: [['甲', '乙']] }] }]
    const refused = applyDocumentOperations(clone(source), operations, { generateId: seqIds() })
    expect(refused.ok).toBe(false)
    if (!refused.ok) {
      expect(refused.issues).toEqual([expect.objectContaining({ code: 'replace-loses-content', nodeId: 'tbl-cols' })])
      expect(refused.issues[0]!.reason).toContain('columns')
    }
    const accepted = applyDocumentOperations(clone(source), [{ ...operations[0]!, acceptLoss: true }], { generateId: seqIds() })
    expect(accepted.ok).toBe(true)
    if (accepted.ok) {
      expect(accepted.warnings.map(item => item.code)).toEqual(['replace-loses-content'])
      expect(JSON.stringify(accepted.doc)).not.toContain('"columns"')
    }
  })

  it('写作片段不能凭空创建 columns：insert 带 columns 的表被明确拒绝', () => {
    const result = applyDocumentOperations(clone(source), [{
      op: 'insert', parent: 'ch-tables', position: 'end', content: [{ kind: 'table', caption: '新表', rows: [['甲', '乙']], columns: [{ width: { value: 100, unit: '%' } }] }],
    }], { generateId: seqIds() })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.issues.map(item => item.reason).join('\n')).toContain('暂不支持字段「columns」')
    }
  })

  it('不触及该表的其它操作保持 columns 与边框样式：替换同章的普通表后，其余两张表原样保留', () => {
    const result = applyDocumentOperations(clone(source), [{
      op: 'replace', nodeId: 'tbl-plain', content: [{ kind: 'table', caption: '改写', rows: [['甲', '乙']] }],
    }], { generateId: seqIds() })
    expect(result.ok).toBe(true)
    if (result.ok) {
      const tables = pmToIr(result.doc).doc.body[0]!.children.filter(child => child.kind === 'table')
      expect(tables.map(item => item.kind === 'table' ? item.columns?.length : undefined)).toEqual([2, undefined, undefined])
      expect(JSON.stringify(result.doc)).toContain('borderTopStyle')
    }
  })
})
