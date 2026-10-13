import { describe, expect, it } from 'vitest'
import type { OutlineItem } from './types'
import { buildOutline } from './outline'
import {
  appendix, bibEntry, bibliography, chapter, clone, deepFreeze, doc, foreword, formula, node, para,
  richDocument, simpleTable, smallDocument, text,
} from './testFixtures'

const find = (items: OutlineItem[], nodeId: string): OutlineItem | undefined => {
  for (const item of items) {
    if (item.nodeId === nodeId) return item
    const nested = find(item.children ?? [], nodeId)
    if (nested) return nested
  }
  return undefined
}

describe('buildOutline', () => {
  const outline = buildOutline(deepFreeze(richDocument()))

  it('章、条、附录带 Resolver 编号、标题与层级', () => {
    expect(outline.body.map(item => [item.nodeId, item.number, item.title])).toEqual([
      ['ch-scope', '1', '范围'], ['ch-refs', '2', '规范性引用文件'], ['ch-terms', '3', '术语和定义'], ['ch-4', '4', '技术要求'],
    ])
    expect(outline.body[0]).toMatchObject({ kind: 'chapter', secType: 'scope' })
    const cl42 = find(outline.body, 'cl-42')!
    expect(cl42).toMatchObject({ kind: 'clause', number: '4.2', title: '详细要求', level: 1 })
    expect(cl42.children!.map(item => [item.nodeId, item.number, item.level])).toEqual([['cl-421', '4.2.1', 2], ['cl-422', '4.2.2', 2]])
    expect(find(outline.body, 'cl-421')!.title).toBe('')
    expect(outline.appendices.map(item => [item.nodeId, item.number, item.normative])).toEqual([
      ['app-a', '附录A', true], ['app-b', '附录B', false],
    ])
    expect(find(outline.appendices, 'cl-a2')!.number).toBe('A.2')
  })

  it('术语条目、表、图、公式带编号与题注，附录内重新编号', () => {
    expect(find(outline.body, 'term-3')).toEqual({ nodeId: 'term-3', kind: 'termEntry', number: '3.3', title: '多语术语' })
    expect(find(outline.body, 'tbl-1')).toEqual({ nodeId: 'tbl-1', kind: 'table', number: '表1', title: '性能指标' })
    expect(find(outline.body, 'fig-1')).toMatchObject({ kind: 'figure', number: '图1', title: '系统架构图' })
    expect(find(outline.body, 'f-1')).toMatchObject({ kind: 'formula', number: '(1)', title: 'E = mc^2' })
    expect(find(outline.appendices, 'tbl-a1')).toMatchObject({ number: '表A.1' })
    expect(find(outline.appendices, 'f-a1')).toMatchObject({ number: '(A.1)' })
  })

  it('段落、列项、注等块不逐个列出，只给数量', () => {
    expect(find(outline.body, 'cl-41')).toMatchObject({ blockCount: 6, children: [] })
    expect(find(outline.body, 'p-411')).toBeUndefined()
    expect(find(outline.body, 'list-1')).toBeUndefined()
    // cl-422：1 个段落 + 1 个警告块未列出
    expect(find(outline.body, 'cl-422')!.blockCount).toBe(2)
  })

  it('前言、引言、参考文献体现是否存在与数量', () => {
    expect(outline.foreword).toEqual({ present: true, blockCount: 2, items: [] })
    expect(outline.introduction).toEqual({ present: true, blockCount: 1, items: [] })
    expect(outline.bibliography).toEqual({ present: true, entryCount: 3 })
  })

  it('前言里的表和公式单独列出，不编号的公式没有编号', () => {
    const pm = doc(
      foreword(para('p', text('说明')), simpleTable('t-fw', '前言表'), formula('f-fw', 'a=b', { numbered: false })),
      chapter('c', '范围', para('q', text('x'))),
    )
    const result = buildOutline(pm)
    expect(result.foreword.blockCount).toBe(1)
    expect(result.foreword.items).toEqual([
      { nodeId: 't-fw', kind: 'table', number: '表1', title: '前言表' },
      { nodeId: 'f-fw', kind: 'formula', title: 'a=b' },
    ])
  })

  it('没有前言、引言、参考文献时 present 为 false', () => {
    const result = buildOutline(smallDocument())
    expect(result.foreword).toEqual({ present: false, blockCount: 0, items: [] })
    expect(result.introduction.present).toBe(false)
    expect(result.appendices).toEqual([])
    expect(result.bibliography).toEqual({ present: false, entryCount: 0 })
  })

  it('过长的公式源码被截断为摘要', () => {
    const latex = `x=${'a+'.repeat(60)}b`
    const result = buildOutline(doc(chapter('c', '范围', formula('f', latex))))
    const title = find(result.body, 'f')!.title
    expect(title.length).toBe(60)
    expect(title.endsWith('…')).toBe(true)
  })

  it('标题里的换行和多余空白折叠为单个空格', () => {
    const pm = doc(node('chapter', { nodeId: 'c', secType: 'general' }, [
      node('chapterTitle', undefined, [text('甲'), { type: 'hardBreak' }, text('  乙')]),
    ]))
    expect(buildOutline(pm).body[0]!.title).toBe('甲 乙')
  })

  it('不修改入参，结果可 JSON 往返', () => {
    const pm = deepFreeze(clone(richDocument()))
    expect(() => buildOutline(pm)).not.toThrow()
    expect(JSON.parse(JSON.stringify(outline))).toEqual(outline)
  })

  it('空文档与只有附录、参考文献的文档不报错', () => {
    expect(buildOutline(doc()).body).toEqual([])
    const only = buildOutline(doc(appendix('a', false, '附录', para('p', text('x'))), bibliography(bibEntry('b', '文献'))))
    expect(only.appendices).toHaveLength(1)
    expect(only.bibliography.entryCount).toBe(1)
  })
})
