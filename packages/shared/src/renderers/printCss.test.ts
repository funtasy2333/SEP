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

describe('printCss 术语条目分页（M-Z-c F-2）', () => {
  /** 取某条规则的声明块（规则须独占一条，选择器前是行首）。 */
  const rule = (css: string, selector: string): string => {
    const start = css.split('\n').findIndex((line) => line.startsWith(`${selector} {`))
    if (start < 0) throw new Error(`找不到规则 ${selector}`)
    const line = css.split('\n')[start]!
    return line.slice(line.indexOf('{') + 1, line.lastIndexOf('}'))
  }

  it('编号行与术语名行都不与其后的行分页，避免编号行孤立在页尾', () => {
    const css = printCss()
    for (const selector of ['.ses-term-num-line', '.ses-term-head']) {
      const declarations = rule(css, selector)
      expect(declarations, selector).toContain('break-after: avoid;')
      expect(declarations, selector).toContain('page-break-after: avoid;')
    }
  })

  it('不给整个术语条目设 break-inside: avoid（长定义、注、示例整体跳页会留下大片空白）', () => {
    const css = printCss()
    expect(rule(css, '.ses-term-entry')).not.toMatch(/break-inside|page-break-inside/)
    // 整个样式表里也没有任何对术语条目整体的不分页声明
    expect(css).not.toMatch(/\.ses-term-entry[^{]*\{[^}]*break-inside\s*:\s*avoid/)
    // 定义、来源等后续行不被强制与下一行相连：只有编号行与术语名行设 break-after
    expect(rule(css, '.ses-term-def')).not.toMatch(/break-after/)
    expect(rule(css, '.ses-term-source')).not.toMatch(/break-after/)
  })

  it('原有版式声明保持不变（黑体加粗、无外边距）', () => {
    const css = printCss()
    for (const selector of ['.ses-term-num-line', '.ses-term-head']) {
      const declarations = rule(css, selector)
      expect(declarations).toContain('font-family: var(--ses-hei);')
      expect(declarations).toContain('font-weight: bold;')
      expect(declarations).toContain('margin: 0;')
    }
  })
})
