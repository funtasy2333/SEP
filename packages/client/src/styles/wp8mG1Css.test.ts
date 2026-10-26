import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const css = readFileSync(fileURLToPath(new URL('./standard-nodes.css', import.meta.url)), 'utf8')

describe('[M-4.4.2.3-03] [M-4.4.2.3-04] standard-nodes.css：规范性引用文件清单显示', () => {
  it('.std-norm-ref 首行缩进 2 字（空两个汉字起排，回行顶格，10.3.4），与条文段相同', () => {
    expect(css).toMatch(/\.std-norm-ref\s*\{[^}]*text-indent:\s*2em;/)
    expect(css).toMatch(/\.std-paragraph\s*\{[^}]*text-indent:\s*2em;/)
  })

  it('文件编号与名称之间的一个汉字由 ::before 添加（U+3000，不入节点内容），两个子节点同行显示', () => {
    expect(css).toMatch(/\.std-norm-ref-title::before\s*\{\s*content:\s*'\\3000';\s*\}/)
    expect(css).toMatch(/\.std-norm-ref-no,\s*\.std-norm-ref-title\s*\{\s*display:\s*inline;\s*\}/)
  })

  it('空名称不显示间隔，空编号保留最小宽度，避免 ProseMirror 的 trailing <br> 把名称挤到下一行', () => {
    expect(css).toContain('.std-norm-ref-title:has(> .ProseMirror-trailingBreak:only-child)::before')
    expect(css).toMatch(/\.std-norm-ref-no:has\(> \.ProseMirror-trailingBreak:only-child\)\s*\{[^}]*display:\s*inline-block;/)
  })
})

describe('[M-10.2-01] [M-10.2-02] [M-10.1.7-01] standard-nodes.css：标准引用 mark 用弱样式', () => {
  it('.std-std-ref / .std-mixed-citation 为点状下划线，不改字体、不用交叉引用的蓝色', () => {
    const block = /\.std-std-ref,\s*\.std-mixed-citation\s*\{([^}]*)\}/.exec(css)![1]!
    expect(block).toContain('text-decoration: underline dotted;')
    expect(block).not.toMatch(/font-|color:\s*#0066cc/)
  })
})
