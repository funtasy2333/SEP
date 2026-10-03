import { describe, expect, it } from 'vitest'
import type { IRDoc, IRTable } from '../../ir/types'
import { resolve } from '../../ir/resolve'
import { renderHtml } from '../html'
import { footnoteFixture } from './footnoteFixture'

function render(doc: IRDoc, variant: 'screen' | 'print' = 'print'): { html: string; labels: ReturnType<typeof resolve>['labels'] } {
  const { labels } = resolve(doc)
  return { html: renderHtml(doc, labels, { variant }), labels }
}

describe('HTML/Vivliostyle 脚注', () => {
  it('条文脚注作为页底浮动内容，标签来自 Resolver', () => {
    const { html, labels } = render(footnoteFixture())
    expect(labels['body-fn-1']).toEqual({ label: '1)', xmlId: 'fn_1', refText: '1)' })
    expect(html).toContain('class="ses-footnote" role="doc-footnote" id="fn_1" data-label="1)"><span class="ses-footnote-marker"><sup>1)</sup></span><span class="ses-footnote-text">')
    expect(html).toContain('.ses-footnote {\n  float: footnote;')
    expect(html).toContain('  margin-inline-start: 4em;\n  text-indent: 0;')
    expect(html).toContain('.ses-footnote::footnote-marker {\n  content: none;\n}')
    expect(html).toContain('.ses-footnote-marker { float: left; width: 2em; margin-inline-start: -2em;')
    expect(html).toContain('@footnote::before')
    expect(html).toContain('width: 41.25mm;')
  })

  it('屏幕预览保留行内脚注内容与标记，不输出 print 悬挂结构', () => {
    const { html } = render(footnoteFixture(), 'screen')
    expect(html).toContain('<span class="ses-footnote" role="doc-footnote" id="fn_1" data-label="1)">前言脚注内容</span>')
    expect(html).not.toContain('class="ses-footnote-marker"')
    expect(html).toContain('.ses-footnote::before { content: attr(data-label);')
  })

  it('表注与表脚注进入 tfoot 的独立全宽行，定义按首次引用标签排序', () => {
    const { html, labels } = render(footnoteFixture())
    expect(labels['table-fn-b']?.label).toBe('a')
    expect(labels['table-fn-a']?.label).toBe('b')
    const tableStart = html.indexOf('<table')
    const tfoot = html.indexOf('<tfoot>', tableStart)
    const notesRow = html.indexOf('<tr class="ses-table-notes">', tfoot)
    const footnotesRow = html.indexOf('<tr class="ses-table-footnotes">', tfoot)
    const tableEnd = html.indexOf('</table>', tfoot)
    expect(tableStart).toBeGreaterThan(-1)
    expect(tfoot).toBeGreaterThan(tableStart)
    expect(notesRow).toBeGreaterThan(tfoot)
    expect(footnotesRow).toBeGreaterThan(notesRow)
    expect(tableEnd).toBeGreaterThan(footnotesRow)
    const tableFooter = html.slice(tfoot, tableEnd)
    expect(tableFooter.indexOf('表注内容')).toBeLessThan(tableFooter.indexOf('定义B'))
    expect(tableFooter.indexOf('<sup>a</sup></span><span class="ses-table-footnote-text">定义B')).toBeLessThan(
      tableFooter.indexOf('<sup>b</sup></span><span class="ses-table-footnote-text">定义A'),
    )
    expect(tableFooter).toContain('id="tabfn_tab_1_a"')
    expect(tableFooter).toContain('id="tabfn_tab_1_b"')
    expect(html).toContain('.ses-table-footnote { font-size: var(--ses-fs-xiaowu); margin-left: 2em; text-indent: -1em;')
    expect(html).toContain('.ses-table-footnote-marker { display: inline-block; width: calc(1em - 1pt);')
  })

  it('表注脚注外框为 0.75pt，二者之间的分隔线保持 0.25pt', () => {
    const { html } = render(footnoteFixture())
    expect(html).toContain('.ses-table-notes td, .ses-table-footnotes td { border-left-width: 0.75pt; border-right-width: 0.75pt; }')
    expect(html).toContain('.ses-table-notes td { border-top-width: 0.75pt; }')
    expect(html).toContain('.ses-table-notes:not(:last-child) td { border-bottom-width: 0.25pt; }')
    expect(html).toContain('.ses-table-footnotes td { border-top-width: 0.25pt; }')
    expect(html).toContain('.ses-table-footnotes:first-child td { border-top-width: 0.75pt; }')
    expect(html).toContain('.ses-table-notes:last-child td, .ses-table-footnotes td { border-bottom-width: 0.75pt; }')
  })

  it('跨表引用即使全局 labels 有目标也拒绝渲染', () => {
    const doc = footnoteFixture()
    const firstTable = doc.body[0]!.children[0] as IRTable
    const foreign: IRTable = {
      ...firstTable,
      id: 'table-2',
      caption: [{ text: '跨表引用' }],
      rows: [{
        id: 'foreign-row', cells: [{
          id: 'foreign-cell', colspan: 1, rowspan: 1, header: false,
          content: [{ kind: 'paragraph', id: 'foreign-p', content: [{
            text: '引用', marks: [{ type: 'tableFootnoteRef', targetId: 'table-fn-a' }],
          }] }],
        }],
      }],
      notes: [],
      footnotes: [],
    }
    doc.body[0]!.children.push(foreign)
    const { labels, problems } = resolve(doc)
    expect(labels['table-fn-a']).toBeDefined()
    expect(problems.some((problem) => problem.code === 'dangling-footnote')).toBe(true)
    expect(() => renderHtml(doc, labels, { variant: 'print' })).toThrow('脚注关联无效')
  })
})
