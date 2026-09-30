/**
 * numbering.ts 单元测试（docs/wp7-docx-delivery.md §9 WP7.2「测试」numbering 一项）。
 *
 * A1–A16 逐级与 §4.2 一致（numFmt、lvlText、suff、ind、rPr）；固定实例的 numId；按需实例从 101
 * 递增、每级都有 startOverride；交错时新建实例、起始值为 N；附录实例的 L0 覆盖。
 */

import { describe, expect, it } from 'vitest'
import type { IRBlock, IRList } from '../../ir/types'
import { createRenderContext } from './body/context'
import { renderBlocks } from './body/block'
import { ABSTRACT_NUM_ID, createNumberingAllocator, listAbstractNumId } from './numbering'
import { findChild } from './__tests__/helpers/xmlTree'
import { parseXml, type XmlElement } from './__tests__/helpers/xmlTree'

function abstractNums(root: XmlElement): Map<string, XmlElement> {
  const map = new Map<string, XmlElement>()
  for (const child of root.children) {
    if (child.kind === 'element' && child.name === 'w:abstractNum') {
      map.set(child.attrs['w:abstractNumId'], child)
    }
  }
  return map
}

function nums(root: XmlElement): Map<string, XmlElement> {
  const map = new Map<string, XmlElement>()
  for (const child of root.children) {
    if (child.kind === 'element' && child.name === 'w:num') {
      map.set(child.attrs['w:numId'], child)
    }
  }
  return map
}

function levels(abs: XmlElement): Map<number, XmlElement> {
  const map = new Map<number, XmlElement>()
  for (const child of abs.children) {
    if (child.kind === 'element' && child.name === 'w:lvl') {
      map.set(Number(child.attrs['w:ilvl']), child)
    }
  }
  return map
}

function lvlAttr(lvl: XmlElement, child: string): string | undefined {
  const el = findChild(lvl, child)
  return el?.attrs['w:val']
}

function lvlInd(lvl: XmlElement): Record<string, string> {
  const pPr = findChild(lvl, 'w:pPr')
  const ind = pPr && findChild(pPr, 'w:ind')
  return ind ? { ...ind.attrs } : {}
}

function lvlRFonts(lvl: XmlElement): string | undefined {
  const rPr = findChild(lvl, 'w:rPr')
  return rPr && findChild(rPr, 'w:rFonts')?.attrs['w:ascii']
}

function lvlRFontsAttrs(lvl: XmlElement): Record<string, string> | undefined {
  const rPr = findChild(lvl, 'w:rPr')
  const fonts = rPr && findChild(rPr, 'w:rFonts')
  return fonts ? { ...fonts.attrs } : undefined
}

