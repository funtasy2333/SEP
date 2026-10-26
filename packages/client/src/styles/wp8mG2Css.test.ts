import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const css = readFileSync(fileURLToPath(new URL('./standard-nodes.css', import.meta.url)), 'utf8')

describe('[M-10.1.4-01] standard-nodes.css：缩略语表显示', () => {
  it('.std-def-list 与公式式中共用项节点：项为 flex 行，缩略语在前、释义在后；冒号自带间隔，不再另留间隙', () => {
    expect(css).toMatch(/\.std-def-list\s*\{[^}]*width:\s*100%;/)
    // 设计 D-M-16（M-Z-c F-3）：原“间隔一个汉字（gap: 1em）”改为全角冒号，故 gap 为 0
    expect(css).toMatch(/\.std-def-list > \.std-where-item\s*\{[^}]*gap:\s*0;[^}]*padding-left:\s*2em;/)
    expect(css).not.toMatch(/\.std-def-list > \.std-where-item\s*\{[^}]*gap:\s*1em/)
  })

  it('[M-Z-c F-3] 缩略语后用 dt::after 显示全角冒号“：”（生成内容，不入模型）；空缩略语占位时不显示冒号', () => {
    expect(css).toMatch(/\.std-def-list > \.std-where-item > dt::after\s*\{\s*content:\s*'：';\s*\}/)
    expect(css).toMatch(/\.std-def-list > \.std-where-item > dt\.def-term-empty::after\s*\{\s*content:\s*none;\s*\}/)
    // 占位与释义之间仍留一个汉字
    expect(css).toMatch(/\.std-def-list > \.std-where-item > dt\.def-term-empty\s*\{\s*margin-right:\s*1em;\s*\}/)
    // 冒号只作用于缩略语表，不影响公式式中与图例
    expect(css).not.toMatch(/(^|\n)\.std-where-item > dt::after/)
    expect(css).not.toMatch(/\.std-figure-legend[^{]*dt::after/)
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
