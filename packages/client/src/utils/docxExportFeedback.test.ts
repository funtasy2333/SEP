import { describe, expect, it } from 'vitest'
import { getDocxExportFeedback } from './docxExportFeedback'

const warning = (code: string) => ({ code, nodeId: 'internal-node-id', message: '内部渲染器细节' })

describe('DOCX 导出后的用户提示', () => {
  it.each(['table-flow-estimate-unavailable', 'table-row-too-tall', 'table-footer-too-tall',
    'table-final-segment-too-tall', 'table-header-rowspan-pagination'])('%s 应呈现需要 Word 复核的持续警告', code => {
    const result = getDocxExportFeedback([warning(code)])
    expect(result.type).toBe('warning')
    expect(result.message).toContain('Word')
    expect(result.message).not.toContain('internal-node-id')
    expect(result.duration).toBe(0)
    expect(result.showClose).toBe(true)
  })

  it('组合风险与原有封面/脚注提示同时保留，同类多个表格只提示一次', () => {
    const result = getDocxExportFeedback([
      warning('table-flow-estimate-unavailable'), warning('table-flow-estimate-unavailable'),
      warning('table-final-segment-too-tall'), warning('cover-asset-approximation'), warning('cover-field-missing'),
      { code: 'footnote-landscape-separator', message: '横排脚注分隔线需校对。' },
    ])
    expect(result.message).toContain('从新页')
    expect(result.message).toContain('末段')
    expect(result.message).toContain('封面素材')
    expect(result.message).toContain('封面信息')
    expect(result.message).toContain('横排脚注分隔线')
    expect(result.message.match(/从新页/g)).toHaveLength(1)
  })

  it('没有需提醒的风险时保持成功提示', () => {
    expect(getDocxExportFeedback([])).toMatchObject({ type: 'success', message: 'DOCX 文件已导出' })
  })

  it('只有封面或横排脚注风险时保持既有警告与8秒时长', () => {
    expect(getDocxExportFeedback([warning('cover-field-missing')])).toMatchObject({ type: 'warning', duration: 8000 })
    expect(getDocxExportFeedback([{ code: 'footnote-landscape-separator', message: '需校对' }]).message).toContain('需校对')
  })
})