describe('numbering.ts：静态部分（16 个 abstractNum + 8 个固定实例）', () => {
  const xml = createNumberingAllocator().buildNumberingXml()
  const root = parseXml(xml)
  const abs = abstractNums(root)
  const numEls = nums(root)

  it('16 个 abstractNum 全部输出，id 为 1–16', () => {
    expect([...abs.keys()].map(Number).sort((a, b) => a - b)).toEqual(Array.from({ length: 16 }, (_, i) => i + 1))
  })

  it('A1、A2、A11–A15 为 multilevel，其余为 singleLevel', () => {
    const multilevelIds = new Set([1, 2, 11, 12, 13, 14, 15])
    for (const [idStr, el] of abs) {
      const id = Number(idStr)
      const type = findChild(el, 'w:multiLevelType')?.attrs['w:val']
      expect(type).toBe(multilevelIds.has(id) ? 'multilevel' : 'singleLevel')
    }
  })

  it('A1 章条：L0 decimal "%1　"，L3 "%1.%2.%3.%4　"，各级标识黑体，缩进 left=0 firstLine=0', () => {
    const lv = levels(abs.get('1')!)
    expect(lv.size).toBe(6) // L0..L5
    expect(lvlAttr(lv.get(0)!, 'w:lvlText')).toBe('%1　')
    expect(lvlAttr(lv.get(0)!, 'w:numFmt')).toBe('decimal')
    expect(lvlAttr(lv.get(3)!, 'w:lvlText')).toBe('%1.%2.%3.%4　')
    for (const ilvl of [0, 1, 2, 3, 4, 5]) {
      expect(lvlRFonts(lv.get(ilvl)!)).toBe('黑体')
      expect(lvlInd(lv.get(ilvl)!)).toEqual({ 'w:left': '0', 'w:firstLine': '0' })
      expect(lvlAttr(lv.get(ilvl)!, 'w:suff')).toBe('nothing')
    }
  })

  it('A2 附录：L0 upperLetter "附录%1"，黑体 + 字符间距 210；L1 "%1.%2　" 黑体（无间距）', () => {
    const lv = levels(abs.get('2')!)
    expect(lvlAttr(lv.get(0)!, 'w:numFmt')).toBe('upperLetter')
    expect(lvlAttr(lv.get(0)!, 'w:lvlText')).toBe('附录%1')
    const rPr0 = findChild(lv.get(0)!, 'w:rPr')!
    expect(findChild(rPr0, 'w:spacing')?.attrs['w:val']).toBe('210')
    expect(lvlAttr(lv.get(1)!, 'w:lvlText')).toBe('%1.%2　')
    const rPr1 = findChild(lv.get(1)!, 'w:rPr')!
    expect(findChild(rPr1, 'w:spacing')).toBeUndefined()
  })

  it('A3/A4 正文图表：singleLevel，"图%1　"/"表%1　"，无 rPr', () => {
    expect(lvlAttr(levels(abs.get('3')!).get(0)!, 'w:lvlText')).toBe('图%1　')
    expect(lvlAttr(levels(abs.get('4')!).get(0)!, 'w:lvlText')).toBe('表%1　')
    expect(findChild(levels(abs.get('3')!).get(0)!, 'w:rPr')).toBeUndefined()
  })

  it('A7 注：none "注："，左 780 悬挂 360，黑体', () => {
    const l0 = levels(abs.get('7')!).get(0)!
    expect(lvlAttr(l0, 'w:numFmt')).toBe('none')
    expect(lvlAttr(l0, 'w:lvlText')).toBe('注：')
    expect(lvlInd(l0)).toEqual({ 'w:left': '780', 'w:hanging': '360' })
    expect(lvlRFonts(l0)).toBe('黑体')
  })

  it('A8 注 X：decimal "注%1："，左 870 悬挂 450，黑体', () => {
    const l0 = levels(abs.get('8')!).get(0)!
    expect(lvlAttr(l0, 'w:lvlText')).toBe('注%1：')
    expect(lvlInd(l0)).toEqual({ 'w:left': '870', 'w:hanging': '450' })
  })

  it('A9/A10 示例：首行 420，黑体', () => {
    expect(lvlInd(levels(abs.get('9')!).get(0)!)).toEqual({ 'w:left': '0', 'w:firstLine': '420' })
    expect(lvlInd(levels(abs.get('10')!).get(0)!)).toEqual({ 'w:left': '0', 'w:firstLine': '420' })
    expect(lvlAttr(levels(abs.get('9')!).get(0)!, 'w:lvlText')).toBe('示例：')
    expect(lvlAttr(levels(abs.get('10')!).get(0)!, 'w:lvlText')).toBe('示例%1：')
  })

  it('A11 破折号列项：L0 bullet "——" suff=nothing，L1 bullet "·" suff=tab', () => {
    const lv = levels(abs.get('11')!)
    expect(lvlAttr(lv.get(0)!, 'w:numFmt')).toBe('bullet')
    expect(lvlAttr(lv.get(0)!, 'w:lvlText')).toBe('——')
    expect(lvlAttr(lv.get(0)!, 'w:suff')).toBe('nothing')
    expect(lvlInd(lv.get(0)!)).toEqual({ 'w:left': '840', 'w:hanging': '420' })
    expect(lvlRFontsAttrs(lv.get(0)!)).toEqual({
      'w:ascii': '宋体',
      'w:eastAsia': '宋体',
      'w:hAnsi': '宋体',
      'w:cs': '宋体',
    })
    expect(lvlAttr(lv.get(1)!, 'w:lvlText')).toBe('·')
    expect(lvlAttr(lv.get(1)!, 'w:suff')).toBe('tab')
    expect(lvlInd(lv.get(1)!)).toEqual({ 'w:left': '1260', 'w:hanging': '420' })
    expect(lvlRFontsAttrs(lv.get(1)!)).toEqual({
      'w:ascii': '宋体',
      'w:eastAsia': '宋体',
      'w:hAnsi': '宋体',
      'w:cs': '宋体',
    })
  })

  it('A12–A15：首层字母/数字用全角右括号，次层统一用间隔号', () => {
    const expectFmt: [string, string][] = [
      ['12', 'lowerLetter'],
      ['13', 'decimal'],
      ['14', 'decimal'],
      ['15', 'decimal'],
    ]
    for (const [id, l0Fmt] of expectFmt) {
      const lv = levels(abs.get(id)!)
      expect(lvlAttr(lv.get(0)!, 'w:numFmt')).toBe(l0Fmt)
      expect(lvlAttr(lv.get(0)!, 'w:lvlText')).toBe('%1）')
      expect(lvlAttr(lv.get(0)!, 'w:suff')).toBe('tab')
      expect(lvlInd(lv.get(0)!)).toEqual({ 'w:left': '840', 'w:hanging': '420' })
      expect(lvlAttr(lv.get(1)!, 'w:numFmt')).toBe('bullet')
      expect(lvlAttr(lv.get(1)!, 'w:lvlText')).toBe('·')
      expect(lvlAttr(lv.get(1)!, 'w:suff')).toBe('tab')
      expect(lvlInd(lv.get(1)!)).toEqual({ 'w:left': '1260', 'w:hanging': '420' })
      for (const ilvl of [0, 1]) {
        expect(lvlRFontsAttrs(lv.get(ilvl)!)).toEqual({
          'w:ascii': '宋体',
          'w:eastAsia': '宋体',
          'w:hAnsi': '宋体',
          'w:cs': '宋体',
        })
      }
    }
    expect(xml).not.toMatch(/w:val="(?:lowerRoman|upperRoman)"/)
  })

  it('A16 参考文献：编号标识为宋体，ASCII、East Asia、HAnsi 和复杂文字均明确指定', () => {
    const l0 = levels(abs.get('16')!).get(0)!
    expect(lvlAttr(l0, 'w:lvlText')).toBe('[%1]　')
    expect(lvlInd(l0)).toEqual({ 'w:left': '0', 'w:firstLine': '420' })
    expect(lvlRFontsAttrs(l0)).toEqual({
      'w:ascii': '宋体',
      'w:eastAsia': '宋体',
      'w:hAnsi': '宋体',
      'w:cs': '宋体',
    })
  })

  it('固定实例（numId=abstractNumId）恰好 8 个：A1/A2/A3/A4/A7/A9/A11/A16，都没有 lvlOverride', () => {
    const fixedIds = ['1', '2', '3', '4', '7', '9', '11', '16']
    expect([...numEls.keys()].sort((a, b) => Number(a) - Number(b))).toEqual(fixedIds.sort((a, b) => Number(a) - Number(b)))
    for (const id of fixedIds) {
      const el = numEls.get(id)!
      expect(findChild(el, 'w:abstractNumId')?.attrs['w:val']).toBe(id)
      expect(el.children.filter((c) => c.kind === 'element' && c.name === 'w:lvlOverride')).toHaveLength(0)
    }
  })
})

