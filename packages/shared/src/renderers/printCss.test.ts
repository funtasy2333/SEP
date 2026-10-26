import { describe, expect, it } from 'vitest'
import { printCss } from './printCss'

describe('printCss 列项标记', () => {
  // WP8.M G7-c（D-M-06 A 真排）：原断言「roman/romanUpper 同一条规则按数字显示、CSS 里不得出现 lower/upper-roman 计数器」；
  // 小写罗马现用 lower-roman 计数器（M-5.7-04），大写罗马（无原文取值）仍按数字显示，upper-roman 仍不得出现。
  it('[M-5.7-04] 首层 alpha/number 使用全角右括号，roman 用 lower-roman 计数器，大写罗马降级为数字编号', () => {
    const css = printCss()
    expect(css).toContain('.ses-list-number > .ses-list-item::before { content: counter(ses-li) "） "; }')
    expect(css).toContain('.ses-list-alpha > .ses-list-item::before { content: counter(ses-li, lower-alpha) "） "; }')
    expect(css).toContain('.ses-list-roman > .ses-list-item::before { content: counter(ses-li, lower-roman) "） "; }')
    expect(css).toContain('.ses-list-romanUpper > .ses-list-item::before { content: counter(ses-li) "） "; }')
    expect(css).not.toMatch(/counter\(ses-li, upper-roman\)/)
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
