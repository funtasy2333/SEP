import { describe, expect, it } from 'vitest'
import { getDocxExportFeedback } from './docxExportFeedback'

const warning = (code: string, label?: string) => ({
  code, nodeId: 'internal-node-id', ...(label ? { label } : {}), message: '内部渲染器细节',
})

describe('DOCX 导出后的用户提示', () => {
  it('页码尚未计算时持续提示 Word 更新步骤，且不掩盖其他导出问题', () => {
    const result = getDocxExportFeedback([warning('toc-pages-pending'), warning('cover-field-missing')])
    expect(result.type).toBe('warning')
    expect(result.message).toContain('目次页码')
    expect(result.message).toContain('全选')
    expect(result.message).toContain('F9')
    expect(result.message).toContain('封面信息')
    expect(result.duration).toBe(0)
    expect(result.showClose).toBe(true)
  })

  it.each(['table-flow-natural-fallback', 'table-row-too-tall', 'table-footer-too-tall',
    'table-final-segment-too-tall', 'table-header-rowspan-pagination'])('%s 应呈现需要 Word 复核的持续警告', code => {
    const result = getDocxExportFeedback([warning(code)])
    expect(result.type).toBe('warning')
    expect(result.message).toContain('Word')
    expect(result.message).not.toContain('internal-node-id')
    expect(result.duration).toBe(0)
    expect(result.showClose).toBe(true)
  })

  it('表格类提示列出受影响的表编号（取自 Resolver labels），同一编号只列一次，无编号时退回“部分表格”', () => {
    const result = getDocxExportFeedback([
      warning('table-flow-natural-fallback', '表3'), warning('table-flow-natural-fallback', '表A.1'),
      warning('table-flow-natural-fallback', '表3'),
      warning('table-row-too-tall', '表5'), warning('table-footer-too-tall'),
    ])
    expect(result.message).toContain('表3、表A.1前的页位置无法可靠确定')
    expect(result.message.match(/表3/g)).toHaveLength(1)
    expect(result.message).toContain('表5的数据行')
    expect(result.message).toContain('部分表格的表题')
    expect(result.message).not.toContain('internal-node-id')
  })

  it('自然分页回退说明续页没有“表X（续）”且需要 Word 复核', () => {
    const result = getDocxExportFeedback([warning('table-flow-natural-fallback', '表2')])
    expect(result.message).toContain('自然分页')
    expect(result.message).toContain('表X（续）')
    expect(result.message).not.toContain('从新页')
  })

  it('组合风险与原有封面/脚注提示同时保留，同类多个表格只提示一次', () => {
    const result = getDocxExportFeedback([
      warning('table-flow-natural-fallback', '表1'), warning('table-flow-natural-fallback', '表2'),
      warning('table-final-segment-too-tall'), warning('cover-asset-approximation'), warning('cover-field-missing'),
      { code: 'footnote-landscape-separator', message: '横排脚注分隔线需校对。' },
    ])
    expect(result.message).toContain('自然分页')
    expect(result.message).toContain('末段')
    expect(result.message).toContain('封面素材')
    expect(result.message).toContain('封面信息')
    expect(result.message).toContain('横排脚注分隔线')
    expect(result.message.match(/页位置无法可靠确定/g)).toHaveLength(1)
  })

  it('没有需提醒的风险时保持成功提示', () => {
    expect(getDocxExportFeedback([])).toMatchObject({ type: 'success', message: 'DOCX 文件已导出' })
  })

  it('只有封面或横排脚注风险时保持既有警告与8秒时长', () => {
    expect(getDocxExportFeedback([warning('cover-field-missing')])).toMatchObject({ type: 'warning', duration: 8000 })
    expect(getDocxExportFeedback([{ code: 'footnote-landscape-separator', message: '需校对' }]).message).toContain('需校对')
  })
})