describe('numbering.ts：按需实例分配器（§4.3）', () => {
  it('多条注：同一作用域键沿用同一实例，换作用域键新建（从 101 起）', () => {
    const alloc = createNumberingAllocator()
    const a = alloc.allocNoteInstance('scope-1', 1)
    const b = alloc.allocNoteInstance('scope-1', 2) // 同一组第二条：沿用实例
    expect(b).toBe(a)
    expect(a).toBe(101)
    const c = alloc.allocNoteInstance('scope-2', 1) // 换作用域：新建
    expect(c).toBe(102)
    const d = alloc.allocNoteInstance('scope-1', 3) // 交错回第一组：新建，startOverride=3
    expect(d).toBe(103)
    expect(d).not.toBe(a)

    const xml = alloc.buildNumberingXml()
    const root = parseXml(xml)
    const numEls = nums(root)
    // 第一次新建：startOverride = ordinalInScope 传入的 1
    const override101 = findChild(numEls.get('101')!, 'w:lvlOverride')!
    expect(override101.attrs['w:ilvl']).toBe('0')
    expect(findChild(override101, 'w:startOverride')?.attrs['w:val']).toBe('1')
    // 交错新建：startOverride = 3（回到第一组时的序号，不是从 1 重新开始）
    const override103 = findChild(numEls.get('103')!, 'w:lvlOverride')!
    expect(findChild(override103, 'w:startOverride')?.attrs['w:val']).toBe('3')
  })

  it('注与示例共用同一个全局递增计数器（不是各自从 101 起）', () => {
    const alloc = createNumberingAllocator()
    const noteId = alloc.allocNoteInstance('n1', 1)
    const exampleId = alloc.allocExampleInstance('e1', 1)
    expect(noteId).toBe(101)
    expect(exampleId).toBe(102)
  })

  it('附录图/表：同一附录复用同一实例，L0 被完整覆盖为 "图{字母}.%1　"', () => {
    const alloc = createNumberingAllocator()
    const figA1 = alloc.allocAppendixFigureInstance('app-a', 'A')
    const figA2 = alloc.allocAppendixFigureInstance('app-a', 'A')
    expect(figA2).toBe(figA1)
    const tblA = alloc.allocAppendixTableInstance('app-a', 'A')
    expect(tblA).not.toBe(figA1)
    const figB = alloc.allocAppendixFigureInstance('app-b', 'B')
    expect(figB).not.toBe(figA1)

    const xml = alloc.buildNumberingXml()
    const root = parseXml(xml)
    const numEls = nums(root)
    const overrideA = findChild(numEls.get(String(figA1))!, 'w:lvlOverride')!
    expect(findChild(overrideA, 'w:startOverride')?.attrs['w:val']).toBe('1')
    const fullLvl = findChild(overrideA, 'w:lvl')!
    expect(fullLvl.attrs['w:ilvl']).toBe('0')
    expect(findChild(fullLvl, 'w:lvlText')?.attrs['w:val']).toBe('图A.%1　')

    const overrideB = findChild(numEls.get(String(figB))!, 'w:lvlOverride')!
    const fullLvlB = findChild(overrideB, 'w:lvl')!
    expect(findChild(fullLvlB, 'w:lvlText')?.attrs['w:val']).toBe('图B.%1　')
  })

  it('编号列表：每次调用新建实例，ilvl 0 与 1 都写 startOverride=1（不论是否用到 L1）', () => {
    const alloc = createNumberingAllocator()
    const id1 = alloc.allocListInstance(ABSTRACT_NUM_ID.listAlpha)
    const id2 = alloc.allocListInstance(ABSTRACT_NUM_ID.listAlpha)
    expect(id2).not.toBe(id1) // 每次都新建，不像注/示例那样按作用域复用

    const xml = alloc.buildNumberingXml()
    const root = parseXml(xml)
    const numEl = nums(root).get(String(id1))!
    const overrides = numEl.children.filter((c): c is XmlElement => c.kind === 'element' && c.name === 'w:lvlOverride')
    expect(overrides).toHaveLength(2)
    const byIlvl = new Map(overrides.map((o) => [o.attrs['w:ilvl'], o]))
    expect(findChild(byIlvl.get('0')!, 'w:startOverride')?.attrs['w:val']).toBe('1')
    expect(findChild(byIlvl.get('1')!, 'w:startOverride')?.attrs['w:val']).toBe('1')
  })

  it('按需实例的 numId 按渲染时第一次需要它的顺序全局递增，不因种类不同而各自归零', () => {
    const alloc = createNumberingAllocator()
    const ids = [
      alloc.allocListInstance(ABSTRACT_NUM_ID.listAlpha),
      alloc.allocAppendixFigureInstance('app-a', 'A'),
      alloc.allocNoteInstance('s1', 1),
      alloc.allocListInstance(ABSTRACT_NUM_ID.listNumber),
    ]
    expect(ids).toEqual([101, 102, 103, 104])
  })
})

