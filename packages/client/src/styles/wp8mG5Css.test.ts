import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const css = readFileSync(fileURLToPath(new URL('./standard-nodes.css', import.meta.url)), 'utf8')

describe('[M-9.2.9-01] standard-nodes.css：术语领域显示', () => {
  it('.std-term-subject-field 的 〈 〉 由 ::before/::after 添加（不入节点内容），与定义同款缩进', () => {
    expect(css).toMatch(/\.std-term-subject-field::before\s*\{\s*content:\s*'\\3008';\s*\}/)
    expect(css).toMatch(/\.std-term-subject-field::after\s*\{\s*content:\s*'\\3009';\s*\}/)
    expect(css).toMatch(/\.std-term-subject-field\s*\{[^}]*text-indent:\s*2em;/)
  })

  it('空领域节点不显示括号，避免 ProseMirror 的 trailing <br> 把 〉 挤到下一行', () => {
    expect(css).toContain('.std-term-subject-field:has(> .ProseMirror-trailingBreak:only-child)::before')
    expect(css).toContain('.std-term-subject-field:has(> .ProseMirror-trailingBreak:only-child)::after')
  })
})
