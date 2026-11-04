import { describe, expect, it } from 'vitest'
import { diffDocuments, docToText } from './docDiff'

const t = (text: string) => ({ type: 'text', text })
const p = (text: string) => ({ type: 'paragraph', content: [t(text)] })
const item = (text: string) => ({ type: 'stdListItem', content: [t(text)] })
const blockItem = (...children: unknown[]) => ({ type: 'stdListBlockItem', content: children })
const stdList = (...items: unknown[]) => ({ type: 'stdList', attrs: { listType: 'dash' }, content: items })

function doc(...blocks: unknown[]) {
  return {
    type: 'doc',
    content: [{
      type: 'chapter',
      content: [{ type: 'chapterTitle', content: [t('要求')] }, ...blocks],
    }],
  }
}

describe('版本对比：块级列项（stdListBlockItem）', () => {
  it('普通列项输出保持原样', () => {
    const text = docToText(doc(stdList(item('普通列项'), item('第二项'))))
    expect(text.split('\n')).toEqual([
      expect.stringContaining('要求'),
      '  — 普通列项',
      '  — 第二项',
      '',
    ])
  })

  it('块级列项的第一段与普通列项同样以“— ”开头，不再被跳过', () => {
    const text = docToText(doc(stdList(item('普通列项'), blockItem(p('块级列项旧文字')))))
    expect(text).toContain('  — 普通列项')
    expect(text).toContain('  — 块级列项旧文字')
  })

  it('后续段落、嵌套 stdList、bulletList、orderedList 都按深度缩进输出', () => {
    const text = docToText(doc(stdList(
      blockItem(
        p('第一段'),
        p('第二段'),
        stdList(item('嵌套普通项'), blockItem(p('嵌套块级首段'), p('嵌套块级次段'))),
        { type: 'bulletList', content: [
          { type: 'listItem', content: [p('圆点一'), { type: 'orderedList', content: [{ type: 'listItem', content: [p('更深的编号项')] }] }] },
          { type: 'listItem', content: [p('圆点二')] },
        ] },
        { type: 'orderedList', attrs: { start: 3 }, content: [
          { type: 'listItem', content: [p('编号三')] },
          { type: 'listItem', content: [p('编号四')] },
        ] },
      ),
    )))
    expect(text.split('\n').slice(1, -1)).toEqual([
      '  — 第一段',
      '    第二段',
      '    — 嵌套普通项',
      '    — 嵌套块级首段',
      '      嵌套块级次段',
      '    • 圆点一',
      '      1. 更深的编号项',
      '    • 圆点二',
      '    3. 编号三',
      '    4. 编号四',
    ])
  })

  it('块级列项内文字不重复输出', () => {
    const text = docToText(doc(stdList(blockItem(p('只出现一次'), { type: 'bulletList', content: [{ type: 'listItem', content: [p('子项只一次')] }] }))))
    expect(text.match(/只出现一次/g)).toHaveLength(1)
    expect(text.match(/子项只一次/g)).toHaveLength(1)
  })

  it('两个版本只在块级列项文字上不同，diffDocuments 能检测到差异', () => {
    const oldDoc = doc(stdList(item('普通列项'), blockItem(p('块级列项旧文字'))))
    const newDoc = doc(stdList(item('普通列项'), blockItem(p('块级列项新文字'))))
    const { lines, stats } = diffDocuments(oldDoc, newDoc)
    expect(stats.added).toBeGreaterThan(0)
    expect(stats.removed).toBeGreaterThan(0)
    expect(lines.filter(l => l.type === 'removed').map(l => l.text)).toEqual(['  — 块级列项旧文字'])
    expect(lines.filter(l => l.type === 'added').map(l => l.text)).toEqual(['  — 块级列项新文字'])
    expect(lines.find(l => l.text === '  — 普通列项')?.type).toBe('unchanged')
  })

  it('只改块级列项内的后续段落或嵌套列表项也能检测到', () => {
    const build = (second: string, nested: string) => doc(stdList(blockItem(p('首段'), p(second), stdList(item(nested)))))
    const base = build('次段', '嵌套项')
    expect(diffDocuments(base, build('次段', '嵌套项')).stats).toMatchObject({ added: 0, removed: 0 })
    expect(diffDocuments(base, build('次段改', '嵌套项')).stats.added).toBe(1)
    expect(diffDocuments(base, build('次段', '嵌套项改')).stats.added).toBe(1)
  })

  it('空的块级列项输出“— ”行，不抛错', () => {
    expect(() => docToText(doc(stdList(blockItem())))).not.toThrow()
    expect(docToText(doc(stdList(blockItem())))).toContain('  — ')
  })
})
