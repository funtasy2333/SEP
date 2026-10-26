import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const css = readFileSync(fileURLToPath(new URL('./standard-nodes.css', import.meta.url)), 'utf8')

describe('[M-8.5-01] standard-nodes.css：图例显示', () => {
  it('图例项复用 .std-where-item：两列（符号在前、释义在后），间隔一个汉字，覆盖公式式中的 4em 缩进', () => {
    expect(css).toMatch(/\.std-figure-legend\s*\{[^}]*text-align:\s*left;/)
    expect(css).toMatch(/\.std-figure-legend > \.std-where-item\s*\{[^}]*gap:\s*1em;[^}]*padding-left:\s*2em;/)
  })

  it('取消公式式中的“——”与“式中：”引导；图例没有“式中：”伪元素', () => {
    expect(css).toMatch(/\.std-figure-legend > \.std-where-item > dd::before\s*\{\s*content:\s*none;\s*\}/)
    expect(css).not.toMatch(/\.std-figure-legend::before/)
  })

  it('空符号格占位为“符号”，空标题占位为“图例标题”（用 :has 识别 ProseMirror 的 trailing br，不依赖 :empty）', () => {
    expect(css).toMatch(/\.std-figure-legend > \.std-where-item > dt\.def-term-empty::before\s*\{\s*content:\s*'符号';/)
    expect(css).toMatch(/\.std-figure-legend-title:has\(> \.ProseMirror-trailingBreak:only-child\)::before\s*\{\s*content:\s*'图例标题';/)
  })
})

describe('[M-8.2-11][M-8.4-03] standard-nodes.css：图内的注与示例', () => {
  it('图居中，图内的注与示例改回左起排（标签仍由 data-resolved-label 提供）', () => {
    expect(css).toMatch(/\.std-figure \{[^}]*text-align:\s*center;/)
    expect(css).toMatch(/\.std-figure > \.std-note,\s*\.std-figure > \.std-example\s*\{\s*text-align:\s*left;\s*\}/)
    expect(css).toContain('.tiptap [data-resolved-label].std-example::before')
  })
})

describe('[M-8.3-02] standard-nodes.css：行内图', () => {
  it('跟随行高垂直居中；S/M/L 分别为 1.2em / 2.4em / 3.6em（8.3 表 2：单/双/三倍行高）', () => {
    expect(css).toMatch(/\.std-inline-image\s*\{[^}]*vertical-align:\s*middle;[^}]*max-height:\s*1\.2em;/)
    expect(css).toMatch(/\.std-inline-image\[data-size='S'\]\s*\{[^}]*height:\s*1\.2em;/)
    expect(css).toMatch(/\.std-inline-image\[data-size='M'\]\s*\{[^}]*height:\s*2\.4em;/)
    expect(css).toMatch(/\.std-inline-image\[data-size='L'\]\s*\{[^}]*height:\s*3\.6em;/)
  })

  it('选中时描边（行内原子可选中）', () => {
    expect(css).toMatch(/\.std-inline-image\.ProseMirror-selectednode\s*\{[^}]*outline:/)
  })
})
