import { describe, expect, it } from 'vitest'
import { printCss } from './printCss'

describe('printCss 列项标记', () => {
  it('首层 alpha/number 使用全角右括号，旧罗马类降级为数字编号', () => {
    const css = printCss()
    expect(css).toContain('.ses-list-number > .ses-list-item::before { content: counter(ses-li) "） "; }')
    expect(css).toContain('.ses-list-alpha > .ses-list-item::before { content: counter(ses-li, lower-alpha) "） "; }')
    expect(css).toContain('.ses-list-roman > .ses-list-item::before,')
    expect(css).toContain('content: counter(ses-li) "） ";')
    expect(css).not.toMatch(/counter\(ses-li, (?:lower|upper)-roman\)/)
  })

  it('嵌套数字列项保留编号，其他嵌套列项使用间隔号', () => {
    expect(printCss()).toContain('.ses-list .ses-list:not(.ses-list-number) > .ses-list-item::before { content: "·"; counter-increment: none; }')
  })
})

it('表题不叠加粗体，普通单元格段落默认顶格', () => {
  const css = printCss()
  const caption = /\.ses-table-caption \{([^}]+)\}/.exec(css)![1]!
  expect(caption).toContain('font-weight: normal;')
  expect(css).toContain('.ses-table-block td > .ses-paragraph, .ses-table-block th > .ses-paragraph { text-indent: 0; }')
})