describe('listAbstractNumId：§4.4 列表类型 → 按需实例 abstractNum', () => {
  it('alpha/number 使用对应编号；旧罗马类型降级到数字编号 A13', () => {
    expect(listAbstractNumId('alpha')).toBe(ABSTRACT_NUM_ID.listAlpha)
    expect(listAbstractNumId('number')).toBe(ABSTRACT_NUM_ID.listNumber)
    expect(listAbstractNumId('roman')).toBe(ABSTRACT_NUM_ID.listNumber)
    expect(listAbstractNumId('romanUpper')).toBe(ABSTRACT_NUM_ID.listNumber)
  })

  it('boxed 退化为 number（A13），调用方另记 list-format-fallback', () => {
    expect(listAbstractNumId('boxed')).toBe(ABSTRACT_NUM_ID.listNumber)
  })

  it('未知类型抛错（dash 不经过这里，调用方直接用属主样式）', () => {
    expect(() => listAbstractNumId('dash')).toThrow(/dash 不经过这里/)
    expect(() => listAbstractNumId('unknown')).toThrow()
  })
})

describe('列项段落渲染', () => {
  function list(id: string, listType: IRList['listType'], children: IRList[] = []): IRList {
    return {
      kind: 'list',
      id,
      listType,
      items: [{
        id: `${id}-item`,
        content: [
          { kind: 'paragraph', id: `${id}-p`, content: [{ text: id }] },
          ...children,
        ],
      }],
    }
  }

  it('二级数字列项保留 1）编号并使用二级缩进，间隔号列项使用二级样式', () => {
    const number = { ...list('number', 'number'), level: 2 as const }
    const ctx = createRenderContext({})
    const xml = renderBlocks(ctx, [number, list('dot', 'dot')], { scopeKey: 'scope' })
    expect(xml).toMatch(/w:pStyle w:val="SesListItem"[^]*w:ilvl w:val="0"[^]*w:ind w:left="1260" w:hanging="420"/)
    expect(xml).toContain('<w:pStyle w:val="SesListDot"/>')
    expect(ctx.warnings).toEqual([])
  })

  it('二级数字列项保留数字编号，其他历史嵌套类型按间隔号兼容', () => {
    const parentTypes: IRList['listType'][] = ['dash', 'alpha', 'number', 'roman', 'romanUpper']
    const childTypes: IRList['listType'][] = ['dash', 'alpha', 'number', 'boxed', 'roman', 'romanUpper']
    const blocks: IRBlock[] = parentTypes.map((parentType, i) =>
      list(`parent-${i}`, parentType, childTypes.map((childType, j) => list(`child-${i}-${j}`, childType))),
    )
    const ctx = createRenderContext({})
    const paragraphs = renderBlocks(ctx, blocks, { scopeKey: 'scope' })
    const numberingXml = ctx.numbering.buildNumberingXml()

    expect(paragraphs.match(/w:ilvl w:val="1"/g)).toHaveLength(20)
    expect(paragraphs.match(/w:ind w:left="1260" w:hanging="420"/g)).toHaveLength(6)
    expect(paragraphs.match(/w:pStyle w:val="SesListDot"/g)).toHaveLength(5)
    expect(numberingXml).toContain('<w:numFmt w:val="bullet"/>')
    expect(numberingXml).toContain('<w:lvlText w:val="·"/>')
    expect(ctx.warnings).toEqual([])
  })

  it('第三层及更深层保留超层警告并尽量使用间隔号', () => {
    const blocks: IRBlock[] = [list('l1', 'alpha', [
      list('l2', 'number', [list('l3', 'number')]),
    ])]
    const ctx = createRenderContext({})
    const paragraphs = renderBlocks(ctx, blocks, { scopeKey: 'scope' })
    const numberingXml = ctx.numbering.buildNumberingXml()

    expect(paragraphs.match(/w:pStyle w:val="SesListDot"/g)).toHaveLength(1)
    expect(paragraphs).not.toContain('>1）<')
    expect(numberingXml).toContain('<w:lvlText w:val="·"/>')
    expect(ctx.warnings.filter((warning) => warning.code === 'list-too-deep')).toHaveLength(1)
  })
})
