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

  it('所有嵌套层级优先使用间隔号', () => {
    expect(printCss()).toContain('.ses-list .ses-list > .ses-list-item::before { content: "·"; counter-increment: none; }')
  })
})
