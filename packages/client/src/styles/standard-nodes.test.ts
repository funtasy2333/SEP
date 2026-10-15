import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const css = readFileSync(fileURLToPath(new URL('./standard-nodes.css', import.meta.url)), 'utf8')

describe('standard-nodes.css 列项标记', () => {
  it('alpha/number 使用全角右括号，旧罗马类型退化为数字标记', () => {
    expect(css).toContain("counter(alpha-counter, lower-alpha) '） '")
    expect(css).toContain("counter(numeric-counter) '） '")
    expect(css).not.toMatch(/counter\([^)]*(?:lower|upper)-roman/)
  })

  it('嵌套列项使用间隔号', () => {
    expect(css).toContain(".std-list .std-list:not(.std-list-numeric) .std-list-item::before {\n  content: '·';\n  margin-right: 0.5em;")
  })

  it('数字列项与间隔号列项均再缩进一层', () => {
    expect(css).toContain('.std-list-dot .std-list-item::before')
    expect(css).toContain('.std-list-numeric,')
    expect(css).toContain('padding-left: 4em')
  })
})

/** 取出以 selector 开头的规则声明块（selector 须与样式表原文一致）。 */
function declarations(selector: string): string {
  const start = css.indexOf(`${selector} {`)
  expect(start, `缺少规则 ${selector}`).toBeGreaterThan(-1)
  return css.slice(start, css.indexOf('}', start))
}

describe('standard-nodes.css 无题条编号与首段同排', () => {
  it('空 clauseTitle 左浮动，只显示编号；仅当紧随其后的是正文段时才浮动', () => {
    const rule = declarations('.std-clause[data-has-title="false"] > .std-clause-title:has(+ .std-paragraph)')
    expect(rule).toContain('float: left')
    expect(rule).toContain('text-indent: 0')
  })

  it('紧随编号的首个正文段不缩进，文字接排在编号之后', () => {
    expect(declarations('.std-clause[data-has-title="false"] > .std-clause-title + .std-paragraph')).toContain('text-indent: 0')
  })

  it('浮动编号被条自身清除，不会溢出到后续内容', () => {
    const rule = declarations('.std-clause[data-has-title="false"]::after')
    expect(rule).toContain('clear: both')
    expect(rule).toContain('display: table')
  })

  it('编号内容规则按条级别、附录前缀与 data-resolved-label 作用在同一个 clauseTitle::before 上', () => {
    expect(css).toContain('.std-appendix .std-clause-level-1 > .std-clause-title::before')
    expect(css).toContain('.tiptap [data-resolved-label].std-clause-title::before')
  })
})
