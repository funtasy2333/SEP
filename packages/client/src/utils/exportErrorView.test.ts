import { describe, expect, it } from 'vitest'
import type { ExportGuardFailure } from '@ses/io'
import { exportErrorViewOf, exportErrorViewOfText } from './exportErrorView'

type FailureFields = Pick<ExportGuardFailure, 'summary' | 'items' | 'detail'>

const failure = (overrides: Partial<FailureFields> = {}): FailureFields => ({
  summary: '导出被阻止：DOCX 有 2 处内容暂不能导出',
  items: [
    'DOCX 暂未支持此信息：doc.body[0].children[2].content[1].image（节点 g3-scope-p）。请保留 JSON 文档。【节点 g3-scope-p，位置 doc.body[0].children[2].content[1].image】',
    'DOCX 暂未支持此信息：doc.body[5].children[1].legend（节点 g3-fig-1）。请保留 JSON 文档。【节点 g3-fig-1，位置 doc.body[5].children[1].legend】',
  ],
  detail: '导出被阻止：甲；乙',
  ...overrides,
})

describe('exportErrorViewOf（导出被阻止提示的显示形态）', () => {
  it('概述一行，明细逐条一行，条数与顺序不变', () => {
    const input = failure()
    const view = exportErrorViewOf(input)
    expect(view.summary).toBe('导出被阻止：DOCX 有 2 处内容暂不能导出')
    expect(view.items).toEqual(input.items)
    // 概述里没有任何明细，明细里也不再含连接各条的全角分号分段
    expect(view.summary).not.toContain('；')
    for (const item of view.items) expect(view.summary).not.toContain(item)
  })

  it('明细去掉首尾空白并丢弃空条目，不合并、不截断', () => {
    const long = `${'很长的路径'.repeat(80)}doc.body[0].children[0].content[0].image`
    const view = exportErrorViewOf(failure({ items: ['  甲  ', '', '   ', long] }))
    expect(view.items).toEqual(['甲', long])
  })

  it('概述或明细缺失时退回连成一段的 detail，保证仍有可读提示', () => {
    expect(exportErrorViewOf(failure({ items: [] }))).toEqual({ summary: '导出被阻止：甲；乙', items: [] })
    expect(exportErrorViewOf(failure({ summary: '  ' }))).toEqual({ summary: '导出被阻止：甲；乙', items: [] })
    expect(exportErrorViewOf(failure({ items: ['', ' '] }))).toEqual({ summary: '导出被阻止：甲；乙', items: [] })
  })

  it('不修改传入的失败信息', () => {
    const input = failure()
    const snapshot = structuredClone(input)
    exportErrorViewOf(input)
    expect(input).toEqual(snapshot)
  })
})

describe('exportErrorViewOfText（只有一段文字的导出错误）', () => {
  it('整段作为概述，没有明细', () => {
    expect(exportErrorViewOfText('DOCX 导出失败：磁盘已满')).toEqual({ summary: 'DOCX 导出失败：磁盘已满', items: [] })
    expect(exportErrorViewOfText('')).toEqual({ summary: '', items: [] })
  })
})
