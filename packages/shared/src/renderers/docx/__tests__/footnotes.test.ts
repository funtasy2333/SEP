import { describe, expect, it } from 'vitest'
import type { IRTable } from '../../../ir/types'
import { resolve } from '../../../ir/resolve'
import { footnoteFixture } from '../../__tests__/footnoteFixture'
import { renderDocxTraced } from '../render'
import { assertChildOrder, assertFootnoteIntegrity, assertWellFormed } from './helpers/checks'

const OPTIONS = {
  formulaOmml: {}, images: {}, stage: 'approval_draft' as const, createdAt: '2026-10-02T00:00:00.000Z',
}

describe('DOCX 原生脚注与表脚注', () => {
  it('输出真实 Word 脚注部件、连续编号、自定义 1) 标识和受控短分隔线', () => {
    const doc = footnoteFixture()
    const { labels, problems } = resolve(doc)
    expect(problems.filter((problem) => problem.code.endsWith('footnote'))).toEqual([])
    const { pkg } = renderDocxTraced(doc, labels, OPTIONS)

    expect(pkg.parts['word/footnotes.xml']).toContain('<w:footnote w:id="1">')
    expect(pkg.parts['word/footnotes.xml']).toContain('<w:t xml:space="preserve">1)</w:t>')
    expect(pkg.parts['word/footnotes.xml']).toContain('<w:t xml:space="preserve">1)</w:t></w:r><w:r><w:tab/></w:r>')
    expect(pkg.parts['word/footnotes.xml']).not.toContain('<w:footnoteRef')
    expect(pkg.parts['word/footnotes.xml']).toContain('w:type="separator" w:id="-1"')
    expect(pkg.parts['word/footnotes.xml']).toContain('w:type="continuationSeparator" w:id="0"')
    expect(pkg.parts['word/footnotes.xml']).toContain('<w:ind w:left="28" w:right="7044"/>')
    expect(pkg.parts['word/document.xml']).toContain('w:footnoteReference w:id="1" w:customMarkFollows="1"')
    expect(pkg.parts['word/settings.xml']).toContain('<w:pos w:val="pageBottom"/>')
    expect(pkg.parts['word/settings.xml']).toContain('<w:numRestart w:val="continuous"/>')
    expect(pkg.parts['[Content_Types].xml']).toContain('/word/footnotes.xml')
    expect(pkg.parts['word/_rels/document.xml.rels']).toContain('relationships/footnotes')
    expect(pkg.parts['word/styles.xml']).toContain('w:styleId="SesFootnoteText"')
    expect(pkg.parts['word/styles.xml']).toContain('w:styleId="SesTableFootnote"')
    expect(() => assertWellFormed(pkg)).not.toThrow()
    expect(() => assertChildOrder(pkg)).not.toThrow()
    expect(() => assertFootnoteIntegrity(pkg)).not.toThrow()
  })

  it('表注与表脚注使用独立全宽行，表脚注按 resolver 首次引用顺序排列', () => {
    const doc = footnoteFixture()
    const { labels } = resolve(doc)
    const { pkg } = renderDocxTraced(doc, labels, OPTIONS)
    const document = pkg.parts['word/document.xml']!
    const notesAt = document.indexOf('<w:t xml:space="preserve">表注内容</w:t>')
    const tableFootnoteAt = document.indexOf('<w:t xml:space="preserve">a</w:t>', notesAt)
    const firstDefinitionAt = document.indexOf('<w:t xml:space="preserve">定义B</w:t>', tableFootnoteAt)
    const secondDefinitionAt = document.indexOf('<w:t xml:space="preserve">定义A</w:t>', firstDefinitionAt)
    expect(notesAt).toBeGreaterThan(-1)
    expect(tableFootnoteAt).toBeGreaterThan(notesAt)
    expect(firstDefinitionAt).toBeGreaterThan(tableFootnoteAt)
    expect(secondDefinitionAt).toBeGreaterThan(firstDefinitionAt)
    expect(document.slice(tableFootnoteAt, firstDefinitionAt)).toContain('<w:t xml:space="preserve">a</w:t></w:r><w:r><w:tab/></w:r>')
    expect((document.match(/<w:gridSpan w:val="2"\/>/g) ?? []).length).toBeGreaterThanOrEqual(2)
  })

  it('即使全局 labels 含目标，跨表脚注引用也在 renderer 入口拒绝', () => {
    const doc = footnoteFixture()
    const firstTable = doc.body[0]!.children[0] as IRTable
    const foreign: IRTable = {
      ...firstTable,
      id: 'table-2', caption: [{ text: '跨表引用' }],
      rows: [{ id: 'foreign-row', cells: [{
        id: 'foreign-cell', colspan: 1, rowspan: 1, header: false,
        content: [{ kind: 'paragraph', id: 'foreign-p', content: [{
          text: '引用', marks: [{ type: 'tableFootnoteRef', targetId: 'table-fn-a' }],
        }] }],
      }] }],
      notes: [], footnotes: [],
    }
    doc.body[0]!.children.push(foreign)
    const { labels, problems } = resolve(doc)
    expect(labels['table-fn-a']).toBeDefined()
    expect(problems.some((problem) => problem.code === 'dangling-footnote')).toBe(true)
    expect(() => renderDocxTraced(doc, labels, OPTIONS)).toThrow('脚注关联无效')
  })

  it.each([true, false])('空源文字的交叉引用按实际输出判断空格：目标有效=%s', (validTarget) => {
    const doc = footnoteFixture()
    const table = doc.body[0]!.children[0] as IRTable
    table.notes = []
    table.footnotes = []
    table.rows[0]!.cells[0]!.content = [{
      kind: 'paragraph', id: 'xref-only-p',
      content: [{ text: '', marks: [{ type: 'crossRef', targetId: validTarget ? 'chapter-1' : 'missing-target' }] }],
    }]
    const { labels } = resolve(doc)
    const { pkg } = renderDocxTraced(doc, labels, OPTIONS)
    const cells = pkg.parts['word/document.xml']!.match(/<w:tc>[\s\S]*?<\/w:tc>/g)!
    // 表题是表外段落，不在任何单元格内；第一个单元格就是源文字为空的数据格。
    expect(cells[0]).toContain(`<w:t xml:space="preserve">${validTarget ? labels['chapter-1']!.refText : '—'}</w:t>`)
    if (validTarget) expect(cells[0]).not.toContain('>—</w:t>')
    assertWellFormed(pkg)
    assertChildOrder(pkg)
  })

  it.each([true, false])('含条文脚注时仅混合横排发出实际分页限制提示：横排=%s', (landscape) => {
    const doc = footnoteFixture()
    const table = doc.body[0]!.children[0] as IRTable
    table.orientation = landscape ? 'landscape' : 'portrait'
    const { labels } = resolve(doc)
    const { pkg } = renderDocxTraced(doc, labels, OPTIONS)
    expect(pkg.warnings.filter(warning => warning.code === 'footnote-landscape-separator')).toHaveLength(landscape ? 1 : 0)
  })

  it('无脚注文档继续省略脚注部件与新增脚注样式', () => {
    const doc = footnoteFixture()
    doc.front.foreword = []
    const table = doc.body[0]!.children[0] as IRTable
    table.footnotes = undefined
    table.rows[0]!.cells[0]!.content = [{ kind: 'paragraph', id: 'cell-p-1', content: [{ text: '无脚注' }] }]
    const { labels } = resolve(doc)
    const { pkg } = renderDocxTraced(doc, labels, OPTIONS)
    expect(pkg.parts['word/footnotes.xml']).toBeUndefined()
    expect(pkg.parts['word/settings.xml']).not.toContain('<w:footnotePr>')
    expect(pkg.parts['word/styles.xml']).not.toContain('SesFootnoteText')
    expect(pkg.parts['word/styles.xml']).not.toContain('SesTableFootnote')
  })
})
