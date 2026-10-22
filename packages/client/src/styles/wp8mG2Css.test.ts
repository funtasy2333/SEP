import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const css = readFileSync(fileURLToPath(new URL('./standard-nodes.css', import.meta.url)), 'utf8')

describe('[M-10.1.4-01] standard-nodes.css：缩略语表显示', () => {
  it('.std-def-list 与公式式中共用项节点：项为 flex 行，缩略语在前、释义在后，间隔一个汉字（1em）', () => {
    expect(css).toMatch(/\.std-def-list\s*\{[^}]*width:\s*100%;/)
    expect(css).toMatch(/\.std-def-list > \.std-where-item\s*\{[^}]*gap:\s*1em;[^}]*padding-left:\s*2em;/)
  })

  it('取消公式式中的“——”与“式中：”引导（它们只对 .std-where-list / .std-where-item 生效）', () => {
    expect(css).toMatch(/\.std-def-list > \.std-where-item > dd::before\s*\{\s*content:\s*none;\s*\}/)
    // 缩略语表没有“式中：”伪元素
    expect(css).not.toMatch(/\.std-def-list::before/)
  })

  it('空术语格占位为“缩略语”，与公式式中的“点击插入符号”区分', () => {
    expect(css).toMatch(/\.std-def-list > \.std-where-item > dt\.def-term-empty::before\s*\{\s*content:\s*'缩略语';/)
    expect(css).toContain(".std-where-item > dt.where-term-empty::before {\n  content: '点击插入符号';")
  })
})
