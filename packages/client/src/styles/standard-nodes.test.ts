import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const css = readFileSync(fileURLToPath(new URL('./standard-nodes.css', import.meta.url)), 'utf8')
const editorContentVue = readFileSync(fileURLToPath(new URL('../components/editor/EditorContent.vue', import.meta.url)), 'utf8')

describe('standard-nodes.css 列项标记', () => {
  // WP8.M G7-a：原断言「CSS 不得出现 lower/upper-roman 计数器，罗马类型退化为数字标记」；小写罗马现为受支持的列项类型。
  it('alpha/number 使用全角右括号，罗马列项用 lower-roman 计数器，大写罗马仍退化为数字标记', () => {
    expect(css).toContain("counter(alpha-counter, lower-alpha) '） '")
    expect(css).toContain("counter(numeric-counter) '） '")
    expect(css).toContain("counter(roman-counter, lower-roman) '） '")
    expect(css).not.toMatch(/counter\([^)]*upper-roman/)
    // roman 不再共用数字计数器；romanUpper 仍与数字列项共用
    expect(css).not.toMatch(/\.std-list-roman\s+\.std-list-item::before,\s*\.std-list-romanUpper/)
    expect(css).toMatch(/\.std-list-numeric \.std-list-item::before,\n\.std-list-romanUpper \.std-list-item::before/)
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

/** 样式表（或 SFC）里所有选择器列表含 needle 的规则声明块。 */
function rulesMatching(source: string, needle: RegExp): string[] {
  const found: string[] = []
  for (const match of source.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (needle.test(match[1]!)) found.push(match[2]!)
  }
  return found
}

describe('standard-nodes.css 条标题：1–5 级字体、字重、字号、外边距统一（按类名，不按 h3–h6 标签）', () => {
  it('.std-clause-title 统一使用 --ses-font-zh-hei、字重 700、14px（五号）与同一外边距', () => {
    const rule = declarations('.std-clause-title')
    expect(rule).toContain('font-family: var(--ses-font-zh-hei)')
    expect(rule).toContain('font-weight: 700')
    expect(rule).toContain('font-size: 14px')
    expect(rule).toContain('margin: 12px 0 6px')
  })

  it('不再按级别单独设置条标题的字号/字体/外边距（一级 15px 等差异已去除）', () => {
    for (const level of [1, 2, 3, 4, 5]) {
      expect(css, `.std-clause-title-${level} 不应再有独立规则`).not.toMatch(new RegExp(`\\.std-clause-title-${level}\\s*[,{]`))
    }
  })

  it('条标题与无题条编号都不再硬编码 SimHei/Heiti SC（Mac 上 Heiti SC 偏细），统一走字体变量', () => {
    const rules = [
      ...rulesMatching(css, /\.std-clause-title/),
      ...rulesMatching(editorContentVue, /std-clause-title/),
    ]
    expect(rules.length).toBeGreaterThan(0)
    for (const rule of rules) {
      expect(rule).not.toMatch(/SimHei|Heiti/)
      if (/font-family/.test(rule)) expect(rule).toContain('var(--ses-font-zh-hei)')
    }
  })

  it('编号 ::before 规则（含附录、data-resolved-label）只给内容，不覆盖字体/字号/字重，继承标题本身', () => {
    const numbering = rulesMatching(css, /\.std-clause-title::before/).filter(rule => !/\bfloat\b/.test(rule))
    const generated = numbering.filter(rule => rule.includes('content:'))
    // 5 级 × (章 + 附录) + 1 条 data-resolved-label 规则 + 无题条 ::before 字体规则
    expect(generated.length).toBeGreaterThanOrEqual(11)
    for (const rule of generated) expect(rule).not.toMatch(/font-(family|size|weight)/)
  })

  it('无题条编号块（::before）与整块同一字体变量、字重 700', () => {
    expect(declarations('.std-clause[data-has-title="false"] > .std-clause-title')).toContain('font-family: var(--ses-font-zh-hei)')
    const before = declarations('.std-clause[data-has-title="false"] > .std-clause-title::before')
    expect(before).toContain('font-family: var(--ses-font-zh-hei)')
    expect(before).toContain('font-weight: 700')
  })

  it('不影响无题条同排布局：浮动规则仍清零外边距并继承字号', () => {
    const rule = declarations('.std-clause[data-has-title="false"] > .std-clause-title:has(+ .std-paragraph)')
    expect(rule).toContain('float: left')
    expect(rule).toContain('margin: 0')
    expect(rule).toContain('font-size: inherit')
  })
})

describe('EditorContent.vue：标签选择器 h3/h4 不再作用于条标题', () => {
  it('h3/h4 规则排除 .std-clause-title（h3 另被索引分组标签使用，不能整体删除）', () => {
    expect(editorContentVue).toContain('.tiptap h3:not(.std-clause-title)')
    expect(editorContentVue).toContain('.tiptap h4:not(.std-clause-title)')
    expect(editorContentVue).not.toMatch(/\.tiptap h[3-6]\)?\s*\{/)
  })

  it('不存在 h5/h6 的标签规则；章标题（h2）规则不受影响', () => {
    expect(editorContentVue).not.toMatch(/\.tiptap h[56]/)
    expect(editorContentVue).toMatch(/\.tiptap h2\)?\s*\{/)
  })
})
