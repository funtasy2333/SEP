import { describe, expect, it } from 'vitest'
import { DEFAULT_XML_PROBLEM_LIMIT, formatXmlProblems } from './xmlProblems'

describe('formatXmlProblems', () => {
  it('空列表返回空字符串', () => {
    expect(formatXmlProblems([])).toBe('')
  })

  it('3 项及以内完整展示并保留 nodeId 与 path 定位信息', () => {
    expect(formatXmlProblems([
      { message: '缺少标题' },
      { message: '资源缺失', path: 'resources/fig_1.png' },
      { message: '术语越界', nodeId: 'term-1', path: 'doc.appendices[0].children[0]' },
    ])).toBe(
      '缺少标题；资源缺失【位置 resources/fig_1.png】；术语越界【节点 term-1，位置 doc.appendices[0].children[0]】',
    )
  })

  it('超过默认上限（3 项）时截断并给出总数，避免 toast 溢出视口', () => {
    const problems = Array.from({ length: 80 }, (_, index) => ({
      message: `不支持旧格式 XML（SEP 早期格式）：发现 elem_${index + 1}`,
    }))
    const formatted = formatXmlProblems(problems)
    expect(DEFAULT_XML_PROBLEM_LIMIT).toBe(3)
    expect(formatted).toBe(
      '不支持旧格式 XML（SEP 早期格式）：发现 elem_1；不支持旧格式 XML（SEP 早期格式）：发现 elem_2；不支持旧格式 XML（SEP 早期格式）：发现 elem_3……等共 80 项问题',
    )
    expect(formatted).not.toContain('elem_4')
  })

  it('支持自定义上限，并对非正上限回退到默认值', () => {
    const problems = [
      { message: '错误1', nodeId: 'n1' },
      { message: '错误2', path: '/a' },
      { message: '错误3' },
      { message: '错误4' },
    ]
    expect(formatXmlProblems(problems, 2)).toBe('错误1【节点 n1】；错误2【位置 /a】……等共 4 项问题')
    expect(formatXmlProblems(problems, 0)).toBe('错误1【节点 n1】；错误2【位置 /a】；错误3……等共 4 项问题')
  })
})
