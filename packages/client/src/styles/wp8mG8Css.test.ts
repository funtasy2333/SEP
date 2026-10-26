import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const css = readFileSync(fileURLToPath(new URL('./standard-nodes.css', import.meta.url)), 'utf8')

/**
 * 这里只钉住样式表的结构；真实浏览器里的列宽行为（40%/60% → 约 4:6，拖拽后 px 生效、columns 不变）
 * 由 G8-b 的 spike 在 Chrome 中验证，结论写在交付报告里。
 */
describe('[M-6.1-03] standard-nodes.css：名义列宽（stdTable.columns）显示', () => {
  it('仅在带 data-columns 的 stdTable 内生效：固定表格布局 + 整宽', () => {
    expect(css).toMatch(/\.std-table-wrapper\[data-columns\] table\s*\{\s*table-layout:\s*fixed;\s*width:\s*100%;\s*\}/)
  })

  it('第 1～40 列的 <col> 各取 var(--ses-col-<n>)；选择器不依赖 .tableWrapper（无视图 DOM 没有这一层）', () => {
    for (let n = 1; n <= 40; n += 1) {
      expect(css, `列 ${n}`).toContain(`.std-table-wrapper[data-columns] colgroup > col:nth-child(${n}) { width: var(--ses-col-${n}); }`)
    }
    expect(css).not.toContain('col:nth-child(41)')
    expect(css.replace(/\/\*[\s\S]*?\*\//g, '')).not.toMatch(/data-columns[^{]*\.tableWrapper/)
  })

  it('不使用 !important：有 colwidth 的列靠 TableView 写的内联 width 自然优先', () => {
    const start = css.indexOf('.std-table-wrapper[data-columns] table {')
    const end = css.indexOf('.std-table-caption-en')
    expect(start).toBeGreaterThan(-1)
    expect(end).toBeGreaterThan(start)
    expect(css.slice(start, end).replace(/\/\*[\s\S]*?\*\//g, '')).not.toContain('!important')
  })
})
